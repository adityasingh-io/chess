"""The analysis model (BRIEF.md, Analysis model), built from stored Stockfish output.

Stockfish judges: Win% comes from its evaluations, "best" is its top move and lines are its lines.
This module only measures (material, captures, checks, clocks) and applies the thresholds in
config.toml. Labels, accuracy and Win% drops use pass 1, so every move is judged at the same
depth; primary types, lines and confirmations use pass 2 where it exists (PLAN.md, reading 1).
"""

from __future__ import annotations

import sqlite3
import statistics
from collections import defaultdict
from dataclasses import dataclass, field

import chess

from coach.analysis import Game, evaluation, gap, is_garbage_time
from coach.config import Config
from coach.measure import balance, play_line
from coach.openings import Opening
from coach.positions import board_from_key, position_key
from coach.tactics import LICHESS_THEME, key_move, motifs, subtype as pick_subtype
from coach.winpct import for_side, game_accuracy, line_win_pct, move_accuracy, position_win_pct

PRIMARY_TYPES = ("allowed_mate", "hung_piece", "tactic", "missed_mate", "missed_win", "quiet")
SEVERITIES = ("inaccuracy", "mistake", "blunder")
FLAGS = ("threw_away_win", "opening", "endgame", "fast", "time_trouble", "after_loss")
LOSS_CAUSES = ("clock", "gave_up", *PRIMARY_TYPES, "outplayed")
ENDGAME_OUTCOMES = ("converted", "spoiled", "held", "saved", "lost_as_expected")


# --- positions and moves ---------------------------------------------------------------------

FEN_VALUES = {"n": 3, "b": 3, "r": 5, "q": 9}


def is_endgame(key: str, limit: int) -> bool:
    """Each side has at most `limit` points of non-pawn material, counted from the position key."""
    white = black = 0
    for c in key.split(" ", 1)[0]:
        if (v := FEN_VALUES.get(c.lower())) is not None:
            if c.isupper():
                white += v
            else:
                black += v
    return white <= limit and black <= limit


def endgame_type(board: chess.Board) -> str:
    """By the pieces on the board when the endgame starts."""
    kinds = {p.piece_type for p in board.piece_map().values()} - {chess.KING, chess.PAWN}
    if not kinds:
        return "pawn"
    if chess.QUEEN in kinds:
        return "queen"
    if kinds == {chess.ROOK}:
        return "rook"
    if kinds <= {chess.KNIGHT, chess.BISHOP}:
        return "minor"
    return "mixed"


def band(cfg: Config, drop: float) -> str:
    b = cfg.analysis.labels
    for limit, name in ((b.excellent, "excellent"), (b.good, "good"), (b.inaccuracy, "inaccuracy"), (b.mistake, "mistake")):
        if drop < limit:
            return name
    return "blunder"


def mate_for(line: dict | None, white: bool) -> int | None:
    """Stockfish's mate count from one side's view: positive means that side mates, negative it gets mated."""
    if not line or line.get("mate") is None:
        return None
    return line["mate"] if white else -line["mate"]


def top(result: dict | None) -> dict | None:
    return result["lines"][0] if result and result.get("lines") else None


@dataclass(eq=False)
class Ply:
    move: sqlite3.Row
    white_before: float      # White's Win% before and after the move (pass 1)
    white_after: float
    best: str | None         # Stockfish's top move in the position before (pass 1)
    label: str               # book, best, excellent, good, inaccuracy, mistake, blunder
    accuracy: float          # the mover's move accuracy
    phase: str               # opening, middlegame, endgame
    book: bool
    mark: Mark | None = None  # Brilliant, Great or Miss, on top of the label

    @property
    def number(self) -> int:
        return self.move["ply"]

    @property
    def white(self) -> bool:
        return self.move["side"] == "white"

    @property
    def mine(self) -> bool:
        return bool(self.move["is_mine"])

    @property
    def win_before(self) -> float:
        return for_side(self.white_before, self.white)

    @property
    def win_after(self) -> float:
        return for_side(self.white_after, self.white)

    @property
    def drop(self) -> float:
        return self.win_before - self.win_after


@dataclass
class Mark:
    """chess.com-style Brilliant, Great or Miss, from Stockfish's pass-1 lines (config.toml, analysis.marks)."""
    kind: str                       # brilliant, great, miss
    gap: float | None = None        # great: how much worse Stockfish's second choice was (Win%)
    second: str | None = None       # great: that second choice (uci)
    material: int | None = None     # brilliant: the mover's material after their next move, vs before the move
    line: list[str] = field(default_factory=list)  # brilliant: the Stockfish line that takes the piece (uci, from after the move)
    chance: float | None = None     # miss: Win% the opponent's move before gave away
    gave_back: float | None = None  # miss: Win% this move gave back


def recapture(ply: Ply, previous: Ply | None) -> bool:
    """The move captures on the square the opponent's move before captured on."""
    if previous is None:
        return False
    prev_board, prev_move = board_from_key(previous.move["key_before"]), chess.Move.from_uci(previous.move["uci"])
    return prev_board.is_capture(prev_move) and chess.Move.from_uci(ply.move["uci"]).to_square == prev_move.to_square


def mark(cfg: Config, ply: Ply, previous: Ply | None, before: dict | None, after: dict | None) -> Mark | None:
    """At most one mark per move, the first that applies: Brilliant, Great, Miss."""
    k = cfg.analysis.marks
    if ply.book:
        return None
    board = board_from_key(ply.move["key_before"])
    move = chess.Move.from_uci(ply.move["uci"])
    if ply.label in ("best", "excellent") and ply.win_before < k.brilliant_max_before and ply.win_after >= k.brilliant_min_after:
        color = chess.WHITE if ply.white else chess.BLACK
        start = board_from_key(ply.move["key_after"])
        for line in (after or {}).get("lines", [])[:2]:
            pv = line["pv"]
            reply = chess.Move.from_uci(pv[0]) if pv else None
            if reply is None or reply not in start.legal_moves or reply.to_square != move.to_square or not start.is_capture(reply):
                continue
            end = play_line(start, pv, 2)
            if len(end.move_stack) < 2:
                continue  # a line that stops at the capture doesn't show whether it's taken back
            net = balance(end, color) - balance(board, color)
            if net <= -k.brilliant_material:
                return Mark("brilliant", material=net, line=pv[:cfg.engine.pv_plies])
    if ply.label == "best" and board.legal_moves.count() > 1 and not recapture(ply, previous):
        g = gap(before, ply.white)
        if g is not None and g >= k.great_gap:
            return Mark("great", gap=g, second=before["lines"][1]["pv"][0])
    if previous is not None and previous.drop >= k.miss_chance:
        if max(k.miss_chance, k.miss_gave_back * previous.drop) <= ply.drop <= previous.drop:
            return Mark("miss", chance=previous.drop, gave_back=ply.drop)
    return None


# --- mistake records ---------------------------------------------------------------------------

@dataclass(eq=False)
class Record:
    game: GameModel
    ply: Ply
    severity: str
    primary: str
    subtype: str | None
    rule: str                    # which recipe rule fired, in words, for `coach review`
    source: str                  # 'pass2' or 'pass1': where the types and lines come from
    confirmed: bool | None       # pass 2 also sees a drop of min_drop+ (None without pass 2)
    best_line: list[str]         # Stockfish's line from the position before my move (uci)
    reply_line: list[str]        # Stockfish's line after my move
    before_top: dict | None      # Stockfish's top line before and after (White's view)
    after_top: dict | None
    after_terminal: str | None   # 'white' / 'black' / 'draw' when my move ended the game
    net_after: int               # net material at the end of reply_line, vs before my move
    net_best: int | None         # net material at the end of best_line
    themes: list[str]            # matching Lichess puzzle themes
    flags: list[str] = field(default_factory=list)
    win_moves: int | None = None  # missed win: my moves its line needs to win the material

    @property
    def id(self) -> str:
        return f"{self.game.game.id}-{self.ply.number}"

    @property
    def tags(self) -> list[str]:
        return [self.primary, *([self.subtype] if self.subtype else []), *self.flags]


@dataclass
class LineCheck:
    line: list[str]
    my_moves_needed: int | None   # my moves until net material reaches material_win and stays
    findable: bool


def best_line(cfg: Config, key: str, first: dict | None, results: dict[str, dict], white: bool) -> tuple[list[str], dict[int, float | None]]:
    """Stockfish's best line from `key`, continued through the pass-2 results stored along it.

    Pass 2 follows a line two plies at a time while my move there is findable, so where the next
    position has its own result the line continues with that result's line. Returns the line and
    the best-minus-second gap at each of my moves where a result exists (keyed by ply index).
    """
    line: list[str] = []
    gaps: dict[int, float | None] = {}
    board, result = board_from_key(key), first
    levels = cfg.engine.triggers.line_my_moves
    for level in range(levels):
        pv = top(result)["pv"] if top(result) else []
        if not pv:
            break
        gaps[len(line)] = gap(result, white)
        following = None
        if level + 1 < levels and len(pv) >= 2:
            after_two = play_line(board, pv, 2)
            if len(after_two.move_stack) == 2 and not after_two.is_game_over():
                following = results.get(position_key(after_two))
        if following is None:
            line += pv[: cfg.engine.pv_plies]
            break
        line += pv[:2]
        board, result = after_two, following
    return line, gaps


def check_winning_line(cfg: Config, before: chess.Board, line: list[str], gaps: dict[int, float | None], color: chess.Color,
                       reference: chess.Board) -> LineCheck:
    """Human-findable filter: the line reaches net material of material_win+ (vs `reference`) within
    line_my_moves of my moves and keeps it to the end, and each of those moves is a check, a capture
    or clearly best."""
    target, limit, min_gap = cfg.analysis.types.material_win, cfg.engine.triggers.line_my_moves, cfg.engine.triggers.min_gap
    board = before.copy(stack=False)
    nets, mine = [], []
    for i, uci in enumerate(line):
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            line = line[:i]
            break
        if board.turn == color:
            g = gaps.get(i)
            mine.append(board.gives_check(move) or board.is_capture(move) or (g is not None and g >= min_gap))
        board.push(move)
        nets.append(balance(board, color) - balance(reference, color))
    if not nets or nets[-1] < target:
        return LineCheck(line, None, False)
    for k in range(1, limit + 1):
        reached = nets[min(2 * k, len(nets)) - 1]
        if reached >= target:
            return LineCheck(line, k, all(mine[:k]))
        if 2 * k >= len(nets):
            break
    return LineCheck(line, None, False)


def line_material(start: chess.Board, line: list[str], color: chess.Color, reference: chess.Board) -> list[tuple[str, int]]:
    """(SAN, net material vs reference) after each move of the line, for `coach review`."""
    board = start.copy(stack=False)
    out = []
    for uci in line:
        move = chess.Move.from_uci(uci)
        if move not in board.legal_moves:
            break
        san = board.san(move)
        board.push(move)
        out.append((san, balance(board, color) - balance(reference, color)))
    return out


def back_rank_mate(board: chess.Board, line: list[str]) -> bool:
    """The line ends in checkmate with the mated king on its home rank."""
    end = play_line(board, line, len(line))
    if not end.is_checkmate():
        return False
    king = end.king(end.turn)
    return king is not None and chess.square_rank(king) == (0 if end.turn == chess.WHITE else 7)


def material_reference(before_board: chess.Board, my_move: chess.Move, best: chess.Move | None,
                       previous: sqlite3.Row | None) -> tuple[chess.Board, bool]:
    """The position net material is measured against: before my move, or before the exchange I'm in.

    If the opponent just captured and my move or Stockfish's best move captures back on that
    square, material is counted from before their capture, so recapturing isn't "winning" material
    and recapturing wrongly can still lose it (PLAN.md, reading 13).
    """
    if previous is None:
        return before_board, False
    prev_board, prev_move = board_from_key(previous["key_before"]), chess.Move.from_uci(previous["uci"])
    if not prev_board.is_capture(prev_move):
        return before_board, False
    square = prev_move.to_square
    if any(m is not None and m.to_square == square and before_board.is_capture(m) for m in (my_move, best)):
        return prev_board, True
    return before_board, False


def classify(cfg: Config, game: Game, ply: Ply, previous: sqlite3.Row | None,
             before: dict | None, after: dict | None, results: dict[str, dict]) -> dict:
    """Primary type, sub-type and the rule that fired, first match in BRIEF.md's order."""
    t, plies = cfg.analysis.types, cfg.engine.pv_plies
    me = ply.white
    color = chess.WHITE if me else chess.BLACK
    before_board, after_board = board_from_key(ply.move["key_before"]), board_from_key(ply.move["key_after"])
    my_move = chess.Move.from_uci(ply.move["uci"])
    b_top, a_top = top(before), top(after)
    best_first = chess.Move.from_uci(b_top["pv"][0]) if b_top and b_top["pv"] else None
    reference, exchange = material_reference(before_board, my_move, best_first, previous)
    since = "before the exchange" if exchange else "before your move"
    reply = a_top["pv"][:plies] if a_top else []
    reply_end = play_line(after_board, reply, plies)
    net_after = balance(reply_end, color) - balance(reference, color)
    simple_best = b_top["pv"][:plies] if b_top else []
    net_simple_best = balance(play_line(before_board, simple_best, plies), color) - balance(reference, color)
    mate_after, mate_before = mate_for(a_top, me), mate_for(b_top, me)
    out = dict(subtype=None, reply_line=reply, net_after=net_after, net_best=net_simple_best, best_line=simple_best, themes=[])

    if mate_after is not None and mate_after < 0 and not (mate_before is not None and mate_before < 0):
        themes = [f"mateIn{-mate_after}"] if -mate_after <= 3 else []
        if themes and back_rank_mate(after_board, reply):
            themes.append("backRankMate")
        had = "none" if mate_before is None else f"mate in {mate_before} for you"
        return {**out, "primary": "allowed_mate", "themes": themes,
                "rule": f"after the move Stockfish has mate in {-mate_after} against you (before: {had})"}

    # Material is lost only if my move's line also ends material_loss or worse compared with
    # Stockfish's best line from the same position (PLAN.md, reading 14).
    first_reply = chess.Move.from_uci(reply[0]) if reply else None
    vs_best = net_after - net_simple_best
    if net_after <= t.material_loss and vs_best <= t.material_loss:
        if first_reply and after_board.is_capture(first_reply):
            return {**out, "primary": "hung_piece", "themes": ["hangingPiece"],
                    "rule": f"reply {after_board.san(first_reply)} is a capture; net material {net_after:+d} ({since}) at the "
                            f"end of Stockfish's line ({len(reply)} plies), {vs_best:+d} vs its best line"}
        key = key_move(after_board, reply, not color, previous=my_move, previous_board=before_board)
        found = motifs(key) if key else set()
        sub = pick_subtype(found)
        key_san = key.before.san(key.move) if key else "?"
        return {**out, "primary": "tactic", "subtype": sub, "themes": [LICHESS_THEME[sub]] if sub in LICHESS_THEME else [],
                "rule": f"net material {net_after:+d} ({since}, {vs_best:+d} vs best line) at the end of Stockfish's line "
                        f"but the reply isn't a capture; "
                        f"key move {key_san}: {', '.join(sorted(found)) or 'no motif'}"}

    if mate_before is not None and 0 < mate_before <= t.missed_mate_max:
        kept = after_board.is_checkmate() or (mate_after is not None and 0 < mate_after <= t.missed_mate_max)
        if not kept:
            themes = [f"mateIn{mate_before}"]
            if back_rank_mate(before_board, b_top["pv"]):
                themes.append("backRankMate")
            now = "no mate" if mate_after is None else f"mate {mate_after:+d}"
            return {**out, "primary": "missed_mate", "themes": themes,
                    "rule": f"Stockfish had mate in {mate_before}; after your move: {now}"}

    if b_top:
        drop = for_side(line_win_pct(b_top), me) - for_side(position_win_pct(after), me)
        if drop >= cfg.engine.triggers.follow_min_drop:
            line, gaps = best_line(cfg, ply.move["key_before"], before, results, me)
            check = check_winning_line(cfg, before_board, line, gaps, color, reference)
            net_best = balance(play_line(before_board, check.line, len(check.line)), color) - balance(reference, color) if check.line else None
            if check.my_moves_needed is not None and check.findable and net_best - net_after >= t.material_win:
                first = chess.Move.from_uci(check.line[0])
                two = play_line(before_board, check.line, 2)
                if before_board.is_capture(first) and balance(two, color) - balance(reference, color) >= t.material_win:
                    sub, found = "free_material", set()
                else:
                    prev_move = chess.Move.from_uci(previous["uci"]) if previous else None
                    prev_board = board_from_key(previous["key_before"]) if previous else None
                    key = key_move(before_board, check.line, color, previous=prev_move, previous_board=prev_board)
                    found = motifs(key) if key else set()
                    sub = pick_subtype(found)
                theme = "hangingPiece" if sub == "free_material" else LICHESS_THEME.get(sub)
                return {**out, "primary": "missed_win", "subtype": sub, "best_line": check.line, "net_best": net_best,
                        "themes": [theme] if theme else [], "win_moves": check.my_moves_needed,
                        "rule": f"best was worth {drop:.0f} Win% more; its line wins {net_best:+d} material ({since}, "
                                f"{net_best - net_after:+d} vs your move's line) within "
                                f"{check.my_moves_needed} of your moves, each a check, capture or clearly best"
                                + (f"; key motifs: {', '.join(sorted(found))}" if found else "")}
            out["net_best"] = net_best
            out["best_line"] = check.line or out["best_line"]

    return {**out, "primary": "quiet",
            "rule": f"no mate; net material {net_after:+d} ({since}), {vs_best:+d} vs Stockfish's best line, "
                    f"doesn't reach {t.material_loss:+d} on both"}


# --- games -------------------------------------------------------------------------------------

@dataclass
class Endgame:
    start: int               # index of the position where the endgame starts (0 = initial position)
    type: str
    win_start: float         # my Win% there
    outcome: str
    spoiler: Ply | None      # my endgame move with the largest Win% drop, for spoiled endgames


@dataclass
class LossCause:
    cause: str
    subtype: str | None = None
    flags: list[str] = field(default_factory=list)
    turning_point: Ply | None = None
    record: Record | None = None


@dataclass
class ThrownWin:
    peak: float
    move: Ply | None         # my move with the largest Win% drop after first reaching the threshold


@dataclass(eq=False)
class GameModel:
    game: Game
    plies: list[Ply]
    white_win: list[float]   # White's Win% at every position, initial position first
    accuracy: dict[str, float | None]
    opening: Opening | None
    opening_ply: int | None
    endgame: Endgame | None = None
    records: list[Record] = field(default_factory=list)
    loss: LossCause | None = None
    thrown: ThrownWin | None = None

    @property
    def id(self) -> str:
        return self.game.id

    @property
    def row(self) -> sqlite3.Row:
        return self.game.row

    @property
    def i_am_white(self) -> bool:
        return self.game.i_am_white

    @property
    def my_win(self) -> list[float]:
        return [for_side(w, self.i_am_white) for w in self.white_win]

    @property
    def my_accuracy(self) -> float | None:
        return self.accuracy[self.row["my_color"]]

    def mine(self) -> list[Ply]:
        return [p for p in self.plies if p.mine]


def build_game(cfg: Config, game: Game, evals1: dict[str, dict], openings: dict[str, Opening]) -> GameModel | None:
    """Per-move facts for a game whose positions all have pass-1 results; None otherwise."""
    keys = game.position_keys()
    if not keys or any(k not in evals1 for k in keys[:-1]):
        return None  # only the final position can be game over, so the rest must all be cached
    results = [evaluation(k, evals1) for k in keys]
    if results[-1] is None:
        return None
    white_win = [position_win_pct(r) for r in results]
    limit = cfg.analysis.phases.endgame_non_pawn
    endgame_start = next((i for i, k in enumerate(keys) if is_endgame(k, limit)), None)

    plies: list[Ply] = []
    in_opening = True
    opening, opening_ply = None, None
    for i, move in enumerate(game.moves):
        book = move["key_after"] in openings
        if book:
            opening, opening_ply = openings[move["key_after"]], move["ply"]
        if endgame_start is not None and i >= endgame_start:
            phase = "endgame"
        elif in_opening and (move["ply"] <= 2 * cfg.analysis.phases.opening_moves or book):
            phase = "opening"
        else:
            phase, in_opening = "middlegame", False
        best_line_ = top(results[i])["pv"] if top(results[i]) else []
        best = best_line_[0] if best_line_ else None
        white = move["side"] == "white"
        before, after = for_side(white_win[i], white), for_side(white_win[i + 1], white)
        label = "book" if book else "best" if move["uci"] == best else band(cfg, before - after)
        plies.append(Ply(move, white_win[i], white_win[i + 1], best, label, move_accuracy(before, after), phase, book))
    for i, ply in enumerate(plies):
        ply.mark = mark(cfg, ply, plies[i - 1] if i else None, results[i], results[i + 1])

    model = GameModel(game, plies, white_win, game_accuracy(white_win, white_moves_first=game.white_moves_first),
                      opening, opening_ply)
    if endgame_start is not None:
        model.endgame = _endgame(cfg, model, endgame_start, board_from_key(keys[endgame_start]))
    return model


def _endgame(cfg: Config, model: GameModel, start: int, board: chess.Board) -> Endgame:
    e = cfg.analysis.endgames
    win = model.my_win[start]
    result = model.row["result"]
    if win >= e.winning:
        outcome = "converted" if result == "win" else "spoiled"
    elif win > e.losing:
        outcome = "spoiled" if result == "loss" else "held"
    else:
        outcome = "lost_as_expected" if result == "loss" else "saved"
    spoiler = None
    if outcome == "spoiled":
        mine = [p for p in model.plies[start:] if p.mine]
        spoiler = max(mine, key=lambda p: p.drop, default=None)
    return Endgame(start, endgame_type(board), win, outcome, spoiler)


def think_thresholds(cfg: Config, models: list[GameModel]) -> dict[str, float]:
    """Per time control, the fast_percentile of my think times (book moves excluded)."""
    times: dict[str, list[float]] = defaultdict(list)
    for m in models:
        for p in m.mine():
            if not p.book and p.move["think_time"] is not None:
                times[m.row["time_control"]].append(p.move["think_time"])
    f = cfg.analysis.flags
    return {
        tc: statistics.quantiles(ts, n=100, method="inclusive")[int(f.fast_percentile) - 1]
        for tc, ts in times.items() if len(ts) >= f.fast_min_moves
    }


def after_loss_ids(cfg: Config, games: list[Game]) -> set[str]:
    """Games that started within after_loss_minutes of a lost game ending."""
    window = cfg.analysis.flags.after_loss_minutes * 60
    losses = sorted(g.row["end_ts"] for g in games if g.row["result"] == "loss")
    out = set()
    for g in games:
        start = g.row["start_ts"]
        if any(0 <= start - end <= window for end in losses if end <= start):
            out.add(g.id)
    return out


def build_records(cfg: Config, model: GameModel, evals1: dict[str, dict], evals2: dict[str, dict],
                  fast: dict[str, float], after_loss: set[str]) -> None:
    f, min_drop = cfg.analysis.flags, cfg.engine.triggers.min_drop
    moves = model.game.moves
    for i, ply in enumerate(model.plies):
        if not ply.mine or ply.drop < min_drop or ply.label == "best":
            continue
        if is_garbage_time(cfg, ply.win_before, ply.win_after):
            continue
        kb, ka = ply.move["key_before"], ply.move["key_after"]
        before2, after2 = evaluation(kb, evals2), evaluation(ka, evals2)
        source = "pass2" if before2 is not None and after2 is not None else "pass1"
        before = before2 if source == "pass2" else evaluation(kb, evals1)
        after = after2 if source == "pass2" else evaluation(ka, evals1)
        results = evals2 if source == "pass2" else {}
        info = classify(cfg, model.game, ply, moves[i - 1] if i else None, before, after, results)
        confirmed = None
        if source == "pass2":
            confirmed = for_side(position_win_pct(before2), ply.white) - for_side(position_win_pct(after2), ply.white) >= min_drop
        severity = band(cfg, ply.drop)
        flags = []
        if ply.win_before >= f.threw_win_before and ply.win_after < f.threw_win_after:
            flags.append("threw_away_win")
        if ply.phase in ("opening", "endgame"):
            flags.append(ply.phase)
        think, limit = ply.move["think_time"], fast.get(model.row["time_control"])
        if severity in ("mistake", "blunder") and think is not None and limit is not None and think < limit:
            flags.append("fast")
        if ply.move["clock"] is not None and ply.move["clock"] < f.time_trouble * model.row["base_seconds"]:
            flags.append("time_trouble")
        if model.id in after_loss:
            flags.append("after_loss")
        model.records.append(Record(
            game=model, ply=ply, severity=severity, primary=info["primary"], subtype=info["subtype"],
            rule=info["rule"], source=source, confirmed=confirmed, best_line=info["best_line"],
            reply_line=info["reply_line"], before_top=top(before), after_top=top(after), after_terminal=after.get("terminal"),
            net_after=info["net_after"], net_best=info["net_best"], themes=info["themes"], flags=flags,
            win_moves=info.get("win_moves"),
        ))


def loss_cause(cfg: Config, model: GameModel) -> LossCause | None:
    """Exactly one cause for every lost game (BRIEF.md, Why I lost)."""
    if model.row["result"] != "loss":
        return None
    l = cfg.analysis.losses
    final = model.my_win[-1]
    code = model.row["my_code"]
    if code == "timeout" and final >= l.playable:
        return LossCause("clock")
    if code in ("resigned", "abandoned") and final >= l.playable:
        return LossCause("gave_up")
    by_ply = {r.ply.number: r for r in model.records}
    for p in model.mine():
        if p.win_before >= l.turning_from and p.win_after <= l.turning_to and p.number in by_ply:
            r = by_ply[p.number]
            return LossCause(r.primary, r.subtype, r.flags, p, r)
    return LossCause("outplayed")


def thrown_win(cfg: Config, model: GameModel) -> ThrownWin | None:
    """A game where my Win% reached `winning` and I didn't win, with the move that threw it away."""
    if model.row["result"] == "win":
        return None
    wins = model.my_win
    first = next((i for i, w in enumerate(wins) if w >= cfg.analysis.losses.winning), None)
    if first is None:
        return None
    later = [p for p in model.plies[first:] if p.mine]
    return ThrownWin(max(wins), max(later, key=lambda p: p.drop, default=None))


def build_all(cfg: Config, games: list[Game], evals1: dict[str, dict], evals2: dict[str, dict],
              openings: dict[str, Opening]) -> list[GameModel]:
    """Every game with complete pass-1 results, with records, loss causes and thrown wins."""
    models = [m for g in games if (m := build_game(cfg, g, evals1, openings)) is not None]
    fast = think_thresholds(cfg, models)
    after_loss = after_loss_ids(cfg, games)
    for m in models:
        build_records(cfg, m, evals1, evals2, fast, after_loss)
        m.loss = loss_cause(cfg, m)
        m.thrown = thrown_win(cfg, m)
    return models
