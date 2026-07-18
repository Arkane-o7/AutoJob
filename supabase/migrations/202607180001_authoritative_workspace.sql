begin;

-- Per-record change envelopes replace whole-workspace snapshots as the sync
-- authority. The snapshot tables remain temporarily for rollback/migration only.
alter table public.workspace_changes
  add column if not exists entity_type text not null default 'legacy_snapshot',
  add column if not exists entity_id text not null default 'workspace',
  add column if not exists base_server_version bigint not null default 0,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists deleted_at timestamptz;

alter table public.workspace_changes
  add constraint workspace_changes_entity_type_check check (entity_type in (
    'legacy_snapshot','profile','application','contact','interview','reminder',
    'answer_memory','learned_answer','resume_version','knowledge_graph','settings',
    'onboarding_progress'
  )) not valid,
  add constraint workspace_changes_entity_id_check check (entity_id ~ '^[A-Za-z0-9:_-]{1,128}$') not valid,
  add constraint workspace_changes_payload_size_check check (pg_column_size(payload) <= 524288) not valid;

create index if not exists workspace_changes_user_entity_idx
  on public.workspace_changes(user_id, entity_type, entity_id, cursor desc);

-- A deleted interview may need a tombstone even if its parent application has
-- not reached this device. Null is used only for tombstones; live rows are
-- validated by apply_workspace_mutation.
alter table public.interviews alter column application_id drop not null;

create table if not exists public.legacy_workspace_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  claim_id uuid not null,
  device_id text not null check (device_id ~ '^[A-Za-z0-9:_-]{1,128}$'),
  record_count integer not null check (record_count between 0 and 5000),
  created_at timestamptz not null default now(),
  primary key (user_id, claim_id)
);
alter table public.legacy_workspace_claims enable row level security;
create policy legacy_workspace_claims_owner_read on public.legacy_workspace_claims
  for select using (auth.uid() = user_id);
grant select on public.legacy_workspace_claims to authenticated;

-- New writes must use the validated, idempotent RPC below. Direct reads stay
-- available under RLS so a user can export their own records.
revoke insert, update, delete on public.devices from authenticated;
revoke insert, update, delete on public.workspace_snapshots from authenticated;
revoke insert, update, delete on public.job_profiles from authenticated;
revoke insert, update, delete on public.applications from authenticated;
revoke insert, update, delete on public.contacts from authenticated;
revoke insert, update, delete on public.contact_applications from authenticated;
revoke insert, update, delete on public.interviews from authenticated;
revoke insert, update, delete on public.private_records from authenticated;

create or replace function public.apply_workspace_mutation(
  p_mutation_id uuid,
  p_device_id text,
  p_entity_type text,
  p_entity_id text,
  p_base_server_version bigint,
  p_operation text,
  p_payload jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_current_version bigint := 0;
  v_current_payload jsonb := '{}'::jsonb;
  v_current_deleted_at timestamptz;
  v_next_version bigint;
  v_now timestamptz := now();
  v_prior public.workspace_changes%rowtype;
  v_private_type text;
  v_account_status public.account_status;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9:_-]{1,128}$' then raise exception 'invalid_device_id'; end if;
  if p_entity_id is null or p_entity_id !~ '^[A-Za-z0-9:_-]{1,128}$' then raise exception 'invalid_entity_id'; end if;
  if p_entity_type is null or p_entity_type not in ('profile','application','contact','interview','reminder','answer_memory','learned_answer','resume_version','knowledge_graph','settings','onboarding_progress') then
    raise exception 'invalid_entity_type';
  end if;
  if p_operation is null or p_operation not in ('upsert','delete') then raise exception 'invalid_operation'; end if;
  if p_base_server_version is null or p_base_server_version < 0 then raise exception 'invalid_base_server_version'; end if;
  if p_operation = 'upsert' and (p_payload is null or jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) > 524288) then
    raise exception 'invalid_payload';
  end if;
  p_payload := case when p_operation = 'delete' then '{}'::jsonb else p_payload end;

  insert into public.app_accounts(user_id) values(v_user) on conflict(user_id) do nothing;
  select status into v_account_status from public.app_accounts where user_id=v_user;
  if v_account_status <> 'active' then raise exception 'account_not_active'; end if;

  -- Serialize idempotent retries, then create/update races for the record.
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':mutation:' || p_mutation_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(v_user::text || ':' || p_entity_type || ':' || p_entity_id, 0));

  select * into v_prior from public.workspace_changes
  where user_id = v_user and change_id = p_mutation_id;
  if found then
    if v_prior.entity_type <> p_entity_type or v_prior.entity_id <> p_entity_id
       or v_prior.operation <> p_operation or v_prior.payload <> p_payload then
      raise exception 'mutation_id_reused';
    end if;
    return jsonb_build_object(
      'status','already_applied','server_version',v_prior.server_version,
      'deleted_at',v_prior.deleted_at,'updated_at',v_prior.created_at
    );
  end if;

  if p_entity_type = 'profile' then
    select server_version, profile_data, deleted_at into v_current_version, v_current_payload, v_current_deleted_at
      from public.job_profiles where user_id=v_user and id=p_entity_id for update;
  elsif p_entity_type = 'application' then
    select server_version, payload, deleted_at into v_current_version, v_current_payload, v_current_deleted_at
      from public.applications where user_id=v_user and id=p_entity_id for update;
  elsif p_entity_type = 'contact' then
    select server_version, payload, deleted_at into v_current_version, v_current_payload, v_current_deleted_at
      from public.contacts where user_id=v_user and id=p_entity_id for update;
  elsif p_entity_type = 'interview' then
    select server_version, payload, deleted_at into v_current_version, v_current_payload, v_current_deleted_at
      from public.interviews where user_id=v_user and id=p_entity_id for update;
  else
    v_private_type := p_entity_type;
    select server_version, payload, deleted_at into v_current_version, v_current_payload, v_current_deleted_at
      from public.private_records where user_id=v_user and record_type=v_private_type and id=p_entity_id for update;
  end if;
  if not found then
    v_current_version := 0;
    v_current_payload := '{}'::jsonb;
    v_current_deleted_at := null;
  end if;

  if v_current_version <> p_base_server_version then
    return jsonb_build_object(
      'status','conflict','server_version',v_current_version,
      'payload',coalesce(v_current_payload,'{}'::jsonb),'deleted_at',v_current_deleted_at
    );
  end if;
  v_next_version := v_current_version + 1;

  insert into public.devices(user_id,id,last_seen_at)
    values(v_user,p_device_id,v_now)
    on conflict(user_id,id) do update set last_seen_at=excluded.last_seen_at;

  if p_entity_type = 'profile' then
    insert into public.job_profiles(user_id,id,profile_data,server_version,deleted_at,updated_at)
      values(v_user,p_entity_id,p_payload,v_next_version,case when p_operation='delete' then v_now end,v_now)
      on conflict(user_id,id) do update set profile_data=excluded.profile_data,server_version=excluded.server_version,deleted_at=excluded.deleted_at,updated_at=excluded.updated_at;
  elsif p_entity_type = 'application' then
    if p_operation='upsert' and coalesce(p_payload->>'status','saved') not in ('saved','preparing','applied','follow_up_due','interview','assignment','offer','rejected','closed') then
      raise exception 'invalid_application_status';
    end if;
    insert into public.applications(user_id,id,profile_id,company,role,status,source,payload,server_version,deleted_at,updated_at)
      values(v_user,p_entity_id,nullif(left(p_payload->>'profile_id',128),''),left(coalesce(p_payload->>'company',''),300),left(coalesce(p_payload->>'role',''),300),left(coalesce(p_payload->>'status','saved'),40),left(coalesce(p_payload->>'source',''),200),p_payload,v_next_version,case when p_operation='delete' then v_now end,v_now)
      on conflict(user_id,id) do update set profile_id=excluded.profile_id,company=excluded.company,role=excluded.role,status=excluded.status,source=excluded.source,payload=excluded.payload,server_version=excluded.server_version,deleted_at=excluded.deleted_at,updated_at=excluded.updated_at;
  elsif p_entity_type = 'contact' then
    insert into public.contacts(user_id,id,payload,server_version,deleted_at,updated_at)
      values(v_user,p_entity_id,p_payload,v_next_version,case when p_operation='delete' then v_now end,v_now)
      on conflict(user_id,id) do update set payload=excluded.payload,server_version=excluded.server_version,deleted_at=excluded.deleted_at,updated_at=excluded.updated_at;
    delete from public.contact_applications where user_id=v_user and contact_id=p_entity_id;
    if p_operation='upsert' and jsonb_typeof(p_payload->'application_ids')='array' then
      insert into public.contact_applications(user_id,contact_id,application_id)
      select v_user,p_entity_id,ids.application_id
      from (
        select distinct left(value,128) as application_id
        from jsonb_array_elements_text(p_payload->'application_ids')
        where value ~ '^[A-Za-z0-9:_-]{1,128}$'
      ) ids
      join public.applications a on a.user_id=v_user and a.id=ids.application_id and a.deleted_at is null
      on conflict do nothing;
    end if;
  elsif p_entity_type = 'interview' then
    if p_operation='upsert' and not exists (
      select 1 from public.applications where user_id=v_user and id=p_payload->>'application_id' and deleted_at is null
    ) then raise exception 'invalid_interview_application'; end if;
    insert into public.interviews(user_id,id,application_id,payload,server_version,deleted_at,updated_at)
      values(v_user,p_entity_id,case when p_operation='delete' then null else nullif(left(p_payload->>'application_id',128),'') end,p_payload,v_next_version,case when p_operation='delete' then v_now end,v_now)
      on conflict(user_id,id) do update set application_id=case when p_operation='delete' then public.interviews.application_id else excluded.application_id end,payload=excluded.payload,server_version=excluded.server_version,deleted_at=excluded.deleted_at,updated_at=excluded.updated_at;
  else
    insert into public.private_records(user_id,record_type,id,payload,server_version,deleted_at,updated_at)
      values(v_user,v_private_type,p_entity_id,p_payload,v_next_version,case when p_operation='delete' then v_now end,v_now)
      on conflict(user_id,record_type,id) do update set payload=excluded.payload,server_version=excluded.server_version,deleted_at=excluded.deleted_at,updated_at=excluded.updated_at;
  end if;

  insert into public.workspace_changes(user_id,change_id,device_id,server_version,operation,entity_type,entity_id,base_server_version,payload,deleted_at)
    values(v_user,p_mutation_id,p_device_id,v_next_version,p_operation,p_entity_type,p_entity_id,p_base_server_version,p_payload,case when p_operation='delete' then v_now end);

  return jsonb_build_object(
    'status','accepted','server_version',v_next_version,
    'deleted_at',case when p_operation='delete' then v_now end,'updated_at',v_now
  );
end;
$$;

create or replace function public.pull_workspace_changes(
  p_after_cursor bigint default 0,
  p_limit integer default 250
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_limit integer;
  v_changes jsonb;
  v_cursor bigint;
  v_has_more boolean;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_after_cursor is null or p_after_cursor < 0 then raise exception 'invalid_cursor'; end if;
  v_limit := greatest(1,least(coalesce(p_limit,250),500));
  select coalesce(jsonb_agg(to_jsonb(c) order by c.cursor),'[]'::jsonb), coalesce(max(c.cursor),p_after_cursor)
    into v_changes,v_cursor
  from (
    select cursor,change_id,entity_type,entity_id,server_version,operation,payload,deleted_at,created_at as updated_at
    from public.workspace_changes
    where user_id=v_user and cursor>p_after_cursor and entity_type<>'legacy_snapshot'
    order by cursor
    limit v_limit
  ) c;
  select exists(select 1 from public.workspace_changes where user_id=v_user and cursor>v_cursor and entity_type<>'legacy_snapshot') into v_has_more;
  return jsonb_build_object('cursor',v_cursor,'has_more',v_has_more,'changes',v_changes);
end;
$$;

create or replace function public.bootstrap_workspace(
  p_device_id text,
  p_after_cursor bigint default 0,
  p_limit integer default 250
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_result jsonb;
  v_status text;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9:_-]{1,128}$' then raise exception 'invalid_device_id'; end if;
  insert into public.app_accounts(user_id) values(v_user) on conflict(user_id) do update set updated_at=now();
  insert into public.devices(user_id,id,last_seen_at,last_sync_cursor)
    values(v_user,p_device_id,now(),greatest(coalesce(p_after_cursor,0),0))
    on conflict(user_id,id) do update set last_seen_at=excluded.last_seen_at,last_sync_cursor=greatest(public.devices.last_sync_cursor,excluded.last_sync_cursor);
  select status::text into v_status from public.app_accounts where user_id=v_user;
  v_result := public.pull_workspace_changes(p_after_cursor,p_limit);
  return v_result || jsonb_build_object('account_status',v_status,'device_id',p_device_id);
end;
$$;

create or replace function public.claim_legacy_workspace(
  p_claim_id uuid,
  p_device_id text,
  p_records jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_record jsonb;
  v_count integer;
  v_result jsonb;
begin
  if v_user is null then raise exception 'not_authenticated' using errcode = '28000'; end if;
  if p_device_id is null or p_device_id !~ '^[A-Za-z0-9:_-]{1,128}$' then raise exception 'invalid_device_id'; end if;
  if jsonb_typeof(p_records)<>'array' then raise exception 'invalid_records'; end if;
  v_count := jsonb_array_length(p_records);
  if v_count>5000 or pg_column_size(p_records)>16777216 then raise exception 'legacy_claim_too_large'; end if;
  if exists(select 1 from public.legacy_workspace_claims where user_id=v_user and claim_id=p_claim_id) then
    return jsonb_build_object('status','already_applied','record_count',v_count);
  end if;
  if exists(select 1 from public.workspace_changes where user_id=v_user and entity_type<>'legacy_snapshot') then
    return jsonb_build_object('status','workspace_not_empty','record_count',0);
  end if;
  for v_record in select value from jsonb_array_elements(p_records)
  loop
    v_result := public.apply_workspace_mutation(
      (v_record->>'mutation_id')::uuid,
      p_device_id,
      v_record->>'entity_type',
      v_record->>'entity_id',
      coalesce((v_record->>'base_server_version')::bigint,0),
      coalesce(v_record->>'operation','upsert'),
      coalesce(v_record->'payload','{}'::jsonb)
    );
    if v_result->>'status' not in ('accepted','already_applied') then raise exception 'legacy_claim_record_rejected'; end if;
  end loop;
  insert into public.legacy_workspace_claims(user_id,claim_id,device_id,record_count)
    values(v_user,p_claim_id,p_device_id,v_count);
  return jsonb_build_object('status','accepted','record_count',v_count);
end;
$$;

revoke all on function public.apply_workspace_mutation(uuid,text,text,text,bigint,text,jsonb) from public, anon;
revoke all on function public.pull_workspace_changes(bigint,integer) from public, anon;
revoke all on function public.bootstrap_workspace(text,bigint,integer) from public, anon;
revoke all on function public.claim_legacy_workspace(uuid,text,jsonb) from public, anon;
revoke execute on function public.apply_workspace_snapshot(uuid,text,bigint,jsonb) from authenticated;
grant execute on function public.apply_workspace_mutation(uuid,text,text,text,bigint,text,jsonb) to authenticated;
grant execute on function public.pull_workspace_changes(bigint,integer) to authenticated;
grant execute on function public.bootstrap_workspace(text,bigint,integer) to authenticated;
grant execute on function public.claim_legacy_workspace(uuid,text,jsonb) to authenticated;

commit;
