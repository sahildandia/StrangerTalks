begin;

alter table public.profiles add column display_name text not null default ''
  check (char_length(display_name)<=60 and display_name !~ '[[:cntrl:]]');

create function private.cm_keep_college() returns trigger language plpgsql set search_path='' as $$
begin
  if old.college_id is not null and new.college_id is distinct from old.college_id then
    raise exception 'Your college has already been selected and cannot be changed.';
  end if;
  return new;
end; $$;
create trigger cm_college_selected_once before update of college_id on public.profiles
for each row execute function private.cm_keep_college();

create or replace function public.cm_set_my_college(p_client_id uuid,p_college_id uuid) returns text
language plpgsql security definer set search_path='' as $$
declare u uuid; current_college uuid; selected_name text;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id);
  if exists(select 1 from private.event_admins where user_id=u) then
    raise exception 'Administrators have access to all colleges and do not need a college assignment.';
  end if;
  select college_id into current_college from public.profiles where id=u for update;
  if current_college is not null and current_college is distinct from p_college_id then
    raise exception 'Your college has already been selected and cannot be changed.';
  end if;
  select name into selected_name from private.colleges where id=p_college_id and (is_active or id=current_college);
  if selected_name is null then raise exception 'Choose a college from the active list.'; end if;
  if current_college=p_college_id then return selected_name; end if;
  update public.profiles set college_id=p_college_id where id=u;
  update auth.users set raw_user_meta_data=coalesce(raw_user_meta_data,'{}'::jsonb)||jsonb_build_object('college_name',selected_name) where id=u;
  return selected_name;
end; $$;

create function public.cm_my_account(p_client_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid;
begin
  u:=private.st_assert(p_client_id);
  return (select jsonb_build_object('id',p.id,'display_name',p.display_name,
    'college_id',p.college_id,'college_name',c.name,'college_locked',p.college_id is not null,
    'is_admin',exists(select 1 from private.event_admins where user_id=u))
    from public.profiles p left join private.colleges c on c.id=p.college_id where p.id=u);
end; $$;

create function public.cm_save_profile(p_client_id uuid,p_name text,p_college_id uuid default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; clean_name text:=btrim(coalesce(p_name,''));
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id);
  if char_length(clean_name)>60 or clean_name ~ '[[:cntrl:]]' then raise exception 'Use a name of up to 60 characters.'; end if;
  if exists(select 1 from private.event_admins where user_id=u) then
    if p_college_id is not null then raise exception 'Administrators manage all colleges without selecting one.'; end if;
  elsif p_college_id is not null then
    perform public.cm_set_my_college(p_client_id,p_college_id);
  elsif not exists(select 1 from public.profiles where id=u and college_id is not null) then
    raise exception 'Choose your college. This selection cannot be changed later.';
  end if;
  update public.profiles set display_name=clean_name where id=u;
  return public.cm_my_account(p_client_id);
end; $$;

create table private.cm_account_actions (
  id uuid primary key default gen_random_uuid(), actor_id uuid not null, user_id uuid not null,
  action text not null check(action in ('ban','reactivate','delete')), note text not null,
  created_at timestamptz not null default now()
);
alter table private.cm_account_actions enable row level security;
revoke all on private.cm_account_actions from public,anon,authenticated;

-- Auth Admin API bans also immediately disconnect the application session.
create function private.cm_sync_auth_ban() returns trigger
language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
  update public.profiles set banned_until=new.banned_until where id=new.id;
  if new.banned_until>now() then
    select session_id into sid from private.active_members where user_id=new.id;
    if sid is not null then perform private.st_end(sid,'moderated'); end if;
    delete from private.match_queue where user_id=new.id;
    delete from private.gc_members where user_id=new.id;
  end if;
  return new;
end; $$;
create trigger cm_sync_auth_ban after update of banned_until on auth.users
for each row execute function private.cm_sync_auth_ban();

create function public.cm_admin_users(p_client_id uuid,p_query text default '',p_college_id uuid default null,
  p_status text default 'all',p_page integer default 0,p_page_size integer default 25) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  perform private.cm_assert_admin(p_client_id);
  if p_status not in ('all','active','banned','registered','guest') or p_page<0 or p_page_size not between 1 and 50
    or char_length(coalesce(p_query,''))>120 then raise exception 'Invalid user filters.'; end if;
  with accounts as (
    select u.id,u.email,coalesce(u.is_anonymous,false) as is_anonymous,u.created_at,u.last_sign_in_at,
      p.last_active_at,coalesce(p.display_name,'') as display_name,p.college_id,c.name as college_name,
      greatest(u.banned_until,p.banned_until) as banned_until,
      coalesce(greatest(u.banned_until,p.banned_until)>now(),false) as is_banned,
      exists(select 1 from private.event_admins a where a.user_id=u.id) as is_admin
    from auth.users u left join public.profiles p on p.id=u.id left join private.colleges c on c.id=p.college_id
  ), filtered as (
    select * from accounts a where (p_college_id is null or a.college_id=p_college_id)
      and (coalesce(btrim(p_query),'')='' or position(lower(btrim(p_query)) in lower(concat_ws(' ',a.id::text,a.email,a.display_name,a.college_name)))>0)
      and (p_status='all' or (p_status='active' and not a.is_banned) or (p_status='banned' and a.is_banned)
        or (p_status='registered' and not a.is_anonymous) or (p_status='guest' and a.is_anonymous))
  ), page as (select * from filtered order by created_at desc,id limit p_page_size offset p_page*p_page_size)
  select jsonb_build_object('total',(select count(*) from filtered),
    'counts',jsonb_build_object('registered',(select count(*) from accounts where not is_anonymous),
      'guests',(select count(*) from accounts where is_anonymous),'banned',(select count(*) from accounts where is_banned),
      'total',(select count(*) from accounts)),
    'users',coalesce((select jsonb_agg(to_jsonb(page) order by created_at desc,id) from page),'[]'::jsonb)) into result;
  return result;
end; $$;

create function public.cm_admin_check_user_action(p_client_id uuid,p_user_id uuid,p_action text,p_note text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid;
begin
  actor:=private.cm_assert_admin(p_client_id);
  if p_action not in ('ban','reactivate','delete') or char_length(btrim(coalesce(p_note,''))) not between 3 and 300 then
    raise exception 'Choose an account action and provide a reason of 3–300 characters.';
  end if;
  if actor=p_user_id then raise exception 'You cannot moderate your own account.'; end if;
  if exists(select 1 from private.event_admins where user_id=p_user_id) then raise exception 'Administrator accounts are protected.'; end if;
  if not exists(select 1 from auth.users where id=p_user_id) then raise exception 'Account not found. Refresh the user list.'; end if;
  perform private.st_rate('admin_accounts',20);
  return jsonb_build_object('actor_id',actor,'user_id',p_user_id);
end; $$;

create function public.cm_admin_record_user_action(p_actor_id uuid,p_user_id uuid,p_action text,p_note text) returns void
language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from private.event_admins a join auth.users u on u.id=a.user_id
    where a.user_id=p_actor_id and (u.banned_until is null or u.banned_until<=now())) then raise exception 'Admin access required.'; end if;
  if p_action not in ('ban','reactivate','delete') or char_length(btrim(coalesce(p_note,''))) not between 3 and 300 then raise exception 'Invalid action.'; end if;
  insert into private.cm_account_actions(actor_id,user_id,action,note) values(p_actor_id,p_user_id,p_action,btrim(p_note));
end; $$;

revoke all on function public.cm_my_account(uuid),public.cm_save_profile(uuid,text,uuid),
 public.cm_admin_users(uuid,text,uuid,text,integer,integer),public.cm_admin_check_user_action(uuid,uuid,text,text) from public,anon;
grant execute on function public.cm_my_account(uuid),public.cm_save_profile(uuid,text,uuid),
 public.cm_admin_users(uuid,text,uuid,text,integer,integer),public.cm_admin_check_user_action(uuid,uuid,text,text) to authenticated;
revoke all on function public.cm_admin_record_user_action(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.cm_admin_record_user_action(uuid,uuid,text,text) to service_role;
revoke all on function private.cm_keep_college(),private.cm_sync_auth_ban() from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
