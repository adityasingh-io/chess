# Agreed plan

Approved 2026-10-23. This records what was decided on top of [BRIEF.md](BRIEF.md); where they differ,
this file wins.

## Decisions

- **Scope:** rapid games from 2026-01-01 only (rated and unrated). The rating chart uses rated games.
- **Opening names** come from the Lichess `chess-openings` dataset (CC0), using the deepest named position
  a game reaches, so families match the puzzle `OpeningTags` and the explorer. `ECOUrl` is kept for
  display and the chess.com link.
- **Engine:** Stockfish 19 (Homebrew build for Apple Silicon), pinned with `brew pin stockfish`.
  `config.toml` names the version and the pipeline refuses any other binary.
- **Budgets come from data.** `coach calibrate` compares every candidate budget with a much deeper
  Stockfish reference; we pick the smallest budget past which agreement stops improving
  ([calibration.md](calibration.md)). Chosen 2026-10-24 against a 64M-node reference: pass 1 at 2M nodes
  (best-move agreement peaks there; 4M is within noise for twice the time) and pass 2 at 16M nodes (still
  improving at 16M, but it's the most the machine affords for a full year in two nights).
- **Progress sync via Supabase (free plan):** puzzle and repertoire review state, attempts and settings,
  synced between phone and Mac. Offline-first (device first, sync when online). Email magic-link sign-in,
  sign-ups disabled after the account exists, row-level security. The Supabase URL and publishable key go
  in the frontend bundle (approved); no service-role key anywhere.
- **Analysis data stays static JSON** on the CDN; the engine cache stays in local SQLite.
- **Installable PWA** so puzzles and games work offline on the phone.
- **FSRS** (ts-fsrs) for spaced repetition instead of SM-2.
- **One schema for both halves:** export models in pydantic, TypeScript types generated from them,
  every export validated in tests.
- **Shared engine cache via a GitHub release asset** so local runs and the nightly Action never redo each
  other's work.
- **Browser engine:** Stockfish 19 lite, multi-threaded with COOP/COEP headers, falling back to lite
  single-threaded. The full-net builds (~99 MB) exceed Cloudflare Pages' 25 MB file limit.
- **Explorer host** is `https://explorer.lichess.org/lichess` (the API docs moved it from
  `explorer.lichess.ovh`). Buckets per the docs: `0` = 0–999, `1000` = 1000–1199, …, `2500`+. OAuth2 with
  no scopes, so a token with no scopes ticked. Confirmed against the live API on 2026-10-24: it takes a
  burst of about 30 requests, then answers 429 and we wait a minute, so about 25 positions a minute.
- **Maia-2 picks the human-like bots' moves in Play on** (decided 2026-10-24; an exception to "one engine"):
  Stockfish's rating setting starts at 1320 and is measured against engines, so it can't play like an
  800. Maia-2 (CSSLab, MIT licence), trained on Lichess rapid games, predicts the move a player of a given
  rating makes. It only chooses the bot's move; it never scores, labels, explains or suggests a move, and
  nothing it picks is stored. Its rapid model is committed as ONNX (float16 weights, 42 MB) and runs in
  the browser with onnxruntime-web (MIT); `scripts/maia/` remakes and checks it.
- **AI notes use short-lived Anthropic credentials, never a stored API key** (decided 2026-10-24; replaces
  the brief's `ANTHROPIC_API_KEY`). On the Mac: an `ant auth login` profile, which the SDK reads and
  refreshes by itself. In the nightly Action: Workload Identity Federation, which exchanges GitHub's OIDC
  token for a short-lived access token, so no Anthropic secret is stored in GitHub either. The pipeline
  builds the client with no key, and the feature is switched on in `config.toml`. The workspace keeps a
  monthly spend limit. Nothing Anthropic goes in the frontend.

## Engine setup

- Each worker: one search thread, fixed node limit, hash cleared before every position (`ucinewgame`),
  board with no move history. The same position gets the same result regardless of order or worker.
- Workers: 10 by default (`--workers 11` for overnight runs). Hash 128 MB in pass 1, 256 MB in pass 2.
- Game-over positions (checkmate, stalemate, insufficient material) never go to the engine; python-chess
  detects them and they score like a mate (±1000 cp) or 50.
- Pass 2 covers, for my moves only and outside garbage time: the position before and after each move
  that drops my Win% by 5+, my-turn positions with one clear best move (gap ≥ 20), and my-turn positions
  along the best line of candidate records (gap ≥ 20 or drop ≥ 15), as long as each of my moves there is
  a check, a capture or clearly best, for up to 3 of my moves.
- Measured on this Mac (5 performance + 6 efficiency cores, 18 GB): about 0.65M nodes/s for one worker
  and 3.2M nodes/s across 10.
- Full-year run (2026-10-24): 604 games, 28,647 pass-1 and 6,551 pass-2 positions. The Mac did the first
  19,488 pass-1 positions in 2.8 h. Five rented 16-vCPU nodes (AMD EPYC 9555, official Linux Stockfish 19,
  `--shard i/5`) did the rest in about 25 minutes at about 23M nodes/s each. Before use, each re-ran 22
  positions the Mac had analysed and matched them exactly. Their results were merged into the cache, and
  a local run found everything cached. Explorer stats: 1,262 positions in 50 minutes. A no-op `coach update`
  takes about 11 s.
- **20-record review (2026-10-24), thresholds kept.** Of 20 random records, 14 fit, 3 were unsure (#9, #10,
  #13, all quiet) and 3 unmarked; none was marked wrong. Six of the 20 lines stop on a capture, so their
  material is measured mid-exchange (reading 3); the review found no wrong label from it, #14 included.

## Web app

- **Visual direction B · Night study** (chosen 2026-10-24 over A · Clubroom): dark first, ink-blue
  surfaces, walnut board, Archivo with narrow caps for labels and JetBrains Mono for numbers and moves. The
  light variant follows the OS, or the Auto/Light/Dark switch (kept in `localStorage`). Severity is a
  one-hue ramp always shown with ?! ? ??. Amber is my move, teal Stockfish's best, violet the live engine.
- **Stack** (exact versions pinned in `web/package.json`): Vite 8, React 19, TypeScript 7, React Router 8,
  react-chessboard 5 with chess.js 1.4 for rules-level board work, Recharts 3 as the one charting library,
  the `stockfish` npm package 19.0.1 (GPL-3.0) for the browser engine. Tests: Vitest with Testing Library
  in jsdom, and `e2e/run.mjs` driving the installed Chrome through playwright-core.
- **Data:** pages fetch the JSON exports and read them with React's `use()`. `mistakes/index.json` (the
  biggest file) loads only on a leak's detail page. Pages are split into their own chunks.
- **Browser engine flavours:** `stockfish-19-lite.js` (cores − 1 threads, at most 8, depth 24) when the page
  is cross-origin isolated, otherwise `stockfish-19-lite-single.js` (depth 20), which works on any static
  host. Both are copied from `node_modules` into `web/public/engine/` (gitignored) at dev and build time.
  The build's `_headers` sets COOP/COEP on Cloudflare Pages; on GitHub Pages the service worker adds them. Live lines are labelled LIVE, scored from my
  side, and never stored.
- **Explore:** drag or tap to play moves for either side from any position in the viewer. Pawns promote to
  a queen. Mate, stalemate, insufficient material and the fifty-move rule come from chess.js, and the engine
  isn't asked about those positions.
- **Eval bar** beside every viewer board, as on chess.com and Lichess: the fill is White's Win% and the
  number is Stockfish's score, written at the end of the side that is ahead. Game positions use the stored
  `win` and `eval` (the start position has only its Win%); Explore uses the live top line, converted with a
  TypeScript port of the pipeline's Win% formula that is tested against every stored move.
- **Compare** (added 2026-10-24 after the first Phase 3 look): for any of my moves that wasn't Stockfish's
  best, two boards step together from the position before the move: my move followed by Stockfish's line
  after it, and Stockfish's best line. Records use their pass-2 lines and scores (`reply_line`,
  `after_eval`, `best_line`, `best_eval`); other moves use the stored pass-1 lines. Side by side when the
  boards get at least 560 px between them, otherwise one board at a time with a You / Stockfish switch.
  Previous and next step through my mistakes in the game. Leak cards switch between the two lines.
- **One set of arrows:** ◀ ▶ ⏮ ⏭ and the arrow keys step whatever the board shows: the game, the compared
  lines, or the moves played in Explore (where ◀ takes a move back and ▶ plays it again). Esc goes back to
  the game.
- **Openings** (Phase 4): one tree per colour, the line kept in the URL (`?line=d2d4,d7d5`). Each position
  shows what I play (games, score, average Win% change), Stockfish's best with its score, what Lichess
  players rated 1000–1399 in rapid choose, and the games that reached it; each game opens in the viewer at
  that position (`?pos=`, matched by the first four FEN fields). ▶ follows my most played move. Below it:
  families with their variations, leak cards (each can show itself in the tree) and surprises, which open in
  Compare at my reply.
- **Endgames** (Phase 4): a type × outcome table whose cells filter the list below. Spoiled endgames open
  in Compare at the spoiling move; the others at the endgame's first move.
- **Insights** (Phase 4): rating, leak rates for the last 20 games against the 20 before, accuracy and
  mistakes by phase, mistake share by think time, score and accuracy by colour, previous result, opponent
  rating, game length (in moves, from the exported ply buckets), hour and opening, and time losses per
  month. Groups under 5 games are drawn faint.
- **Phone navigation** (changed in Phase 5): the bottom bar holds the training loop, Home, Leaks, Puzzles,
  Games and More; More lists Openings, the repertoire trainer, Endgames, Insights and Settings. The top bar
  on wider screens shows every page.
- **Puzzles** (Phase 5): from my games (`puzzles/mine.json`, 264) and a Lichess subset
  (`puzzles/lichess.json`, about 4,700), with `puzzles/index.json` counting each set per tag so pages can
  offer a drill without loading the sets. My puzzles start before my mistake; their solutions are
  Stockfish's pass-2 line, extended while my move stays clearly best (gap ≥ 20), up to 6 plies, ending on
  my move; missed-win puzzles use the human-findable line. A wrong move at a step where Stockfish's move
  isn't clearly best says other moves may work too; a mating move always solves. Lichess puzzles start
  after their first move. Selection: rated 400–1400, popularity ≥ 80, at least 500 plays; per theme a
  quota weighted by how often my records carry the tags that map to it (at least 150 each), plus 20% by my
  six most played families' `OpeningTags`; inside each group the most popular first, spread over 100-point
  rating bands. Tags stay hidden until a puzzle is over (they name the motif).
- **Sessions:** ten puzzles. Due reviews first (longest overdue first), then puzzles never tried; my own
  newest game first, Lichess ones nearest my puzzle level (Elo-style, starts at 900, K = 40, moved only by
  Lichess puzzles). A leak's "Drill these" takes up to five of my own puzzles with that tag, then Lichess
  puzzles of the mapped themes.
- **Spaced repetition:** ts-fsrs with day steps only (a puzzle solved today never comes back today).
  Clean solve → Good; one wrong move or a hint → Hard; revealed or two wrong → Again. Lines: the first
  time a line is shown (learn) → Hard, so it's back the next day, or Again after a slip; from memory, no
  slip → Good, one → Hard, more → Again. Progress (cards, an attempts log capped at 5,000, lines added from the
  tree, puzzle level) lives in `localStorage` as one JSON object, exported and imported from Settings.
  Import merges: per item the newer answer wins, attempts are pooled, lines keep their latest add or
  remove.
- **Repertoire trainer:** `repertoire.pgn` (committed) holds the starter lines, generated by
  `coach repertoire` from the named chess-openings lines in `config.toml`, extended by Stockfish's pass-2
  move on my turns and the explorer's most common reply on theirs, up to 20 plies, stopping where fewer
  than 50 explorer games remain. Editing the PGN is how the repertoire changes; the next `coach build`
  picks it up. Leak lines are the moves to each opening leak position from my games, then Stockfish's
  pass-1 best; the drill asks only that last move. "Drill this line" in the tree adds the current line,
  and the tree lists any of my moves along it that aren't Stockfish's best. A line I've never drilled is
  shown first: the arrow gives each of my moves, with Stockfish's score for it, whether it's Stockfish's
  top move, how often players at my level play it (explorer), the opening it reaches and what it does on
  the board; then it's played from memory. Wherever a drill asks for my move, every legal move is scored
  with pass-1 settings on the position after it (as each move of a game is), so a slip shows its stored
  score next to the line's move and what happens along Stockfish's line after it. Lines added from the
  tree have no stored scores; a slip there is scored by the in-browser engine, labelled live. A finished
  line lists every move with its score, share and reason.
- **Explanations** (`src/coach/why.py`): measured on the board along Stockfish's stored lines, never
  judged. For a move: what it takes (or takes back), develops, castles, promotes, checks or mates; what it
  newly attacks (a piece worth more than the attacker, or undefended), opens an attack on, pins, or
  protects (a piece that was attacked with no defender), and whether it moves a piece out of attack (one
  attacked by something cheaper, or attacked with no defender, that isn't attacked after). For a line: what each side captures over its
  first `pv_plies` moves, like-for-like captures cancelling, with the net material. A mistake's text adds
  this for Stockfish's best move and line and for the move I played and Stockfish's reply; when both
  lines end with the same material, it says the difference is in the position, which only Stockfish's
  score measures. A mistake's text starts with the verdict: Stockfish's best move with its score and what
  its line does to material, then my move with its score and what its line does. Puzzles show it for the
  solution once they're over.
- **Dashboard training card:** puzzles due, a drill on the top leak that has puzzles, the opening lines
  due or to learn, and answers today against a goal of ten, with a streak of days.
- **Sync:** Supabase, off unless the build has `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`
  (from the repo-root `.env`; Vite exposes only `VITE_` variables). The client library loads only then.
  Magic-link sign-in without account creation; one `progress` row per user under row-level security
  (`supabase/migrations/0001_progress.sql`). A sync pulls, merges and pushes; it runs at start, when the
  device comes back online and five seconds after a change. Setup steps: [DEPLOY.md](DEPLOY.md).
- **Installable and offline:** a web manifest and a service worker written at build time. Install caches
  the app shell, every built file and the training data (summary, games index, leaks, puzzles,
  repertoire). Pages and data are network-first with the cache as fallback; built assets and engine files
  are cache-first.
- **Play it out** (`/play`, added after Phase 6 from what the data shows: 174 games reached 80% and
  weren't won, 155 of them lost; 47 of 303 losses were resigned or abandoned at 40% or more). Three lists,
  each played on against the in-browser Stockfish at full strength or its own Skill Level 10 or 3:
  - *Wins that got away:* the position before the move that threw each win, when my stored Win% there is
    at least 80. Goal: a win.
  - *Games you gave up:* the position each `gave_up` loss ended in (Stockfish moves first if the game ended
    on its turn). Goal: not losing, so a draw or a win.
  - *Mating practice:* queen, rook and two rooks against a lone king. Goal: a win.

  Stockfish's moves are played, never shown as analysis or stored. The rules decide the result
  (checkmate, stalemate, threefold repetition, fifty moves, insufficient material). Tries and goals
  reached stay on the device. The viewer links here from a thrown win and from a game given up;
  `losses.json` carries each start position and its Win%.
- **Last game and retrying a game:** the dashboard shows the newest game (result, accuracy, label counts,
  why I lost) with links to review it, retry its mistakes (`/puzzles?game=<id>`: my puzzles from that game
  in move order), and play its thrown win again or play on from where I gave it up. Game summaries and game files carry their puzzle count.
- **Quality of life** (added 2026-10-24 from what chess.com and Lichess players ask for):
  - *Hover to show:* every move and square an explanation names is a button. Hovering one (or focusing it
    from the keyboard) shows it on the board while the pointer stays; a tap or click keeps it shown until
    it's tapped again, and scrolls the board into view if it's off screen. A move is looked up in the
    stored lines the text was written from (the move before mine, Stockfish's best line, my move and
    Stockfish's line after it), then tried in the position after the move named before it; a square after
    "on" is a square. The line chips under an explanation show their move on hover too.
  - *Settings → Board* (`localStorage` "coach-settings", all off at first): square names in the corner of
    every square, in place of the edge coordinates; hanging pieces ringed (attacked by the other side and
    not defended, measured with chess.js, pins ignored), hidden while a drill waits for my move; move
    sounds, synthesised with Web Audio when a board steps one legal move forward. A gear in the top bar
    opens Settings.
  - *Threat* (game viewer, button or X): passes the turn and asks the in-browser Stockfish what the other
    side would play. Shown as a violet arrow and a LIVE line, never stored; not offered in check.
  - *Puzzles:* my puzzles also store my move and Stockfish's line after it (`played_line`), shown as a
    second row of chips once the puzzle is over. The Missed tab lists puzzles whose latest answer wasn't a
    clean solve, newest first, and plays them as a session.
  - *Coordinates* (`/coordinates`, under More and in Settings): the page names a square and I tap it, as
    many as I can in 30 seconds, as White or Black, with or without pieces. The best per side stays on the
    device.
  - *Square names* are sized from the board's own width (about a fifth of a square), not the page's.
- **Play on** (added 2026-10-24): on either Compare board, a move plays on from wherever that board is
  (before the move or any step of its line), and the chosen bot answers: Stockfish at full strength (as in
  Play it out), or Maia-2 like chess.com ~600, ~800 or ~1000 rapid players (`[bots]` in `config.toml`,
  converted to Lichess ratings with `rating_map` and exported in `summary.json`; my own rating, converted,
  is the opponent rating Maia-2 is given). Maia-2 plays its most likely move, shown with its share. Each
  board keeps its own moves; the board played on last is scored live by the in-browser Stockfish (eval
  bar, best-move arrow and "Stockfish's best here"), labelled live and never saved. ◀ ▶ step those moves,
  Esc or "Back to the lines" returns to the stored lines. "Nobody" lets me play both sides. The model
  (42 MB) and its runtime (14 MB) download the first time a Maia bot answers and stay cached, not at
  install.
- **Exports are committed.** The `.gitignore` rule `data/` also matched `web/public/data`, so Phase 2's
  exports never reached git. It is now `/data/`.

## Deploy and automation

- **Hosting:** GitHub Pages at `adityasingh.io/chess/` (the user site's domain plus the repo name; the repo
  is public because Pages on a private repo needs a paid plan). `.github/workflows/pages.yml` builds with
  `COACH_GITHUB_PAGES_BASE=/chess/`, which sets the sub-path and copies `index.html` to `404.html` for deep
  links. It runs when CI passes on main, and the nightly calls it after a data commit (pushes made with the
  workflow's token start no other workflow). Pages can't send headers, so the service worker adds COOP/COEP
  to everything it serves: the engine is single-threaded on a first visit and multi-threaded after.
  Cloudflare Pages and Vercel still work (the build writes `_headers`; `web/vercel.json`). Steps:
  [DEPLOY.md](DEPLOY.md).
- **Fetch new games:** a Cloudflare Worker (`web/worker/update.ts`, deployed with Wrangler) behind a card
  on the Games page. `GET /status` lists the chess.com games in the configured time classes that the
  site's `games/index.json` lacks, and the nightly's latest run; `POST /update` starts the nightly only when
  there is such a game and nothing is running or was published in the last 10 minutes. No sign-in: the most
  anyone can do is start an update for a real new game early. Its GitHub token is a Worker secret limited
  to this repo's Actions. The card follows the run every 15 s and offers a reload once the site has the
  games. Data files are fetched with `cache: "no-cache"` so a new update shows at once (Pages lets browsers
  keep files ten minutes).
- **noindex** on by default: robots meta tag, `robots.txt` disallowing everything and an `X-Robots-Tag`
  header. `COACH_NOINDEX=0` at build time turns all three off.
- **Secret scan:** `npm run build` ends with `scripts/scan-bundle.mjs`, which fails on known key formats
  (Anthropic, Supabase secret and service-role, Lichess, GitHub, AWS, private keys) and on the value of
  any pipeline secret (the `.env` file's non-`VITE_` variables and the CI secrets). It prints names only.
- **Shared cache:** `coach cache push` uploads the `evals`, `explorer` and `notes` tables as one
  zstd-compressed SQLite file (about 5 MB) and the Lichess puzzle subset to the release `cache`; `pull`
  merges with `INSERT OR IGNORE`, so rows already present stay. Games and moves are rebuilt from chess.com.
  CI checks that the Linux Stockfish 19 reproduces results recorded on the Mac, which is what makes
  sharing sound. A fresh checkout's export keeps the last exported Lichess puzzles when the subset is
  missing.
- **Nightly Action:** pinned Stockfish 19 Linux build with a checksum, cache pull (it stops if there's no
  cache, rather than re-analysing every game), `coach update --no-notes`, the optional notes step, cache
  push, and a commit of `web/public/data` if anything changed. `COACH_WORKERS=4` fits the pool to the
  runner; results don't depend on the worker count.
- **AI notes** (off in `config.toml`): the 30 costliest confirmed records by Win% lost. The model
  (`claude-opus-5-5`, low effort) gets only stored facts: my move, Win% before and after, Stockfish's
  scores and lines in SAN, material at the end of each line, the tags and the template text; no FEN, so it
  isn't asked to read the position. Every move in a reply must be one of the facts' moves, every square
  must appear in them, every number must be one of theirs (or a rounding of one), with no numbers spelled
  out, 1 to 4 sentences and at most 600 characters. A failing or cut-off reply is cached as failed and the
  template stays. Notes are cached per record and per facts hash (with the model and prompt version), so
  a record is asked about once unless its facts change. The viewer shows the note with the template
  behind "Worded by Claude from Stockfish's facts".

## How the brief is read

1. Labels, accuracy and Win% drops come from pass 1, so every move is judged at the same depth. Pass 2
   supplies lines, primary types and puzzle checks. Records note whether pass 2 confirms the drop;
   puzzles use confirmed records only.
2. Bands include their lower edge (Inaccuracy is 5 ≤ drop < 10). Label precedence: Book, Best, bands.
3. A recapture is a capture on the square the previous move captured on. Free material: Stockfish's best
   move is a capture, net material is +2 or better after the opponent's reply and still at the end of the
   line. Short lines are measured at their end.
4. Losing exactly one pawn (−1) matches no material type and falls to Quiet mistake; watch it in
   calibration.
5. Endgame outcomes add "lost as expected" (≤ 30 and lost). Bands: ≥ 70, strictly between 30 and 70,
   ≤ 30. The spoiling move is my endgame move with the largest Win% drop.
6. My first move's previous clock is the starting time. Fast-blunder percentile is per `TimeControl`,
   excluding book moves. "After a loss" means the game started within 30 minutes of a lost game's end.
7. Positions are analysed without move history, so Stockfish can't see repetitions coming. Accepted.
8. Mate scores map to Win% exactly as Lichess does (±1000 cp), and move accuracy includes Lichess's +1
   uncertainty bonus. Both verified in lila/scalachess source.
9. Tactic taggers are written from the `puzzleTheme.xml` descriptions only (no lichess-puzzler code).
   They describe the geometry of moves Stockfish's line already chose; whether material is lost is
   decided by net material along Stockfish's line.
10. Rule tests run on recorded Stockfish output; tagger tests use Lichess puzzles and their themes;
    formula and parsing tests use hand-computed numbers.
11. The starter repertoire is generated from data (chess-openings named lines, extended by Stockfish's
    top move on my turns and the most common reply at my level on theirs), never written from memory.
12. Explorer stats are fetched by the pipeline and exported only for positions in my tree; the frontend
    never holds the token.
13. Exchanges: if the opponent just captured and my move or Stockfish's best move captures back on that
    square, net material is counted from before their capture. Recapturing isn't "winning" material, and
    recapturing wrongly can still lose it.
14. Hung piece and tactic also need my move's line to end at least 2 worse than Stockfish's best line from
    the same position (a move isn't "hanging" material the best move would lose too). Missed win needs the
    best line to end at least +2 better than mine.
15. Records are my moves with drop ≥ 5 outside garbage time, except moves labelled Best. Book moves can be
    records.
16. Sub-type precedence: double check, fork, pin, skewer, discovered attack, else other. A motif counts
    only if the rest of Stockfish's line captures a targeted piece (a pin also counts when a capture lands
    on a square the pinned piece covers). Mating puzzles are left out of `tagger-check`.
17. The loss turning point must be a record. The thrown-win move is my largest drop after Win% first
    reaches 80.
18. Time trouble uses the clock after the move. "After a win / loss" in insights means the previous game
    ended within 30 minutes.
19. Top leaks rank primary types and sub-types by total Win% lost; flags describe context and aren't
    ranked.
20. The exported opening tree keeps positions reached in at least `tree_min_games` (2) games.
21. Exports are reproducible: `as_of` is the newest game's end time, and a file is rewritten only when its
    content changes.
22. `tagger-check` measures the first 20,000 puzzles of the Lichess puzzle stream (cached locally).
23. A game resigned or abandoned before any move is modelled from its initial position, so a loss still gets
    exactly one cause from Stockfish's stored Win% there. It has no opening, so opening reports leave it out.

## Phases

| Phase | Builds | Acceptance |
|---|---|---|
| 1 | Repo, config, fetch, parse, both passes, Win%/accuracy, tests, calibration study | `coach accuracy` next to chess.com's; calibration results and a recommended budget |
| 2 | Full-year run, analysis model, explorer, export with shared schema, `review`, `tagger-check` | Why-I-lost covers 100% of losses; leaks, openings, endgames, runtime; no-op re-run in seconds. Stop for the 20-record review |
| 3 | Visual direction and screenshots first; then dashboard, leaks, games, game viewer, explore mode | Phone width, smooth 100-move game, every number from exports or the live engine |
| 4 | Openings tree and report, endgames, insights | Phone width; numbers match exports |
| 5 | Puzzles (mine and Lichess), FSRS, PWA, Supabase sync, repertoire trainer | A drill session from a leak works end to end on the phone |
| 6 | GitHub repo, deploy docs, noindex toggle, bundle secret scan, nightly Action, shared cache, AI notes | Site live on the subdomain; nightly run finishes in minutes |
