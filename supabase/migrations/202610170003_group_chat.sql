-- Additive group chat backend. Existing anonymous identities and random chats stay valid.
begin;
create table private.gc_rooms (
  id uuid primary key, name text not null, description text not null,
  topic text not null, capacity integer not null default 20 check(capacity between 2 and 20)
);
insert into private.gc_rooms(id,name,description,topic) values
 ('10000000-0000-4000-8000-000000000001','The Lounge','A little hello. A new perspective.','general'),
 ('10000000-0000-4000-8000-000000000002','Music & Mood','Songs, artists, and what is on repeat.','music'),
 ('10000000-0000-4000-8000-000000000003','Game Corner','Games, adventures, and friendly conversation.','gaming'),
 ('10000000-0000-4000-8000-000000000004','Daily Life','Small moments and everyday stories.','life');
create table private.gc_members (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  room_id uuid not null references private.gc_rooms(id), joined_at timestamptz not null default clock_timestamp(),
  typing_until timestamptz
);
create index on private.gc_members(room_id);
create table public.gc_messages (
  id uuid primary key default gen_random_uuid(), room_id uuid not null references private.gc_rooms(id),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check(char_length(body) between 1 and 2000),
  client_nonce uuid not null, created_at timestamptz not null default clock_timestamp(),
  unique(sender_id,client_nonce)
);
create index on public.gc_messages(room_id,created_at);
create table private.gc_reports (
  id uuid primary key default gen_random_uuid(), reporter_id uuid not null, reported_id uuid not null,
  room_id uuid not null, reason text not null check(reason in ('harassment','sexual_content','underage','spam','other')),
  evidence jsonb not null, created_at timestamptz not null default now(),
  expires_at timestamptz not null default(now()+interval '30 days'), reviewed_at timestamptz
);
alter table private.gc_rooms enable row level security;
alter table private.gc_members enable row level security;
alter table private.gc_reports enable row level security;
alter table public.gc_messages enable row level security;
revoke all on private.gc_rooms,private.gc_members,private.gc_reports,public.gc_messages from public,anon,authenticated;

create function private.gc_sweep() returns void language sql set search_path='' as $$
  delete from private.gc_members m where not exists(
    select 1 from private.presence p join public.profiles f on f.id=p.user_id
    where p.user_id=m.user_id and p.last_seen>now()-interval '75 seconds'
      and (f.banned_until is null or f.banned_until<=now()));
$$;
create function public.gc_can_read(p_room_id uuid,p_created_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.gc_members m join private.presence p on p.user_id=m.user_id
    join public.profiles f on f.id=m.user_id where m.user_id=auth.uid() and m.room_id=p_room_id
      and p.last_seen>now()-interval '75 seconds' and p_created_at>=m.joined_at
      and p_created_at>now()-interval '1 hour' and (f.banned_until is null or f.banned_until<=now()));
$$;
grant select on public.gc_messages to authenticated;
create policy gc_member_messages on public.gc_messages for select to authenticated
  using(public.gc_can_read(room_id,created_at));

create function private.gc_snapshot(p_room_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare r private.gc_rooms; joined timestamptz;
begin
  select joined_at into joined from private.gc_members where user_id=auth.uid() and room_id=p_room_id;
  if not found then return jsonb_build_object('state','left'); end if;
  select * into r from private.gc_rooms where id=p_room_id;
  return jsonb_build_object('state','joined','room',to_jsonb(r),
    'members',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'typing_until',m.typing_until) order by m.joined_at),'[]') from private.gc_members m where m.room_id=p_room_id),
    'messages',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') from
      (select * from public.gc_messages where room_id=p_room_id and created_at>=joined
        and created_at>now()-interval '1 hour' order by created_at desc,id desc limit 200) x));
end;
$$;
create function public.gc_list(p_client_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.st_lock(); perform private.st_assert(p_client_id); perform private.gc_sweep();
  perform private.st_rate('gc_list',60);
  return (select jsonb_agg(to_jsonb(r)||jsonb_build_object('member_count',(select count(*) from private.gc_members m where m.room_id=r.id)) order by r.id) from private.gc_rooms r);
end;
$$;
create function public.gc_join(p_client_id uuid,p_room_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; cap integer; sid uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id); perform private.gc_sweep(); perform private.st_sweep();
  select capacity into cap from private.gc_rooms where id=p_room_id;
  if not found then raise exception 'Group not found.'; end if;
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
-- Entering random mode atomically leaves any group, even from a modified client.
create function private.gc_leave_for_random() returns trigger language plpgsql set search_path='' as $$
begin delete from private.gc_members where user_id=new.user_id; return new; end;
$$;
create trigger gc_random_queue before insert on private.match_queue for each row execute function private.gc_leave_for_random();
create trigger gc_random_match before insert on private.active_members for each row execute function private.gc_leave_for_random();

create function public.gc_poll(p_client_id uuid,p_room_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id); perform private.gc_sweep();
  perform private.st_rate('gc_poll',90);
  if not exists(select 1 from private.gc_members where user_id=u and room_id=p_room_id) then return jsonb_build_object('state','left'); end if;
  update private.presence set last_seen=now() where user_id=u;
  update public.profiles set last_active_at=now() where id=u;
  return private.gc_snapshot(p_room_id);
end;
$$;
create function public.gc_leave(p_client_id uuid,p_room_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.st_lock(); perform private.st_assert(p_client_id);
  delete from private.gc_members where user_id=auth.uid() and room_id=p_room_id;
end;
$$;
create function public.gc_send(p_client_id uuid,p_room_id uuid,p_body text,p_nonce uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; m public.gc_messages; body_text text:=btrim(p_body);
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id); perform private.gc_sweep();
  if not exists(select 1 from private.gc_members where user_id=u and room_id=p_room_id) then raise exception 'You are no longer in this group. Join again.'; end if;
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
create function public.gc_typing(p_client_id uuid,p_room_id uuid,p_typing boolean) returns void language plpgsql security definer set search_path='' as $$
begin
  perform private.st_lock(); perform private.st_assert(p_client_id); perform private.gc_sweep();
  if not exists(select 1 from private.gc_members where user_id=auth.uid() and room_id=p_room_id) then return; end if;
  perform private.st_rate('typing',45,900);
  update private.gc_members set typing_until=case when p_typing then now()+interval '4 seconds' else null end where user_id=auth.uid();
end;
$$;
create function public.gc_safety(p_client_id uuid,p_room_id uuid,p_target uuid,p_reason text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid; joined timestamptz; rid uuid; evidence jsonb;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id); perform private.gc_sweep();
  select joined_at into joined from private.gc_members where user_id=u and room_id=p_room_id;
  if not found or p_target=u or p_target is null then raise exception 'Choose another member of your current group.'; end if;
  if not exists(select 1 from private.gc_members where user_id=p_target and room_id=p_room_id)
    and not exists(select 1 from public.gc_messages where sender_id=p_target and room_id=p_room_id and created_at>=joined) then raise exception 'That identity is not part of this conversation.'; end if;
  perform private.st_rate('safety',10);
  insert into private.blocked_users(blocker_id,blocked_id) values(u,p_target) on conflict do nothing;
  if p_reason is not null then
    if p_reason not in ('harassment','sexual_content','underage','spam','other') then raise exception 'Choose a valid report reason.'; end if;
    select coalesce(jsonb_agg(to_jsonb(x)),'[]') into evidence from
      (select sender_id,body,created_at from public.gc_messages where room_id=p_room_id and created_at>=joined order by created_at desc,id limit 20) x;
    insert into private.gc_reports(reporter_id,reported_id,room_id,reason,evidence) values(u,p_target,p_room_id,p_reason,evidence) returning id into rid;
  end if;
  -- Leave the reporter's room; neither blocked identity may rejoin the other.
  delete from private.gc_members where user_id=u;
  return rid;
end;
$$;
create function private.gc_cleanup() returns void language plpgsql set search_path='' as $$
begin
  perform private.gc_sweep();
  delete from public.gc_messages where created_at<now()-interval '1 hour';
  delete from private.gc_reports where expires_at<now();
end;
$$;
-- Preserve the installed minute Cron schedule while extending its owner-only work.
alter function private.st_cleanup() rename to st_cleanup_random;
create function private.st_cleanup() returns void language plpgsql security definer set search_path='' as $$
begin perform private.st_lock(); perform private.gc_cleanup(); perform private.st_cleanup_random(); end;
$$;
revoke all on all functions in schema private from public,anon,authenticated;
revoke all on function public.gc_can_read(uuid,timestamptz),public.gc_list(uuid),public.gc_join(uuid,uuid),
 public.gc_poll(uuid,uuid),public.gc_leave(uuid,uuid),public.gc_send(uuid,uuid,text,uuid),public.gc_typing(uuid,uuid,boolean),public.gc_safety(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.gc_can_read(uuid,timestamptz),public.gc_list(uuid),public.gc_join(uuid,uuid),
 public.gc_poll(uuid,uuid),public.gc_leave(uuid,uuid),public.gc_send(uuid,uuid,text,uuid),public.gc_typing(uuid,uuid,boolean),public.gc_safety(uuid,uuid,uuid,text) to authenticated;
alter publication supabase_realtime add table public.gc_messages;
notify pgrst,'reload schema';
commit;
