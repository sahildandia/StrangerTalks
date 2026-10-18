begin;
create function private.cm_is_admin(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.event_admins where user_id=p_user_id);
$$;
revoke all on function private.cm_is_admin(uuid) from public,anon,authenticated;
alter table private.gc_rooms drop constraint gc_rooms_capacity_check;
alter table private.gc_rooms add constraint gc_rooms_capacity_check check(capacity between 2 and 1000);
create or replace function public.gc_list(p_client_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; college uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id); perform private.gc_sweep();
  perform private.st_rate('gc_list',60);
  select college_id into college from public.profiles where id=u;
  if college is null and not private.cm_is_admin(u) then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object(
    'college_name',(select name from private.colleges where id=r.college_id),
    'member_count',(select count(*) from private.gc_members m where m.room_id=r.id),
    'last_message',(select left(m.body,160) from public.gc_messages m where m.room_id=r.id and m.created_at>now()-interval '1 hour' order by m.created_at desc,m.id desc limit 1),
    'last_message_at',(select m.created_at from public.gc_messages m where m.room_id=r.id and m.created_at>now()-interval '1 hour' order by m.created_at desc,m.id desc limit 1)
  ) order by r.name) from private.gc_rooms r where r.college_id is not null and (r.college_id=college or private.cm_is_admin(u)) and r.status='approved'),'[]'::jsonb);
end;
$$;

create or replace function public.gc_join(p_client_id uuid,p_room_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; cap integer; sid uuid; college uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id); perform private.gc_sweep(); perform private.st_sweep();
  select college_id into college from public.profiles where id=u;
  select r.capacity into cap from private.gc_rooms r where r.id=p_room_id and r.college_id is not null and (r.college_id=college or private.cm_is_admin(u)) and r.status='approved';
  if not found then raise exception 'That approved group is not available for your college. Select your college in Profile.'; end if;
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

create or replace function private.gc_sweep() returns void
language plpgsql set search_path='' as $$
begin
  delete from private.gc_members m where not exists(
    select 1 from private.gc_rooms r join public.profiles f on (f.college_id=r.college_id or private.cm_is_admin(f.id))
    join private.presence p on p.user_id=f.id
    where r.id=m.room_id and r.college_id is not null and f.id=m.user_id
      and p.last_seen>now()-interval '75 seconds'
      and (f.banned_until is null or f.banned_until<=now()));
end;
$$;

create or replace function public.gc_can_read(p_room_id uuid,p_created_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.gc_members m
    join private.gc_rooms r on r.id=m.room_id and r.college_id is not null
    join public.profiles f on f.id=m.user_id and (f.college_id=r.college_id or private.cm_is_admin(f.id))
    join private.presence p on p.user_id=m.user_id
    where r.status='approved' and m.user_id=auth.uid() and m.room_id=p_room_id
      and p.last_seen>now()-interval '75 seconds' and p_created_at>=m.joined_at
      and p_created_at>now()-interval '1 hour' and (f.banned_until is null or f.banned_until<=now()));
$$;

create or replace function public.gc_poll(p_client_id uuid,p_room_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id); perform private.gc_sweep();
  perform private.st_rate('gc_poll',90);
  if not exists(select 1 from private.gc_members m join private.gc_rooms r on r.id=m.room_id
    join public.profiles f on f.id=m.user_id and (f.college_id=r.college_id or private.cm_is_admin(f.id))
    where m.user_id=u and m.room_id=p_room_id and r.college_id is not null and r.status='approved') then
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
declare u uuid; message_row public.gc_messages; body_text text:=btrim(p_body);
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id); perform private.gc_sweep();
  if not exists(select 1 from private.gc_members member
    join private.gc_rooms room on room.id=member.room_id
    join public.profiles profile on profile.id=member.user_id and (profile.college_id=room.college_id or private.cm_is_admin(profile.id))
    where member.user_id=u and member.room_id=p_room_id and room.college_id is not null
      and room.status='approved') then
    raise exception 'You are no longer in a group for this college. Join again.';
  end if;
  if p_nonce is null then raise exception 'Message identifier required.'; end if;
  select * into message_row from public.gc_messages where sender_id=u and client_nonce=p_nonce;
  if found then
    if message_row.room_id<>p_room_id or message_row.body is distinct from body_text then
      raise exception 'Message identifier already used.';
    end if;
    return to_jsonb(message_row);
  end if;
  if body_text is null or char_length(body_text) not between 1 and 2000 then
    raise exception 'Write a message between 1 and 2,000 characters.';
  end if;
  if body_text ~* '(https?://|www\.|\m(rape you|kill you|send nudes|child porn)\M)' then
    raise exception 'Message blocked by basic safety filters. Links, threats and sexual solicitation are not allowed.';
  end if;
  perform private.st_rate('send',30,600);
  if exists(select 1 from public.gc_messages where sender_id=u and body=body_text and created_at>now()-interval '10 seconds') then
    raise exception 'Please avoid repeating the same message.';
  end if;
  insert into public.gc_messages(room_id,sender_id,body,client_nonce)
    values(p_room_id,u,body_text,p_nonce) returning * into message_row;
  update private.gc_members set typing_until=null where user_id=u;
  return to_jsonb(message_row);
end;
$$;

create or replace function public.gc_submit_room(
  p_client_id uuid,p_name text,p_description text,p_topic text,p_capacity integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid; college uuid; room_id uuid; cleaned_name text; cleaned_description text;
begin
  u:=private.st_assert(p_client_id); perform private.st_rate('gc_submit_room',5,1000);
  select college_id into college from public.profiles where id=u;
  if college is null then raise exception 'Choose your college in Profile before creating a group.'; end if;
  cleaned_name:=regexp_replace(btrim(coalesce(p_name,'')),'\s+',' ','g');
  cleaned_description:=btrim(coalesce(p_description,''));
  if char_length(cleaned_name) not between 3 and 48 or cleaned_name ~ '[[:cntrl:]]'
    or char_length(cleaned_description) not between 10 and 240 or cleaned_description ~ '[[:cntrl:]]'
    or p_topic not in ('general','music','gaming','life','department','college','career','study','events','social')
    or p_capacity not between 2 and 1000 then
    raise exception 'Check the group name, description, category, and member limit.';
  end if;
  if exists(select 1 from private.gc_rooms r where r.college_id=college and lower(r.name)=lower(cleaned_name)) then
    raise exception 'A group with that name already exists or is awaiting review.';
  end if;
  insert into private.gc_rooms(id,name,description,topic,capacity,college_id,status,submitted_by)
    values(gen_random_uuid(),cleaned_name,cleaned_description,p_topic,p_capacity,college,'pending',u)
    returning id into room_id;
  return jsonb_build_object('id',room_id,'status','pending');
end;
$$;
notify pgrst,'reload schema';
commit;
