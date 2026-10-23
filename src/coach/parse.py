"""Parse raw chess.com archives into games and moves (rules-level facts only)."""

from __future__ import annotations

import hashlib
import io
import json
import sqlite3
from dataclasses import dataclass, field
from datetime import UTC, datetime

import chess
import chess.pgn
from rich.console import Console

from coach.config import Config
from coach.positions import position_key

DRAW_CODES = {"agreed", "repetition", "stalemate", "insufficient", "50move", "timevsinsufficient"}


def parse_time_control(tc: str) -> tuple[int, int] | None:
    """'600' -> (600, 0), '600+5' -> (600, 5). Daily controls ('1/86400') -> None."""
    if "/" in tc:
        return None
    base, _, inc = tc.partition("+")
    return int(base), int(inc or 0)


def result_of(code: str) -> str:
    if code == "win":
        return "win"
    return "draw" if code in DRAW_CODES else "loss"


def think_times(clocks: list[float | None], base: int, increment: int, white_first: bool = True) -> list[float | None]:
    """Seconds spent on each ply: the mover's previous clock minus this clock plus the increment.

    clocks[i] is the mover's remaining time after ply i. Each side's first move counts
    from the starting time.
    """
    previous = {True: float(base), False: float(base)}
    times: list[float | None] = []
    for i, clock in enumerate(clocks):
        white = (i % 2 == 0) == white_first
        before = previous[white]
        if clock is None or before is None:
            times.append(None)
            previous[white] = clock
            continue
        times.append(max(0.0, round(before - clock + increment, 3)))
        previous[white] = clock
    return times


@dataclass
class ParsedMove:
    ply: int
    side: str
    san: str
    uci: str
    fen_before: str
    fen_after: str
    key_before: str
    key_after: str
    clock: float | None
    think_time: float | None = None


@dataclass
class ParsedGame:
    id: str
    url: str
    month: str
    start_ts: int
    end_ts: int
    time_class: str
    time_control: str
    base_seconds: int
    increment: int
    rated: bool
    my_color: str
    my_rating: int | None
    opp_username: str
    opp_rating: int | None
    my_code: str
    opp_code: str
    result: str
    termination: str | None
    eco: str | None
    eco_url: str | None
    initial_fen: str
    cc_acc_white: float | None
    cc_acc_black: float | None
    pgn: str
    moves: list[ParsedMove] = field(default_factory=list)


def _start_ts(headers: chess.pgn.Headers, fallback: int) -> int:
    date, time_ = headers.get("UTCDate"), headers.get("UTCTime")
    if not date or not time_:
        return fallback
    return int(datetime.strptime(f"{date} {time_}", "%Y.%m.%d %H:%M:%S").replace(tzinfo=UTC).timestamp())


def parse_game(raw: dict, username: str, month: str) -> ParsedGame | None:
    """None for games that aren't standard chess or that don't involve the player."""
    if raw.get("rules") != "chess" or not raw.get("pgn"):
        return None
    white, black = raw["white"], raw["black"]
    name = username.lower()
    if white["username"].lower() == name:
        my_color, me, opp = "white", white, black
    elif black["username"].lower() == name:
        my_color, me, opp = "black", black, white
    else:
        return None
    tc = parse_time_control(raw["time_control"])
    if tc is None:
        return None

    pgn_game = chess.pgn.read_game(io.StringIO(raw["pgn"]))
    if pgn_game is None:
        return None
    headers = pgn_game.headers
    board = pgn_game.board()
    initial_fen = board.fen()
    white_first = board.turn == chess.WHITE

    moves: list[ParsedMove] = []
    for ply, node in enumerate(pgn_game.mainline(), start=1):
        move = node.move
        side = "white" if board.turn == chess.WHITE else "black"
        fen_before, key_before = board.fen(), position_key(board)
        san = board.san(move)
        board.push(move)
        moves.append(
            ParsedMove(
                ply=ply,
                side=side,
                san=san,
                uci=move.uci(),
                fen_before=fen_before,
                fen_after=board.fen(),
                key_before=key_before,
                key_after=position_key(board),
                clock=node.clock(),
            )
        )
    for move, spent in zip(moves, think_times([m.clock for m in moves], *tc, white_first=white_first)):
        move.think_time = spent

    accuracies = raw.get("accuracies") or {}
    end_ts = int(raw["end_time"])
    return ParsedGame(
        id=raw["url"].rstrip("/").split("/")[-1],
        url=raw["url"],
        month=month,
        start_ts=_start_ts(headers, end_ts),
        end_ts=end_ts,
        time_class=raw["time_class"],
        time_control=raw["time_control"],
        base_seconds=tc[0],
        increment=tc[1],
        rated=bool(raw.get("rated")),
        my_color=my_color,
        my_rating=me.get("rating"),
        opp_username=opp["username"],
        opp_rating=opp.get("rating"),
        my_code=me["result"],
        opp_code=opp["result"],
        result=result_of(me["result"]),
        termination=headers.get("Termination"),
        eco=headers.get("ECO"),
        eco_url=headers.get("ECOUrl") or raw.get("eco"),
        initial_fen=initial_fen,
        cc_acc_white=accuracies.get("white"),
        cc_acc_black=accuracies.get("black"),
        pgn=raw["pgn"],
        moves=moves,
    )


def store_game(conn: sqlite3.Connection, game: ParsedGame) -> None:
    conn.execute("DELETE FROM games WHERE id = ?", (game.id,))
    conn.execute(
        """INSERT INTO games (id, url, month, start_ts, end_ts, time_class, time_control, base_seconds,
           increment, rated, my_color, my_rating, opp_username, opp_rating, my_code, opp_code, result,
           termination, eco, eco_url, initial_fen, ply_count, cc_acc_white, cc_acc_black, pgn)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (
            game.id, game.url, game.month, game.start_ts, game.end_ts, game.time_class, game.time_control,
            game.base_seconds, game.increment, int(game.rated), game.my_color, game.my_rating,
            game.opp_username, game.opp_rating, game.my_code, game.opp_code, game.result, game.termination,
            game.eco, game.eco_url, game.initial_fen, len(game.moves), game.cc_acc_white, game.cc_acc_black,
            game.pgn,
        ),
    )
    conn.executemany(
        """INSERT INTO moves (game_id, ply, side, is_mine, san, uci, fen_before, fen_after, key_before,
           key_after, clock, think_time) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        [
            (
                game.id, m.ply, m.side, int(m.side == game.my_color), m.san, m.uci, m.fen_before,
                m.fen_after, m.key_before, m.key_after, m.clock, m.think_time,
            )
            for m in game.moves
        ],
    )


def parse_all(cfg: Config, conn: sqlite3.Connection, console: Console) -> int:
    """Parse every archive whose raw file changed since it was last parsed."""
    since_ts = int(datetime.combine(cfg.player.since, datetime.min.time(), tzinfo=UTC).timestamp())
    stored = 0
    for row in conn.execute("SELECT month, sha256, parsed_sha FROM archives ORDER BY month").fetchall():
        if row["sha256"] == row["parsed_sha"]:
            continue
        body = (cfg.raw_dir / f"{row['month']}.json").read_text()
        if hashlib.sha256(body.encode()).hexdigest() != row["sha256"]:
            raise SystemExit(f"raw archive {row['month']} changed on disk; run `coach fetch` again")
        count = 0
        for raw in json.loads(body).get("games", []):
            if raw.get("time_class") not in cfg.player.time_classes:
                continue
            game = parse_game(raw, cfg.player.username, row["month"])
            if game is None or game.start_ts < since_ts:
                continue
            store_game(conn, game)
            count += 1
        conn.execute("UPDATE archives SET parsed_sha = ? WHERE month = ?", (row["sha256"], row["month"]))
        conn.commit()
        console.print(f"parsed {row['month']}: {count} games")
        stored += count
    return stored
