# Deploying

The app is a static site (`web/dist`) plus optional progress sync through Supabase. Everything here is a
one-time setup done by hand; nothing in the repo creates accounts or projects.

## Progress sync (Supabase, optional)

Without it, training progress stays on each device, and Settings can export it as JSON and import it on
another device. With it, the phone and the Mac share one copy: each device keeps working offline and
merges with the server when it's online (for each puzzle or line the newer answer wins).

1. **Project.** Create a project on the free plan at supabase.com.
2. **Table.** In the SQL editor, run [`supabase/migrations/0001_progress.sql`](../supabase/migrations/0001_progress.sql).
   It makes one `progress` table with row-level security, so a signed-in user can read and write only
   their own row. (With the Supabase CLI linked to the project, `supabase db push` does the same.)
3. **Sign-in.** Authentication → Sign In / Providers: keep Email on (the app uses magic links, no
   passwords). Under URL Configuration, set the Site URL to the deployed address and add
   `https://<your site>/settings` and `http://localhost:5173/settings` to the redirect URLs.
4. **My account, then no more sign-ups.** Authentication → Users → Add user, with my email. Then turn off
   "Allow new users to sign up". The app also asks for links with `shouldCreateUser: false`, so it can't
   make accounts itself.
5. **Keys.** Project Settings → API Keys: copy the project URL and the **publishable** key
   (`sb_publishable_…`) into the repo-root `.env` as `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`), and into the host's build environment. Both are
   meant to be public and end up in the bundle; the secret and service-role keys are never used anywhere.
6. **Build and sign in.** Rebuild (`npm run build` in `web/`). In the app, Settings → Sync → send the link,
   open it on the same device. Do this once on each device.

Supabase's built-in email sender allows only a few emails an hour, which is plenty for one person.

## Hosting

Phase 6 fills this in: the GitHub repo, Cloudflare Pages, the subdomain, the noindex toggle and the
nightly Action.
