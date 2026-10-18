begin;
alter table private.gc_rooms drop constraint gc_rooms_capacity_check;
alter table private.gc_rooms add constraint gc_rooms_capacity_check check(capacity>=2);
create or replace function public.gc_submit_room(
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
    or p_capacity is null or p_capacity<2 then
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
notify pgrst,'reload schema';
commit;
