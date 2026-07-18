begin;

-- Conflict review must identify versions without exposing raw workspace JSON.
-- Devices register a short, non-unique browser/OS label; Scout never collects
-- hostnames, hardware identifiers, or other fingerprinting data.
create or replace function public.register_workspace_device(
  p_device_id text,
  p_device_label text
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_label text;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9:_-]{1,128}$' then raise exception 'invalid_device_id'; end if;
  v_label := left(regexp_replace(coalesce(p_device_label,'Chrome device'),'[[:cntrl:]]',' ','g'),80);
  if btrim(v_label) = '' then v_label := 'Chrome device'; end if;

  insert into public.devices(user_id,id,label,last_seen_at)
    values(v_user,p_device_id,v_label,now())
    on conflict(user_id,id) do update
      set label=excluded.label,last_seen_at=excluded.last_seen_at;

  return jsonb_build_object('device_id',p_device_id,'device_label',v_label);
end;
$$;

create or replace function public.workspace_record_provenance(
  p_entity_type text,
  p_entity_id text,
  p_server_version bigint
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_change public.workspace_changes%rowtype;
  v_label text;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_entity_type is null or p_entity_type not in ('profile','application','contact','interview','reminder','answer_memory','learned_answer','resume_version','knowledge_graph','settings','onboarding_progress') then
    raise exception 'invalid_entity_type';
  end if;
  if p_entity_id is null or p_entity_id !~ '^[A-Za-z0-9:_-]{1,128}$' then raise exception 'invalid_entity_id'; end if;
  if p_server_version is null or p_server_version < 1 then raise exception 'invalid_server_version'; end if;

  select * into v_change
  from public.workspace_changes
  where user_id=v_user
    and entity_type=p_entity_type
    and entity_id=p_entity_id
    and server_version=p_server_version
  order by cursor desc
  limit 1;

  if not found then return '{}'::jsonb; end if;

  select nullif(btrim(label),'') into v_label
  from public.devices
  where user_id=v_user and id=v_change.device_id;

  return jsonb_build_object(
    'device_id',v_change.device_id,
    'device_label',coalesce(v_label,'Another Chrome device'),
    'updated_at',v_change.created_at
  );
end;
$$;

revoke all on function public.register_workspace_device(text,text) from public, anon;
revoke all on function public.workspace_record_provenance(text,text,bigint) from public, anon;
grant execute on function public.register_workspace_device(text,text) to authenticated;
grant execute on function public.workspace_record_provenance(text,text,bigint) to authenticated;

commit;
