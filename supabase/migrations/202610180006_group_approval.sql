-- Student-submitted campus groups stay private until an administrator approves them.
begin;

alter table private.gc_rooms
  add column status text not null default 'approved' check (status in ('pending','approved','rejected','disabled')),
  add column submitted_by uuid references auth.users(id) on delete set null,
  add column created_at timestamptz not null default now(),
  add column reviewed_by uuid references auth.users(id) on delete set null,
  add column reviewed_at timestamptz,
  add column review_note text check (review_note is null or char_length(review_note) <= 300);

alter table private.gc_rooms drop constraint if exists gc_rooms_capacity_check;
alter table private.gc_rooms add constraint gc_rooms_capacity_check check (capacity between 2 and 100);
create index gc_rooms_admin_queue on private.gc_rooms(status,created_at desc);

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
  ) order by r.name) from private.gc_rooms r where r.college_id=college and r.status='approved'),'[]'::jsonb);
end;
$$;

create or replace function public.gc_join(p_client_id uuid,p_room_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; cap integer; sid uuid; college uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id); perform private.gc_sweep(); perform private.st_sweep();
  select college_id into college from public.profiles where id=u;
  select r.capacity into cap from private.gc_rooms r where r.id=p_room_id and r.college_id=college and college is not null and r.status='approved';
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

create function public.gc_submit_room(
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
    or p_capacity not between 2 and 100 then
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

create function public.gc_admin_list_rooms(p_client_id uuid,p_college_id uuid default null,p_status text default 'pending')
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
  u:=private.cm_assert_admin(p_client_id);
  if p_status not in ('all','pending','approved','rejected','disabled') then raise exception 'Choose a valid group status filter.'; end if;
  return coalesce((select jsonb_agg(to_jsonb(r)||jsonb_build_object(
    'college_name',c.name,
    'member_count',(select count(*) from private.gc_members m where m.room_id=r.id)
  ) order by (r.status='pending') desc,r.created_at desc)
    from private.gc_rooms r join private.colleges c on c.id=r.college_id
    where r.college_id is not null and (p_college_id is null or r.college_id=p_college_id)
      and (p_status='all' or r.status=p_status)), '[]'::jsonb);
end;
$$;

create function public.gc_admin_review_room(p_client_id uuid,p_room_id uuid,p_status text,p_note text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
  u:=private.cm_assert_admin(p_client_id);
  if p_status not in ('approved','rejected','disabled') then raise exception 'Choose approve, reject, or pause.'; end if;
  if p_note is not null and char_length(p_note)>300 then raise exception 'Review note is too long.'; end if;
  update private.gc_rooms set status=p_status,review_note=nullif(btrim(p_note),''),reviewed_by=u,reviewed_at=now()
    where id=p_room_id and college_id is not null;
  if not found then raise exception 'This group could not be found.'; end if;
  if p_status<>'approved' then delete from private.gc_members where room_id=p_room_id; end if;
  return true;
end;
$$;

create or replace function public.gc_can_read(p_room_id uuid,p_created_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.gc_members m
    join private.gc_rooms r on r.id=m.room_id and r.college_id is not null and r.status='approved'
    join public.profiles f on f.id=m.user_id and f.college_id=r.college_id
    join private.presence p on p.user_id=m.user_id
    where m.user_id=auth.uid() and m.room_id=p_room_id
      and p.last_seen>now()-interval '75 seconds' and p_created_at>=m.joined_at
      and p_created_at>now()-interval '1 hour' and (f.banned_until is null or f.banned_until<=now()));
$$;

revoke all on function public.gc_submit_room(uuid,text,text,text,integer),public.gc_admin_list_rooms(uuid,uuid,text),public.gc_admin_review_room(uuid,uuid,text,text) from public,anon;
grant execute on function public.gc_submit_room(uuid,text,text,text,integer) to authenticated;
grant execute on function public.gc_admin_list_rooms(uuid,uuid,text),public.gc_admin_review_room(uuid,uuid,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
