-- Remove ordinary one-to-one chat messages immediately when either participant
-- deliberately leaves or skips. Reports are copied to private.user_reports first
-- by st_safety, so moderation evidence is preserved separately.
begin;

create or replace function public.st_leave(p_client_id uuid,p_session_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid; sid uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id);
  select session_id into sid from private.active_members where user_id=u;
  if sid is not null and p_session_id is not null and sid<>p_session_id then
    raise exception 'Conversation changed. Please refresh.';
  end if;
  if sid is not null then
    perform private.st_end(sid,'left');
    delete from public.chat_messages where session_id=sid;
  end if;
  delete from private.match_queue where user_id=u;
  return private.st_snapshot();
end;
$$;

create or replace function public.st_next(p_client_id uuid,p_session_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare u uuid; sid uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id);
  perform private.st_rate('next',12,1000);
  select session_id into sid from private.active_members where user_id=u;
  if sid is not null and sid is distinct from p_session_id then
    raise exception 'Conversation changed. Please refresh.';
  end if;
  if sid is not null then
    perform private.st_end(sid,'next');
    delete from public.chat_messages where session_id=sid;
  end if;
  update private.presence set last_seen=now() where user_id=u;
  insert into private.match_queue(user_id) values(u) on conflict do nothing;
  perform private.st_sweep(); perform private.st_match();
  return private.st_snapshot();
end;
$$;

commit;
