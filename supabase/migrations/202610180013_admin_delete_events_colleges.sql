begin;

create or replace function public.ce_admin_delete_event(p_client_id uuid,p_event_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare u uuid; removed integer;
begin
  u:=private.st_assert(p_client_id);
  if not exists(select 1 from private.event_admins where user_id=u) then raise exception 'Admin access required.'; end if;
  if p_event_id is null then raise exception 'Select an event to delete.'; end if;
  delete from public.campus_events where id=p_event_id;
  get diagnostics removed=row_count;
  if removed=0 then raise exception 'Event not found or already deleted.'; end if;
  return true;
end;
$$;

create or replace function public.cm_remove_college(p_client_id uuid,p_college_id uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare u uuid; changed integer;
begin
  u:=private.cm_assert_admin(p_client_id);
  if p_college_id is null then raise exception 'Select a college to remove.'; end if;
  update private.colleges set is_active=false where id=p_college_id and is_active=true;
  get diagnostics changed=row_count;
  if changed=0 then raise exception 'College not found or already removed.'; end if;
  return true;
end;
$$;

create function public.ce_current_user_is_admin() returns boolean
language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.event_admins a where a.user_id=auth.uid());
$$;

create policy event_posters_admin_delete on storage.objects for delete to authenticated
using(bucket_id='event-posters' and public.ce_current_user_is_admin());

revoke all on function public.ce_admin_delete_event(uuid,uuid),public.cm_remove_college(uuid,uuid),public.ce_current_user_is_admin() from public,anon;
grant execute on function public.ce_admin_delete_event(uuid,uuid),public.cm_remove_college(uuid,uuid),public.ce_current_user_is_admin() to authenticated;
notify pgrst, 'reload schema';
commit;
