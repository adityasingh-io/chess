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
uv run coach puzzles                 # pick the Lichess puzzle subset (streams the puzzle file once)
uv run coach repertoire              # write the starter repertoire.pgn (edit it afterwards)
uv run coach cache pull              # merge the shared cache (GitHub release `cache`) into data/
uv run coach cache push              # upload this machine's engine results, explorer stats and notes
uv run coach notes --dry-run         # AI notes (off in config.toml): what would be sent, without sending
```

Individual steps: `coach fetch`, `coach parse`, `coach analyze` (`--shard 2/3` takes one share of the
games, to split a long run across machines), `coach explorer` (needs
`LICHESS_TOKEN`), `coach build` (model and JSON export from cached results; never runs the engine).
Analysis is cached in `data/coach.sqlite` per (position, engine version, settings), so it can be stopped
and resumed at any time. Exports go to `web/public/data/`, with their JSON Schema in
`web/schema/export.schema.json`.

All tunable numbers live in [config.toml](config.toml). Secrets live in `.env`, which is gitignored.

## Web app

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run check      # types, generated types up to date, unit and page tests
npm run build      # production build in web/dist, then a scan that fails on anything secret-looking
npm run e2e        # every page at phone and desktop width in Chrome, step timing, the live engine
```

Dashboard, leaks, games with a move-by-move viewer and live engine (chess.com-style Brilliant, Great and Miss
marks next to every label, with each game's counts), openings tree and report, endgames,
insights, puzzles from my games and Lichess with spaced repetition, a repertoire trainer that shows a
new line move by move before asking for it from memory, and "Play it out": wins that got away and games I
gave up while still playable, played on against the in-browser Stockfish. Every mistake, puzzle and
trainer move says what it does on the board, measured along Stockfish's lines, and every move or square it
names shows on the board on hover or tap. Settings has board options (square names on every square,
hanging pieces, move sounds); the viewer can show the opponent's threat (live engine); a move played on the
board starts a side line in the move list, as on chess.com, and side lines or either Compare board can be
played on against Stockfish or Maia-2 playing like a chess.com ~600, ~800 or ~1000 player (Maia-2, MIT, only
picks the bot's moves); a coordinates drill helps find squares quickly. It installs
as an app and works offline; training progress stays on the device unless Supabase sync is set up.

## Deploy

The app is published on GitHub Pages at [adityasingh.io/chess](https://adityasingh.io/chess/) when CI
passes on main and after each nightly update. On the Games page, **Fetch new games** starts the nightly
update straight away, through a small Cloudflare Worker (`web/worker/`), and shows the new games when
they're in. [docs/DEPLOY.md](docs/DEPLOY.md) has the one-time steps: GitHub Pages, the Worker and its
GitHub token, the noindex toggle, Supabase sync, the nightly Action with its shared cache, the optional
AI-worded notes, and Cloudflare Pages or Vercel instead. CI (`.github/workflows/ci.yml`) runs every test,
the build's secret scan and the browser checks on each push.

## Tests

```bash
uv run pytest                 # everything
uv run pytest -m "not engine" # skip tests that run Stockfish
```

## Licence

GPL-3.0-or-later, because Stockfish and its WebAssembly builds are GPL-3.0.
Maia-2's model (`web/public/maia/`, MIT, notice in `LICENSE-maia2.txt`) and onnxruntime-web (MIT) are
GPL-compatible.
