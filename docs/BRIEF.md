# Build brief: personal chess coach (Stockfish + Lichess)

The original brief, kept as the spec. Where the agreed plan changes something, [PLAN.md](PLAN.md) wins.

## What to build

A personal, chess.com-Diamond-level analysis app for my chess.com account r00k4ndr0ll. My goal is 1000
rapid by 31 Dec 2026, and the app exists to find what is costing me rating and drill it.

Two halves:

1. Local Python pipeline: fetch my games, analyse every move with Stockfish, build the analysis model
   below, generate puzzles, and export static JSON.
2. React web app that reads that JSON, with our own board and viewer only (no Lichess embeds or links).
   It runs locally (`npm run dev`) and deploys as a static site from GitHub to a subdomain of my domain
   (e.g. `chess.adityasingh.io`).

All heavy engine work runs on my machine (MacBook M3 Pro), never on the host. The deployed site is fully
static.

## How to work

- Show me a plan first, then build phase by phase (phases at the bottom). Commit after each phase with
  tests passing, and stop at each phase's acceptance check for me to review.
- Verify library APIs and current versions against their docs before using them; don't guess.
- Ask me before: adding any paid service, changing the licence, or anything that would put a secret in
  git or in the frontend bundle.
- Single user (me). Prefer simple and robust over clever.

## Non-negotiable: Stockfish does all chess calculation

This is the most important rule in the project. Breaking it makes the analysis worthless.

- Judging comes only from Stockfish. Every evaluation, best move, line, move label, accuracy, and every
  "how bad was it" comes from Stockfish output.
- Measuring is allowed. Code may read facts off the board and along Stockfish's lines, like a
  scorekeeper: material count, which piece moved, what a piece attacks, whether a move is a check or
  capture, whose turn it is, clocks. python-chess is used for these rules-level facts and for legality
  and SAN/UCI conversion. Measuring describes what happened; it never decides whether it was good.
- You (Claude) never calculate chess. Don't decide from your own reasoning that a move is good or bad,
  that a piece is hanging, that a line wins, or what the best move is. Don't hand-write chess heuristics
  that stand in for the engine (e.g. "a piece is hanging if it's attacked more than defended"). If a
  feature needs a chess judgement, get it from Stockfish.
- Tests must not encode your chess opinions. Fixtures for evaluations, labels or tags come from recorded
  Stockfish output or from the Lichess puzzle database (engine-verified, with human-voted themes), never
  from expected values you worked out yourself. Pure maths (Win%, accuracy formulas) and parsing can be
  tested with hand-computed numbers.
- All explanation text is generated from engine facts by templates, e.g. "Bxf7 lost 3 points of
  material: Stockfish's line is Bxf7 Qxf7. Best was Nf3 (+0.4)." Every move, eval and material number is
  filled in from stored data.
- One engine, one configuration. The pipeline uses only local Stockfish with the settings in
  `config.toml`, so all stored numbers are comparable. No other engines or cloud evals. Record the
  Stockfish version with every cached result.
- Live exploration in the browser uses Stockfish WASM. Label those evals as live, never write them back
  into the pipeline data, and don't present them as the game's official analysis.

## Facts already verified

- chess.com public API, no auth: `GET https://api.chess.com/pub/player/r00k4ndr0ll/games/archives`
  returns monthly archive URLs. Each archive's `games[]` has `pgn`, `time_class`, `rated`, `end_time`,
  `white`/`black` (`username`, `rating`, `result`), and `accuracies` only for games chess.com reviewed
  (108 of my 603 rapid games this year). PGNs have `[%clk h:mm:ss]` on every move, plus `ECO`, `ECOUrl`,
  `TimeControl` (e.g. `600` or `600+5`), `Termination`, `WhiteElo`, `BlackElo`. Fetch archives
  sequentially, send a User-Agent containing a contact email taken from `.env`, and back off on HTTP
  429. Volume: ~626 games in 2026 (603 rapid), ~32,700 plies.
- Lichess formulas (lichess.org/page/accuracy):
  - `Win% = 50 + 50 * (2 / (1 + exp(-0.00368208 * centipawns)) - 1)`
  - `Accuracy% = 103.1668 * exp(-0.04354 * (winBefore - winAfter)) - 3.1669` (clamp 0–100)
  - Game accuracy = average of (volatility-weighted mean of move accuracies, using sliding windows sized
    by game length with each window's Win% standard deviation as weight) and (harmonic mean of move
    accuracies).
- Lichess puzzle database: `https://database.lichess.org/lichess_db_puzzle.csv.zst` (~307 MB, CC0,
  ~6.16M puzzles). Columns: `PuzzleId, FEN, Moves, Rating, RatingDeviation, Popularity, NbPlays, Themes,
  GameUrl, OpeningTags, DailyDate`. The FEN is the position before the opponent's move: apply the first
  move in `Moves` to get the puzzle position, and the solution is the remaining moves. `OpeningTags` is
  only set for puzzles starting before move 20. Theme names and descriptions are in `puzzleTheme.xml` in
  the lila repository.
- Lichess opening explorer (`https://explorer.lichess.ovh/lichess`) returns 401 without auth, so it
  needs my Lichess personal API token (required for this project). It filters by `speeds` and by fixed
  `ratings` buckets. My understanding is the buckets are 0, 1000, 1200, 1400, 1600, 1800, 2000, 2200,
  2500, each covering up to the next one; confirm against the live API before relying on it.
- Lichess ratings are higher than chess.com ratings at my level. One published conversion (lucb3,
  "Converting Chess.com to Lichess ratings") puts chess.com rapid 600 ≈ Lichess rapid 980, 700 ≈ 1070,
  800 ≈ 1165, 1000 ≈ 1350, 1100 ≈ 1440. So "players at my level" (chess.com 600–1100) means roughly the
  Lichess rapid 1000–1400 buckets. Make the mapping configurable.
- Lichess pages can't be iframed (they send `X-Frame-Options: SAMEORIGIN`). Irrelevant anyway: we build
  our own viewer.
- react-chessboard is MIT-licensed and supports arrows, custom square styles and `onPieceDrop`.

## Stack

- Pipeline: Python 3.12+, `uv`, `python-chess`, Stockfish binary (`brew install stockfish`, path from
  `.env`), SQLite cache, `zstandard` for the puzzle file, a small CLI (Typer or argparse), `pytest`.
- Web: Vite + React + TypeScript, `react-chessboard` + `chess.js`, React Router, one charting library.
  Mobile-first, since I'll drill puzzles on my phone. Light and dark themes.
- In-browser engine (for exploring lines the pipeline didn't analyse): Stockfish compiled to
  WebAssembly, running in a Web Worker. Default to a single-threaded build so the site works on any
  static host without COOP/COEP headers; offer the multi-threaded build only where the host can set
  those headers.
- Licence: Stockfish and its WASM builds are GPL-3.0, so license this repo GPL-3.0. Don't copy code from
  `lichess-puzzler` (AGPL); reimplement the ideas.
- "Book" moves: use the `lichess-org/chess-openings` dataset (check its licence) to mark moves that
  reach a named opening position.

## Pipeline

One command, `uv run coach update`, runs every step and only processes new games.

1. fetch: incremental. Store raw archive JSON in `data/raw/` (gitignored). Re-download only the current
   month.
2. parse: for each move store ply, side, SAN, UCI, FEN before/after, clock remaining, and think time
   (`my previous clock − my clock + increment`). Store game metadata, my colour, result, termination,
   opponent rating and start time.
3. analyze: two passes, cached in SQLite keyed by (FEN without move counters, engine version, settings).
   Resumable, with a progress bar and ETA. Use a multiprocessing pool of (cores − 1) workers, each with
   its own engine (`Threads=1`, `Hash=128`). Handle mate scores. Store evals from White's view and
   convert to the mover's view when needed.
   - Pass 1: every position, fixed node limit (start at 500k, configurable), MultiPV 2.
   - Pass 2, deeper (start at 4M nodes) with MultiPV 3 and Stockfish's line up to 10 plies, only on:
     moves that dropped the mover's Win% by 5 or more, positions where best − second-best ≥ 20 Win%
     (puzzle candidates), and positions along candidate puzzle lines.
4. derive:
   - Move labels by the mover's Win% drop: Best (Stockfish's top move), Excellent (< 2), Good (< 5),
     Inaccuracy (5–10), Mistake (10–15), Blunder (≥ 15), Book (reaches a named opening).
   - Accuracy per move and per game with the Lichess formulas.
   - Then build everything in the Analysis model section below.
5. puzzles:
   - From my games: every mistake record (below) where one move is clearly best (best − second-best ≥ 20
     Win%, confirmed in pass 2). Extend the solution along Stockfish's line while, at each of my turns,
     Stockfish's best move is still clearly best by the same gap, up to 6 plies. Also include "missed a
     win" records that pass the human-findable filter. Each puzzle carries the record's tags.
   - Same kind, from Lichess: stream-decompress the CSV once and keep puzzles rated 400–1400 with decent
     popularity and play count. Select by the Lichess themes my top leaks map to (see the mapping below)
     and by my openings' `OpeningTags` (Caro-Kann, Queen's Gambit, Slav). Write a subset of about 5,000.
     Don't commit the CSV.
6. export: write to `web/public/data/`: `summary.json`, `games/index.json`, one `games/{id}.json` per
   game (moves, evals, lines, labels, clocks, tags), `mistakes/index.json`, `losses.json`, `leaks.json`,
   `openings/white.json`, `openings/black.json`, `endgames.json`, `insights.json`, `puzzles/mine.json`,
   `puzzles/lichess.json`. Keep files small and load them lazily.

## Analysis model

Stockfish only provides evaluations, top moves and lines. This section defines exactly how those are
turned into categories. Every threshold here lives in `config.toml` so I can tune it.

### Scale and filters

- All Win% values are from my point of view unless stated.
- Garbage time: ignore a move if my Win% before it was below 10, or above 90 and still above 60 after
  it. Everything else counts.
- Material is counted with P=1, N=3, B=3, R=5, Q=9. "Net material along a line" means my material minus
  the opponent's at the end of Stockfish's line, compared with before my move, measured with
  python-chess.

### Phases

- Opening: moves 1–12, plus any later move whose position is still in the book dataset.
- Endgame: from the first position where each side has 13 or fewer points of non-pawn material.
- Middlegame: everything in between.
- Endgame type, by material at the moment the endgame starts: pawn (kings and pawns only), rook (rooks
  and pawns), minor piece (knights/bishops and pawns), queen (queens present), mixed (anything else).

### Mistake records

Every move of mine that drops my Win% by 5 or more (outside garbage time) becomes a record: game, ply,
phase, opening family, my move, Stockfish's best move and line, Win% before and after, severity label,
think time, clock left, opponent rating, primary type, sub-type, flags, and which recipe rule fired (for
review).

### Primary type (exactly one per record, first match in this order)

1. Allowed mate: after my move Stockfish reports a forced mate against me, and before it didn't.
2. Hung a piece: in Stockfish's line after my move, the opponent's first reply is a capture and net
   material at the end of the line is −2 or worse for me.
3. Walked into a tactic: net material at the end of Stockfish's line is −2 or worse, but the first reply
   isn't the losing capture. Sub-type from the key enemy move (the first opponent move in the line that
   isn't a recapture), measured on the board right after it: fork, pin, skewer, discovered attack,
   double check, or other.
4. Missed mate: before my move Stockfish's best move for me had mate in 3 or less, and my move doesn't
   keep a mate in 3 or less.
5. Missed a win: Stockfish's best move for me is worth 15+ Win% more than my move, its line wins net
   material of +2 or more for me, and it passes the human-findable filter. Sub-type: free material (my
   best move is a capture that wins material outright), or fork / pin / skewer / discovered attack /
   double check from my key move in the line.
6. Quiet mistake: none of the above (Win% dropped but no material changes hands in the line and no
   mate). These are positional; show the better move and line without a "why".

Implement fork, pin, skewer, discovered attack and double check to match Lichess's definitions in
`puzzleTheme.xml`, so my tags line up with Lichess puzzle themes. Mapping for "same kind" puzzles: Hung a
piece → `hangingPiece`; fork → `fork`; pin → `pin`; skewer → `skewer`; discovered attack →
`discoveredAttack`; double check → `doubleCheck`; mates → `mateIn1` / `mateIn2` / `mateIn3` (plus
`backRankMate` when the mating square is on the back rank); free material → `hangingPiece`.

Human-findable filter (for "missed" types and missed-win puzzles): Stockfish's winning line needs at most
3 of my moves, and each of my moves in it is a check, a capture, or a move Stockfish rates clearly best
(gap ≥ 20 Win%). Otherwise it's an engine-only idea and isn't counted against me.

### Flags (any number per record)

- Threw away a win: Win% before ≥ 80 and after < 60.
- Endgame (with endgame type), Opening (with opening family).
- Fast blunder: severity Mistake or worse and think time below the 25th percentile of my think times for
  that time control.
- Time trouble: clock below 10% of the starting time.
- After a loss: the game started within 30 minutes of a loss.

### Why I lost: exactly one cause per loss

1. Lost on time with my Win% at the last move ≥ 40 → Clock: flagged while playable.
2. Resigned or abandoned with Win% ≥ 40 → Gave up while playable.
3. Otherwise find the turning point: my first move that took my Win% from ≥ 40 to ≤ 25. The cause is
   that record's primary type (with sub-type and flags).
4. No such move → Outplayed slowly.

Every loss must get exactly one cause (add a test). Separately, list winning games not won: games where
my Win% reached 80+ and the result wasn't a win, with the move that threw it away.

### Opening report (per colour, per opening family and variation from `ECOUrl`)

- Games, score, and score difference vs my other openings of the same colour (never compare Black
  openings with White games).
- My average Win% after move 12: do I come out of the opening okay?
- Leak positions in my tree (merged by position, so transpositions combine), shown as cards: board, "you
  play X (n games, score)", "Stockfish: Y (eval)", "players at your level: Z (%)" from the Lichess
  explorer. A position is a leak if my move there loses 10+ Win% on average, or my score from it is 15+
  points below my same-colour average, over at least 5 games.
- Surprises: positions where the opponent played a move that players at my level choose under 10% of
  the time, and my next move was a Mistake or worse.

### Endgame report

For every game that reaches an endgame: endgame type and my Win% when it started. Outcome: converted
(≥ 70 at the start and won), spoiled (≥ 70 and didn't win, or 30–70 and lost), held (30–70 and drew or
won), saved (≤ 30 and drew or won). Show spoiled endgames with the move that spoiled them and
Stockfish's line.

### Insights

Score and accuracy by colour, opening, phase, opponent rating band, hour of day, game length, and after
a win vs after a loss. Think time vs blunder rate, time losses, rating over time. Leak rates per game for
each primary type and flag, as last 20 games vs the previous 20.

### Calibration

- `uv run coach review --n 20 [--type fork]` prints random mistake records: the position (FEN and ASCII
  board), my move, Stockfish's line with material after each move, the assigned type and the rule that
  fired. I use this to tune thresholds.
- `uv run coach tagger-check` runs the sub-type tagger on a sample of Lichess puzzles (their solution
  line as the input) and reports agreement with Lichess's own theme tags per theme.

## Web app

Every screen follows the same pattern: number → my actual positions → drill them.

- Dashboard: rating chart with a goal line (1000 by 2026-12-31, configurable); a "Why I lost" bar
  (every loss in one cause, for the last 30 days and all time); my top 3 leaks with trend (per-game
  rate, last 20 vs previous 20); winning games not won; today's training (puzzles due, one opening
  drill).
- Leaks: every primary type, sub-type and flag with count, per-game rate, trend and total Win% lost.
  Click one to get the list of my positions (board, my move and Stockfish's best as arrows, Stockfish's
  line playable, link to that move in the game viewer). "Drill these" starts a puzzle session filtered
  to that tag: my own puzzles plus Lichess puzzles of the mapped theme.
- Games: filterable list (result, colour, opening, date, accuracy, loss cause) showing accuracy and
  blunder count.
- Game viewer (our own implementation):
  - Board with keyboard navigation and flip; move list with label badges and primary-type tags;
    clickable eval graph; think-time chart.
  - On each of my moves: arrows for my move vs Stockfish's best, Stockfish's line as a clickable
    variation, and the templated explanation.
  - The turning point of a lost game is highlighted.
  - Explore mode: play any move from any position and the in-browser Stockfish evaluates it live, with
    top 3 lines, clearly labelled as live.
  - A plain link to the original game on chess.com.
- Openings: an interactive tree per colour (board plus a table of next moves) with the opening report:
  family stats, leak cards, surprises, and for each position what I play vs Stockfish vs players at my
  level. Clicking a position lists the games that reached it; "Drill this line" adds it to the
  repertoire trainer.
- Endgames: the endgame report by type and outcome, with spoiled endgames clickable into the viewer.
- Puzzles: tabs for My mistakes, Same kind (Lichess) and Due today, filterable by tag. Try, retry, hint
  and reveal, with a link to the source game and stats per tag. Spaced repetition (SM-2 or a light FSRS)
  stored in localStorage, with export/import of progress as JSON.
- Insights: charts from `insights.json`.
- Repertoire trainer: spaced-repetition drills of my lines, loaded from a repertoire PGN in the config,
  plus leak lines found in my games. My repertoire: White 1.d4 2.c4 (Queen's Gambit; vs QGD, QGA, Slav,
  Albin). Black vs 1.e4: Caro-Kann (Main, Advance, Exchange). Black vs 1.d4: Slav.

Before building the UI, propose a visual direction and show me screenshots of the dashboard, leaks page
and game viewer.

## Config

- `config.toml`: username, rating goal and date, engine node limits, every threshold in the Analysis
  model, chess.com → Lichess rating mapping and explorer buckets, repertoire PGN path.
- `.env` (gitignored, with a committed `.env.example`): `STOCKFISH_PATH`, `CHESSCOM_CONTACT_EMAIL`,
  `LICHESS_TOKEN` (required, used only for the opening explorer; check which scopes it needs, likely
  none), `ANTHROPIC_API_KEY` (optional).

## Optional, off by default: AI-worded coach notes

Templates are the default and must be good on their own. Only if `ANTHROPIC_API_KEY` is set and I turn
this on: for my N most costly mistakes, have the Anthropic API reword the templated explanation into 2–3
friendlier sentences (check the current docs for model names). The model receives only stored engine
facts (FEN, my move, best move, Stockfish's line, evals, tags, material change) and may only rephrase
them: it must not add any move, line, evaluation or judgement that isn't in the facts. Validate the
output: every move it mentions must appear in the given facts and every number must match; drop any note
that fails and fall back to the template. Cache results. Never call the API from the frontend.

## Deploy

- GitHub repo. Commit the exported JSON under `web/public/data` (it's public chess.com data). Gitignore
  raw archives, the SQLite cache, the puzzle CSV and `.env`.
- Static hosting connected to GitHub: Cloudflare Pages or Vercel (build `npm run build`, output
  `web/dist`), with SPA routing fallback and a custom subdomain via CNAME. Document both options in the
  README. Add a toggle for a `noindex` meta tag.
- Optional nightly GitHub Action: install Stockfish, restore the SQLite cache, run `coach update` for new
  games only, commit changed data so the host redeploys. It must finish comfortably on a standard
  runner.
- CI check that no secrets end up in the built bundle.

## Phases and acceptance checks

1. Fetch, parse, analyse 20 recent games. Unit tests for clock and think-time parsing, Win% and accuracy
   formulas, and mate handling. Accept: the CLI prints per-game accuracy; for games that have chess.com
   `accuracies`, the numbers are in the same ballpark (they won't match exactly, as the formulas
   differ).
2. Full year and analysis model. Analyse all 2026 games and build everything in the Analysis model;
   export JSON. Accept: a printed "Why I lost" summary covering 100% of losses, top leaks, opening and
   endgame summaries, and the runtime; `coach review` and `coach tagger-check` work; re-running finishes
   in seconds when there are no new games. Stop here so I can review 20 records and we tune thresholds
   before any UI work.
3. Web app core. Dashboard, leaks drill-down, games list, game viewer with eval graph, best lines and
   explore mode. Accept: works at phone width, the game viewer handles a 100-move game smoothly, and
   every number on screen comes from exported data or the live engine.
4. Openings, endgames and insights pages.
5. Puzzles and repertoire trainer, including the Lichess subset, tag filters and spaced repetition.
6. Deploy, plus the optional nightly Action and AI-worded coach notes.
