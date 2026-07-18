begin;

create extension if not exists pgcrypto;

create type public.account_status as enum ('active', 'deletion_requested', 'deleted');
create type public.publication_visibility as enum ('private', 'recruiters');

create table public.app_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  avatar_url text not null default '',
  status public.account_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.devices (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9:_-]{1,128}$'),
  label text not null default '',
  last_seen_at timestamptz not null default now(),
  last_sync_cursor bigint not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.workspace_snapshots (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  server_version bigint not null default 1,
  last_change_id uuid,
  updated_at timestamptz not null default now()
);

create table public.workspace_changes (
  cursor bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  change_id uuid not null,
  device_id text not null,
  server_version bigint not null,
  operation text not null check (operation in ('upsert', 'delete')),
  created_at timestamptz not null default now(),
  unique (user_id, change_id)
);
create index workspace_changes_user_cursor_idx on public.workspace_changes(user_id, cursor);

create table public.job_profiles (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  profile_data jsonb not null default '{}'::jsonb,
  server_version bigint not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.applications (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  profile_id text,
  company text not null default '',
  role text not null default '',
  status text not null default 'saved',
  source text not null default '',
  payload jsonb not null default '{}'::jsonb,
  server_version bigint not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create index applications_user_updated_idx on public.applications(user_id, updated_at);

create table public.contacts (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  payload jsonb not null default '{}'::jsonb,
  server_version bigint not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table public.contact_applications (
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id text not null,
  application_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, contact_id, application_id),
  foreign key (user_id, contact_id) references public.contacts(user_id, id) on delete cascade,
  foreign key (user_id, application_id) references public.applications(user_id, id) on delete cascade
);

create table public.interviews (
  user_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  application_id text not null,
  payload jsonb not null default '{}'::jsonb,
  server_version bigint not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, application_id) references public.applications(user_id, id) on delete cascade
);

create table public.private_records (
  user_id uuid not null references auth.users(id) on delete cascade,
  record_type text not null check (record_type in ('reminder', 'answer_memory', 'learned_answer', 'resume_version', 'knowledge_graph', 'settings', 'onboarding_progress')),
  id text not null,
  payload jsonb not null default '{}'::jsonb,
  server_version bigint not null default 1,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, record_type, id)
);

create table public.candidate_publications (
  user_id uuid primary key references auth.users(id) on delete cascade,
  visibility public.publication_visibility not null default 'private',
  headline text not null default '',
  target_roles text[] not null default '{}',
  location text not null default '',
  skills text[] not null default '{}',
  experience_summary text not null default '',
  portfolio_url text not null default '',
  linkedin_url text not null default '',
  published_at timestamptz,
  updated_at timestamptz not null default now(),
  check (cardinality(target_roles) <= 12),
  check (cardinality(skills) <= 80)
);

create table public.support_reports (
  id uuid primary key default gen_random_uuid(),
  -- Hosted Supabase installs pgcrypto in the `extensions` schema. Qualifying
  -- this call keeps the migration portable when `extensions` is not on the
  -- database role's default search_path.
  reference_code text not null unique default upper(substr(encode(extensions.gen_random_bytes(8), 'hex'), 1, 10)),
  user_id uuid not null references auth.users(id) on delete cascade,
  extension_version text not null,
  source_domain text not null,
  platform text not null,
  description text not null,
  expected_behavior text not null default '',
  actual_behavior text not null default '',
  diagnostic_payload jsonb not null,
  status text not null default 'new' check (status in ('new', 'triaged', 'fixed', 'closed')),
  resolution_note text not null default '',
  retain_until timestamptz not null default (now() + interval '90 days'),
  created_at timestamptz not null default now()
);
create index support_reports_user_created_idx on public.support_reports(user_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('resumes', 'resumes', false, 8388608, array['application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

alter table public.app_accounts enable row level security;
alter table public.devices enable row level security;
alter table public.workspace_snapshots enable row level security;
alter table public.workspace_changes enable row level security;
alter table public.job_profiles enable row level security;
alter table public.applications enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_applications enable row level security;
alter table public.interviews enable row level security;
alter table public.private_records enable row level security;
alter table public.candidate_publications enable row level security;
alter table public.support_reports enable row level security;

create policy app_accounts_owner on public.app_accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy devices_owner on public.devices for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy snapshots_owner on public.workspace_snapshots for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy changes_owner_read on public.workspace_changes for select using (auth.uid() = user_id);
create policy profiles_owner on public.job_profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy applications_owner on public.applications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy contacts_owner on public.contacts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy contact_applications_owner on public.contact_applications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy interviews_owner on public.interviews for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy private_records_owner on public.private_records for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy publications_owner on public.candidate_publications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy resume_owner_select on storage.objects for select using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy resume_owner_insert on storage.objects for insert with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy resume_owner_update on storage.objects for update using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text) with check (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);
create policy resume_owner_delete on storage.objects for delete using (bucket_id = 'resumes' and (storage.foldername(name))[1] = auth.uid()::text);

grant select, insert, update, delete on public.app_accounts, public.devices, public.workspace_snapshots,
  public.job_profiles, public.applications, public.contacts, public.contact_applications,
  public.interviews, public.private_records, public.candidate_publications to authenticated;

create or replace function public.bootstrap_account()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.app_accounts(user_id, display_name, avatar_url)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), coalesce(new.raw_user_meta_data->>'avatar_url', ''));
  insert into public.candidate_publications(user_id) values (new.id);
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.bootstrap_account();

create or replace function public.apply_workspace_snapshot(
  p_change_id uuid,
  p_device_id text,
  p_base_server_version bigint,
  p_payload jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
  v_current public.workspace_snapshots%rowtype;
  v_version bigint;
begin
  if v_user is null then raise exception 'not_authenticated'; end if;
  if jsonb_typeof(p_payload) <> 'object' or pg_column_size(p_payload) > 16777216 then raise exception 'invalid_payload'; end if;
  if exists(select 1 from public.workspace_changes where user_id = v_user and change_id = p_change_id) then
    select * into v_current from public.workspace_snapshots where user_id = v_user;
    return jsonb_build_object('status','already_applied','server_version',coalesce(v_current.server_version,0));
  end if;
  select * into v_current from public.workspace_snapshots where user_id = v_user for update;
  if found and v_current.server_version <> p_base_server_version then
    return jsonb_build_object('status','conflict','server_version',v_current.server_version,'payload',v_current.payload);
  end if;
  v_version := coalesce(v_current.server_version, 0) + 1;
  insert into public.workspace_snapshots(user_id,payload,server_version,last_change_id,updated_at)
  values(v_user,p_payload,v_version,p_change_id,now())
  on conflict(user_id) do update set payload=excluded.payload,server_version=excluded.server_version,last_change_id=excluded.last_change_id,updated_at=now();
  insert into public.workspace_changes(user_id,change_id,device_id,server_version,operation)
  values(v_user,p_change_id,p_device_id,v_version,'upsert');
  return jsonb_build_object('status','accepted','server_version',v_version);
end;
$$;

revoke all on function public.apply_workspace_snapshot(uuid,text,bigint,jsonb) from public, anon;
grant execute on function public.apply_workspace_snapshot(uuid,text,bigint,jsonb) to authenticated;

revoke all on public.support_reports from anon, authenticated;
revoke all on public.workspace_changes from anon;

commit;
