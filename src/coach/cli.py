"""`uv run coach …` commands."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated

import typer
from rich.console import Console
from rich.table import Table

from coach import db
from coach.analysis import accuracy_of, load_games, needs_engine, run_analysis, select_game_ids
from coach.chesscom import fetch as fetch_archives
from coach.config import Config, load_config
from coach.parse import parse_all

app = typer.Typer(no_args_is_help=True, add_completion=False, help="Personal chess coach pipeline.")
console = Console()

Last = Annotated[int | None, typer.Option(help="Only the N most recent games (default: all).")]
Reviewed = Annotated[int, typer.Option(help="Also the N most recent games chess.com reviewed.")]


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
def analyze(last: Last = None, reviewed: Reviewed = 0, pass1_only: bool = False) -> None:
    """Run Stockfish pass 1 (and pass 2) on the selected games. Resumable."""
    cfg, conn = _setup()
    games = load_games(conn, select_game_ids(conn, last, reviewed))
    console.print(f"{len(games)} games selected")
    run_analysis(cfg, conn, games, console, deep=not pass1_only)


@app.command()
def update(last: Last = None, reviewed: Reviewed = 0) -> None:
    """Fetch, parse and analyse, touching only what's new."""
    cfg, conn = _setup()
    fetch_archives(cfg, conn, console)
    parse_all(cfg, conn, console)
    games = load_games(conn, select_game_ids(conn, last, reviewed))
    run_analysis(cfg, conn, games, console)


@app.command()
def accuracy(last: Last = 20, reviewed: Reviewed = 0) -> None:
    """Per-game accuracy (Lichess formula on our Stockfish evals) next to chess.com's."""
    from coach.engine import check_engine

    cfg, conn = _setup()
    engine = check_engine(cfg.secrets.stockfish_path, cfg.engine.version)
    evals = db.load_evals(conn, engine, cfg.engine.pass1.key)
    games = load_games(conn, select_game_ids(conn, last, reviewed))

    table = Table(title=f"Accuracy, {cfg.engine.version} at {cfg.engine.pass1.nodes:,} nodes")
    for col in ("date", "me", "opponent", "result", "plies", "mine", "chess.com", "diff", "opp", "opp chess.com"):
        table.add_column(col, justify="right" if col not in ("date", "me", "opponent", "result") else "left")
    diffs, opp_diffs = [], []
    for g in games:
        acc = accuracy_of(g, evals)
        r = g.row
        when = datetime.fromtimestamp(r["start_ts"], UTC).strftime("%Y-%m-%d")
        opp_color = "black" if g.i_am_white else "white"
        ours = acc[r["my_color"]] if acc else None
        theirs = acc[opp_color] if acc else None
        cc, cc_opp = r[f"cc_acc_{r['my_color']}"], r[f"cc_acc_{opp_color}"]
        diff = ours - cc if ours is not None and cc is not None else None
        if diff is not None:
            diffs.append(diff)
            opp_diffs.append(theirs - cc_opp)
        table.add_row(
            when, r["my_color"], f"{r['opp_username']} ({r['opp_rating']})", r["result"], str(r["ply_count"]),
            _fmt(ours) if acc else "not analysed", _fmt(cc), "—" if diff is None else f"{diff:+.1f}",
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
def calibrate(last: Last = 20, reviewed: Reviewed = 0) -> None:
    """Engine budget study on positions from the selected (already analysed) games."""
    from coach import calibrate as calib
    from coach.engine import check_engine

    cfg, conn = _setup()
    engine = check_engine(cfg.secrets.stockfish_path, cfg.engine.version)
    games = load_games(conn, select_game_ids(conn, last, reviewed))
    all_games = load_games(conn, select_game_ids(conn))
    n1_all = len({k for g in all_games for k in g.position_keys() if needs_engine(k)})
    n1_sel = len({k for g in games for k in g.position_keys() if needs_engine(k)})
    n2_sel = len(db.cached_keys(conn, engine, cfg.engine.pass2.key))
    n2_all = round(n1_all * n2_sel / n1_sel) if n1_sel else 0
    console.print(f"full year: {len(all_games)} games, {n1_all:,} pass-1 positions, ~{n2_all:,} pass-2 positions")
    calib.run(cfg, conn, games, console, (n1_all, n2_all))


def main() -> None:
    app()
