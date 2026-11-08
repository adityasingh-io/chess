"""The players in config.toml's [rivals]: the openings they play, the habits Stockfish says cost them, and how my
games against them went.

Their games are their public chess.com archives (chesscom.fetch_rivals) in my time classes, read with the same
parser as mine, and only when I ask (`coach rivals`), never in the nightly run. Counting what they play is
rules-level; every score is Stockfish's pass 1, on the positions they reached at least `min_times` times or that my
own games reach, and on the position after each move they played there, so a move of theirs gets the drop and the
label it would get in one of my games (PLAN.md, reading 26). `analyse` fetches the missing scores; `rival_out` only
reads the cache. `head_to_head` is built from my analysed games alone, so it stays current with every update.
"""

from __future__ import annotations

import json
import sqlite3
from collections import Counter
from dataclasses import dataclass, field
from statistics import mean

import chess
from rich.console import Console

from coach import db, schema as S
from coach.analysis import evaluation, needs_engine
from coach.chesscom import rival_dir
from coach.config import Config
from coach.engine import analyse_positions, check_engine
from coach.export import _dump, ev, loss_info, r1, write_schema
from coach.model import PRIMARY_TYPES, GameModel, band, top
from coach.openings import Opening, load_openings, openings_dir
from coach.parse import ParsedGame, parse_game
from coach.positions import position_key
from coach.reports import POINTS
from coach.templates import line_san, move_san
from coach.trainer import alternatives
from coach.winpct import for_side, position_win_pct

COLOURS = ("white", "black")
OTHER = {"white": "black", "black": "white"}
COSTLY = {"inaccuracy", "mistake", "blunder"}
PHASES = ("opening", "middlegame", "endgame")


def names(cfg: Config, wanted: list[str] | None = None) -> list[str]:
    """The rivals to work on: `wanted` (each must be in config.toml's [rivals]), or all of them."""
    known = {n.lower(): n for n in cfg.rivals.usernames}
    if not wanted:
        return list(cfg.rivals.usernames)
    missing = [w for w in wanted if w.lower() not in known]
    if missing:
        raise SystemExit(f"Add {', '.join(missing)} to [rivals] usernames in config.toml first.")
    return [known[w.lower()] for w in wanted]


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


def my_positions(cfg: Config, conn: sqlite3.Connection) -> dict[str, set[str]]:
    """The positions in the first `rivals.plies` plies of my games, by my colour: where a rival's game, played
    with the other colour, is in my openings."""
    out: dict[str, set[str]] = {c: set() for c in COLOURS}
    rows = conn.execute("SELECT g.my_color AS colour, m.key_before AS key FROM moves m JOIN games g ON g.id = m.game_id "
                        "WHERE m.ply <= ?", (cfg.rivals.plies,))
    for row in rows:
        out[row["colour"]].add(row["key"])
    return out


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


def kept(cfg: Config, nodes: dict[str, Node], mine: set[str]) -> list[Node]:
    """The positions reached in at least `min_times` games, or in any number if my games reach them too, most
    reached first."""
    out = [n for n in nodes.values() if len(n.games) >= cfg.rivals.min_times or n.key in mine]
    return sorted(out, key=lambda n: (-len(n.games), n.key))


def wanted(cfg: Config, games: list[ParsedGame], mine: dict[str, set[str]]) -> list[str]:
    """Each kept position, and on the rival's turn the position after every move they played there."""
    keys = []
    for colour in COLOURS:
        for n in kept(cfg, tree(cfg, games, colour), mine[OTHER[colour]]):
            keys.append(n.key)
            if n.rival_turn:
                keys += [key for key, _ in n.after.values()]
    return [k for k in dict.fromkeys(keys) if needs_engine(k)]


def analyse(cfg: Config, conn: sqlite3.Connection, console: Console, which: list[str]) -> None:
    mine = my_positions(cfg, conn)
    loaded = {name: load(cfg, name) for name in which}
    engine = check_engine(cfg.secrets.stockfish_path, cfg.engine.version)

    def run(keys: list[str], label: str) -> None:
        analyse_positions(conn, keys, cfg.engine.pass1, engine_path=cfg.secrets.stockfish_path, engine=engine,
                          workers=cfg.engine.workers, console=console, label=label)

    run([k for games, _ in loaded.values() for k in wanted(cfg, games, mine)], "rivals")
    # Then every answer to the costly moves the prep session asks about, which are known once the tree is scored.
    evals1 = db.load_evals(conn, cfg.engine.version, cfg.engine.pass1.key)
    openings = load_openings(openings_dir(cfg.root), cfg.data_dir)
    run([k for name, (games, months) in loaded.items() if months
         for k in prep_wanted(cfg, rival_out(cfg, name, games, months, evals1, openings, mine).your_openings)],
        "rival prep")


def score(games: list[ParsedGame]) -> float | None:
    """The rival's score in percent (`result` is theirs: parse_game reads a game from the side of the player it's
    given)."""
    return _percent([g.result for g in games])


def _percent(results: list[str]) -> float | None:
    return 100 * sum(POINTS[r] for r in results) / len(results) if results else None


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


def node_out(cfg: Config, n: Node, evals1: dict[str, dict], openings: dict[str, Opening], mine: set[str]) -> S.RivalNode:
    best_top = top(evaluation(n.key, evals1))
    best = best_top["pv"][0] if best_top and best_top["pv"] else None
    moves = sorted((move_out(cfg, n, uci, evals1, openings) for uci in n.moves), key=lambda m: (-m.games, m.san))
    return S.RivalNode(key=n.key, fen=n.fen, rival_turn=n.rival_turn, yours=n.key in mine, games=len(n.games),
                       vs_me=vs_me(cfg, n.games), score=r1(score(n.games)), opening=n.opening, eval=ev(best_top),
                       best=best, best_san=move_san(n.fen, best), moves=moves)


def costly(cfg: Config, m: S.RivalMove, best: str | None) -> bool:
    """Not Stockfish's best, and a drop of an Inaccuracy's or more, by the drop alone (so a book move can be)."""
    return m.drop is not None and m.uci != best and band(cfg, m.drop) in COSTLY


def prep_picks(cfg: Config, yours: list[S.Habit]) -> list[S.Habit]:
    """The costly moves in my openings the prep session asks me to punish: most often played first, then the
    costliest."""
    return sorted(yours, key=lambda h: (-h.move.games, -(h.move.drop or 0), h.key, h.move.uci))[: cfg.rivals.prep]


def _after(h: S.Habit) -> chess.Board:
    board = chess.Board(h.fen)
    board.push_uci(h.move.uci)
    return board


def prep_wanted(cfg: Config, yours: list[S.Habit]) -> list[str]:
    """The position after every legal move of mine once they've played each picked move."""
    keys = []
    for h in prep_picks(cfg, yours):
        board = _after(h)
        for move in board.legal_moves:
            board.push(move)
            keys.append(position_key(board))
            board.pop()
    return [k for k in dict.fromkeys(keys) if needs_engine(k)]


def prep_out(cfg: Config, yours: list[S.Habit], evals1: dict[str, dict]) -> list[S.PrepStep]:
    """The picked moves whose every answer is scored, each answer labelled as keymoments.key_out labels a key
    moment's moves: Best for Stockfish's move, else the band of the Win% it loses against my Win% there."""
    out = []
    for h in prep_picks(cfg, yours):
        board = _after(h)
        result = evaluation(position_key(board), evals1)
        here = top(result)
        if here is None:   # not scored yet
            continue
        me = board.turn
        win = for_side(position_win_pct(result), me == chess.WHITE)
        best = here["pv"][0] if here["pv"] else None
        moves = []
        for a in alternatives(cfg, board, me, evals1):
            if a.win is None:
                break
            drop = win - a.win
            moves.append(S.KeyMove(**{**a.model_dump(), "win": r1(a.win)}, drop=r1(drop),
                                   label="best" if a.uci == best else band(cfg, drop)))
        else:
            line = here["pv"][: cfg.engine.pv_plies]
            out.append(S.PrepStep(colour=h.colour, key=h.key, fen=board.fen(), opening=h.opening, reached=h.reached,
                                  move=h.move, win=r1(win), moves=moves, best_line=line, best_line_san=line_san(board.fen(), line)))
    return out


def endings(games: list[ParsedGame]) -> S.Endings:
    """How the rival's games ended: the loser's chess.com code when they won or lost, theirs when they drew."""
    won = Counter(g.opp_code for g in games if g.result == "win")
    lost = Counter(g.my_code for g in games if g.result == "loss")
    drawn = Counter(g.my_code for g in games if g.result == "draw")
    return S.Endings(won=dict(won.most_common()), lost=dict(lost.most_common()), drawn=dict(drawn.most_common()))


def time_trouble(cfg: Config, games: list[ParsedGame]) -> S.TimeTrouble:
    """Games where the rival's clock, after one of their moves, fell below `flags.time_trouble` of the starting
    time (PLAN.md, reading 18), among those with clocks in the PGN."""
    share = cfg.analysis.flags.time_trouble
    timed, low = [], []
    for g in games:
        clocks = [m.clock for m in g.moves if m.side == g.my_color and m.clock is not None]
        if not clocks:
            continue
        timed.append(g)
        if min(clocks) < share * g.base_seconds:
            low.append(g)
    return S.TimeTrouble(share=share, timed=len(timed), games=len(low),
                         lost_on_time=sum(1 for g in low if g.result == "loss" and g.my_code == "timeout"),
                         score=r1(score(low)))


def rival_out(cfg: Config, username: str, games: list[ParsedGame], months: list[str], evals1: dict[str, dict],
              openings: dict[str, Opening], mine: dict[str, set[str]]) -> S.Rival:
    sides, habits, yours = {}, [], []
    for colour in COLOURS:
        theirs = [g for g in games if g.my_color == colour]
        nodes = kept(cfg, tree(cfg, games, colour, openings), mine[OTHER[colour]])
        out = [node_out(cfg, n, evals1, openings, mine[OTHER[colour]]) for n in nodes]
        sides[colour] = S.RivalSide(colour=colour, games=len(theirs), score=r1(score(theirs)), tree=out)
        for n, o in zip(nodes, out):
            for m in o.moves if n.rival_turn else []:
                if not costly(cfg, m, o.best):
                    continue
                h = S.Habit(colour=colour, key=n.key, fen=n.fen, opening=n.opening, reached=o.games, yours=o.yours,
                            move=m, best=o.best, best_san=o.best_san, vs_me=vs_me(cfg, n.moves[m.uci]))
                if m.games >= cfg.rivals.min_times:
                    habits.append(h)
                if o.yours:
                    yours.append(h)
    def cost(h: S.Habit) -> tuple:   # Win% given away, most first
        return -h.move.drop * h.move.games, h.key, h.move.uci

    return S.Rival(as_of=max((g.end_ts for g in games), default=0), username=username,
                   time_classes=list(cfg.player.time_classes), months=months, games=len(games),
                   vs_me=len(vs_me(cfg, games)), plies=cfg.rivals.plies, min_times=cfg.rivals.min_times,
                   white=sides["white"], black=sides["black"], habits=sorted(habits, key=cost),
                   your_openings=sorted(yours, key=cost), prep=prep_out(cfg, yours, evals1), endings=endings(games),
                   time_trouble=time_trouble(cfg, games))


def files(cfg: Config, conn: sqlite3.Connection, evals1: dict[str, dict], openings: dict[str, Opening],
          which: list[str]) -> dict[str, S.Rival]:
    """`rivals/<username>.json` for each of `which` that has archives here."""
    mine, out = my_positions(cfg, conn), {}
    for name in which:
        games, months = load(cfg, name)
        if months:
            out[f"rivals/{name.lower()}.json"] = rival_out(cfg, name, games, months, evals1, openings, mine)
    return out


def write(cfg: Config, rivals: dict[str, S.Rival]) -> int:
    """Write the rival files that changed (the rest of the export is the build's); returns how many."""
    written = 0
    for rel, model in rivals.items():
        path, text = cfg.export_dir / rel, _dump(model)
        if not path.exists() or path.read_text() != text:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(text)
            written += 1
    write_schema(cfg)
    return written


# --- head to head, from my own games -------------------------------------------------------------------

def _accuracy(models: list[GameModel], phase: str, mine: bool) -> tuple[float | None, int]:
    acc = [p.accuracy for m in models for p in m.plies if p.mine == mine and p.phase == phase]
    return (r1(mean(acc)) if acc else None), len(acc)


def head_to_head(cfg: Config, models: list[GameModel], keys: dict[str, S.KeyMoment | None], stamp: int) -> S.Rivals:
    """For each rival, my games against them (newest first) with how each went, my records per game against them
    next to my usual rate, and both sides' accuracy by phase in those games."""
    usual = {tag: sum(1 for m in models for r in m.records if tag in r.tags) / len(models) if models else 0.0
             for tag in PRIMARY_TYPES}
    out = []
    for name in cfg.rivals.usernames:
        vs = sorted((m for m in models if m.row["opp_username"].lower() == name.lower()), key=lambda m: -m.row["start_ts"])
        rows = []
        for m in vs:
            theirs = OTHER[m.row["my_color"]]
            k = keys.get(m.id)
            turn = m.loss.turning_point if m.loss else None
            rows.append(S.HeadToHeadGame(
                id=m.id, ts=m.row["start_ts"], colour=m.row["my_color"], result=m.row["result"],
                opening=m.opening.family if m.opening else None, accuracy=r1(m.my_accuracy),
                their_accuracy=r1(m.accuracy[theirs]), loss=loss_info(m), turning_san=turn.move["san"] if turn else None,
                turning_drop=r1(turn.drop) if turn else None, key_ply=k.ply if k else None, thrown=m.thrown is not None))
        rates = [S.HeadToHeadRate(tag=t, against=round(sum(1 for m in vs for r in m.records if t in r.tags) / len(vs), 3),
                                  usual=round(usual[t], 3)) for t in PRIMARY_TYPES] if vs else []
        phases = []
        for ph in PHASES:
            (mine_acc, mine_n), (their_acc, their_n) = _accuracy(vs, ph, True), _accuracy(vs, ph, False)
            phases.append(S.HeadToHeadPhase(phase=ph, mine=mine_acc, theirs=their_acc, my_moves=mine_n, their_moves=their_n))
        out.append(S.HeadToHead(username=name, games=rows, score=r1(_percent([m.row['result'] for m in vs])), rates=rates,
                                phases=phases))
    return S.Rivals(as_of=stamp, rivals=out)
