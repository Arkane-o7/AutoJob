-- Supabase's database test runner relies on pgTAP. Hosted projects do not
-- enable it by default, so keep the test dependency reproducible and outside
-- the public application schema.
create extension if not exists pgtap with schema extensions;
