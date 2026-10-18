-- Keep the college-scoped next-chat flow's privacy cleanup from the prior migration.
begin;

create or replace function public.st_next(p_client_id uuid,p_session_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; sid uuid;
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id);
  if not exists(select 1 from public.profiles where id=u and college_id is not null) then
    raise exception 'Choose your college in Profile before starting a random chat.';
  end if;
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
  perform private.st_sweep();
  perform private.st_match();
  return private.st_snapshot();
end;
$$;

commit;
