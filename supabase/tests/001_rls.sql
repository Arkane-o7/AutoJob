begin;
select plan(12);

select has_table('public', 'workspace_snapshots', 'workspace snapshots exist');
select has_table('public', 'candidate_publications', 'candidate publication exists');
select has_table('public', 'support_reports', 'private support table exists');
select is((select relrowsecurity from pg_class where oid='public.workspace_snapshots'::regclass), true, 'workspace snapshots enforce RLS');
select is((select relrowsecurity from pg_class where oid='public.applications'::regclass), true, 'applications enforce RLS');
select is((select relrowsecurity from pg_class where oid='public.contacts'::regclass), true, 'contacts enforce RLS');
select is((select relrowsecurity from pg_class where oid='public.interviews'::regclass), true, 'interviews enforce RLS');
select is((select relrowsecurity from pg_class where oid='public.private_records'::regclass), true, 'answer/reminder records enforce RLS');
select is((select relrowsecurity from pg_class where oid='public.candidate_publications'::regclass), true, 'publications enforce RLS');
select ok((select column_default like '%private%' from information_schema.columns where table_schema='public' and table_name='candidate_publications' and column_name='visibility'), 'candidate publication defaults to private');
select is((select relrowsecurity from pg_class where oid='public.support_reports'::regclass), true, 'support reports enforce RLS');
select is((select count(*)::int from pg_policies where schemaname='public' and tablename='support_reports'), 0, 'normal clients receive no support-report table policy');

select * from finish();
rollback;
