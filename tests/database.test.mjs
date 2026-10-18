import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const url = process.env.TEST_DATABASE_URL;
test('PostgreSQL security and conversation integration', {skip: !url && 'Set TEST_DATABASE_URL to an isolated strangertalk_test database.'}, async t => {
  const pool = new pg.Pool({connectionString:url,max:24});
  const database = (await pool.query('select current_database() as name')).rows[0].name;
  if (!database.endsWith('_test')) { await pool.end(); throw new Error('Refusing destructive fixtures outside a database whose name ends in _test.'); }
  try {
    await pool.query(`drop schema if exists private cascade; drop schema if exists public cascade; drop schema if exists auth cascade; drop schema if exists storage cascade;
      drop publication if exists supabase_realtime; create schema public; create schema auth;
      do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role nologin; end if; end $$;
      grant usage on schema public,auth to authenticated,anon;
      create schema storage;
      grant usage on schema storage to authenticated,anon;
      create table storage.buckets(id text primary key,name text not null,public boolean not null,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null,owner_id text);
      alter table storage.objects enable row level security;
      grant select,insert,delete on storage.objects to authenticated;
      create table auth.users(id uuid primary key, is_anonymous boolean default true, email text, banned_until timestamptz, raw_user_meta_data jsonb not null default '{}'::jsonb, created_at timestamptz default now(),last_sign_in_at timestamptz default now());
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create publication supabase_realtime;`);
    await pool.query(await readFile(new URL('../supabase/migrations/202610170001_strangertalk.sql',import.meta.url),'utf8'));
    await pool.query(await readFile(new URL('../supabase/migrations/202610170003_group_chat.sql',import.meta.url),'utf8'));
    await pool.query(await readFile(new URL('../supabase/migrations/202610180001_delete_chat_on_leave.sql',import.meta.url),'utf8'));
    await pool.query(await readFile(new URL('../supabase/migrations/202610180002_campus_events.sql',import.meta.url),'utf8'));
    await pool.query(await readFile(new URL('../supabase/migrations/202610180003_college_directory.sql',import.meta.url),'utf8'));
    await pool.query(await readFile(new URL('../supabase/migrations/202610180004_college_scopes.sql',import.meta.url),'utf8'));
    await pool.query(await readFile(new URL('../supabase/migrations/202610180005_refresh_postgrest_college_schema.sql',import.meta.url),'utf8'));
    await pool.query(await readFile(new URL('../supabase/migrations/202610180006_group_approval.sql',import.meta.url),'utf8'));
    await pool.query(await readFile(new URL('../supabase/migrations/202610180007_chat_privacy_fixes.sql',import.meta.url),'utf8'));
    await pool.query(await readFile(new URL('../supabase/migrations/202610180008_account_management.sql',import.meta.url),'utf8'));
    await pool.query(await readFile(new URL('../supabase/migrations/202610180009_admin_college_groups.sql',import.meta.url),'utf8'));
    await pool.query("insert into private.colleges(name) values('Test University'),('Other University') on conflict do nothing");
    const makeUser = async (college='Test University') => {
      const user = {id:randomUUID(),client:randomUUID(),college};
      await pool.query('insert into auth.users(id,raw_user_meta_data) values($1,jsonb_build_object(\'college_name\',$2::text))',[user.id,college]);
      return user;
    };
    const asUser = async (u,query,values=[]) => {
      const connection = await pool.connect();
      try {
        await connection.query('begin'); await connection.query('set local role authenticated');
        await connection.query("select set_config('request.jwt.claim.sub',$1,true)",[u.id]);
        const result = await connection.query(query,values); await connection.query('commit'); return result;
      } catch(e) { await connection.query('rollback'); throw e; }
      finally { connection.release(); }
    };
    const call = async (u,name,values=[]) => (await asUser(u,`select to_jsonb(public.${name}(${[u.client,...values].map((_,i)=>'$'+(i+1)).join(',')})) as result`,[u.client,...values])).rows[0].result;
    const enroll = async u => {
      const session=await call(u,'st_begin',[true,'2026-10-17']);
      const college=(await pool.query('select id from private.colleges where name=$1 and is_active',[u.college])).rows[0];
      if (college) await call(u,'cm_set_my_college',[college.id]);
      return session;
    };
    const reset = async () => {
      await pool.query('delete from auth.users; truncate private.user_reports,private.moderation_actions');
      await pool.query("insert into private.colleges(name) values('Test University'),('Other University') on conflict do nothing");
    };
    const resetRates = async u => pool.query('delete from private.rate_limits where user_id=$1',[u.id]);
    let a,b,c,sid;
    await t.test('anonymous identity requires adult consent and correct policy',async () => {
      a=await makeUser(); b=await makeUser(); c=await makeUser();
      await assert.rejects(call(a,'st_begin',[false,'2026-10-17']),/adults/);
      await assert.rejects(call(a,'st_begin',[true,'old']),/guidelines/);
      assert.equal((await enroll(a)).state,'idle'); await enroll(b); await enroll(c);
      await assert.rejects(call({...a,client:randomUUID()},'st_begin',[true,'2026-10-17']),/another tab/);
    });
    await t.test('waits for a real second user and creates exactly one shared session',async () => {
      assert.equal((await call(a,'st_join')).state,'waiting');
      assert.equal((await pool.query('select count(*) from public.chat_sessions')).rows[0].count,'0');
      const snapshot=await call(b,'st_join'); assert.equal(snapshot.state,'chat'); sid=snapshot.session.id;
      assert.equal((await call(a,'st_heartbeat')).session.id,sid);
      const duplicate=await Promise.all(Array.from({length:8},()=>call(a,'st_join')));
      assert.ok(duplicate.every(s=>s.session.id===sid));
      assert.equal((await pool.query('select count(*) from private.active_members')).rows[0].count,'2');
    });
    await t.test('messages, nonce retry, typing, flood and content filters are server enforced',async () => {
      const nonce=randomUUID();
      const m=await call(a,'st_send',[sid,'Hello, stranger!',nonce]);
      assert.equal(m.body,'Hello, stranger!');
      assert.equal((await call(a,'st_send',[sid,'Hello, stranger!',nonce])).id,m.id);
      await assert.rejects(call(a,'st_send',[sid,'different',nonce]),/identifier/);
      assert.equal((await asUser(b,'select * from public.chat_messages where session_id=$1',[sid])).rows.length,1);
      await assert.rejects(call(a,'st_send',[sid,'Too fast',randomUUID()]),/slow down/);
      await assert.rejects(call(b,'st_send',[sid,'https://scam.example',randomUUID()]),/blocked/);
      await call(b,'st_send',[sid,'Hi there!',randomUUID()]);
      await call(a,'st_typing',[sid,true]);
      assert.ok(new Date((await call(b,'st_heartbeat')).session.typing_b_until ?? (await call(b,'st_heartbeat')).session.typing_a_until)>new Date());
    });
    await t.test('outsiders cannot read messages, forge membership, write tables or inspect reports',async () => {
      assert.equal((await asUser(c,'select * from public.chat_messages')).rows.length,0);
      assert.equal((await asUser(c,'select * from public.chat_sessions')).rows.length,0);
      await assert.rejects(call(c,'st_send',[sid,'intrusion',randomUUID()]),/ended/);
      await assert.rejects(asUser(a,'insert into public.chat_messages(session_id,sender_id,body,client_nonce) values($1,$2,$3,$4)',[sid,b.id,'forged',randomUUID()]),/permission denied/);
      await assert.rejects(asUser(a,'update public.profiles set banned_until=null'),/permission denied/);
      await assert.rejects(asUser(a,'select * from private.user_reports'),/permission denied/);
      await assert.rejects(asUser(a,'select private.st_cleanup()'),/permission denied/);
      const conn=await pool.connect();
      try { await conn.query('begin'); await conn.query('set local role anon'); await assert.rejects(conn.query('select public.st_join($1)',[a.client]),/permission denied/); await conn.query('rollback'); }
      finally {conn.release();}
    });
    await t.test('next ends both memberships, avoids immediate rematch, and rejects stale actions',async () => {
      assert.equal((await call(c,'st_join')).state,'waiting');
      const next=await call(a,'st_next',[sid]); assert.equal(next.state,'chat');
      assert.ok([next.session.user_a,next.session.user_b].includes(c.id));
      assert.equal((await pool.query('select count(*) from public.chat_messages where session_id=$1',[sid])).rows[0].count,'0');
      assert.equal((await call(b,'st_heartbeat')).state,'idle');
      await assert.rejects(call(b,'st_send',[sid,'late',randomUUID()]),/ended/);
      await resetRates(a); await assert.rejects(call(a,'st_next',[sid]),/changed/);
      await resetRates(a); await call(a,'st_send',[next.session.id,'This should clear on leave.',randomUUID()]);
      await call(a,'st_leave',[next.session.id]);
      assert.equal((await pool.query('select count(*) from public.chat_messages where session_id=$1',[next.session.id])).rows[0].count,'0');
      assert.equal((await call(c,'st_heartbeat')).state,'idle');
    });
    await t.test('random matches and group rooms never cross college boundaries',async () => {
      await reset(); a=await makeUser('Test University'); b=await makeUser('Other University'); c=await makeUser('Test University');
      await enroll(a); await enroll(b); await enroll(c);
      const aCollege=(await pool.query('select college_id from public.profiles where id=$1',[a.id])).rows[0].college_id;
      const bCollege=(await pool.query('select college_id from public.profiles where id=$1',[b.id])).rows[0].college_id;
      assert.notEqual(aCollege,bCollege);
      const aRooms=await call(a,'gc_list'); const bRooms=await call(b,'gc_list');
      assert.ok(aRooms.length>0); assert.ok(bRooms.length>0); assert.notEqual(aRooms[0].id,bRooms[0].id);
      await call(a,'gc_join',[aRooms[0].id]);
      await assert.rejects(call(b,'gc_join',[aRooms[0].id]),/not available for your college/);
      await call(c,'gc_join',[aRooms[0].id]);
      const groupMessage=await call(a,'gc_send',[aRooms[0].id,'Only our campus.',randomUUID()]);
      assert.equal((await asUser(c,'select * from public.gc_messages where id=$1',[groupMessage.id])).rows.length,1);
      assert.equal((await asUser(b,'select * from public.gc_messages where id=$1',[groupMessage.id])).rows.length,0);
      await call(a,'gc_leave',[aRooms[0].id]); await call(c,'gc_leave',[aRooms[0].id]);
      assert.equal((await call(a,'st_join')).state,'waiting');
      assert.equal((await call(b,'st_join')).state,'waiting');
      assert.equal((await pool.query('select count(*) from private.active_members')).rows[0].count,'0');
      const sameCollege=await call(c,'st_join'); assert.equal(sameCollege.state,'chat');
      assert.ok([sameCollege.session.user_a,sameCollege.session.user_b].includes(a.id));
      assert.ok(![sameCollege.session.user_a,sameCollege.session.user_b].includes(b.id));
      const otherCollege=(await pool.query("select id from private.colleges where name='Other University'")).rows[0].id;
      await assert.rejects(call(a,'cm_set_my_college',[otherCollege]),/cannot be changed/);
      assert.equal((await pool.query('select count(*) from private.active_members where session_id=$1',[sameCollege.session.id])).rows[0].count,'2');
      assert.notEqual((await pool.query('select college_id from public.profiles where id=$1',[a.id])).rows[0].college_id,otherCollege);
    });
    await t.test('report evidence is limited and block prevents re-pairing in either direction',async () => {
      await reset(); a=await makeUser(); b=await makeUser(); await enroll(a); await enroll(b);
      await call(a,'st_join'); sid=(await call(b,'st_join')).session.id;
      await pool.query(`insert into public.chat_messages(session_id,sender_id,body,client_nonce)
        select $1,$2,'evidence '||x,gen_random_uuid() from generate_series(1,25) x`,[sid,a.id]);
      const rid=await call(a,'st_safety',[sid,'harassment']); assert.ok(rid);
      const report=(await pool.query('select * from private.user_reports')).rows[0];
      assert.equal(report.reported_id,b.id); assert.equal(report.evidence.length,20);
      assert.equal((await call(b,'st_heartbeat')).state,'idle');
      await resetRates(a); await resetRates(b);
      await pool.query("update public.chat_sessions set ended_at=now()-interval '1 minute'");
      assert.equal((await call(a,'st_join')).state,'waiting'); assert.equal((await call(b,'st_join')).state,'waiting');
      assert.equal((await pool.query('select count(*) from private.active_members')).rows[0].count,'0');
    });
    await t.test('offline lease expires, reconnect does not revive a dead conversation, cleanup deletes evidence on schedule',async () => {
      await reset(); a=await makeUser(); b=await makeUser(); await enroll(a); await enroll(b); await call(a,'st_join');
      sid=(await call(b,'st_join')).session.id;
      await call(a,'st_send',[sid,'Temporary message',randomUUID()]);
      await pool.query("update private.presence set last_seen=now()-interval '80 seconds' where user_id=$1",[a.id]);
      assert.equal((await call(b,'st_heartbeat')).session.end_reason,'timeout');
      assert.equal((await call(a,'st_heartbeat')).state,'idle');
      await pool.query("update public.chat_sessions set ended_at=now()-interval '12 minutes'");
      await pool.query('select private.st_cleanup()');
      assert.equal((await pool.query('select count(*) from public.chat_messages')).rows[0].count,'0');
      await pool.query(`insert into private.user_reports(reporter_id,reported_id,session_id,reason,evidence,expires_at)
        values($1,$2,$3,'other','[]',now()-interval '1 minute')`,[a.id,b.id,sid]);
      await pool.query('select private.st_cleanup()');
      assert.equal((await pool.query('select count(*) from private.user_reports')).rows[0].count,'0');
    });
    await t.test('12 simultaneous users form six disjoint real conversations',async () => {
      await reset(); const users=await Promise.all(Array.from({length:12},()=>makeUser())); await Promise.all(users.map(enroll));
      await Promise.all(users.map(u=>call(u,'st_join')));
      const rows=(await pool.query('select * from private.active_members')).rows;
      assert.equal(rows.length,12); assert.equal(new Set(rows.map(r=>r.user_id)).size,12);
      const counts=Object.values(Object.groupBy(rows,r=>r.session_id)).map(a=>a.length);
      assert.deepEqual(counts,[2,2,2,2,2,2]);
      const all=await Promise.all(users.flatMap(u=>[call(u,'st_join'),call(u,'st_join')]));
      assert.ok(all.every(x=>x.state==='chat'));
      assert.equal((await pool.query('select count(*) from public.chat_sessions where ended_at is null')).rows[0].count,'6');
    });
    await t.test('cancel removes queue entry and moderator bans prevent use',async () => {
      await reset(); a=await makeUser(); await enroll(a); await call(a,'st_join'); await call(a,'st_leave',[null]);
      assert.equal((await pool.query('select count(*) from private.match_queue')).rows[0].count,'0');
      await pool.query("select private.st_moderate($1,24,'Reviewed test report')",[a.id]);
      await assert.rejects(call(a,'st_heartbeat'),/restricted/);
      assert.equal((await pool.query('select count(*) from private.moderation_actions')).rows[0].count,'1');
    });
    await t.test('event submissions stay private until an admin approves them',async () => {
      await reset(); const student=await makeUser('Test University'); const admin=await makeUser('Test University'); const outsider=await makeUser('Other University'); await enroll(student); await enroll(admin); await enroll(outsider);
      const poster=`${student.id}/${randomUUID()}.png`;
      await pool.query("insert into storage.objects(bucket_id,name,owner_id) values('event-posters',$1,$2)",[poster,student.id]);
      const submitted=await call(student,'ce_submit',['TechnoFest 2026','Department of CSE','Technical',new Date(Date.now()+86400000*2).toISOString().slice(0,10),'09:00','17:00','Main Block','A campus technology festival with talks, workshops, and student projects.','https://example.org/register',poster,'intra_college']);
      assert.equal(submitted.status,'pending');
      assert.equal((await asUser(student,'select * from public.ce_list($1)',[student.client])).rows.length,0);
      assert.equal((await asUser(outsider,'select * from public.ce_list($1)',[outsider.client])).rows.length,0);
      assert.equal((await asUser(student,'select * from public.ce_my_events($1)',[student.client])).rows.length,1);
      assert.equal((await asUser(student,'select * from storage.objects')).rows.length,1);
      await assert.rejects(asUser(student,"insert into storage.objects(bucket_id,name,owner_id) values('event-posters',$1,$2)",[`${admin.id}/forbidden.png`,admin.id]),/row-level security/);
      await assert.rejects(asUser(admin,'select * from public.ce_admin_events($1)',[admin.client]),/Admin access required/);
      await assert.rejects(asUser(student,'select * from public.campus_events'),/permission denied/);
      assert.equal((await asUser(student,'select public.ce_can_read_poster($1) as allowed',[poster])).rows[0].allowed,true);
      assert.equal((await asUser(admin,'select public.ce_can_read_poster($1) as allowed',[poster])).rows[0].allowed,false);
      await pool.query('insert into private.event_admins(user_id) values($1)',[admin.id]);
      assert.equal((await asUser(admin,'select * from public.ce_admin_events($1)',[admin.client])).rows.length,1);
      await call(admin,'ce_review',[submitted.id,'approved',null]);
      assert.equal((await asUser(student,'select * from public.ce_list($1)',[student.client])).rows.length,1);
      assert.equal((await asUser(outsider,'select * from public.ce_list($1)',[outsider.client])).rows.length,0);
      assert.equal((await asUser(outsider,'select public.ce_can_read_poster($1) as allowed',[poster])).rows[0].allowed,false);
      assert.equal((await asUser(admin,'select public.ce_can_read_poster($1) as allowed',[poster])).rows[0].allowed,true);
      const interPoster=`${student.id}/${randomUUID()}.png`;
      await pool.query("insert into storage.objects(bucket_id,name,owner_id) values('event-posters',$1,$2)",[interPoster,student.id]);
      await resetRates(student);
      const inter=await call(student,'ce_submit',['Inter Campus Meetup','Student Union','Social',new Date(Date.now()+86400000*3).toISOString().slice(0,10),'10:00','12:00','Main Block','A campus-wide student meetup for communities and networking.','https://example.org/inter',interPoster,'inter_college']);
      await call(admin,'ce_review',[inter.id,'approved',null]);
      assert.equal((await asUser(outsider,'select * from public.ce_list($1)',[outsider.client])).rows.length,1);
      assert.equal((await asUser(outsider,'select public.ce_can_read_poster($1) as allowed',[interPoster])).rows[0].allowed,true);
      await assert.rejects(call(student,'ce_review',[submitted.id,'rejected',null]),/Admin access required/);
      await resetRates(student);
      await assert.rejects(call(student,'ce_submit',['Unsafe link','Department','Technical',new Date(Date.now()+86400000*2).toISOString().slice(0,10),'09:00','10:00','Main Block','A campus technology festival with talks, workshops, and student projects.','javascript:alert(1)',poster,'intra_college']),/secure registration link/);
    });
    await t.test('college is selected once, including concurrent saves and direct update attempts',async () => {
      await reset(); const user=await makeUser(''); await enroll(user);
      const colleges=(await pool.query('select id from private.colleges where is_active order by name')).rows.slice(0,2);
      const attempts=await Promise.allSettled(colleges.map(college=>call(user,'cm_save_profile',['Student',college.id])));
      assert.equal(attempts.filter(result=>result.status==='fulfilled').length,1);
      const profile=await call(user,'cm_my_account'); assert.equal(profile.college_locked,true);
      const other=colleges.find(college=>college.id!==profile.college_id);
      await assert.rejects(call(user,'cm_set_my_college',[other.id]),/cannot be changed/);
      await assert.rejects(pool.query('update public.profiles set college_id=$1 where id=$2',[other.id,user.id]),/cannot be changed/);
      const saved=await call(user,'cm_save_profile',['Updated name',profile.college_id]);
      assert.equal(saved.display_name,'Updated name'); assert.equal(saved.college_id,profile.college_id);
      await assert.rejects(call(user,'cm_save_profile',['x'.repeat(61),profile.college_id]),/60 characters/);
    });
    await t.test('only admins can read the user directory or authorize account actions',async () => {
      await reset(); const admin=await makeUser(''); const student=await makeUser(); const guest=await makeUser('Other University');
      await enroll(admin); await enroll(student); await enroll(guest);
      await pool.query("update auth.users set is_anonymous=false,email=case when id=$1 then 'admin@example.test' else 'student@example.test' end where id in($1,$2)",[admin.id,student.id]);
      await pool.query('insert into private.event_admins(user_id) values($1)',[admin.id]);
      const profile=await call(admin,'cm_my_account'); assert.equal(profile.is_admin,true); assert.equal(profile.college_id,null);
      await call(admin,'cm_save_profile',['Administrator',null]);
      await assert.rejects(call(student,'cm_admin_users'),/Admin access required/);
      await assert.rejects(asUser(student,'select * from private.cm_account_actions'),/permission denied/);
      await assert.rejects(call(student,'cm_admin_check_user_action',[guest.id,'ban','Reviewed report']),/Admin access required/);
      await assert.rejects(call(admin,'cm_admin_check_user_action',[admin.id,'delete','Reviewed report']),/own account/);
      await assert.rejects(asUser(admin,"select public.cm_admin_record_user_action($1,$2,'ban','Denied')",[admin.id,student.id]),/permission denied/);
      const directory=await call(admin,'cm_admin_users');
      assert.equal(directory.counts.registered,2); assert.equal(directory.counts.guests,1); assert.equal(directory.total,3);
      assert.equal((await call(admin,'cm_admin_users',['student@example.test',null,'registered',0,25])).users[0].id,student.id);
      const college=(await call(student,'cm_my_account')).college_id;
      assert.equal((await call(admin,'cm_admin_users',['',college,'all',0,25])).total,1);
      assert.equal((await call(admin,'cm_admin_check_user_action',[student.id,'ban','Reviewed report'])).actor_id,admin.id);
      await pool.query('insert into private.event_admins(user_id) values($1)',[student.id]);
      await assert.rejects(call(admin,'cm_admin_check_user_action',[student.id,'ban','Reviewed report']),/protected/);
    });
    await t.test('Auth bans disconnect group access and reactivation also clears legacy profile bans',async () => {
      await reset(); const user=await makeUser(); await enroll(user);
      const room=(await call(user,'gc_list'))[0]; await call(user,'gc_join',[room.id]);
      await pool.query("update auth.users set banned_until=now()+interval '100 years' where id=$1",[user.id]);
      assert.equal((await pool.query('select count(*) from private.gc_members where user_id=$1',[user.id])).rows[0].count,'0');
      await assert.rejects(call(user,'st_heartbeat'),/restricted/);
      await pool.query('update auth.users set banned_until=null where id=$1',[user.id]);
      assert.equal((await call(user,'cm_my_account')).id,user.id);
      await pool.query("select private.st_moderate($1,24,'Legacy ban')",[user.id]);
      await pool.query('update auth.users set banned_until=null where id=$1',[user.id]);
      assert.equal((await pool.query('select banned_until from public.profiles where id=$1',[user.id])).rows[0].banned_until,null);
    });
    await t.test('admin with no college can join and moderate all colleges; group capacity stops at 1000',async () => {
      await reset(); const admin=await makeUser(''); const student=await makeUser(); const outsider=await makeUser('Other University');
      await enroll(admin); await enroll(student); await enroll(outsider);
      await pool.query('insert into private.event_admins(user_id) values($1)',[admin.id]);
      const rooms=await call(admin,'gc_list'); assert.ok(new Set(rooms.map(room=>room.college_id)).size>=2);
      const otherRoom=(await call(outsider,'gc_list'))[0];
      await call(admin,'gc_join',[otherRoom.id]);
      const message=await call(admin,'gc_send',[otherRoom.id,'Admin campus announcement',randomUUID()]);
      assert.equal((await call(admin,'gc_poll',[otherRoom.id])).state,'joined');
      assert.equal((await asUser(admin,'select public.gc_can_read($1,$2) as allowed',[otherRoom.id,message.created_at])).rows[0].allowed,true);
      await assert.rejects(call(student,'gc_join',[otherRoom.id]),/not available/);
      const pending=await call(student,'gc_submit_room',['Campus Network','A community for campus students.','general',1000]);
      assert.equal(pending.status,'pending');
      await assert.rejects(pool.query('update private.gc_rooms set capacity=1001 where id=$1',[pending.id]),/check constraint/);
      await call(admin,'gc_admin_review_room',[pending.id,'approved',null]);
      const approved=(await call(student,'gc_list')).find(room=>room.id===pending.id); assert.equal(approved.capacity,1000);
      await resetRates(student); await assert.rejects(call(student,'gc_submit_room',['Too Large Group','A community for campus students.','general',1001]),/member limit/);
      await pool.query('delete from auth.users where id=$1',[outsider.id]);
      assert.equal((await pool.query('select count(*) from public.profiles where id=$1',[outsider.id])).rows[0].count,'0');
    });
  } finally { await pool.end(); }
});
