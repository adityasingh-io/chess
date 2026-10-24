"""`uv run coach …` commands."""

from __future__ import annotations

import time
from collections import Counter
from datetime import UTC, datetime
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from coach import db
from coach.analysis import accuracy_of, full_year_counts, load_games, run_analysis, select_game_ids, shard_ids
from coach.chesscom import fetch as fetch_archives
from coach.config import Config, load_config
from coach.parse import parse_all

app = typer.Typer(no_args_is_help=True, add_completion=False, help="Personal chess coach pipeline.")
console = Console()

Last = Annotated[int | None, typer.Option(help="Only the N most recent games (default: all).")]
Reviewed = Annotated[int, typer.Option(help="Also the N most recent games chess.com reviewed.")]
Shard = Annotated[str | None, typer.Option(help="Only share i/n of the selected games, e.g. 2/3, to split a run across machines.")]


def _fmt(value: float | None) -> str:
    return "—" if value is None else f"{value:.1f}"


def _setup() -> tuple[Config, object]:
    cfg = load_config()
    return cfg, db.connect(cfg.db_path)


@app.command()
def fetch() -> None:
    """Download new or unfinished monthly archives from chess.com."""
    cfg, conn = _setup()
    fetch_archives(cfg, conn, console)


@app.command()
def parse() -> None:
    """Parse changed archives into games and moves."""
    cfg, conn = _setup()
    console.print(f"{parse_all(cfg, conn, console)} games parsed")


@app.command()
def analyze(last: Last = None, reviewed: Reviewed = 0, pass1_only: bool = False, shard: Shard = None) -> None:
    """Run Stockfish pass 1 (and pass 2) on the selected games. Resumable."""
    cfg, conn = _setup()
    games = load_games(conn, shard_ids(select_game_ids(conn, last, reviewed), shard))
    console.print(f"{len(games)} games selected")
    run_analysis(cfg, conn, games, console, deep=not pass1_only)


@app.command()
def update(last: Last = None, reviewed: Reviewed = 0,
           notes: Annotated[bool, typer.Option(help="Also ask for AI notes when they're on in config.toml.")] = True) -> None:
    """Fetch, parse, analyse, fetch explorer stats and export, touching only what's new."""
    from coach.build import fetch_explorer, fetch_puzzles, fetch_trainer, run_build

    cfg, conn = _setup()
    timings: dict[str, float] = {}

    def step(name: str, fn, *args):
        started = time.perf_counter()
        out = fn(*args)
        timings[name] = time.perf_counter() - started
        return out

    step("fetch", fetch_archives, cfg, conn, console)
    step("parse", parse_all, cfg, conn, console)
    games = load_games(conn, select_game_ids(conn, last, reviewed))
    step("analyse", run_analysis, cfg, conn, games, console)
    if cfg.secrets.lichess_token:
        step("explorer", fetch_explorer, cfg, conn, console)
    else:
        console.print("LICHESS_TOKEN not set: skipping explorer stats")
    step("trainer", fetch_trainer, cfg, conn, console)
    step("puzzles", fetch_puzzles, cfg, conn, console)
    if notes and cfg.notes.enabled:
        from coach.build import write_notes

        try:
            kept, dropped = step("notes", write_notes, cfg, conn, console)
            console.print(f"notes: {kept} new, {dropped} kept the template")
        except Exception as e:  # noqa: BLE001 - notes are optional; the export goes ahead with the templates
            console.print(f"notes skipped: {type(e).__name__}: {e}")
    result = step("build", run_build, cfg, conn, console)
    print_acceptance(cfg, result, timings)


@app.command()
def accuracy(last: Last = 20, reviewed: Reviewed = 0) -> None:
    """Per-game accuracy (Lichess formula on our Stockfish evals) next to chess.com's."""
    from coach.engine import check_engine

    cfg, conn = _setup()
    engine = check_engine(cfg.secrets.stockfish_path, cfg.engine.version)
    evals = db.load_evals(conn, engine, cfg.engine.pass1.key)
    games = load_games(conn, select_game_ids(conn, last, reviewed))

    # Compact enough for an 80-column terminal.
    table = Table(
        title=f"Accuracy, {cfg.engine.version} at {cfg.engine.pass1.nodes:,} nodes",
        box=None, collapse_padding=True, pad_edge=False, header_style="bold underline",
    )
    table.add_column("date")
    table.add_column("me")
    table.add_column("opponent", max_width=16, no_wrap=True, overflow="ellipsis")
    for col in ("elo", "res", "plies", "mine", "c.com", "diff", "opp", "opp c.com"):
        table.add_column(col, justify="left" if col == "res" else "right")
    diffs, opp_diffs = [], []
    for g in games:
        acc = accuracy_of(g, evals)
        r = g.row
        when = datetime.fromtimestamp(r["start_ts"], UTC).strftime("%m-%d")
        opp_color = "black" if g.i_am_white else "white"
        ours = acc[r["my_color"]] if acc else None
        theirs = acc[opp_color] if acc else None
        cc, cc_opp = r[f"cc_acc_{r['my_color']}"], r[f"cc_acc_{opp_color}"]
        diff = ours - cc if ours is not None and cc is not None else None
        if diff is not None:
            diffs.append(diff)
            opp_diffs.append(theirs - cc_opp)
        table.add_row(
            when, r["my_color"][0].upper(), r["opp_username"], str(r["opp_rating"]), r["result"], str(r["ply_count"]),
            _fmt(ours) if acc else "—", _fmt(cc), "—" if diff is None else f"{diff:+.1f}",
            _fmt(theirs), _fmt(cc_opp),
        )
    console.print(table)
    if diffs:
        mad = sum(abs(d) for d in diffs) / len(diffs)
        console.print(
            f"{len(diffs)} games with chess.com accuracies: mine minus chess.com averages {sum(diffs) / len(diffs):+.1f} "
            f"(mean absolute {mad:.1f}); opponent {sum(opp_diffs) / len(opp_diffs):+.1f} "
            f"(mean absolute {sum(abs(d) for d in opp_diffs) / len(opp_diffs):.1f})"
        )


@app.command()
def calibrate(last: Last = 20, reviewed: Reviewed = 0, resample: bool = False) -> None:
    """Engine budget study. The sampled moves are saved on first run and reused when resuming."""
    from coach import calibrate as calib
    from coach.engine import check_engine

    cfg, conn = _setup()
    engine = check_engine(cfg.secrets.stockfish_path, cfg.engine.version)
    games = load_games(conn, select_game_ids(conn, last, reviewed))  # only used when drawing a new sample
    n_games, n1, n2 = full_year_counts(cfg, conn, engine)
    console.print(f"full year: {n_games} games, {n1:,} pass-1 positions, ~{n2:,} pass-2 positions")
    calib.run(cfg, conn, games, console, (n1, n2), resample=resample)


@app.command()
def build() -> None:
    """Build the analysis model and write the JSON export from cached results (never runs the engine)."""
    from coach.build import run_build

    cfg, conn = _setup()
    result = run_build(cfg, conn, console)
    print_acceptance(cfg, result, {"build": result.seconds})


@app.command("explorer")
def explorer_cmd() -> None:
    """Fetch Lichess explorer stats for my opening positions (one request at a time, cached)."""
    from coach.build import fetch_explorer

    cfg, conn = _setup()
    fetch_explorer(cfg, conn, console)


@app.command()
def puzzles(refresh: Annotated[bool, typer.Option(help="Select again even if a subset is cached.")] = False) -> None:
    """Pick the Lichess puzzle subset (streams the puzzle file once) and cache it in data/."""
    from coach.build import fetch_puzzles

    cfg, conn = _setup()
    fetch_puzzles(cfg, conn, console, refresh)


@app.command()
def repertoire(force: Annotated[bool, typer.Option(help="Write the starter PGN again, replacing the current one.")] = False) -> None:
    """Write the starter repertoire PGN from data (runs Stockfish and the explorer on the lines' positions)."""
    from coach import repertoire as rep

    cfg, conn = _setup()
    path = cfg.root / cfg.repertoire.pgn
    if path.exists() and not force:
        console.print(f"{path.name} exists; edit it, or pass --force to generate it again")
        return
    rep.write_starter(cfg, conn, console)


cache_app = typer.Typer(no_args_is_help=True, help="The shared cache on the GitHub release `cache` (src/coach/cache.py).")
app.add_typer(cache_app, name="cache")


@cache_app.command("pull")
def cache_pull() -> None:
    """Merge the shared Stockfish results, explorer responses and notes into the local database."""
    from coach import cache

    cfg, conn = _setup()
    if not cache.pull(cfg, conn, console.print):
        raise typer.Exit(1)


@cache_app.command("push")
def cache_push() -> None:
    """Upload this machine's Stockfish results, explorer responses and notes (merge with `pull` first)."""
    from coach import cache

    cfg, conn = _setup()
    cache.push(cfg, conn, console.print)


@app.command("notes")
def notes_cmd(dry_run: Annotated[bool, typer.Option(help="Print what Claude would be sent for the costliest mistake, without asking.")] = False,
              show: Annotated[bool, typer.Option(help="Print the cached notes.")] = False) -> None:
    """Have Claude reword the explanations of my costliest mistakes (off unless [notes] enabled = true)."""
    from coach import notes
    from coach.build import load_inputs, write_notes

    cfg, conn = _setup()
    if show:
        console.print_json(notes.dump(conn))
        return
    if dry_run:
        _, models, _, _ = load_inputs(cfg, conn)
        picked = notes.costliest(cfg, models)
        console.print(f"{len(picked)} records would be sent. System prompt:\n{notes.SYSTEM}\n")
        if picked:
            console.print(f"First message ({picked[0].id}):\n{notes.facts(picked[0]).text}")
        return
    if not cfg.notes.enabled:
        console.print("notes are off: set enabled = true under [notes] in config.toml")
        raise typer.Exit(1)
    kept, dropped = write_notes(cfg, conn, console)
    console.print(f"{kept} new notes, {dropped} kept the template; run `coach build` to export them")


@app.command()
def review(n: int = 20, type: Annotated[str | None, typer.Option(help="A primary type, sub-type or flag, e.g. fork.")] = None,
           seed: Annotated[int | None, typer.Option(help="Seed for a repeatable sample.")] = None) -> None:
    """Print random mistake records: position, my move, Stockfish's lines with material, type and rule."""
    from coach import review as rv
    from coach.build import load_inputs

    cfg, conn = _setup()
    _, models, _, _ = load_inputs(cfg, conn)
    records = [r for m in models for r in m.records]
    picked = rv.pick(records, n, type, seed)
    if not picked:
        console.print(f"no records{f' tagged {type}' if type else ''} yet ({len(models)} games analysed)")
    for i, r in enumerate(picked, 1):
        rv.show(console, r, i)


@app.command("tagger-check")
def tagger_check(sample: Annotated[int | None, typer.Option(help="Puzzles to read (default from config).")] = None) -> None:
    """Run the sub-type tagger on Lichess puzzles and report agreement with their theme tags."""
    from coach import puzzledb
    from coach.taggercheck import agreement

    cfg, _ = _setup()
    rows = puzzledb.sample(cfg, sample)
    stats, used = agreement(rows)
    table = Table(title=f"Tagger vs Lichess themes ({used:,} of {len(rows):,} puzzles, mates left out)",
                  box=None, collapse_padding=True, pad_edge=False, header_style="bold underline")
    for col in ("theme", "tagged", "found", "recall %", "precision %", "sub-type %"):
        table.add_column(col, justify="left" if col == "theme" else "right")
    for s in stats:
        table.add_row(s.theme, str(s.tagged), str(s.detected), f"{s.recall:.1f}", f"{s.precision:.1f}",
                      f"{s.subtype_agreement:.1f}")
    console.print(table)
    console.print("recall: Lichess-tagged puzzles we tag too; precision: our tags that Lichess agrees with; "
                  "sub-type: puzzles with only that theme where our single sub-type matches.")


def print_acceptance(cfg: Config, result, timings: dict[str, float]) -> None:
    """The Phase 2 summary: why I lost, top leaks, openings, endgames and the runtime."""
    from coach.reports import leaks, top_leaks

    models = result.models
    files = result.built.files
    console.print(f"[bold]{len(models)} of {result.games} games analysed[/] "
                  f"({sum(len(m.records) for m in models)} mistake records); export: {result.written} files written, "
                  f"{result.unchanged} unchanged")
    if result.explorer_missing:
        console.print(f"explorer stats missing for {result.explorer_missing} positions (run `coach explorer`)")

    losses = files["losses.json"]
    causes = sorted(losses.causes.items(), key=lambda kv: -kv[1])
    covered = sum(losses.causes.values())
    table = Table(title=f"Why I lost: {covered} of {losses.total} losses have one cause", box=None,
                  collapse_padding=True, pad_edge=False, header_style="bold underline")
    for col in ("cause", "losses", "%", "last 30 days"):
        table.add_column(col, justify="left" if col == "cause" else "right")
    for cause, count in causes:
        table.add_row(cause, str(count), f"{100 * count / losses.total:.0f}", str(losses.causes_30_days.get(cause, 0)))
    console.print(table)

    table = Table(title="Top leaks (Win% lost)", box=None, collapse_padding=True, pad_edge=False, header_style="bold underline")
    for col in ("leak", "records", "per game", "last 20", "prev 20", "Win% lost"):
        table.add_column(col, justify="left" if col == "leak" else "right")
    for l in top_leaks(cfg, leaks(cfg, models), 6):
        table.add_row(l.tag, str(l.count), f"{l.per_game:.2f}", _fmt2(l.recent), _fmt2(l.previous), f"{l.win_lost:.0f}")
    console.print(table)
    flags = {l.tag: l for l in leaks(cfg, models) if l.kind == "flag"}
    console.print("flags: " + ", ".join(f"{t} {l.count}" for t, l in flags.items()))

    for colour in ("white", "black"):
        report = files[f"openings/{colour}.json"]
        table = Table(title=f"Openings as {colour}: {report.games} games, score {_fmt(report.score)}%", box=None,
                      collapse_padding=True, pad_edge=False, header_style="bold underline")
        for col in ("family", "games", "score", "vs rest", "Win% at 12"):
            table.add_column(col, justify="left" if col == "family" else "right", max_width=28 if col == "family" else None)
        for f in report.families[:5]:
            table.add_row(f.family, str(f.games), _fmt(f.score), _signed(f.score_vs_rest), _fmt(f.win_after_opening))
        console.print(table)
        console.print(f"  leak positions: {len(report.leaks)}, surprises: {len(report.surprises)}")

    ends = files["endgames.json"]
    outcomes = Counter()
    for counts in ends.table.values():
        outcomes.update(counts)
    console.print(f"[bold]Endgames[/]: {ends.games} games; " + ", ".join(f"{k} {v}" for k, v in outcomes.most_common())
                  + "; by type: " + ", ".join(f"{t} {sum(c.values())}" for t, c in sorted(ends.table.items())))
    console.print(f"[bold]Winning games not won[/]: {len(losses.thrown)}")
    console.print("[bold]Runtime[/]: " + ", ".join(f"{k} {v:.1f}s" for k, v in timings.items()))


def _fmt2(value: float | None) -> str:
    return "—" if value is None else f"{value:.2f}"


def _signed(value: float | None) -> str:
    return "—" if value is None else f"{value:+.1f}"


def main() -> None:
    app()
