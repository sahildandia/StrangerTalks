-- Moderated campus events. Posters stay private until an event is approved.
begin;

create table private.event_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table private.event_admins enable row level security;
revoke all on private.event_admins from public,anon,authenticated;

create table public.campus_events (
  id uuid primary key default gen_random_uuid(),
  submitted_by uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 3 and 90),
  organizer text not null check (char_length(btrim(organizer)) between 2 and 90),
  category text not null check (category in ('Technical','Cultural','Workshop','Career','Social','Other')),
  event_date date not null,
  start_time time not null,
  end_time time,
  venue text not null check (char_length(btrim(venue)) between 2 and 120),
  description text not null check (char_length(btrim(description)) between 20 and 2000),
  registration_url text not null check (registration_url ~ '^https://[^[:space:]]+$'),
  poster_path text not null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null
);
create index campus_events_public_date on public.campus_events(event_date,start_time) where status='approved';
create index campus_events_owner on public.campus_events(submitted_by,created_at desc);
alter table public.campus_events enable row level security;
revoke all on public.campus_events from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('event-posters','event-posters',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=5242880,allowed_mime_types=excluded.allowed_mime_types;

create function public.ce_is_admin(p_client_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
  u:=private.st_assert(p_client_id);
  return exists(select 1 from private.event_admins where user_id=u);
end;
$$;

create function public.ce_can_read_poster(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from public.campus_events e where e.poster_path=p_path
    and (e.status='approved' or e.submitted_by=auth.uid()
      or exists(select 1 from private.event_admins a where a.user_id=auth.uid())))
$$;

create function public.ce_list(p_client_id uuid) returns setof public.campus_events
language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
  u:=private.st_assert(p_client_id);
  return query select e.* from public.campus_events e where e.status='approved'
    and e.event_date>=current_date order by e.event_date,e.start_time limit 100;
end;
$$;

create function public.ce_my_events(p_client_id uuid) returns setof public.campus_events
language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
  u:=private.st_assert(p_client_id);
  return query select e.* from public.campus_events e where e.submitted_by=u order by e.created_at desc limit 100;
end;
$$;

create function public.ce_admin_events(p_client_id uuid) returns setof public.campus_events
language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
  u:=private.st_assert(p_client_id);
  if not exists(select 1 from private.event_admins where user_id=u) then raise exception 'Admin access required.'; end if;
  return query select e.* from public.campus_events e order by (e.status='pending') desc,e.created_at desc limit 250;
end;
$$;

create function public.ce_submit(
  p_client_id uuid,p_title text,p_organizer text,p_category text,p_event_date date,
  p_start_time time,p_end_time time,p_venue text,p_description text,p_registration_url text,p_poster_path text
) returns public.campus_events
language plpgsql security definer set search_path='' as $$
declare u uuid; e public.campus_events;
begin
  u:=private.st_assert(p_client_id); perform private.st_rate('event_submit',5,1000);
  if p_title is null or char_length(btrim(p_title)) not between 3 and 90
    or p_organizer is null or char_length(btrim(p_organizer)) not between 2 and 90
    or p_category not in ('Technical','Cultural','Workshop','Career','Social','Other')
    or p_event_date<current_date or p_event_date>current_date+365
    or p_start_time is null or (p_end_time is not null and p_end_time<=p_start_time)
    or p_venue is null or char_length(btrim(p_venue)) not between 2 and 120
    or p_description is null or char_length(btrim(p_description)) not between 20 and 2000
    or p_registration_url is null or p_registration_url !~ '^https://[^[:space:]]+$'
    or p_poster_path is null or split_part(p_poster_path,'/',1)<>u::text then
    raise exception 'Check the event details, secure registration link, date, and poster, then try again.';
  end if;
  if not exists(select 1 from storage.objects where bucket_id='event-posters' and name=p_poster_path and owner_id=u::text) then
    raise exception 'Upload your event poster before submitting.';
  end if;
  perform private.st_rate('event_submit_daily',10);
  insert into public.campus_events(submitted_by,title,organizer,category,event_date,start_time,end_time,venue,description,registration_url,poster_path)
  values(u,btrim(p_title),btrim(p_organizer),p_category,p_event_date,p_start_time,p_end_time,btrim(p_venue),btrim(p_description),p_registration_url,p_poster_path)
  returning * into e;
  return e;
end;
$$;

create function public.ce_review(p_client_id uuid,p_event_id uuid,p_status text,p_note text default null) returns public.campus_events
language plpgsql security definer set search_path='' as $$
declare u uuid; e public.campus_events;
begin
  u:=private.st_assert(p_client_id);
  if not exists(select 1 from private.event_admins where user_id=u) then raise exception 'Admin access required.'; end if;
  if p_status not in ('approved','rejected') then raise exception 'Choose approve or reject.'; end if;
  update public.campus_events set status=p_status,review_note=nullif(left(btrim(coalesce(p_note,'')),300),''),reviewed_at=now(),reviewed_by=u
  where id=p_event_id returning * into e;
  if not found then raise exception 'Event submission not found.'; end if;
  return e;
end;
$$;

create policy event_posters_insert on storage.objects for insert to authenticated
with check(bucket_id='event-posters' and split_part(name,'/',1)=auth.uid()::text and owner_id=auth.uid()::text);
create policy event_posters_read on storage.objects for select to authenticated
using(bucket_id='event-posters' and public.ce_can_read_poster(name));
create policy event_posters_delete on storage.objects for delete to authenticated
using(bucket_id='event-posters' and split_part(name,'/',1)=auth.uid()::text and owner_id=auth.uid()::text);

revoke all on function public.ce_is_admin(uuid),public.ce_can_read_poster(text),public.ce_list(uuid),
  public.ce_my_events(uuid),public.ce_admin_events(uuid),public.ce_submit(uuid,text,text,text,date,time,time,text,text,text,text),
  public.ce_review(uuid,uuid,text,text) from public,anon;
grant execute on function public.ce_is_admin(uuid),public.ce_list(uuid),public.ce_my_events(uuid),
  public.ce_admin_events(uuid),public.ce_submit(uuid,text,text,text,date,time,time,text,text,text,text),
  public.ce_review(uuid,uuid,text,text) to authenticated;
grant execute on function public.ce_can_read_poster(text) to authenticated;

-- Add more named group rooms while preserving rooms that existing members use.
insert into private.gc_rooms(id,name,description,topic) values
  ('10000000-0000-4000-8000-000000000005','CSE Students','Projects, coding, labs, and campus life.','department'),
  ('10000000-0000-4000-8000-000000000006','College General','Meet students from every department.','college'),
  ('10000000-0000-4000-8000-000000000007','Placement Updates','Interviews, resumes, and job preparation.','career'),
  ('10000000-0000-4000-8000-000000000008','Memes & Fun','Keep it friendly and share a laugh.','social'),
  ('10000000-0000-4000-8000-000000000009','Study Discussions','Find a study partner and stay focused.','study'),
  ('10000000-0000-4000-8000-00000000000a','Event Updates','Discover what is happening on campus.','events')
on conflict(id) do nothing;

create or replace function public.gc_list(p_client_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
begin
  perform private.st_lock(); perform private.st_assert(p_client_id); perform private.gc_sweep();
  perform private.st_rate('gc_list',60);
  return (select jsonb_agg(to_jsonb(r)||jsonb_build_object(
    'member_count',(select count(*) from private.gc_members m where m.room_id=r.id),
    'last_message',(select left(m.body,160) from public.gc_messages m where m.room_id=r.id and m.created_at>now()-interval '1 hour' order by m.created_at desc,m.id desc limit 1),
    'last_message_at',(select m.created_at from public.gc_messages m where m.room_id=r.id and m.created_at>now()-interval '1 hour' order by m.created_at desc,m.id desc limit 1)
  ) order by r.name) from private.gc_rooms r);
end;
$$;
revoke all on function public.gc_list(uuid) from public,anon;
grant execute on function public.gc_list(uuid) to authenticated;

notify pgrst,'reload schema';
commit;
