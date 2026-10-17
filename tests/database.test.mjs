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
    await pool.query(`drop schema if exists private cascade; drop schema if exists public cascade; drop schema if exists auth cascade;
      drop publication if exists supabase_realtime; create schema public; create schema auth;
      do $$ begin if not exists(select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if; end $$;
      grant usage on schema public,auth to authenticated,anon;
      create table auth.users(id uuid primary key, is_anonymous boolean default true, created_at timestamptz default now(),last_sign_in_at timestamptz default now());
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create publication supabase_realtime;`);
    await pool.query(await readFile(new URL('../supabase/migrations/202610170001_strangertalk.sql',import.meta.url),'utf8'));
    const makeUser = async () => {
      const user = {id:randomUUID(),client:randomUUID()};
      await pool.query('insert into auth.users(id) values($1)',[user.id]);
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
    const enroll = async u => call(u,'st_begin',[true,'2026-10-17']);
    const reset = async () => { await pool.query('truncate auth.users cascade; truncate private.user_reports,private.moderation_actions'); };
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
      assert.equal((await call(b,'st_heartbeat')).state,'idle');
      await assert.rejects(call(b,'st_send',[sid,'late',randomUUID()]),/ended/);
      await resetRates(a); await assert.rejects(call(a,'st_next',[sid]),/changed/);
      await call(a,'st_leave',[next.session.id]);
      assert.equal((await call(c,'st_heartbeat')).state,'idle');
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
  } finally { await pool.end(); }
});
