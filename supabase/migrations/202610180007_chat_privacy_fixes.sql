-- Keep chat cleanup and group messaging working with college-scoped membership.
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

create or replace function public.gc_send(p_client_id uuid,p_room_id uuid,p_body text,p_nonce uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid; message_row public.gc_messages; body_text text:=btrim(p_body);
begin
  perform private.st_lock(); u:=private.st_assert(p_client_id); perform private.gc_sweep();
  if not exists(select 1 from private.gc_members member
    join private.gc_rooms room on room.id=member.room_id
    join public.profiles profile on profile.id=member.user_id and profile.college_id=room.college_id
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

commit;
