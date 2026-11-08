"""The players in config.toml's [rivals]: the openings they play, and the habits Stockfish says cost them.

Their games are their public chess.com archives (chesscom.fetch_rivals) in my time classes, read with the same
parser as mine. Counting what they play is rules-level; every score is Stockfish's pass 1, on the positions they
reached at least `min_times` times and on the position after each move they played there, so a move of theirs gets
the drop and the label it would get in one of my games (PLAN.md, reading 26). `analyse` fetches the missing scores;
`rival_out` only reads the cache.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field

import chess
from rich.console import Console

from coach import schema as S
from coach.analysis import evaluation, needs_engine
from coach.chesscom import rival_dir
from coach.config import Config
from coach.engine import analyse_positions, check_engine
from coach.export import ev, r1
from coach.model import band, top
from coach.openings import Opening
from coach.parse import ParsedGame, parse_game
from coach.reports import POINTS
from coach.templates import line_san, move_san
from coach.winpct import for_side, position_win_pct

COLOURS = ("white", "black")
COSTLY = {"inaccuracy", "mistake", "blunder"}


def load(cfg: Config, username: str) -> tuple[list[ParsedGame], list[str]]:
    """The rival's standard games from the starting position in my time classes, oldest first, and the newest
    `rivals.months` months they come from."""
    folder = rival_dir(cfg, username)
    months = sorted(p.stem for p in folder.glob("*.json"))[-cfg.rivals.months:]
    games = []
    for month in months:
        for raw in json.loads((folder / f"{month}.json").read_text()).get("games", []):
            if raw.get("time_class") not in cfg.player.time_classes:
                continue
            game = parse_game(raw, username, month)
            if game is not None and game.initial_fen == chess.STARTING_FEN:
                games.append(game)
    return sorted(games, key=lambda g: (g.start_ts, g.id)), months


@dataclass(eq=False)
class Node:
    key: str
    fen: str                   # from the first game that reached it
    rival_turn: bool
    opening: str | None
    games: list[ParsedGame] = field(default_factory=list)
    moves: dict[str, list[ParsedGame]] = field(default_factory=dict)   # UCI -> the games that played it here
    san: dict[str, str] = field(default_factory=dict)
    after: dict[str, tuple[str, str]] = field(default_factory=dict)    # UCI -> (key, FEN) of the position after it


def tree(cfg: Config, games: list[ParsedGame], colour: str, openings: dict[str, Opening] | None = None) -> dict[str, Node]:
    """Every position before one of the first `rivals.plies` plies of the rival's games as `colour`, with what was
    played from it. A game that reaches a position twice (a repetition) counts there once."""
    nodes: dict[str, Node] = {}
    for g in games:
        if g.my_color != colour:
            continue
        seen: set[str] = set()
        name = None
        for m in g.moves[: cfg.rivals.plies]:
            if m.key_before not in seen:
                seen.add(m.key_before)
                n = nodes.get(m.key_before)
                if n is None:
                    n = nodes[m.key_before] = Node(m.key_before, m.fen_before, m.side == colour, name)
                n.games.append(g)
                n.moves.setdefault(m.uci, []).append(g)
                n.san.setdefault(m.uci, m.san)
                n.after.setdefault(m.uci, (m.key_after, m.fen_after))
            if openings and m.key_after in openings:
                name = openings[m.key_after].name
    return nodes


def often(cfg: Config, nodes: dict[str, Node]) -> list[Node]:
    """The positions reached in at least `min_times` games, most reached first."""
    kept = [n for n in nodes.values() if len(n.games) >= cfg.rivals.min_times]
    return sorted(kept, key=lambda n: (-len(n.games), n.key))


def wanted(cfg: Config, games: list[ParsedGame]) -> list[str]:
    """Each often-reached position, and on the rival's turn the position after every move they played there."""
    keys = []
    for colour in COLOURS:
        for n in often(cfg, tree(cfg, games, colour)):
            keys.append(n.key)
            if n.rival_turn:
                keys += [key for key, _ in n.after.values()]
    return [k for k in dict.fromkeys(keys) if needs_engine(k)]


def analyse(cfg: Config, conn: sqlite3.Connection, console: Console) -> None:
    keys = [k for name in cfg.rivals.usernames for k in wanted(cfg, load(cfg, name)[0])]
    engine = check_engine(cfg.secrets.stockfish_path, cfg.engine.version)
    analyse_positions(conn, keys, cfg.engine.pass1, engine_path=cfg.secrets.stockfish_path, engine=engine,
                      workers=cfg.engine.workers, console=console, label="rivals")


def score(games: list[ParsedGame]) -> float | None:
    """The rival's score in percent (`result` is theirs: parse_game reads the game from their side)."""
    return 100 * sum(POINTS[g.result] for g in games) / len(games) if games else None


def vs_me(cfg: Config, games: list[ParsedGame]) -> list[str]:
    return sorted(g.id for g in games if g.opp_username.lower() == cfg.player.username.lower())


def move_out(cfg: Config, n: Node, uci: str, evals1: dict[str, dict], openings: dict[str, Opening]) -> S.RivalMove:
    """A move from `n`, labelled as model.build_game labels the moves of my games: Book, Best, then the drop's band."""
    key_after, fen_after = n.after[uci]
    before, after = evaluation(n.key, evals1), evaluation(key_after, evals1)
    win = drop = label = None
    if before is not None and after is not None:
        white = n.fen.split()[1] == "w"   # the mover
        win = for_side(position_win_pct(after), white)
        drop = for_side(position_win_pct(before), white) - win
        line = top(before)["pv"] if top(before) else []
        best = line[0] if line else None
        label = "book" if key_after in openings else "best" if uci == best else band(cfg, drop)
    reply = top(after)["pv"][: cfg.engine.pv_plies] if top(after) else []
    return S.RivalMove(uci=uci, san=n.san[uci], games=len(n.moves[uci]), score=r1(score(n.moves[uci])), win=r1(win),
                       drop=r1(drop), label=label, eval=ev(top(after)), reply=reply[0] if reply else None,
                       reply_san=move_san(fen_after, reply[0]) if reply else None, reply_line=reply,
                       reply_line_san=line_san(fen_after, reply))


def node_out(cfg: Config, n: Node, evals1: dict[str, dict], openings: dict[str, Opening]) -> S.RivalNode:
    best_top = top(evaluation(n.key, evals1))
    best = best_top["pv"][0] if best_top and best_top["pv"] else None
    moves = sorted((move_out(cfg, n, uci, evals1, openings) for uci in n.moves), key=lambda m: (-m.games, m.san))
    return S.RivalNode(key=n.key, fen=n.fen, rival_turn=n.rival_turn, games=len(n.games), vs_me=vs_me(cfg, n.games),
                       score=r1(score(n.games)), opening=n.opening, eval=ev(best_top), best=best,
                       best_san=move_san(n.fen, best), moves=moves)


def rival_out(cfg: Config, username: str, games: list[ParsedGame], months: list[str], evals1: dict[str, dict],
              openings: dict[str, Opening]) -> S.Rival:
    sides, habits = {}, []
    for colour in COLOURS:
        theirs = [g for g in games if g.my_color == colour]
        kept = often(cfg, tree(cfg, games, colour, openings))
        nodes = [node_out(cfg, n, evals1, openings) for n in kept]
        sides[colour] = S.RivalSide(colour=colour, games=len(theirs), score=r1(score(theirs)), tree=nodes)
        for n, out in zip(kept, nodes):
            for m in out.moves if n.rival_turn else []:
                if (m.games >= cfg.rivals.min_times and m.drop is not None and m.uci != out.best
                        and band(cfg, m.drop) in COSTLY):
                    habits.append(S.Habit(colour=colour, key=n.key, fen=n.fen, opening=n.opening, reached=out.games,
                                          move=m, best=out.best, best_san=out.best_san, vs_me=vs_me(cfg, n.moves[m.uci])))
    habits.sort(key=lambda h: (-h.move.drop * h.move.games, h.key, h.move.uci))
    return S.Rival(as_of=max((g.end_ts for g in games), default=0), username=username,
                   time_classes=list(cfg.player.time_classes), months=months, games=len(games),
                   vs_me=len(vs_me(cfg, games)), plies=cfg.rivals.plies, min_times=cfg.rivals.min_times,
                   white=sides["white"], black=sides["black"], habits=habits)


def files(cfg: Config, evals1: dict[str, dict], openings: dict[str, Opening]) -> dict[str, S.Rival]:
    """`rivals/<username>.json` for each rival with archives here; without any (a fresh checkout), the file
    exported last time stays."""
    out = {}
    for name in cfg.rivals.usernames:
        games, months = load(cfg, name)
        if months:
            out[f"rivals/{name.lower()}.json"] = rival_out(cfg, name, games, months, evals1, openings)
    return out
