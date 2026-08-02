begin;

-- Contact interactions are private workspace records. They deliberately reuse
-- the existing owner-only private_records table and record-level sync path.
alter table public.private_records
  drop constraint if exists private_records_record_type_check;
alter table public.private_records
  add constraint private_records_record_type_check check (record_type in (
    'contact_activity','reminder','answer_memory','learned_answer','resume_version',
    'knowledge_graph','settings','onboarding_progress'
  )) not valid;
alter table public.private_records validate constraint private_records_record_type_check;

alter table public.workspace_changes
  drop constraint if exists workspace_changes_entity_type_check;
alter table public.workspace_changes
  add constraint workspace_changes_entity_type_check check (entity_type in (
    'legacy_snapshot','profile','application','contact','contact_activity',
    'interview','reminder','answer_memory','learned_answer','resume_version',
    'knowledge_graph','settings','onboarding_progress'
  )) not valid;
alter table public.workspace_changes validate constraint workspace_changes_entity_type_check;

-- Keep the authoritative RPC body identical to the reviewed implementation,
-- changing only its entity allowlist. pg_get_functiondef retains the PL/pgSQL
-- body; fail the migration if the expected prior contract has drifted.
do $$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef('public.apply_workspace_mutation(uuid,text,text,text,bigint,text,jsonb)'::regprocedure)
    into v_definition;
  v_updated := replace(
    v_definition,
    '''profile'',''application'',''contact'',''interview'',''reminder''',
    '''profile'',''application'',''contact'',''contact_activity'',''interview'',''reminder'''
  );
  if v_updated = v_definition then raise exception 'apply_workspace_mutation allowlist drifted'; end if;
  execute v_updated;

  select pg_get_functiondef('public.workspace_record_provenance(text,text,bigint)'::regprocedure)
    into v_definition;
  v_updated := replace(
    v_definition,
    '''profile'',''application'',''contact'',''interview'',''reminder''',
    '''profile'',''application'',''contact'',''contact_activity'',''interview'',''reminder'''
  );
  if v_updated = v_definition then raise exception 'workspace_record_provenance allowlist drifted'; end if;
  execute v_updated;
end;
$$;

revoke all on function public.apply_workspace_mutation(uuid,text,text,text,bigint,text,jsonb) from public, anon;
revoke all on function public.workspace_record_provenance(text,text,bigint) from public, anon;
grant execute on function public.apply_workspace_mutation(uuid,text,text,text,bigint,text,jsonb) to authenticated;
grant execute on function public.workspace_record_provenance(text,text,bigint) to authenticated;

commit;
