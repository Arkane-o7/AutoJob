begin;
select extensions.plan(20);

select extensions.has_table('public','legacy_workspace_claims','reviewed legacy claims are tracked');
select extensions.is((select relrowsecurity from pg_class where oid='public.legacy_workspace_claims'::regclass),true,'legacy claims enforce RLS');
select extensions.has_column('public','workspace_changes','entity_type','change feed identifies entity type');
select extensions.has_column('public','workspace_changes','entity_id','change feed identifies entity id');
select extensions.has_column('public','workspace_changes','base_server_version','change feed records optimistic base version');
select extensions.has_column('public','workspace_changes','payload','change feed carries the accepted record');
select extensions.has_column('public','workspace_changes','deleted_at','change feed preserves tombstones');
select extensions.has_function('public','apply_workspace_mutation',array['uuid','text','text','text','bigint','text','jsonb'],'per-record mutation RPC exists');
select extensions.has_function('public','pull_workspace_changes',array['bigint','integer'],'incremental pull RPC exists');
select extensions.has_function('public','bootstrap_workspace',array['text','bigint','integer'],'authenticated bootstrap RPC exists');
select extensions.has_function('public','claim_legacy_workspace',array['uuid','text','jsonb'],'reviewed legacy claim RPC exists');
select extensions.has_function('public','register_workspace_device',array['text','text'],'friendly device registration RPC exists');
select extensions.has_function('public','workspace_record_provenance',array['text','text','bigint'],'conflict provenance RPC exists');
select extensions.ok(has_function_privilege('authenticated','public.apply_workspace_mutation(uuid,text,text,text,bigint,text,jsonb)','execute'),'authenticated users can invoke mutation RPC');
select extensions.ok(has_function_privilege('authenticated','public.register_workspace_device(text,text)','execute'),'authenticated users can register their device label');
select extensions.ok(has_function_privilege('authenticated','public.workspace_record_provenance(text,text,bigint)','execute'),'authenticated users can inspect their conflict provenance');
select extensions.ok(not has_table_privilege('authenticated','public.applications','insert'),'clients cannot bypass application mutation validation');
select extensions.ok(not has_table_privilege('authenticated','public.contacts','update'),'clients cannot bypass contact mutation validation');
select extensions.ok(not has_table_privilege('anon','public.workspace_changes','select'),'anonymous clients cannot read the private change feed');
select extensions.ok((select count(*)=1 from pg_indexes where schemaname='public' and tablename='workspace_changes' and indexname='workspace_changes_user_entity_idx'),'entity history lookup index exists');

select * from extensions.finish();
rollback;
