-- Public college picker and admin-reviewed college directory requests.
begin;

create table private.colleges (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120 and name !~ '[[:cntrl:]]'),
  name_key text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored unique,
  is_active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table private.college_requests (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 2 and 120 and name !~ '[[:cntrl:]]'),
  name_key text generated always as (lower(regexp_replace(btrim(name), '\s+', ' ', 'g'))) stored,
  requested_by uuid references auth.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  review_note text check (review_note is null or char_length(review_note) <= 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz
);
create unique index college_requests_one_pending_name on private.college_requests(name_key) where status='pending';
create index college_requests_admin_queue on private.college_requests(status,created_at desc);

alter table private.colleges enable row level security;
alter table private.college_requests enable row level security;
revoke all on private.colleges,private.college_requests from public,anon,authenticated;

create function private.cm_assert_admin(p_client_id uuid) returns uuid
language plpgsql set search_path='' as $$
declare u uuid;
begin
  u:=private.st_assert(p_client_id);
  if not exists(select 1 from private.event_admins where user_id=u) then
    raise exception 'Admin access required.';
  end if;
  return u;
end;
$$;

create function public.cm_list_colleges(p_client_id uuid)
returns table(id uuid,name text)
language sql stable security definer set search_path='' as $$
  select c.id,c.name from private.colleges c where c.is_active order by c.name;
$$;

create function public.cm_request_college(p_client_id uuid,p_name text) returns text
language plpgsql security definer set search_path='' as $$
declare cleaned text; request_id uuid;
begin
  if p_client_id is null then raise exception 'Session identifier required.'; end if;
  cleaned:=regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g');
  if char_length(cleaned) not between 2 and 120 or cleaned ~ '[[:cntrl:]]' then
    raise exception 'Enter a college name between 2 and 120 characters.';
  end if;
  if exists(select 1 from private.colleges c where c.is_active and c.name_key=lower(cleaned)) then
    raise exception 'That college is already in the list. Select it above.';
  end if;
  insert into private.college_requests(name,requested_by)
  values(cleaned,auth.uid())
  on conflict(name_key) where status='pending'
  do update set updated_at=now()
  returning id into request_id;
  return 'pending';
end;
$$;

create function public.cm_admin_colleges(p_client_id uuid)
returns table(id uuid,name text,is_active boolean,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
  u:=private.cm_assert_admin(p_client_id);
  return query select c.id,c.name,c.is_active,c.created_at from private.colleges c order by c.name;
end;
$$;

create function public.cm_admin_college_requests(p_client_id uuid)
returns table(id uuid,name text,status text,review_note text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
  u:=private.cm_assert_admin(p_client_id);
  return query select r.id,r.name,r.status,r.review_note,r.created_at
    from private.college_requests r order by (r.status='pending') desc,r.created_at desc limit 250;
end;
$$;

create function public.cm_admin_add_college(p_client_id uuid,p_name text)
returns table(id uuid,name text,is_active boolean,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare u uuid; cleaned text;
begin
  u:=private.cm_assert_admin(p_client_id);
  cleaned:=regexp_replace(btrim(coalesce(p_name,'')), '\s+', ' ', 'g');
  if char_length(cleaned) not between 2 and 120 or cleaned ~ '[[:cntrl:]]' then
    raise exception 'Enter a college name between 2 and 120 characters.';
  end if;
  return query insert into private.colleges as c(name,created_by) values(cleaned,u)
    on conflict(name_key) do update set is_active=true
    returning c.id,c.name,c.is_active,c.created_at;
end;
$$;

create function public.cm_review_college_request(p_client_id uuid,p_request_id uuid,p_status text,p_note text default null)
returns boolean
language plpgsql security definer set search_path='' as $$
declare u uuid; r private.college_requests;
begin
  u:=private.cm_assert_admin(p_client_id);
  if p_status not in ('approved','rejected') then raise exception 'Choose approve or reject.'; end if;
  if p_note is not null and char_length(p_note)>300 then raise exception 'Review note is too long.'; end if;
  select * into r from private.college_requests where id=p_request_id for update;
  if not found or r.status<>'pending' then raise exception 'This college request is no longer pending.'; end if;
  if p_status='approved' then
    insert into private.colleges(name,created_by) values(r.name,u)
      on conflict(name_key) do update set is_active=true;
  end if;
  update private.college_requests set status=p_status,review_note=nullif(btrim(p_note),''),
    reviewed_by=u,reviewed_at=now(),updated_at=now() where id=r.id;
  return true;
end;
$$;

revoke all on function private.cm_assert_admin(uuid) from public,anon,authenticated;
revoke all on function public.cm_list_colleges(uuid) from public;
revoke all on function public.cm_request_college(uuid,text) from public;
revoke all on function public.cm_admin_colleges(uuid) from public;
revoke all on function public.cm_admin_college_requests(uuid) from public;
revoke all on function public.cm_admin_add_college(uuid,text) from public;
revoke all on function public.cm_review_college_request(uuid,uuid,text,text) from public;
grant execute on function public.cm_list_colleges(uuid),public.cm_request_college(uuid,text) to anon,authenticated;
grant execute on function public.cm_admin_colleges(uuid),public.cm_admin_college_requests(uuid),public.cm_admin_add_college(uuid,text),public.cm_review_college_request(uuid,uuid,text,text) to authenticated;

commit;
