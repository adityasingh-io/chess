-- Supabase pauses a free project after a week without database activity, and an API call only counts if it
-- runs a query; the app can go a week unopened. The nightly Action (.github/workflows/nightly.yml) calls this
-- once a day with the publishable key. It reads no table and returns only the database's clock.
create or replace function public.keep_awake()
returns timestamptz
language sql
stable
set search_path = ''
as $$ select now() $$;

-- New functions are executable by everyone by default; only the API's signed-out role needs this one.
revoke all on function public.keep_awake() from public, anon, authenticated;
grant execute on function public.keep_awake() to anon;
