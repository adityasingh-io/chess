"""The trainer's lines, with a reason for every move and a stored score for every move I could play instead.

Where a drill asks for my move, every legal move there is scored with pass-1 settings on the position after
it, the same way each move of my games is scored, so a slip in the trainer gets the score it would get in a
game. How often players at my level, and masters, choose a move comes from the Lichess explorer. The words
are measured on the board (why.py). `analyse` fetches what's missing; `repertoire_out` only reads the caches.
"""

from __future__ import annotations

import sqlite3

import chess
from rich.console import Console

from coach import explorer, schema as S
from coach.analysis import evaluation, needs_engine
from coach.config import Config
from coach.engine import analyse_positions, check_engine
from coach.model import GameModel
from coach.openings import load_openings, openings_dir
from coach.positions import position_key
from coach.repertoire import SIDES, coverage_lines, leak_lines, line_id, read_pgn
from coach.why import move_sentence, played_why
from coach.winpct import for_side, position_win_pct

# colour, name, source, UCI moves, plies played for me before the drill asks
Line = tuple[str, str, str, list[str], int]
SLIPS_SHOWN = 5   # a line lists the latest games where I left it


def all_lines(cfg: Config, models: list[GameModel], evals1: dict[str, dict]) -> list[Line]:
    """The repertoire PGN's lines, then coverage lines for my opponents' replies, then the leak lines from my
    games, each once."""
    pgn = read_pgn(cfg.root / cfg.repertoire.pgn)
    lines: list[Line] = [(c, n, "repertoire", m, 0) for c, n, m in pgn]
    lines += [(c, n, "coverage", m, s) for c, n, m, s in coverage_lines(cfg, models, evals1, pgn)]
    lines += [(c, n, "leak", m, s) for c, n, m, s in leak_lines(cfg, models, evals1)]
    out, seen = [], set()
    for line in lines:
        lid = line_id(line[0], line[3])
        if lid not in seen:
            seen.add(lid)
            out.append(line)
    return out


def _asks(board: chess.Board, colour: str, ply: int, start: int) -> bool:
    return ply >= start and board.turn == SIDES[colour]


def wanted(lines: list[Line]) -> tuple[set[str], set[str]]:
    """Positions to score (after every legal move where a drill asks, after every line move otherwise)
    and positions to look up in the explorer (before every line move)."""
    engine, stats = set(), set()
    for colour, _, _, moves, start in lines:
        board = chess.Board()
        for i, uci in enumerate(moves):
            stats.add(position_key(board))
            for move in list(board.legal_moves) if _asks(board, colour, i, start) else [chess.Move.from_uci(uci)]:
                board.push(move)
                engine.add(position_key(board))
                board.pop()
            board.push_uci(uci)
    return {k for k in engine if needs_engine(k)}, stats


def analyse(cfg: Config, conn: sqlite3.Connection, lines: list[Line], console: Console) -> None:
    keys, stats = wanted(lines)
    engine = check_engine(cfg.secrets.stockfish_path, cfg.engine.version)
    analyse_positions(conn, sorted(keys), cfg.engine.pass1, engine_path=cfg.secrets.stockfish_path, engine=engine,
                      workers=cfg.engine.workers, console=console, label="trainer")
    if cfg.secrets.lichess_token:
        explorer.fetch(cfg, conn, stats, console)
        explorer.fetch(cfg, conn, stats, console, database="masters")
    else:
        console.print("LICHESS_TOKEN not set: skipping explorer stats for the trainer")


def _scored(board: chess.Board, move: chess.Move, me: chess.Color, evals1: dict[str, dict]) -> tuple:
    """Stockfish's top line after the move (or None), the game-over result, and my Win% after it."""
    board.push(move)
    key = position_key(board)
    board.pop()
    result = evaluation(key, evals1)
    if result is None:
        return None, None, None
    top = result["lines"][0] if result.get("lines") else None
    return top, result.get("terminal"), for_side(position_win_pct(result), me == chess.WHITE)


def _eval(top: dict | None) -> S.Eval | None:
    return S.Eval(cp=top.get("cp"), mate=top.get("mate")) if top else None


def alternatives(cfg: Config, board: chess.Board, me: chess.Color, evals1: dict[str, dict]) -> list[S.Alternative]:
    """Every legal move with its stored score and what happens along Stockfish's line after it, best first."""
    out = []
    for move in board.legal_moves:
        top, terminal, win = _scored(board, move, me, evals1)
        reply = top["pv"][: cfg.engine.pv_plies] if top else []
        out.append(S.Alternative(uci=move.uci(), san=board.san(move), eval=_eval(top), terminal=terminal, win=win,
                                 why=played_why(board, move.uci(), reply, me, cfg.engine.pv_plies)))
    return sorted(out, key=lambda a: (a.win is None, -(a.win or 0), a.san))


def repertoire_out(cfg: Config, lines: list[Line], evals1: dict[str, dict], stats: dict[str, dict],
                   masters: dict[str, dict], slips: dict[str, list[S.Slip]], stamp: int) -> S.Repertoire:
    """`slips`: per line id, the games where I left the line by my own move, newest first."""
    names = load_openings(openings_dir(cfg.root), cfg.data_dir)
    path = cfg.root / cfg.repertoire.pgn
    out, positions = [], {}
    for colour, name, source, moves, start in lines:
        me = SIDES[colour]
        board, steps, opening, took_on = chess.Board(), [], None, None
        for i, uci in enumerate(moves):
            move, key = chess.Move.from_uci(uci), position_key(board)
            asks = _asks(board, colour, i, start)
            if asks and key not in positions:
                positions[key] = alternatives(cfg, board, me, evals1)
            top, terminal, win = _scored(board, move, me, evals1)
            best_win = max((a.win for a in positions[key] if a.win is not None), default=None) if asks else None
            share, _ = explorer.share(stats.get(key), uci)
            masters_share, _ = explorer.share(masters.get(key), uci)
            played = (stats.get(key) or {}).get("moves") or []
            reached = names.get(position_key(_after(board, move)))
            named = reached.name if reached and reached.name != opening else None
            opening = reached.name if reached else opening
            steps.append(S.LineStep(
                san=board.san(move), key=key if asks else None, eval=_eval(top), terminal=terminal, win=win,
                top=None if best_win is None or win is None else win >= best_win, share=share,
                most_common=bool(played) and played[0]["uci"] == uci, masters_share=masters_share, opening=named,
                reason=move_sentence(board, move, took_on),
            ))
            took_on = move.to_square if board.is_capture(move) else None
            board.push(move)
        lid = line_id(colour, moves)
        out.append(S.RepertoireLine(id=lid, colour=colour, name=name, source=source, moves=moves,
                                    san=[s.san for s in steps], start=start, steps=steps,
                                    slips=slips.get(lid, [])[:SLIPS_SHOWN], slip_games=len(slips.get(lid, []))))
    return S.Repertoire(as_of=stamp, pgn=cfg.repertoire.pgn if path.exists() else None,
                        cover_min_games=cfg.repertoire.cover_min_games, lines=out, positions=positions)


def _after(board: chess.Board, move: chess.Move) -> chess.Board:
    after = board.copy(stack=False)
    after.push(move)
    return after
