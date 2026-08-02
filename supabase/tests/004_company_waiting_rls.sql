begin;
select extensions.plan(14);

insert into auth.users(id, email) values
  ('44444444-4444-4444-8444-444444444444', 'company-a@example.test'),
  ('55555555-5555-4555-8555-555555555555', 'company-b@example.test'),
  ('66666666-6666-4666-8666-666666666666', 'company-c@example.test')
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select extensions.is((public.apply_workspace_mutation(
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd1', 'device_a', 'company', 'company_shared', 0, 'upsert',
  '{"name":"Acme","domain":"acme.example"}'::jsonb
)->>'status'), 'accepted', 'user A can create a company');
select extensions.is((select count(*)::integer from public.private_records where record_type='company'), 1, 'user A reads their company');
select extensions.is((public.apply_workspace_mutation(
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd2', 'device_a', 'waiting_item', 'waiting_shared', 0, 'upsert',
  '{"what":"Recruiter reply","application_id":"app_a","status":"open"}'::jsonb
)->>'status'), 'accepted', 'user A can create a waiting item');
select extensions.is((select count(*)::integer from public.private_records where record_type='waiting_item'), 1, 'user A reads their waiting item');

select set_config('request.jwt.claim.sub', '55555555-5555-4555-8555-555555555555', true);
select extensions.is((select count(*)::integer from public.private_records where record_type='company'), 0, 'user B cannot read user A companies');
select extensions.is((select count(*)::integer from public.private_records where record_type='waiting_item'), 0, 'user B cannot read user A waiting items');
select extensions.ok(not has_table_privilege('authenticated', 'public.private_records', 'update'), 'clients cannot directly update company or waiting records');
select extensions.is(public.workspace_record_provenance('company', 'company_shared', 1), '{}'::jsonb, 'user B cannot read user A company provenance');
select extensions.is((public.apply_workspace_mutation(
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1', 'device_b', 'company', 'company_shared', 0, 'upsert',
  '{"name":"Other Acme","domain":"other.example"}'::jsonb
)->>'status'), 'accepted', 'the same company id remains owner-scoped');
select extensions.is((select payload->>'name' from public.private_records where record_type='company' and id='company_shared'), 'Other Acme', 'user B reads only their company payload');

select set_config('request.jwt.claim.sub', '44444444-4444-4444-8444-444444444444', true);
select extensions.ok(public.workspace_record_provenance('company', 'company_shared', 1) <> '{}'::jsonb, 'user A reads owner-only company provenance');
select extensions.is((public.apply_workspace_mutation(
  'dddddddd-dddd-4ddd-8ddd-ddddddddddd3', 'device_a', 'waiting_item', 'waiting_shared', 1, 'delete', '{}'::jsonb
)->>'status'), 'accepted', 'user A can tombstone a waiting item');
select extensions.ok((select deleted_at is not null from public.private_records where record_type='waiting_item' and id='waiting_shared'), 'waiting tombstone is materialized');

select set_config('request.jwt.claim.sub', '66666666-6666-4666-8666-666666666666', true);
select extensions.is((public.claim_legacy_workspace(
  'ffffffff-ffff-4fff-8fff-fffffffffff1', 'device_c',
  '[{"mutation_id":"ffffffff-ffff-4fff-8fff-fffffffffff2","entity_type":"company","entity_id":"legacy_company","base_server_version":0,"operation":"upsert","payload":{"name":"Legacy Co"}},{"mutation_id":"ffffffff-ffff-4fff-8fff-fffffffffff3","entity_type":"waiting_item","entity_id":"legacy_waiting","base_server_version":0,"operation":"upsert","payload":{"what":"Legacy reply","status":"open"}}]'::jsonb
)->>'status'), 'accepted', 'reviewed legacy claims accept company and waiting records');

select * from extensions.finish();
rollback;
