begin;

alter table public.gc_messages add column image_data text check(image_data is null or (octet_length(image_data)<=700000 and image_data ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$'));

create or replace function private.gc_snapshot(p_room_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare r private.gc_rooms; joined timestamptz;
begin
  select joined_at into joined from private.gc_members where user_id=auth.uid() and room_id=p_room_id;
  if not found then return jsonb_build_object('state','left'); end if;
  select * into r from private.gc_rooms where id=p_room_id;
  return jsonb_build_object('state','joined','room',to_jsonb(r),
    'members',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'typing_until',m.typing_until) order by m.joined_at),'[]') from private.gc_members m where m.room_id=p_room_id),
    'messages',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') from
      (select * from public.gc_messages where room_id=p_room_id and created_at>=joined
        and created_at>now()-interval '24 hours' order by created_at desc,id desc limit 200) x));
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
      and p_created_at>now()-interval '24 hours' and (f.banned_until is null or f.banned_until<=now()));
$$;

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
    'last_message',(select left(m.body,160) from public.gc_messages m where m.room_id=r.id and m.created_at>now()-interval '24 hours' order by m.created_at desc,m.id desc limit 1),
    'last_message_at',(select m.created_at from public.gc_messages m where m.room_id=r.id and m.created_at>now()-interval '24 hours' order by m.created_at desc,m.id desc limit 1)
  ) order by r.name) from private.gc_rooms r where r.college_id is not null and (r.college_id=college or private.cm_is_admin(u)) and r.status='approved'),'[]'::jsonb);
end;
$$;

create or replace function private.gc_cleanup() returns void language plpgsql set search_path='' as $$
begin
  perform private.gc_sweep();
  delete from public.gc_messages where created_at<now()-interval '24 hours';
  delete from private.gc_reports where expires_at<now();
end;
$$;

create function public.gc_send_image(p_client_id uuid,p_room_id uuid,p_image_data text,p_nonce uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; m public.gc_messages;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id);
  if p_image_data is null or octet_length(p_image_data)>700000 or p_image_data !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$' then raise exception 'Choose a valid photo smaller than 500 KB.'; end if;
  perform public.gc_send(p_client_id,p_room_id,'Photo',p_nonce);
  select * into m from public.gc_messages where sender_id=u and client_nonce=p_nonce for update;
  if m.image_data is not null and m.image_data<>p_image_data then raise exception 'Message identifier already used.'; end if;
  update public.gc_messages set image_data=p_image_data where id=m.id returning * into m;
  return to_jsonb(m);
end;
$$;
revoke all on function public.gc_send_image(uuid,uuid,text,uuid) from public,anon;
grant execute on function public.gc_send_image(uuid,uuid,text,uuid) to authenticated;

alter table private.gc_reports alter column expires_at set default(now()+interval '24 hours');

create or replace function public.gc_safety(p_client_id uuid,p_room_id uuid,p_target uuid,p_reason text default null) returns uuid language plpgsql security definer set search_path='' as $$
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

update private.gc_reports set expires_at=least(expires_at,created_at+interval '24 hours');

notify pgrst, 'reload schema';

commit;
