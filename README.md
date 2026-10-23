# Chess coach

A personal analysis app for the chess.com account `r00k4ndr0ll`: fetch my games, analyse every move
with Stockfish on my own machine, find what's costing me rating, and drill it. Goal: 1000 rapid by
2026-12-31.

Stockfish does all chess judgement. The code only measures facts on the board (material, checks,
captures, clocks) and fills templates from stored engine output. See [docs/BRIEF.md](docs/BRIEF.md)
for the full spec and [docs/PLAN.md](docs/PLAN.md) for the agreed plan.

## Setup

```bash
brew install stockfish && brew pin stockfish   # config.toml pins the version
cp .env.example .env                            # then fill in CHESSCOM_CONTACT_EMAIL
uv sync
```

## Pipeline

```bash
uv run coach update                  # fetch, parse, analyse, explorer, export: only what's new
uv run coach update --last 20        # limit analysis to the 20 most recent games
uv run coach accuracy --last 20      # my accuracy (Lichess formula) next to chess.com's
uv run coach calibrate               # engine budget study, writes docs/calibration.md
uv run coach review --n 20           # random mistake records with Stockfish's lines and the rule
uv run coach review --type fork      # only one type, sub-type or flag
uv run coach tagger-check            # sub-type tagger vs Lichess puzzle themes
```

Individual steps: `coach fetch`, `coach parse`, `coach analyze`, `coach explorer` (needs
`LICHESS_TOKEN`), `coach build` (model and JSON export from cached results; never runs the engine).
Analysis is cached in `data/coach.sqlite` per (position, engine version, settings), so it can be stopped
and resumed at any time. Exports go to `web/public/data/`, with their JSON Schema in
`web/schema/export.schema.json`.

All tunable numbers live in [config.toml](config.toml). Secrets live in `.env`, which is gitignored.

## Tests

```bash
uv run pytest                 # everything
uv run pytest -m "not engine" # skip tests that run Stockfish
```

## Licence

GPL-3.0-or-later, because Stockfish and its WebAssembly builds are GPL-3.0.
