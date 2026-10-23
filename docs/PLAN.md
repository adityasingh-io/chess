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
  no scopes, so a token with no scopes ticked. Still to confirm against the live API in Phase 2.

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

## Phases

| Phase | Builds | Acceptance |
|---|---|---|
| 1 | Repo, config, fetch, parse, both passes, Win%/accuracy, tests, calibration study | `coach accuracy` next to chess.com's; calibration results and a recommended budget |
| 2 | Full-year run, analysis model, explorer, export with shared schema, `review`, `tagger-check` | Why-I-lost covers 100% of losses; leaks, openings, endgames, runtime; no-op re-run in seconds. Stop for the 20-record review |
| 3 | Visual direction and screenshots first; then dashboard, leaks, games, game viewer, explore mode | Phone width, smooth 100-move game, every number from exports or the live engine |
| 4 | Openings tree and report, endgames, insights | Phone width; numbers match exports |
| 5 | Puzzles (mine and Lichess), FSRS, PWA, Supabase sync, repertoire trainer | A drill session from a leak works end to end on the phone |
| 6 | GitHub repo, deploy docs, noindex toggle, bundle secret scan, nightly Action, shared cache, AI notes | Site live on the subdomain; nightly run finishes in minutes |
