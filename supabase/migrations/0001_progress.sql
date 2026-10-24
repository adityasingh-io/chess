-- Training progress for the web app's sync (docs/PLAN.md): one row per user holding the same JSON the app
-- keeps in localStorage (web/src/lib/progress.ts). The app pulls the row, merges it with the device's copy
-- and writes the result back. Row-level security limits every user to their own row; the browser only
-- ever holds the publishable key and a signed-in user's session.
create table if not exists public.progress (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.progress enable row level security;

revoke all on public.progress from anon;
grant select, insert, update on public.progress to authenticated;

create policy "progress: read own row" on public.progress
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "progress: insert own row" on public.progress
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "progress: update own row" on public.progress
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
