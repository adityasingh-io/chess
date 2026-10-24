# Chess coach: project rules

Spec: [docs/BRIEF.md](docs/BRIEF.md). Agreed plan and decisions: [docs/PLAN.md](docs/PLAN.md) (wins where
they differ).

## Non-negotiable: Stockfish does all chess calculation

- Every evaluation, best move, line, label, accuracy and "how bad was it" comes from stored Stockfish
  output. Never decide from your own reasoning that a move is good or bad, a piece is hanging, a line wins
  or what the best move is, and never write heuristics that stand in for the engine.
- Code may only *measure* rules-level facts with python-chess: material, which piece moved, what a piece
  attacks, check, capture, side to move, clocks.
- Test fixtures for evals, labels and tags come from recorded Stockfish output or the Lichess puzzle
  database. Only pure maths and parsing tests may use hand-computed numbers.
- Explanations are templates filled from stored data.
- One engine, one configuration (`config.toml`); the Stockfish version is recorded with every cached
  result. Browser (WASM) evals are labelled live and never written back.

## How to work

- Build phase by phase; commit after each phase with tests passing and stop at its acceptance check.
- Verify library APIs and versions against current docs before using them.
- Ask before adding a paid service, changing the licence (GPL-3.0-or-later), or putting a secret in git or
  the frontend bundle. Never print `.env` values.
- Single user. Prefer simple and robust over clever.

## Layout and commands

- `src/coach/`: pipeline (`uv run coach --help`; `coach update` does everything new, `coach puzzles` picks
  the Lichess subset, `coach repertoire` writes the starter `repertoire.pgn`). `config.toml` holds every
  tunable number; `.env` holds secrets (and the two public `VITE_SUPABASE_*` values the app build reads).
  `data/` (gitignored) holds raw archives and `coach.sqlite`.
- `uv run pytest` (add `-m "not engine"` to skip tests that run Stockfish).
- `web/`: the app (Vite + React). In `web/`: `npm run dev`; `npm run check` (types, generated types up to
  date, unit and page tests); `npm run e2e` (builds, then checks every page at phone and desktop width in
  Chrome, the 250-ply game's step timing and the live engine). `npm run types` regenerates
  `src/types/export.ts` from `schema/export.schema.json`. `npm run build` ends with a secret scan of
  `dist/`. Progress sync setup: `docs/DEPLOY.md` and `supabase/migrations/`.
- Deploy, nightly Action, shared cache (`coach cache pull|push`) and AI notes (`coach notes`, off in
  `config.toml`, short-lived credentials only): `docs/DEPLOY.md`. Workflows in `.github/workflows/`.
