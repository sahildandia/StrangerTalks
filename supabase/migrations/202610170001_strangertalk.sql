-- Apply once in Supabase SQL Editor. This is the authoritative application backend.
-- SECURITY DEFINER RPCs are equivalent to server endpoints: no admin key in the app.
begin;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  adult_attested_at timestamptz not null default now(),
  terms_version text not null,
  banned_until timestamptz,
  last_active_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create table private.presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  client_id uuid not null,
  last_seen timestamptz not null default now()
);
create table private.match_queue (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  joined_at timestamptz not null default now()
);
create table public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles(id) on delete cascade,
  user_b uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  end_reason text check(end_reason in ('left','next','blocked','reported','timeout','expired','moderated')),
  typing_a_until timestamptz,
  typing_b_until timestamptz,
  check(user_a <> user_b)
);
create table private.active_members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  session_id uuid not null references public.chat_sessions(id) on delete cascade
);
create index on private.active_members(session_id);
create index on public.chat_sessions(user_a,created_at desc);
create index on public.chat_sessions(user_b,created_at desc);
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check(char_length(body) between 1 and 2000),
  client_nonce uuid not null,
  created_at timestamptz not null default now(),
  unique(sender_id,client_nonce)
);
create index on public.chat_messages(session_id,created_at);
create table private.blocked_users (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key(blocker_id,blocked_id), check(blocker_id <> blocked_id)
);
create table private.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null,
  reported_id uuid not null,
  session_id uuid not null,
  reason text not null check(reason in ('harassment','sexual_content','underage','spam','other')),
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default(now() + interval '30 days'),
  reviewed_at timestamptz,
  unique(reporter_id,session_id)
);
create table private.moderation_actions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null, action text not null, note text not null,
  created_at timestamptz not null default now()
);
create table private.rate_limits (
  user_id uuid not null references public.profiles(id) on delete cascade,
  action text not null, window_start timestamptz not null,
  count integer not null, last_at timestamptz not null,
  primary key(user_id,action)
);

alter table public.profiles enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
alter table private.presence enable row level security;
alter table private.match_queue enable row level security;
alter table private.active_members enable row level security;
alter table private.blocked_users enable row level security;
alter table private.user_reports enable row level security;
alter table private.moderation_actions enable row level security;
alter table private.rate_limits enable row level security;
revoke all on public.profiles, public.chat_sessions, public.chat_messages from public, anon, authenticated;
grant select on public.profiles, public.chat_sessions, public.chat_messages to authenticated;
create policy own_profile on public.profiles for select to authenticated using(id = (select auth.uid()));
create policy own_sessions on public.chat_sessions for select to authenticated
  using((select auth.uid()) in (user_a,user_b));
create policy own_messages on public.chat_messages for select to authenticated using(
  exists(select 1 from public.chat_sessions s where s.id = session_id
    and (select auth.uid()) in (s.user_a,s.user_b))
);

create function private.st_lock() returns void language sql set search_path = '' as $$
  select pg_advisory_xact_lock(736281904);
$$;
create function private.st_rate(p_action text,p_max integer,p_gap_ms integer default 0)
returns void language plpgsql set search_path = '' as $$
declare r private.rate_limits; t timestamptz := clock_timestamp();
begin
  select * into r from private.rate_limits where user_id = auth.uid() and action = p_action for update;
  if found and r.last_at > t - make_interval(secs => p_gap_ms / 1000.0) then
    raise exception 'Please slow down and try again in a moment.';
  end if;
  if r.window_start > t - interval '1 minute' and r.count >= p_max then
    raise exception 'Too many requests. Please wait one minute.';
  end if;
  insert into private.rate_limits values(auth.uid(),p_action,t,1,t)
    on conflict(user_id,action) do update set
      count = case when rate_limits.window_start <= t - interval '1 minute' then 1 else rate_limits.count+1 end,
      window_start = case when rate_limits.window_start <= t - interval '1 minute' then t else rate_limits.window_start end,
      last_at = t;
end;
$$;
create function private.st_assert(p_client_id uuid) returns uuid language plpgsql set search_path = '' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Please start an anonymous session first.'; end if;
  if not exists(select 1 from public.profiles where id=u and terms_version='2026-10-17') then
    raise exception 'Please confirm you are 18 or older and accept the guidelines.';
  end if;
  if exists(select 1 from public.profiles where id=u and banned_until > now()) then
    raise exception 'Chat access is restricted. Contact the app owner for help.';
  end if;
  if not exists(select 1 from private.presence where user_id=u and client_id=p_client_id) then
    raise exception 'This session is open in another tab. Close it and try again after 75 seconds.';
  end if;
  return u;
end;
$$;
create function private.st_end(p_session uuid,p_reason text) returns void language plpgsql set search_path = '' as $$
begin
  update public.chat_sessions set ended_at=now(),end_reason=p_reason,typing_a_until=null,typing_b_until=null
    where id=p_session and ended_at is null;
  delete from private.active_members where session_id=p_session;
end;
$$;
create function private.st_sweep() returns void language plpgsql set search_path = '' as $$
declare r record;
begin
  delete from private.match_queue q where not exists(
    select 1 from private.presence p where p.user_id=q.user_id and p.last_seen > now()-interval '75 seconds');
  for r in select s.id from public.chat_sessions s where s.ended_at is null and (
    s.created_at < now()-interval '1 hour'
    or exists(select 1 from public.profiles p where p.id in(s.user_a,s.user_b) and p.banned_until>now())
    or not exists(select 1 from private.presence p where p.user_id=s.user_a and p.last_seen>now()-interval '75 seconds')
    or not exists(select 1 from private.presence p where p.user_id=s.user_b and p.last_seen>now()-interval '75 seconds'))
  loop perform private.st_end(r.id,'timeout'); end loop;
end;
$$;
create function private.st_snapshot() returns jsonb language plpgsql set search_path = '' as $$
declare s public.chat_sessions;
begin
  select c.* into s from public.chat_sessions c join private.active_members m on m.session_id=c.id where m.user_id=auth.uid();
  if found then return jsonb_build_object('state','chat','session',to_jsonb(s)); end if;
  if exists(select 1 from private.match_queue where user_id=auth.uid()) then
    return jsonb_build_object('state','waiting','session',null);
  end if;
  select * into s from public.chat_sessions where auth.uid() in(user_a,user_b) order by created_at desc limit 1;
  return jsonb_build_object('state','idle','session',case when s.id is null then null else to_jsonb(s) end);
end;
$$;
create function private.st_match() returns void language plpgsql set search_path = '' as $$
declare u uuid := auth.uid(); other_user uuid; sid uuid;
begin
  if exists(select 1 from private.active_members where user_id=u) then return; end if;
  if not exists(select 1 from private.match_queue where user_id=u) then return; end if;
  select q.user_id into other_user from private.match_queue q
    join private.presence p on p.user_id=q.user_id join public.profiles f on f.id=q.user_id
    where q.user_id<>u and p.last_seen>now()-interval '75 seconds'
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

create function public.st_begin(p_client_id uuid,p_adult boolean,p_terms_version text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid := auth.uid();
begin
  perform private.st_lock();
  if u is null then raise exception 'Authentication required.'; end if;
  if p_adult is distinct from true or p_terms_version is distinct from '2026-10-17' then
    raise exception 'This app is for adults 18 or older. Accept the current guidelines to continue.';
  end if;
  if p_client_id is null then raise exception 'Session identifier required.'; end if;
  insert into public.profiles(id,terms_version) values(u,p_terms_version)
    on conflict(id) do update set terms_version=excluded.terms_version;
  if exists(select 1 from private.presence where user_id=u and client_id<>p_client_id and last_seen>now()-interval '75 seconds') then
    raise exception 'This session is open in another tab. Close it and try again after 75 seconds.';
  end if;
  perform private.st_sweep();
  insert into private.presence values(u,p_client_id,now()) on conflict(user_id) do update set client_id=excluded.client_id,last_seen=now();
  update public.profiles set last_active_at=now() where id=u;
  perform private.st_assert(p_client_id);
  perform private.st_rate('begin',20);
  return private.st_snapshot();
end;
$$;
create function public.st_join(p_client_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id);
  perform private.st_sweep();
  if exists(select 1 from private.active_members where user_id=u) then return private.st_snapshot(); end if;
  perform private.st_rate('join',12,500);
  update private.presence set last_seen=now() where user_id=u;
  insert into private.match_queue(user_id) values(u) on conflict do nothing;
  perform private.st_match(); return private.st_snapshot();
end;
$$;
create function public.st_heartbeat(p_client_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id);
  perform private.st_rate('heartbeat',90);
  -- Sweep before renewing: a device offline for 75 seconds loses its conversation.
  perform private.st_sweep();
  update private.presence set last_seen=now() where user_id=u;
  update public.profiles set last_active_at=now() where id=u;
  perform private.st_match(); return private.st_snapshot();
end;
$$;
create function public.st_leave(p_client_id uuid,p_session_id uuid default null) returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid; sid uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id);
  select session_id into sid from private.active_members where user_id=u;
  if sid is not null and p_session_id is not null and sid<>p_session_id then raise exception 'Conversation changed. Please refresh.'; end if;
  if sid is not null then perform private.st_end(sid,'left'); end if;
  delete from private.match_queue where user_id=u;
  return private.st_snapshot();
end;
$$;
create function public.st_next(p_client_id uuid,p_session_id uuid) returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid; sid uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id);
  perform private.st_rate('next',12,1000);
  select session_id into sid from private.active_members where user_id=u;
  if sid is not null and sid is distinct from p_session_id then raise exception 'Conversation changed. Please refresh.'; end if;
  if sid is not null then perform private.st_end(sid,'next'); end if;
  update private.presence set last_seen=now() where user_id=u;
  insert into private.match_queue(user_id) values(u) on conflict do nothing;
  perform private.st_sweep(); perform private.st_match(); return private.st_snapshot();
end;
$$;
create function public.st_send(p_client_id uuid,p_session_id uuid,p_body text,p_nonce uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare u uuid; m public.chat_messages; body_text text := btrim(p_body);
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id); perform private.st_sweep();
  if not exists(select 1 from private.active_members where user_id=u and session_id=p_session_id) then
    raise exception 'This conversation has ended.';
  end if;
  if p_nonce is null then raise exception 'Message identifier required.'; end if;
  select * into m from public.chat_messages where sender_id=u and client_nonce=p_nonce;
  if found then
    if m.session_id<>p_session_id or m.body is distinct from body_text then raise exception 'Message identifier already used.'; end if;
    return to_jsonb(m);
  end if;
  if body_text is null or char_length(body_text) not between 1 and 2000 then raise exception 'Write a message between 1 and 2,000 characters.'; end if;
  if body_text ~* '(https?://|www\.|\m(rape you|kill you|send nudes|child porn)\M)' then
    raise exception 'Message blocked by basic safety filters. Links, threats and sexual solicitation are not allowed.';
  end if;
  perform private.st_rate('send',30,600);
  if exists(select 1 from public.chat_messages where sender_id=u and body=body_text and created_at>now()-interval '10 seconds') then
    raise exception 'Please avoid repeating the same message.';
  end if;
  insert into public.chat_messages(session_id,sender_id,body,client_nonce) values(p_session_id,u,body_text,p_nonce) returning * into m;
  update public.chat_sessions set typing_a_until=case when user_a=u then null else typing_a_until end,
    typing_b_until=case when user_b=u then null else typing_b_until end where id=p_session_id;
  return to_jsonb(m);
end;
$$;
create function public.st_typing(p_client_id uuid,p_session_id uuid,p_typing boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare u uuid; t timestamptz;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id);
  if not exists(select 1 from private.active_members where user_id=u and session_id=p_session_id) then return; end if;
  perform private.st_rate('typing',45,900);
  t:=case when p_typing then now()+interval '4 seconds' else null end;
  update public.chat_sessions set typing_a_until=case when user_a=u then t else typing_a_until end,
    typing_b_until=case when user_b=u then t else typing_b_until end where id=p_session_id and ended_at is null;
end;
$$;
create function public.st_safety(p_client_id uuid,p_session_id uuid,p_reason text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare u uuid; s public.chat_sessions; target uuid; rid uuid; evidence jsonb;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id);
  select * into s from public.chat_sessions where id=p_session_id and u in(user_a,user_b)
    and (ended_at is null or ended_at>now()-interval '10 minutes');
  if not found then raise exception 'This conversation is no longer available for a report.'; end if;
  perform private.st_rate('safety',10);
  target:=case when s.user_a=u then s.user_b else s.user_a end;
  insert into private.blocked_users(blocker_id,blocked_id) values(u,target) on conflict do nothing;
  if p_reason is not null then
    if p_reason not in ('harassment','sexual_content','underage','spam','other') then raise exception 'Choose a valid report reason.'; end if;
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into evidence from (
      select sender_id,body,created_at from public.chat_messages where session_id=p_session_id order by created_at desc,id limit 20
    ) x;
    insert into private.user_reports(reporter_id,reported_id,session_id,reason,evidence)
      values(u,target,p_session_id,p_reason,evidence) on conflict(reporter_id,session_id) do nothing returning id into rid;
    if rid is null then select id into rid from private.user_reports where reporter_id=u and session_id=p_session_id; end if;
  end if;
  perform private.st_end(p_session_id,case when p_reason is null then 'blocked' else 'reported' end);
  return rid;
end;
$$;

-- Owner-only moderation, callable from SQL Editor; deliberately outside the API schema.
create function private.st_moderate(p_user_id uuid,p_hours integer,p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  perform private.st_lock();
  if p_hours is null or p_hours not between 0 and 87600 or p_note is null or char_length(btrim(p_note)) not between 1 and 1000 then
    raise exception 'Supply 0–87600 hours and a review note of 1–1000 characters.';
  end if;
  update public.profiles set banned_until=case when p_hours=0 then null else now()+make_interval(hours=>p_hours) end where id=p_user_id;
  if not found then raise exception 'Identity not found.'; end if;
  insert into private.moderation_actions(user_id,action,note) values(p_user_id,case when p_hours=0 then 'unban' else 'ban' end,btrim(p_note));
  if p_hours>0 then
    select session_id into sid from private.active_members where user_id=p_user_id;
    if sid is not null then perform private.st_end(sid,'moderated'); end if;
    delete from private.match_queue where user_id=p_user_id;
  end if;
end;
$$;

-- Owner-only housekeeping; cron calls this, never a mobile client.
create function private.st_cleanup() returns void language plpgsql security definer set search_path = '' as $$
begin
  perform private.st_lock(); perform private.st_sweep();
  delete from public.chat_messages m using public.chat_sessions s where m.session_id=s.id and
    (s.ended_at<now()-interval '10 minutes' or m.created_at<now()-interval '1 hour');
  delete from private.user_reports where expires_at<now();
  delete from public.chat_sessions where ended_at<now()-interval '1 day';
  delete from private.rate_limits where last_at<now()-interval '1 day';
  delete from private.presence where last_seen<now()-interval '1 day';
  delete from private.moderation_actions where created_at<now()-interval '90 days';
  -- Retain identity/blocks for 90 days after last authenticated use, then remove.
  delete from auth.users a using public.profiles p where a.id=p.id and a.is_anonymous=true
    and greatest(coalesce(a.last_sign_in_at,a.created_at),p.last_active_at)<now()-interval '90 days'
    and not exists(select 1 from private.presence pr where pr.user_id=a.id)
    and not exists(select 1 from private.active_members m where m.user_id=a.id);
  delete from auth.users where is_anonymous=true and created_at<now()-interval '1 day'
    and not exists(select 1 from public.profiles p where p.id=auth.users.id);
end;
$$;

-- PostgreSQL functions otherwise default to executable by PUBLIC. Lock every endpoint down.
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.st_begin(uuid,boolean,text),public.st_join(uuid),public.st_heartbeat(uuid),
  public.st_leave(uuid,uuid),public.st_next(uuid,uuid),public.st_send(uuid,uuid,text,uuid),
  public.st_typing(uuid,uuid,boolean),public.st_safety(uuid,uuid,text) from public,anon;
grant execute on function public.st_begin(uuid,boolean,text),public.st_join(uuid),public.st_heartbeat(uuid),
  public.st_leave(uuid,uuid),public.st_next(uuid,uuid),public.st_send(uuid,uuid,text,uuid),
  public.st_typing(uuid,uuid,boolean),public.st_safety(uuid,uuid,text) to authenticated;

-- RLS is evaluated for each Postgres Changes event. Polling repairs missed events.
alter publication supabase_realtime add table public.chat_sessions,public.chat_messages;
commit;
