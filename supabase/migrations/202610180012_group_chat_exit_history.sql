begin;

create or replace function private.gc_snapshot(p_room_id uuid) returns jsonb language plpgsql set search_path='' as $$
declare r private.gc_rooms;
begin
  if not exists(select 1 from private.gc_members where user_id=auth.uid() and room_id=p_room_id) then return jsonb_build_object('state','left'); end if;
  select * into r from private.gc_rooms where id=p_room_id;
  return jsonb_build_object('state','joined','room',to_jsonb(r),
    'members',(select coalesce(jsonb_agg(jsonb_build_object('user_id',m.user_id,'typing_until',m.typing_until) order by m.joined_at),'[]') from private.gc_members m where m.room_id=p_room_id),
    'messages',(select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at,x.id),'[]') from
      (select * from public.gc_messages where room_id=p_room_id and created_at>now()-interval '24 hours' order by created_at desc,id desc limit 200) x));
end;
$$;

create or replace function public.gc_can_read(p_room_id uuid,p_created_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.gc_members m
    join private.gc_rooms r on r.id=m.room_id and r.college_id is not null
    join public.profiles f on f.id=m.user_id and (f.college_id=r.college_id or private.cm_is_admin(f.id))
    join private.presence p on p.user_id=m.user_id
    where r.status='approved' and m.user_id=auth.uid() and m.room_id=p_room_id
      and p.last_seen>now()-interval '75 seconds'
      and p_created_at>now()-interval '24 hours' and (f.banned_until is null or f.banned_until<=now()));
$$;

notify pgrst, 'reload schema';
commit;
