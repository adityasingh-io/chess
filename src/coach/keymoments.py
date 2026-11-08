"""Each game's key moment (model.key_moment), with a stored score for every move I could have played there.

Every legal move in the position before my move is scored with pass-1 settings on the position after it, the
same way each move of my games is scored, so a move tried in the review gets the drop and the label it would
have got in the game. `analyse` fetches what's missing for the newest games (config.toml, key_moments), newest
first, and for every game against a rival however old; `key_out` only reads the cache, so a key moment stays exported
once its moves are scored.
"""

from __future__ import annotations

import sqlite3

import chess
from rich.console import Console

from coach import schema as S
from coach.analysis import needs_engine
from coach.config import Config
from coach.engine import analyse_positions, check_engine
from coach.model import GameModel, band
from coach.positions import position_key
from coach.trainer import alternatives


def _board(m: GameModel) -> chess.Board:
    return chess.Board(m.key.record.ply.move["fen_before"])


def wanted(models: list[GameModel], games: int | None = None, also: frozenset[str] = frozenset()) -> list[str]:
    """The position after every legal move at each key moment of the newest `games` games (all of them by default)
    and of the games in `also`, newest game first."""
    keys = []
    newest = sorted(models, key=lambda m: -m.row["start_ts"])
    for m in [m for i, m in enumerate(newest) if games is None or i < games or m.id in also]:
        if m.key:
            board = _board(m)
            for move in board.legal_moves:
                board.push(move)
                keys.append(position_key(board))
                board.pop()
    return [k for k in dict.fromkeys(keys) if needs_engine(k)]


def analyse(cfg: Config, conn: sqlite3.Connection, models: list[GameModel], console: Console) -> None:
    engine = check_engine(cfg.secrets.stockfish_path, cfg.engine.version)
    rivals = {n.lower() for n in cfg.rivals.usernames}
    also = frozenset(m.id for m in models if m.row["opp_username"].lower() in rivals)
    analyse_positions(conn, wanted(models, cfg.key_moments.games, also), cfg.engine.pass1, engine_path=cfg.secrets.stockfish_path,
                      engine=engine, workers=cfg.engine.workers, console=console, label="key moments")


def r1(x: float) -> float:
    return round(x, 1)


def key_out(cfg: Config, m: GameModel, evals1: dict[str, dict]) -> S.KeyMoment | None:
    """The key moment with every legal move's stored score; None until all of them are scored."""
    if not m.key:
        return None
    ply = m.key.record.ply
    board = _board(m)
    moves = []
    for a in alternatives(cfg, board, board.turn, evals1):
        if a.win is None:
            return None
        drop = ply.win_before - a.win
        label = "best" if a.uci == ply.best else band(cfg, drop)
        moves.append(S.KeyMove(**{**a.model_dump(), "win": r1(a.win)}, drop=r1(drop), label=label))
    return S.KeyMoment(kind=m.key.kind, ply=ply.number, record=m.key.record.id, fen=ply.move["fen_before"],
                       win_before=r1(ply.win_before), moves=moves)
