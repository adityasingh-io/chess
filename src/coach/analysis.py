"""Which positions get which pass, and per-game Win% and accuracy from the stored evals.

Nothing here judges a move: every number is read off Stockfish's output, and the only board
facts used (check, capture, game over) are rules-level measurements from python-chess.
"""

from __future__ import annotations

import sqlite3
import zlib
from dataclasses import dataclass

import chess
from rich.console import Console

from coach import db
from coach.config import Config
from coach.engine import analyse_positions
from coach.positions import board_from_key, position_key, terminal_outcome
from coach.winpct import for_side, game_accuracy, line_win_pct, position_win_pct


@dataclass
class Game:
    row: sqlite3.Row
    moves: list[sqlite3.Row]

    @property
    def id(self) -> str:
        return self.row["id"]

    @property
    def i_am_white(self) -> bool:
        return self.row["my_color"] == "white"

    def position_keys(self) -> list[str]:
        """The initial position, then the position after each ply."""
        if not self.moves:
            return []
        return [self.moves[0]["key_before"], *(m["key_after"] for m in self.moves)]


def select_game_ids(conn: sqlite3.Connection, last: int | None = None, reviewed: int = 0) -> list[str]:
    """The `last` most recent games (all if None), plus the `reviewed` most recent with chess.com accuracies."""
    ids: list[str] = []
    query = "SELECT id FROM games ORDER BY start_ts DESC" + (" LIMIT ?" if last is not None else "")
    ids += [r["id"] for r in conn.execute(query, (last,) if last is not None else ())]
    if reviewed:
        rows = conn.execute(
            "SELECT id FROM games WHERE cc_acc_white IS NOT NULL ORDER BY start_ts DESC LIMIT ?", (reviewed,)
        )
        ids += [r["id"] for r in rows]
    return list(dict.fromkeys(ids))


def shard_ids(ids: list[str], shard: str | None) -> list[str]:
    """The share "i/n" (1-based) of `ids`, split by a stable hash of the game id so shares stay even."""
    if shard is None:
        return ids
    index, count = (int(part) for part in shard.split("/"))
    if not 1 <= index <= count:
        raise SystemExit(f"--shard {shard}: expected i/n with 1 ≤ i ≤ n")
    return [game_id for game_id in ids if zlib.crc32(game_id.encode()) % count == index - 1]


def load_games(conn: sqlite3.Connection, ids: list[str]) -> list[Game]:
    games = []
    for game_id in ids:
        row = conn.execute("SELECT * FROM games WHERE id = ?", (game_id,)).fetchone()
        moves = conn.execute("SELECT * FROM moves WHERE game_id = ? ORDER BY ply", (game_id,)).fetchall()
        games.append(Game(row, moves))
    return sorted(games, key=lambda g: g.row["start_ts"])


def evaluation(key: str, evals: dict[str, dict]) -> dict | None:
    """Stockfish's result for a position, or the rules outcome if the game is over there.

    Game-over positions never go to the engine, so a cached result means the game isn't over.
    """
    if key in evals:
        return evals[key]
    outcome = terminal_outcome(board_from_key(key))
    return {"terminal": outcome} if outcome is not None else None


def needs_engine(key: str) -> bool:
    return terminal_outcome(board_from_key(key)) is None


def gap(result: dict | None, white: bool) -> float | None:
    """Best minus second-best Win% for the side to move; None with fewer than two lines."""
    if not result or "lines" not in result or len(result["lines"]) < 2:
        return None
    first, second = result["lines"][:2]
    return for_side(line_win_pct(first), white) - for_side(line_win_pct(second), white)


@dataclass
class MyMove:
    game: Game
    move: sqlite3.Row
    win_before: float
    win_after: float

    @property
    def drop(self) -> float:
        return self.win_before - self.win_after


def is_garbage_time(cfg: Config, before: float, after: float) -> bool:
    g = cfg.garbage_time
    return before < g.below or (before > g.above and after > g.still_above)


def my_moves(game: Game, evals: dict[str, dict]) -> list[MyMove]:
    """My moves with my Win% before and after, wherever both positions have results."""
    out = []
    for move in game.moves:
        if not move["is_mine"]:
            continue
        before = evaluation(move["key_before"], evals)
        after = evaluation(move["key_after"], evals)
        if before is None or after is None:
            continue
        out.append(
            MyMove(
                game=game,
                move=move,
                win_before=for_side(position_win_pct(before), game.i_am_white),
                win_after=for_side(position_win_pct(after), game.i_am_white),
            )
        )
    return out


def pass2_initial_keys(cfg: Config, games: list[Game], evals1: dict[str, dict]) -> list[str]:
    """Before and after each of my Win%-dropping moves, and my-turn positions with one clear best move."""
    t = cfg.engine.triggers
    keys: list[str] = []
    for game in games:
        for mm in my_moves(game, evals1):
            if is_garbage_time(cfg, mm.win_before, mm.win_after):
                continue
            if mm.drop >= t.min_drop:
                keys += [mm.move["key_before"], mm.move["key_after"]]
            elif (g := gap(evals1.get(mm.move["key_before"]), game.i_am_white)) is not None and g >= t.min_gap:
                keys.append(mm.move["key_before"])
    return [k for k in dict.fromkeys(keys) if needs_engine(k)]


def line_candidates(cfg: Config, games: list[Game], evals1: dict[str, dict], evals2: dict[str, dict]) -> list[tuple[str, bool]]:
    """(position key, I am White) for my Win%-dropping moves whose best line we follow further."""
    t = cfg.engine.triggers
    out = []
    for game in games:
        for mm in my_moves(game, evals1):
            if mm.drop < t.min_drop or is_garbage_time(cfg, mm.win_before, mm.win_after):
                continue
            key = mm.move["key_before"]
            g = gap(evals2.get(key), game.i_am_white)
            if (g is not None and g >= t.min_gap) or mm.drop >= t.follow_min_drop:
                out.append((key, game.i_am_white))
    return out


def next_line_position(key: str, result: dict, white: bool, min_gap: float) -> str | None:
    """Two plies down Stockfish's best line, if my move there is findable (clear best, check or capture)."""
    pv = result["lines"][0]["pv"]
    if len(pv) < 2:
        return None
    board = board_from_key(key)
    mine = chess.Move.from_uci(pv[0])
    g = gap(result, white)
    if not ((g is not None and g >= min_gap) or board.gives_check(mine) or board.is_capture(mine)):
        return None
    board.push(mine)
    board.push(chess.Move.from_uci(pv[1]))
    return None if board.is_game_over() else position_key(board)


def run_analysis(cfg: Config, conn: sqlite3.Connection, games: list[Game], console: Console, *, deep: bool = True) -> dict:
    """Pass 1 on every position, then pass 2 on candidates and along their lines."""
    from coach.engine import check_engine

    engine = check_engine(cfg.secrets.stockfish_path, cfg.engine.version)
    common = dict(engine_path=cfg.secrets.stockfish_path, engine=engine, workers=cfg.engine.workers, console=console)

    keys1 = [k for g in games for k in g.position_keys() if needs_engine(k)]
    stats = {"pass1": analyse_positions(conn, keys1, cfg.engine.pass1, label="pass 1", **common)}
    if not deep:
        return stats
    evals1 = db.load_evals(conn, engine, cfg.engine.pass1.key, set(keys1))

    keys2 = pass2_initial_keys(cfg, games, evals1)
    stats["pass2"] = [analyse_positions(conn, keys2, cfg.engine.pass2, label="pass 2", **common)]
    evals2 = db.load_evals(conn, engine, cfg.engine.pass2.key)

    frontier = line_candidates(cfg, games, evals1, evals2)
    for level in range(1, cfg.engine.triggers.line_my_moves):
        frontier = advance_lines(frontier, evals2, cfg.engine.triggers.min_gap)
        if not frontier:
            break
        stats["pass2"].append(
            analyse_positions(conn, [k for k, _ in frontier], cfg.engine.pass2, label=f"pass 2 lines ({level})", **common)
        )
        evals2 = db.load_evals(conn, engine, cfg.engine.pass2.key)
    return stats


def advance_lines(frontier: list[tuple[str, bool]], evals2: dict[str, dict], min_gap: float) -> list[tuple[str, bool]]:
    """Each line position two plies further on, where its pass-2 result says the line continues."""
    out = []
    for key, white in frontier:
        result = evals2.get(key)
        if result and (pos := next_line_position(key, result, white, min_gap)):
            out.append((pos, white))
    return out


def planned_pass2_keys(cfg: Config, games: list[Game], evals1: dict[str, dict], evals2: dict[str, dict]) -> set[str]:
    """The pass-2 positions run_analysis asks for, worked out from cached results only."""
    keys = set(pass2_initial_keys(cfg, games, evals1))
    frontier = line_candidates(cfg, games, evals1, evals2)
    for _ in range(1, cfg.engine.triggers.line_my_moves):
        frontier = advance_lines(frontier, evals2, cfg.engine.triggers.min_gap)
        keys |= {k for k, _ in frontier}
    return keys


def full_year_counts(cfg: Config, conn: sqlite3.Connection, engine: str) -> tuple[int, int, int]:
    """(games, pass-1 positions, estimated pass-2 positions) for every parsed game.

    The pass-2 share is measured on the games already fully analysed in pass 1.
    """
    games = load_games(conn, select_game_ids(conn))
    evals1 = db.load_evals(conn, engine, cfg.engine.pass1.key)
    evals2 = db.load_evals(conn, engine, cfg.engine.pass2.key)
    n1 = len({k for g in games for k in g.position_keys() if needs_engine(k)})
    analysed = [g for g in games if white_win_pcts(g, evals1) is not None]
    n1_done = len({k for g in analysed for k in g.position_keys() if needs_engine(k)})
    n2_done = len(planned_pass2_keys(cfg, analysed, evals1, evals2))
    return len(games), n1, round(n1 * n2_done / n1_done) if n1_done else 0


def white_win_pcts(game: Game, evals: dict[str, dict]) -> list[float] | None:
    results = [evaluation(key, evals) for key in game.position_keys()]
    if not results or any(r is None for r in results):
        return None
    return [position_win_pct(r) for r in results]


def accuracy_of(game: Game, evals: dict[str, dict]) -> dict[str, float | None] | None:
    wps = white_win_pcts(game, evals)
    if wps is None:
        return None
    white_first = game.moves[0]["side"] == "white"
    return game_accuracy(wps, white_moves_first=white_first)
