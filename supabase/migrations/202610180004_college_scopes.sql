-- Keep campus events and every group room inside a college boundary.
begin;

alter table public.profiles
  add column college_id uuid references private.colleges(id) on delete set null;
alter table private.gc_rooms
  add column college_id uuid references private.colleges(id) on delete cascade;
create unique index gc_rooms_college_name on private.gc_rooms(college_id,name) where college_id is not null;
alter table public.campus_events
  add column audience text not null default 'inter_college' check (audience in ('intra_college','inter_college')),
  add column college_id uuid references private.colleges(id) on delete set null,
  add constraint campus_events_audience_college check (
    (audience='inter_college' and college_id is null) or
    (audience='intra_college' and college_id is not null)
  );
create index campus_events_visibility on public.campus_events(audience,college_id,event_date,start_time) where status='approved';

-- Bind new accounts to their selected registration college. Guests can set theirs in Profile.
create function private.cm_assign_profile_college() returns trigger
language plpgsql security definer set search_path='' as $$
declare college_name text;
begin
  select u.raw_user_meta_data->>'college_name' into college_name from auth.users u where u.id=new.id;
  if college_name is not null then
    select c.id into new.college_id from private.colleges c
      where c.is_active and c.name_key=lower(regexp_replace(btrim(college_name), '\s+', ' ', 'g'));
  end if;
  return new;
end;
$$;
create trigger cm_assign_profile_college_before_insert
before insert on public.profiles for each row execute function private.cm_assign_profile_college();
update public.profiles p set college_id=c.id
from auth.users u, private.colleges c
where p.id=u.id and c.is_active
  and c.name_key=lower(regexp_replace(btrim(coalesce(u.raw_user_meta_data->>'college_name','')), '\s+', ' ', 'g'));

-- End existing cross-college matches and remove queues without a college assignment.
do $$
declare r record;
begin
  delete from private.match_queue q using public.profiles p where q.user_id=p.id and p.college_id is null;
  for r in select s.id from public.chat_sessions s
    join public.profiles a on a.id=s.user_a join public.profiles b on b.id=s.user_b
    where s.ended_at is null and (a.college_id is null or b.college_id is null or a.college_id<>b.college_id)
  loop perform private.st_end(r.id,'moderated'); end loop;
end;
$$;

create function public.cm_set_my_college(p_client_id uuid,p_college_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare u uuid; selected_name text; active_session uuid; other_college uuid;
begin
  perform private.st_lock();
  u:=private.st_assert(p_client_id);
  select c.name into selected_name from private.colleges c where c.id=p_college_id and c.is_active;
  if selected_name is null then raise exception 'Choose a college from the active list.'; end if;
  select m.session_id,case when s.user_a=u then b.college_id else a.college_id end into active_session,other_college
  from private.active_members m join public.chat_sessions s on s.id=m.session_id
    join public.profiles a on a.id=s.user_a join public.profiles b on b.id=s.user_b where m.user_id=u;
  if active_session is not null and other_college is distinct from p_college_id then perform private.st_end(active_session,'moderated'); end if;
  update public.profiles set college_id=p_college_id where id=u;
  update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('college_name',selected_name) where id=u;
  delete from private.gc_members where user_id=u;
  delete from private.match_queue where user_id=u;
  return selected_name;
end;
$$;

-- Keep null-college rooms as private templates, and create a separate room set per college.
create function private.cm_sync_group_rooms(p_college_id uuid) returns void
language sql security definer set search_path='' as $$
  insert into private.gc_rooms(id,name,description,topic,capacity,college_id)
  select gen_random_uuid(),seed.name,seed.description,seed.topic,seed.capacity,college.id
  from private.gc_rooms seed join private.colleges college on college.id=p_college_id and college.is_active
  where seed.college_id is null
  on conflict(college_id,name) where college_id is not null do nothing;
$$;
create function private.cm_sync_group_rooms_trigger() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.is_active then perform private.cm_sync_group_rooms(new.id); end if;
  return new;
end;
$$;
create trigger cm_sync_college_group_rooms
after insert or update of is_active on private.colleges
for each row execute function private.cm_sync_group_rooms_trigger();
insert into private.gc_rooms(id,name,description,topic,capacity,college_id)
select gen_random_uuid(),seed.name,seed.description,seed.topic,seed.capacity,college.id
from private.gc_rooms seed cross join private.colleges college
where seed.college_id is null and college.is_active
on conflict(college_id,name) where college_id is not null do nothing;

-- Disconnect legacy shared-room sessions; they must rejoin their college-specific rooms.
delete from private.gc_members;

-- Random one-to-one matches also stay inside a college.
create or replace function private.st_match() returns void language plpgsql set search_path='' as $$
declare u uuid:=auth.uid(); other_user uuid; sid uuid; college uuid;
begin
  if exists(select 1 from private.active_members where user_id=u) then return; end if;
  if not exists(select 1 from private.match_queue where user_id=u) then return; end if;
  select college_id into college from public.profiles where id=u;
  if college is null then delete from private.match_queue where user_id=u; return; end if;
  select q.user_id into other_user from private.match_queue q
    join private.presence p on p.user_id=q.user_id join public.profiles f on f.id=q.user_id
    where q.user_id<>u and f.college_id=college and p.last_seen>now()-interval '75 seconds'
      and (f.banned_until is null or f.banned_until<=now())
      and not exists(select 1 from private.active_members where user_id=q.user_id)
      and not exists(select 1 from private.blocked_users b where
        (b.blocker_id=u and b.blocked_id=q.user_id) or(b.blocked_id=u and b.blocker_id=q.user_id))
      and not exists(select 1 from public.chat_sessions s where
        u in(s.user_a,s.user_b) and q.user_id in(s.user_a,s.user_b)
        and s.ended_at>now()-interval '30 seconds')
    order by random() limit 1;
  if other_user is null then return; end if;
  insert into public.chat_sessions(user_a,user_b) values(u,other_user) returning id into sid;
  insert into private.active_members values(u,sid),(other_user,sid);
  delete from private.match_queue where user_id in(u,other_user);
end;
$$;

create or replace function public.st_join(p_client_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id);
  if not exists(select 1 from public.profiles where id=u and college_id is not null) then raise exception 'Choose your college in Profile before starting a random chat.'; end if;
  perform private.st_sweep();
  if exists(select 1 from private.active_members where user_id=u) then return private.st_snapshot(); end if;
  perform private.st_rate('join',12,500);
  update private.presence set last_seen=now() where user_id=u;
  insert into private.match_queue(user_id) values(u) on conflict do nothing;
  perform private.st_match(); return private.st_snapshot();
end;
$$;

create or replace function public.st_next(p_client_id uuid,p_session_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; sid uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id);
  if not exists(select 1 from public.profiles where id=u and college_id is not null) then raise exception 'Choose your college in Profile before starting a random chat.'; end if;
  perform private.st_rate('next',12,1000);
  select session_id into sid from private.active_members where user_id=u;
  if sid is not null and sid is distinct from p_session_id then raise exception 'Conversation changed. Please refresh.'; end if;
  if sid is not null then perform private.st_end(sid,'next'); end if;
  update private.presence set last_seen=now() where user_id=u;
  insert into private.match_queue(user_id) values(u) on conflict do nothing;
  perform private.st_sweep(); perform private.st_match(); return private.st_snapshot();
end;
$$;

create or replace function public.gc_can_read(p_room_id uuid,p_created_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.gc_members m
    join private.gc_rooms r on r.id=m.room_id and r.college_id is not null
    join public.profiles f on f.id=m.user_id and f.college_id=r.college_id
    join private.presence p on p.user_id=m.user_id
    where m.user_id=auth.uid() and m.room_id=p_room_id
      and p.last_seen>now()-interval '75 seconds' and p_created_at>=m.joined_at
      and p_created_at>now()-interval '1 hour' and (f.banned_until is null or f.banned_until<=now()));
$$;

create or replace function private.gc_sweep() returns void
language plpgsql set search_path='' as $$
begin
  delete from private.gc_members m where not exists(
    select 1 from private.gc_rooms r join public.profiles f on f.college_id=r.college_id
    join private.presence p on p.user_id=f.id
    where r.id=m.room_id and r.college_id is not null and f.id=m.user_id
      and p.last_seen>now()-interval '75 seconds'
      and (f.banned_until is null or f.banned_until<=now()));
end;
$$;

create or replace function public.gc_list(p_client_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; college uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id); perform private.gc_sweep();
  perform private.st_rate('gc_list',60);
  select college_id into college from public.profiles where id=u;
  if college is null then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object(
    'member_count',(select count(*) from private.gc_members m where m.room_id=r.id),
    'last_message',(select left(m.body,160) from public.gc_messages m where m.room_id=r.id and m.created_at>now()-interval '1 hour' order by m.created_at desc,m.id desc limit 1),
    'last_message_at',(select m.created_at from public.gc_messages m where m.room_id=r.id and m.created_at>now()-interval '1 hour' order by m.created_at desc,m.id desc limit 1)
  ) order by r.name) from private.gc_rooms r where r.college_id=college),'[]'::jsonb);
end;
$$;

create or replace function public.gc_join(p_client_id uuid,p_room_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; cap integer; sid uuid; college uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id); perform private.gc_sweep(); perform private.st_sweep();
  select college_id into college from public.profiles where id=u;
  select r.capacity into cap from private.gc_rooms r where r.id=p_room_id and r.college_id=college and college is not null;
  if not found then raise exception 'That group is not available for your college. Select your college in Profile.'; end if;
  if exists(select 1 from private.gc_members where user_id=u and room_id=p_room_id) then
    update private.presence set last_seen=now() where user_id=u;
    return private.gc_snapshot(p_room_id);
  end if;
  perform private.st_rate('gc_join',12,500);
  if (select count(*) from private.gc_members where room_id=p_room_id)>=cap then raise exception 'This group is full. Try another room.'; end if;
  if exists(select 1 from private.gc_members m join private.blocked_users b on
    (b.blocker_id=u and b.blocked_id=m.user_id) or(b.blocked_id=u and b.blocker_id=m.user_id)
    where m.room_id=p_room_id) then raise exception 'A blocked identity is in this room. Choose a different group.'; end if;
  select session_id into sid from private.active_members where user_id=u;
  if sid is not null then perform private.st_end(sid,'left'); end if;
  delete from private.match_queue where user_id=u;
  delete from private.gc_members where user_id=u;
  update private.presence set last_seen=now() where user_id=u;
  update public.profiles set last_active_at=now() where id=u;
  insert into private.gc_members(user_id,room_id) values(u,p_room_id);
  return private.gc_snapshot(p_room_id);
end;
$$;

create or replace function public.gc_poll(p_client_id uuid,p_room_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id); perform private.gc_sweep();
  perform private.st_rate('gc_poll',90);
  if not exists(select 1 from private.gc_members m join private.gc_rooms r on r.id=m.room_id
    join public.profiles f on f.id=m.user_id and f.college_id=r.college_id
    where m.user_id=u and m.room_id=p_room_id and r.college_id is not null) then
    delete from private.gc_members where user_id=u and room_id=p_room_id;
    return jsonb_build_object('state','left');
  end if;
  update private.presence set last_seen=now() where user_id=u;
  update public.profiles set last_active_at=now() where id=u;
  return private.gc_snapshot(p_room_id);
end;
$$;

create or replace function public.gc_send(p_client_id uuid,p_room_id uuid,p_body text,p_nonce uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; m public.gc_messages; body_text text:=btrim(p_body);
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id); perform private.gc_sweep();
  if not exists(select 1 from private.gc_members m join private.gc_rooms r on r.id=m.room_id
    join public.profiles f on f.id=m.user_id and f.college_id=r.college_id
    where m.user_id=u and m.room_id=p_room_id and r.college_id is not null) then raise exception 'You are no longer in a group for this college. Join again.'; end if;
  if p_nonce is null then raise exception 'Message identifier required.'; end if;
  select * into m from public.gc_messages where sender_id=u and client_nonce=p_nonce;
  if found then
    if m.room_id<>p_room_id or m.body is distinct from body_text then raise exception 'Message identifier already used.'; end if;
    return to_jsonb(m);
  end if;
  if body_text is null or char_length(body_text) not between 1 and 2000 then raise exception 'Write a message between 1 and 2,000 characters.'; end if;
  if body_text ~* '(https?://|www\.|\m(rape you|kill you|send nudes|child porn)\M)' then raise exception 'Message blocked by basic safety filters. Links, threats and sexual solicitation are not allowed.'; end if;
  perform private.st_rate('send',30,600);
  if exists(select 1 from public.gc_messages where sender_id=u and body=body_text and created_at>now()-interval '10 seconds') then raise exception 'Please avoid repeating the same message.'; end if;
  insert into public.gc_messages(room_id,sender_id,body,client_nonce) values(p_room_id,u,body_text,p_nonce) returning * into m;
  update private.gc_members set typing_until=null where user_id=u;
  return to_jsonb(m);
end;
$$;

create or replace function public.ce_can_read_poster(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.campus_events e where e.poster_path=p_path
    and (e.submitted_by=auth.uid() or exists(select 1 from private.event_admins a where a.user_id=auth.uid()) or
      (e.status='approved' and (e.audience='inter_college' or exists(select 1 from public.profiles p where p.id=auth.uid() and p.college_id=e.college_id)))))
$$;
-- Approved inter-college events use a null college scope; intra-college events require one.
alter table public.campus_events alter column college_id drop not null;
create or replace function public.ce_list(p_client_id uuid) returns setof public.campus_events
language plpgsql security definer set search_path='' as $$
declare u uuid; college uuid;
begin
  u:=private.st_assert(p_client_id); select college_id into college from public.profiles where id=u;
  return query select e.* from public.campus_events e where e.status='approved' and e.event_date>=current_date
    and (e.audience='inter_college' or (college is not null and e.college_id=college))
    order by e.event_date,e.start_time limit 100;
end;
$$;

drop function public.ce_submit(uuid,text,text,text,date,time,time,text,text,text,text);
create function public.ce_submit(
  p_client_id uuid,p_title text,p_organizer text,p_category text,p_event_date date,
  p_start_time time,p_end_time time,p_venue text,p_description text,p_registration_url text,p_poster_path text,p_audience text
) returns public.campus_events
language plpgsql security definer set search_path='' as $$
declare u uuid; college uuid; e public.campus_events;
begin
  u:=private.st_assert(p_client_id); perform private.st_rate('event_submit',5,1000);
  select college_id into college from public.profiles where id=u;
  if p_title is null or char_length(btrim(p_title)) not between 3 and 90
    or p_organizer is null or char_length(btrim(p_organizer)) not between 2 and 90
    or p_category not in ('Technical','Cultural','Workshop','Career','Social','Other')
    or p_event_date<current_date or p_event_date>current_date+365
    or p_start_time is null or (p_end_time is not null and p_end_time<=p_start_time)
    or p_venue is null or char_length(btrim(p_venue)) not between 2 and 120
    or p_description is null or char_length(btrim(p_description)) not between 20 and 2000
    or p_registration_url is null or p_registration_url !~ '^https://[^[:space:]]+$'
    or p_poster_path is null or split_part(p_poster_path,'/',1)<>u::text
    or p_audience is null or p_audience not in ('intra_college','inter_college')
    or (p_audience='intra_college' and college is null) then
    raise exception 'Check the event details, visibility, college, secure registration link, date, and poster, then try again.';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='event-posters' and name=p_poster_path and owner_id=u::text) then
    raise exception 'Upload your event poster before submitting.';
  end if;
  perform private.st_rate('event_submit_daily',10);
  insert into public.campus_events(submitted_by,title,organizer,category,event_date,start_time,end_time,venue,description,registration_url,poster_path,audience,college_id)
  values(u,btrim(p_title),btrim(p_organizer),p_category,p_event_date,p_start_time,p_end_time,btrim(p_venue),btrim(p_description),p_registration_url,p_poster_path,p_audience,case when p_audience='intra_college' then college else null end)
  returning * into e;
  return e;
end;
$$;

revoke all on function public.cm_set_my_college(uuid,uuid) from public,anon;
grant execute on function public.cm_set_my_college(uuid,uuid) to authenticated;
revoke all on function public.gc_can_read(uuid,timestamptz),public.gc_list(uuid),public.gc_join(uuid,uuid),public.gc_poll(uuid,uuid),public.gc_send(uuid,uuid,text,uuid) from public,anon;
grant execute on function public.gc_can_read(uuid,timestamptz),public.gc_list(uuid),public.gc_join(uuid,uuid),public.gc_poll(uuid,uuid),public.gc_send(uuid,uuid,text,uuid) to authenticated;
revoke all on function public.ce_list(uuid),public.ce_submit(uuid,text,text,text,date,time,time,text,text,text,text,text),public.ce_can_read_poster(text) from public,anon;
grant execute on function public.ce_list(uuid),public.ce_submit(uuid,text,text,text,date,time,time,text,text,text,text,text),public.ce_can_read_poster(text) to authenticated;
revoke all on function private.cm_assign_profile_college(),private.cm_sync_group_rooms(uuid),private.cm_sync_group_rooms_trigger() from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
