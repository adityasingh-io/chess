"""The repertoire trainer's lines: a PGN of my repertoire plus the leak lines found in my games.

The starter PGN is generated from data, never written from memory (PLAN.md, reading 11): each named
line from the chess-openings dataset is extended, on my turns by Stockfish's best move (pass-2 settings)
and on the opponent's by the most common reply of players at my level (Lichess explorer), until it has
`plies` moves or the explorer has fewer than `min_games` games there. Once written, the PGN is mine to
edit; the pipeline only reads it. Each game in it is one or more lines (variations become their own
lines), and its `Repertoire` header says which colour I play.

Coverage lines fill the PGN's gaps with what my opponents actually play: every reply of theirs that at
least `cover_min_games` of my games reached is followed until my games stop reaching the position. On my
turn a line plays the PGN's move where it has one; elsewhere my most played move when its stored label is
Excellent or better (`KEEP`), so a good habit stays, and Stockfish's stored best (pass 1) when it isn't.
"""

from __future__ import annotations

import csv
import hashlib
import sqlite3
from collections import defaultdict
from pathlib import Path

import chess
import chess.pgn
from rich.console import Console

from coach import db, explorer
from coach.analysis import needs_engine
from coach.config import Config
from coach.engine import analyse_positions, check_engine
from coach.model import GameModel
from coach.openings import load_openings, openings_dir
from coach.positions import position_key
from coach.reports import Node, leak_positions, score, tree

SIDES = {"white": chess.WHITE, "black": chess.BLACK}
KEEP = ("book", "best", "excellent")   # labels of my usual move that a coverage line keeps


def named_line(root: Path, name: str) -> list[str] | None:
    """The first (shortest) line with exactly this name in the chess-openings dataset, as UCI."""
    for path in sorted(openings_dir(root).glob("*.tsv")):
        with path.open(newline="") as f:
            for row in csv.DictReader(f, delimiter="\t"):
                if row["name"] == name:
                    board = chess.Board()
                    for token in row["pgn"].split():
                        if not token.rstrip(".").isdigit():
                            board.push_san(token)
                    return [m.uci() for m in board.move_stack]
    return None


def extend(cfg: Config, conn: sqlite3.Connection, lines: list[tuple[str, str, list[str]]], console: Console) -> None:
    """Grow every line one ply at a time, in place, analysing and fetching only the positions needed."""
    engine = check_engine(cfg.secrets.stockfish_path, cfg.engine.version)
    settings = cfg.engine.pass2
    active = list(range(len(lines)))
    while active:
        boards = {}
        for i in active:
            board = chess.Board()
            for uci in lines[i][2]:
                board.push_uci(uci)
            boards[i] = board
        mine = [i for i in active if boards[i].turn == SIDES[lines[i][0]]]
        theirs = [i for i in active if i not in mine]
        keys = [position_key(boards[i]) for i in mine if needs_engine(position_key(boards[i]))]
        if keys:
            analyse_positions(conn, keys, settings, engine_path=cfg.secrets.stockfish_path, engine=engine,
                              workers=cfg.engine.workers, console=console, label="repertoire")
        evals = db.load_evals(conn, engine, settings.key, set(keys))
        if theirs:
            explorer.fetch(cfg, conn, [position_key(boards[i]) for i in theirs], console)
        stats = explorer.load(conn, cfg)
        still = []
        for i in active:
            colour, _, moves = lines[i]
            board, key = boards[i], position_key(boards[i])
            if board.is_game_over() or len(moves) >= cfg.repertoire.plies:
                continue
            if i in mine:
                result = evals.get(key)
                pv = result["lines"][0]["pv"] if result and result.get("lines") else []
                move = pv[0] if pv else None
            else:
                s = stats.get(key) or {}
                total = (s.get("white") or 0) + (s.get("draws") or 0) + (s.get("black") or 0)
                top = (s.get("moves") or [None])[0]
                move = top["uci"] if top and total >= cfg.repertoire.min_games else None
            if move is None:
                continue
            moves.append(move)
            still.append(i)
        active = still


def write_starter(cfg: Config, conn: sqlite3.Connection, console: Console) -> Path:
    path = cfg.root / cfg.repertoire.pgn
    lines: list[tuple[str, str, list[str]]] = []
    for colour in ("white", "black"):
        for name in getattr(cfg.repertoire, colour):
            start = named_line(cfg.root, name)
            if start is None:
                console.print(f"repertoire: no line named {name!r} in chess-openings, skipped")
                continue
            lines.append((colour, name, start))
    extend(cfg, conn, lines, console)
    games = []
    for colour, name, moves in lines:
        game = chess.pgn.Game()
        game.headers["Event"] = f"Starter repertoire: {name}"
        game.headers["Repertoire"] = colour
        game.headers["Opening"] = name
        game.headers["Annotator"] = (f"chess-openings line, extended by {cfg.engine.version} on my moves and the "
                                     "most common reply at my level (Lichess explorer) on theirs")
        node = game
        for uci in moves:
            node = node.add_variation(chess.Move.from_uci(uci))
        games.append(str(game))
    path.write_text("\n\n".join(games) + "\n")
    console.print(f"repertoire: wrote {len(lines)} lines to {path.name}")
    return path


def read_pgn(path: Path) -> list[tuple[str, str, list[str]]]:
    """(colour, name, UCI moves) for every line in the PGN, variations included."""
    out = []
    if not path.exists():
        return out
    with path.open() as f:
        while (game := chess.pgn.read_game(f)) is not None:
            colour = game.headers.get("Repertoire", "white").lower()
            name = game.headers.get("Opening") or game.headers.get("Event", "Repertoire line")

            def walk(node: chess.pgn.GameNode, moves: list[str]) -> None:
                if not node.variations:
                    if moves:
                        out.append((colour, name, moves))
                    return
                for child in node.variations:
                    walk(child, [*moves, child.move.uci()])

            walk(game, [])
    return out


def line_id(colour: str, moves: list[str]) -> str:
    return hashlib.sha256(f"{colour}:{' '.join(moves)}".encode()).hexdigest()[:12]


def path_to(node: Node, models: list[GameModel]) -> list[str] | None:
    """The moves of a game of mine that reached the node, up to that position."""
    by_id = {m.id: m for m in models}
    for gid in node.games:
        m = by_id.get(gid)
        if not m:
            continue
        for p in m.plies:
            if p.move["key_before"] == node.key:
                return [q.move["uci"] for q in m.plies[: p.number - 1]]
    return None


def leak_lines(cfg: Config, models: list[GameModel], evals1: dict[str, dict]) -> list[tuple[str, str, list[str], int]]:
    """(colour, name, moves, start) for each opening leak position: the moves to it, then Stockfish's best."""
    out = []
    names = load_openings(openings_dir(cfg.root), cfg.data_dir)
    for colour in ("white", "black"):
        mine = [m for m in models if m.row["my_color"] == colour and m.plies]
        nodes = tree(cfg, models, colour, evals1)
        for n, _, _ in leak_positions(cfg, nodes, score(mine)):
            usual = max(n.moves, key=lambda u: len(n.moves[u]))
            moves = path_to(n, models)
            if moves is None or not n.best or usual == n.best:
                continue  # nothing to drill where my usual move is already Stockfish's best
            board, opening = chess.Board(), None
            for uci in moves:
                board.push_uci(uci)
                opening = names.get(position_key(board), opening)
            # Named by the deepest named opening on the way, not by the moves (the drill shows those).
            name = f"{opening.name if opening else 'Leak'}, move {board.fullmove_number}"
            out.append((colour, name, [*moves, n.best], len(moves)))
    return out


def taught(lines: list[tuple[str, str, list[str]]], colour: str) -> dict[str, set[str]]:
    """Position key -> the PGN's moves there, for the lines I play as `colour`."""
    out: dict[str, set[str]] = defaultdict(set)
    for c, _, moves in lines:
        if c != colour:
            continue
        board = chess.Board()
        for uci in moves:
            out[position_key(board)].add(uci)
            board.push_uci(uci)
    return out


def coverage_lines(cfg: Config, models: list[GameModel], evals1: dict[str, dict],
                   pgn: list[tuple[str, str, list[str]]]) -> list[tuple[str, str, list[str], int]]:
    """(colour, name, moves, start) for each way my opponents take my games out of the PGN often enough.

    `start` is the first of my moves the PGN doesn't have; the moves before it are played for me."""
    n = cfg.repertoire.cover_min_games
    names = load_openings(openings_dir(cfg.root), cfg.data_dir)
    out = []
    for colour in ("white", "black"):
        me, nodes, book = SIDES[colour], tree(cfg, models, colour, evals1), taught(pgn, colour)

        def emit(moves: list[str], start: int | None) -> None:
            if start is None:
                return  # all of it is in the PGN already
            board, opening, theirs = chess.Board(), None, ""
            for uci in moves:
                if board.turn != me:  # named after their last move: lines branch on their replies
                    number = f"{board.fullmove_number}. " if board.turn == chess.WHITE else f"{board.fullmove_number}…"
                    theirs = number + board.san(chess.Move.from_uci(uci))
                board.push_uci(uci)
                opening = names.get(position_key(board), opening)
            out.append((colour, f"{opening.name if opening else 'Your games'}, after {theirs}", moves, start))

        def walk(board: chess.Board, moves: list[str], start: int | None, seen: frozenset[str]) -> None:
            key = position_key(board)
            node = nodes.get(key)
            if node is None or key in seen:
                if board.turn != me:
                    emit(moves, start)  # a line ends on my move
                return
            seen = seen | {key}
            if board.turn == me:
                if key in book:
                    ucis, first = sorted(book[key]), start
                else:
                    move = usual_move(node)
                    move = move if move and node.moves[move][0].label in KEEP else node.best
                    ucis, first = [move] if move else [], len(moves) if start is None else start
                for uci in ucis:
                    walk(_pushed(board, uci), [*moves, uci], first, seen)
                return
            replies = sorted(u for u, ps in node.moves.items() if len({p.move["game_id"] for p in ps}) >= n)
            if not replies:
                emit(moves, start)
            for uci in replies:
                walk(_pushed(board, uci), [*moves, uci], start, seen)

        walk(chess.Board(), [], None, frozenset())
    return out


def usual_move(node: Node) -> str | None:
    """The move I played here in the most games (ties: the first in UCI order)."""
    games = {u: len({p.move["game_id"] for p in ps}) for u, ps in node.moves.items()}
    return min(games, key=lambda u: (-games[u], u)) if games else None


def _pushed(board: chess.Board, uci: str) -> chess.Board:
    after = board.copy(stack=False)
    after.push_uci(uci)
    return after


def pgn_text(moves: list[str]) -> str:
    board = chess.Board()
    return board.variation_san([chess.Move.from_uci(u) for u in moves]) if moves else ""

