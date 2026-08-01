begin;
select extensions.plan(15);

insert into auth.users(id, email) values
  ('11111111-1111-4111-8111-111111111111', 'activity-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'activity-b@example.test'),
  ('33333333-3333-4333-8333-333333333333', 'activity-c@example.test')
on conflict (id) do nothing;

set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select extensions.is(
  (public.apply_workspace_mutation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'device_a', 'contact_activity', 'activity_shared', 0, 'upsert',
    '{"contact_id":"contact_a","type":"email","direction":"outbound","summary":"Private A"}'::jsonb
  )->>'status'),
  'accepted',
  'user A can create a contact activity through the authoritative RPC'
);
select extensions.is((select count(*)::integer from public.private_records where record_type='contact_activity'), 1, 'user A can read their own contact activity');
select extensions.is((select payload->>'summary' from public.private_records where record_type='contact_activity' and id='activity_shared'), 'Private A', 'user A reads the accepted activity payload');

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select extensions.is((select count(*)::integer from public.private_records where record_type='contact_activity'), 0, 'user B cannot read user A activity');
select extensions.ok(not has_table_privilege('authenticated', 'public.private_records', 'update'), 'authenticated users cannot directly update contact activities');
select extensions.ok(not has_table_privilege('authenticated', 'public.private_records', 'delete'), 'authenticated users cannot directly delete contact activities');
select extensions.is((public.workspace_record_provenance('contact_activity', 'activity_shared', 1)), '{}'::jsonb, 'user B cannot read user A provenance');

select extensions.is(
  (public.apply_workspace_mutation(
    'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1', 'device_b', 'contact_activity', 'activity_shared', 0, 'upsert',
    '{"contact_id":"contact_b","type":"note","direction":"none","summary":"Private B"}'::jsonb
  )->>'status'),
  'accepted',
  'the same entity id remains owner-scoped for user B'
);
select extensions.is((select payload->>'summary' from public.private_records where record_type='contact_activity' and id='activity_shared'), 'Private B', 'user B sees only their own same-id activity');

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select extensions.ok((public.workspace_record_provenance('contact_activity', 'activity_shared', 1)) <> '{}'::jsonb, 'user A can read owner-only provenance');
select extensions.is(
  (public.apply_workspace_mutation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2', 'device_a', 'contact_activity', 'activity_shared', 1, 'delete', '{}'::jsonb
  )->>'status'),
  'accepted',
  'user A can tombstone their activity'
);
select extensions.ok((select deleted_at is not null from public.private_records where record_type='contact_activity' and id='activity_shared'), 'activity tombstone is materialized');
select extensions.ok(position('"operation": "delete"' in public.pull_workspace_changes(0, 100)::text) > 0, 'activity tombstone propagates through the change feed');
select extensions.is(
  (public.apply_workspace_mutation(
    'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', 'device_a', 'contact_activity', 'activity_shared', 1, 'upsert',
    '{"contact_id":"contact_a","type":"email","direction":"outbound","summary":"Stale"}'::jsonb
  )->>'status'),
  'conflict',
  'same-record stale versions conflict after a tombstone'
);

select set_config('request.jwt.claim.sub', '33333333-3333-4333-8333-333333333333', true);
select extensions.is(
  (public.claim_legacy_workspace(
    'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    'device_c',
    '[{"mutation_id":"cccccccc-cccc-4ccc-8ccc-ccccccccccc2","entity_type":"contact_activity","entity_id":"legacy_activity","base_server_version":0,"operation":"upsert","payload":{"contact_id":"legacy_contact","type":"note","direction":"none","summary":"Legacy activity"}}]'::jsonb
  )->>'status'),
  'accepted',
  'reviewed legacy claims accept contact activities'
);

select * from extensions.finish();
rollback;
