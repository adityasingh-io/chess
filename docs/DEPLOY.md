# Deploying

The app is a static site (`web/dist`) on GitHub Pages at `adityasingh.io/chess/`, a small Cloudflare
Worker for the "Fetch new games" button, and optional progress sync through Supabase. Everything here is a
one-time setup; nothing in the repo creates accounts or projects.

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
   make accounts itself. "Send invitation" (the option that needs no password) leaves the account
   unconfirmed until the invite is opened, and with sign-ups off Supabase can treat a sign-in link for an
   unconfirmed account as a sign-up and refuse it; confirming it in the SQL editor avoids that:
   `update auth.users set email_confirmed_at = now() where email = '<my email>';`.
5. **Keys.** Project Settings → API Keys: copy the project URL and the **publishable** key
   (`sb_publishable_…`) into the repo-root `.env` as `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`), and into the host's build environment. Both are
   meant to be public and end up in the bundle; the secret and service-role keys are never used anywhere.
6. **Build and sign in.** Rebuild (`npm run build` in `web/`). In the app, Settings → Sync → send the link,
   open it on the same device. Do this once on each device.

Supabase's built-in email sender allows only a few emails an hour, which is plenty for one person. It sends
the default templates (a sign-in link, no code); editing them, say to add a 6-digit code, needs custom SMTP.

## The GitHub repo

1. Create an empty repo on GitHub and push: `git remote add origin git@github.com:<you>/<repo>.git &&
   git push -u origin main`. It's public (`adityasingh-io/chess`): GitHub Pages on a private repo needs a
   paid plan, and public repos also get Actions minutes free. Cloudflare Pages and Vercel build private
   repos, if it ever goes back.
2. CI (`.github/workflows/ci.yml`) runs on every push: pytest including the Stockfish tests (the Linux
   build must reproduce the results recorded on the Mac, which is what lets the two share a cache), the
   web checks, the production build with its secret scan, and the browser checks.

`web/public/data` is committed (it's public chess.com data). The SQLite cache, raw archives, the puzzle
file and `.env` stay out.

## Hosting (GitHub Pages)

The user site `adityasingh-io.github.io` already serves `adityasingh.io`, so this repo's Pages site is at
`adityasingh.io/<repo>/` with no DNS changes.

1. Repo → Settings → Pages → Source: **GitHub Actions** (or `gh api -X POST repos/<you>/<repo>/pages -f
   build_type=workflow`).
2. `.github/workflows/pages.yml` builds with `COACH_GITHUB_PAGES_BASE=/chess/` (the repo name) and
   deploys. It runs when CI passes on main, from the nightly after a data commit, and by hand (Actions →
   Pages → Run workflow). The sub-path build also writes `404.html`, which Pages serves for deep links.
   For sync it passes the repository variables (not secrets: both are public) `VITE_SUPABASE_URL` and
   `VITE_SUPABASE_PUBLISHABLE_KEY` (`gh variable set <name> --body <value>`).
3. Pages can't send headers, so the service worker adds the cross-origin isolation ones: the engine runs
   single-threaded on a first visit and multi-threaded from the next page load.

Pages lets browsers keep files for ten minutes; the app revalidates its data files, so a new update shows
at once.

## Fetch new games (Cloudflare Worker)

The Games page has a **Fetch new games** card when the build has `VITE_UPDATE_URL` (pages.yml sets it).
It calls `web/worker/update.ts`, which checks chess.com against the site's data and starts the nightly
workflow on GitHub. The Worker also does this by itself every 5 minutes (the cron in
`web/worker/wrangler.toml`, with the Worker's other settings), so a new game is usually on the site a few
minutes after it ends. The scheduled check leaves alone a game an earlier run already saw (one the
pipeline leaves out, or a failed run); the button still starts those. `npx wrangler@4.152.0 tail` from
`web/worker` shows what each check did.

1. **Deploy** from `web/worker`: `npx wrangler@4.152.0 deploy` (after `npx wrangler@4.152.0 login`, which
   opens Cloudflare in the browser). It prints the `*.workers.dev` address that pages.yml uses and the
   schedule. The free plan allows 5 cron triggers per account; this uses one.
2. **GitHub token:** github.com → Settings → Developer settings → Fine-grained tokens → Generate new
   token. Repository access: only this repo. Permissions → Repository → **Actions: Read and write**
   (Metadata: read comes with it). Then, from `web/worker`: `npx wrangler@4.152.0 secret put GITHUB_TOKEN`
   and paste it. Until it's set the card says the service isn't set up; when it expires, make a new one
   the same way.

No sign-in: the Worker only starts the nightly when chess.com has a game the site lacks and no update is
running or publishing, so the most anyone can do is start a real update early.

## Or Cloudflare Pages

The build writes everything the host needs into `web/dist`: `_headers` with the cross-origin isolation
headers the multi-threaded engine needs, and the noindex settings below. With no `404.html`, Pages serves
`index.html` for any path that isn't a file, which is the single-page fallback the app's routes need.

1. Cloudflare dashboard → Workers & Pages → Create → Pages → Connect to Git, and pick the repo.
2. Build settings: framework preset **None**, root directory **`web`**, build command **`npm run build`**,
   build output directory **`dist`**. Environment variables: `NODE_VERSION` = `22`; for sync, also
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (public values; see above).
3. Save and deploy. Every push to `main` (including the nightly data commit) redeploys.
4. **Subdomain:** the project → Custom domains → Set up a custom domain → e.g. `chess.<your domain>`. If
   the domain's DNS is on Cloudflare the record is added for you; otherwise add a CNAME record `chess` →
   `<project>.pages.dev` at your DNS provider and wait for the certificate.

Limits that matter: 25 MiB per file and 20,000 files on the free plan. The build is about 670 files and
none is over 5 MB (the full-strength engine builds would not fit, which is why the browser uses the lite
one).

## Or Vercel

`web/vercel.json` holds the same setup (build command, `dist`, the single-page rewrite, the headers). Import
the repo, set the root directory to `web`, add the same environment variables, and deploy. Domains → add
`chess.<your domain>` and create the CNAME record Vercel shows.

## Search engines

A personal site, so builds ask search engines to stay out: a `robots` noindex meta tag, a `robots.txt`
that disallows everything, and an `X-Robots-Tag: noindex` header (in `_headers`, and in `vercel.json`).
To allow indexing, set `COACH_NOINDEX=0` in the host's build environment (and remove the header from
`vercel.json` on Vercel).

## Nightly update (GitHub Action, optional)

`.github/workflows/nightly.yml` runs at 03:00 India time: it installs the pinned Stockfish 19 Linux build
(checksum-checked), pulls the shared cache, runs `coach update` for the new games, pushes the cache and
commits the changed exports, which makes the host redeploy.

1. **Seed the cache once from the Mac** (otherwise the Action would re-analyse every game, so it stops
   instead): `gh auth login`, then `uv run coach cache push`. It uploads the Stockfish results, explorer
   responses and notes (about 5 MB compressed) and the Lichess puzzle subset to a release named `cache`.
   Later, `uv run coach cache pull` on the Mac takes what the Action added; `push` merges it in first too,
   so a push never drops the Action's results.
2. **Secrets** (repo → Settings → Secrets and variables → Actions → Secrets): `CHESSCOM_CONTACT_EMAIL` and
   `LICHESS_TOKEN`, the same values as in `.env`.
3. **Try it:** Actions → Nightly update → Run workflow. With a few new games it should take minutes (a rough
   estimate: a few minutes of engine time per new game on the runner's 4 cores).

## AI-worded notes (optional)

Off by default. When on, Claude rewords the templated explanation of my 30 costliest mistakes into a
few friendlier sentences; every reply is checked against the Stockfish facts it was given (moves, squares,
numbers) and dropped if anything doesn't match. No API key is stored anywhere (docs/PLAN.md).

1. **Claude Console:** a workspace for this with a monthly spend limit.
2. **On the Mac:** `ant auth login` (the SDK reads and refreshes that profile), `uv sync --extra notes`,
   set `enabled = true` under `[notes]` in `config.toml`, then `uv run coach notes --dry-run` to see exactly
   what would be sent, `uv run coach notes`, and `uv run coach build`. `uv run coach notes --show` lists
   the cached notes.
3. **In the nightly Action (Workload Identity Federation):** in the Console, create a federation rule that
   trusts GitHub Actions: issuer `https://token.actions.githubusercontent.com`, audience
   `https://api.anthropic.com`, subject `repo:<you>/<repo>:ref:refs/heads/main`, inference scope only. Then
   add repo **variables** (not secrets; they're ids): `ANTHROPIC_FEDERATION_RULE_ID`,
   `ANTHROPIC_ORGANIZATION_ID`, and if the rule needs them `ANTHROPIC_SERVICE_ACCOUNT_ID` and
   `ANTHROPIC_WORKSPACE_ID`. The workflow exchanges GitHub's five-minute token for short-lived
   credentials right before the notes step; that step can fail without stopping the update.

The pipeline refuses to run notes if `ANTHROPIC_API_KEY` is set in the environment or `.env`.
