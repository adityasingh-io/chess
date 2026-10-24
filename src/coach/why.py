"""Why a move is good or bad, in words measured on the board along Stockfish's own lines.

Stockfish chose every line and gave every score. This only describes what happens on the board as a line
is played (python-chess, rules-level facts): what a move takes, attacks, pins or protects, whether it
moves a piece out of attack, checks, castles, develops a piece or promotes, and what each side captures
over the line. The sentences are templates filled from those facts; nothing here decides that a move is
good or bad. A mistake's text leads with the verdict: Stockfish's two scores, and what changes hands along
each of its lines.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

import chess

from coach.measure import PIECE_VALUES, balance
from coach.tactics import discovered_targets, pins

NAMES = {chess.PAWN: "pawn", chess.KNIGHT: "knight", chess.BISHOP: "bishop", chess.ROOK: "rook",
         chess.QUEEN: "queen", chess.KING: "king"}
COUNT = {2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight"}
CENTRE = (chess.D4, chess.E4, chess.D5, chess.E5)
HOME = {  # where each side's knights and bishops start: moving one off it develops it
    chess.WHITE: {chess.KNIGHT: (chess.B1, chess.G1), chess.BISHOP: (chess.C1, chess.F1)},
    chess.BLACK: {chess.KNIGHT: (chess.B8, chess.G8), chess.BISHOP: (chess.C8, chess.F8)},
}
MAX_LISTED = 2  # attacked or protected pieces named per move, most valuable first


def join(parts: list[str]) -> str:
    return parts[0] if len(parts) == 1 else f"{', '.join(parts[:-1])} and {parts[-1]}"


def the(board: chess.Board, square: chess.Square) -> str:
    """'the knight on f6', or 'the king'."""
    t = board.piece_type_at(square)
    return "the king" if t == chess.KING else f"the {NAMES[t]} on {chess.square_name(square)}"


def pieces(types: list[int]) -> str:
    """'the queen', 'a rook and a pawn', 'two pawns'."""
    counts = Counter(types)
    parts = []
    for t in sorted(counts, key=lambda t: -PIECE_VALUES[t]):
        n = counts[t]
        if n == 1:
            parts.append(f"the {NAMES[t]}" if t == chess.QUEEN else f"a {NAMES[t]}")
        else:
            parts.append(f"{COUNT.get(n, n)} {NAMES[t]}s")
    return join(parts)


def _listed(board: chess.Board, squares) -> list[str]:
    ranked = sorted(squares, key=lambda s: (-PIECE_VALUES.get(board.piece_type_at(s), 100), s))
    return [the(board, s) for s in ranked[:MAX_LISTED]]


def move_facts(board: chess.Board, move: chess.Move, took_on: chess.Square | None = None) -> list[str]:
    """What a move does on the board, as phrases: 'takes the pawn on d5', 'attacks the queen on c2'.

    `took_on` is where the opponent's previous move captured, so taking on that square is taking back.
    """
    side, piece = board.turn, board.piece_at(move.from_square)
    after = board.copy(stack=False)
    after.push(move)
    out = []
    if board.is_castling(move):
        out.append("castles " + ("kingside" if board.is_kingside_castling(move) else "queenside"))
    elif board.is_en_passant(move):
        out.append("takes the pawn en passant")
    elif board.is_capture(move):
        out.append(f"{'takes back' if move.to_square == took_on else 'takes'} {the(board, move.to_square)}")
    if move.promotion:
        out.append(f"promotes to a {NAMES[move.promotion]}")
    if move.from_square in HOME[side].get(piece.piece_type, ()):
        out.append(f"develops the {NAMES[piece.piece_type]}")
    if piece.piece_type == chess.PAWN and move.to_square in CENTRE and not board.is_capture(move):
        out.append(f"puts a pawn in the centre on {chess.square_name(move.to_square)}")
    value = PIECE_VALUES.get(piece.piece_type, 100)
    # A piece that was attacked by something cheaper, or attacked with no defender, and isn't attacked now.
    if piece.piece_type not in (chess.PAWN, chess.KING) and not after.is_attacked_by(not side, move.to_square):
        attackers = board.attackers(not side, move.from_square)
        if attackers and (min(PIECE_VALUES.get(board.piece_type_at(s), 100) for s in attackers) < value
                          or not board.is_attacked_by(side, move.from_square)):
            out.append(f"moves {the(board, move.from_square)} out of attack")
    if after.is_checkmate():
        return [*out, "is checkmate"]
    if after.is_check():
        out.append("gives check")
    if board.is_castling(move):
        return out
    enemy = chess.SquareSet(after.occupied_co[not side])
    before = board.attacks(move.from_square)

    def threatened(s: chess.Square) -> bool:
        """Attacked and either worth more than the attacker or not defended at all."""
        t = after.piece_type_at(s)
        return t != chess.KING and (PIECE_VALUES[t] > value or not after.is_attacked_by(not side, s))

    attacked = [s for s in after.attacks(move.to_square) & enemy if s not in before and threatened(s)]
    if attacked:
        out.append(f"attacks {join(_listed(after, attacked))}")
    opened = [s for s in discovered_targets(after, move)
              if after.piece_type_at(s) not in (chess.KING, chess.PAWN) and s not in attacked]
    if opened:
        out.append(f"opens an attack on {join(_listed(after, opened))}")
    pinned_before = {(p, b) for pinner, p, b in pins(board, side) if pinner == move.from_square}
    for pinner, pinned, behind in pins(after, side):
        if pinner == move.to_square and (pinned, behind) not in pinned_before and after.piece_type_at(pinned) != chess.PAWN:
            out.append(f"pins {the(after, pinned)} to {the(after, behind)}")
    # Pieces that were attacked with no defender before the move and have one now.
    own = chess.SquareSet(after.occupied_co[side])
    guarded = [s for s in after.attacks(move.to_square) & own
               if s not in before and after.piece_type_at(s) != chess.KING and after.is_attacked_by(not side, s)
               and not board.is_attacked_by(side, s)]
    if guarded:
        out.append(f"protects {join(_listed(after, guarded))}")
    return out


def move_sentence(board: chess.Board, move: chess.Move, took_on: chess.Square | None = None) -> str:
    """'Attacks the pawn on d5.' (empty when the move does none of the measured things)."""
    facts = move_facts(board, move, took_on)
    if not facts:
        return ""
    text = join(facts)
    return f"{text[0].upper()}{text[1:]}."


@dataclass
class Trade:
    """What each side captures along a line, from `me`'s point of view."""
    mine: list[int] = field(default_factory=list)      # piece types I take
    theirs: list[int] = field(default_factory=list)    # piece types they take
    promoted: list[bool] = field(default_factory=list)  # True for my promotions, False for theirs
    net: int = 0                                      # my material balance at the end minus at the start
    mated: bool | None = None                         # the line ends in checkmate: True if I'm mated


def trade(board: chess.Board, line: list[str], me: chess.Color, plies: int) -> Trade:
    """Captures, promotions and net material along up to `plies` moves of the line (stops at an illegal move)."""
    t = Trade()
    b = board.copy(stack=False)
    start = balance(b, me)
    for uci in line[:plies]:
        move = chess.Move.from_uci(uci)
        if move not in b.legal_moves:
            break
        if b.is_capture(move):
            taken = chess.PAWN if b.is_en_passant(move) else b.piece_type_at(move.to_square)
            (t.mine if b.turn == me else t.theirs).append(taken)
        if move.promotion:
            t.promoted.append(b.turn == me)
        b.push(move)
    t.net = balance(b, me) - start
    # Like-for-like captures cancel out, so a long line says what changed hands in the end.
    both = Counter(t.mine) & Counter(t.theirs)
    t.mine, t.theirs = list((Counter(t.mine) - both).elements()), list((Counter(t.theirs) - both).elements())
    if b.is_checkmate():
        t.mated = b.turn == me
    return t


def outcome(t: Trade) -> str:
    """'you win the queen for a rook (+4 in material)', '' when no material changes hands."""
    if t.mated is not None:
        return "you get checkmated" if t.mated else "it ends in checkmate"
    mine, theirs = sum(PIECE_VALUES[p] for p in t.mine), sum(PIECE_VALUES[p] for p in t.theirs)
    if not t.mine and not t.theirs:
        text = ""
    elif not t.theirs:
        text = f"you win {pieces(t.mine)}"
    elif not t.mine:
        text = f"you lose {pieces(t.theirs)}"
    elif mine > theirs:
        text = f"you win {pieces(t.mine)} for {pieces(t.theirs)}"
    elif mine < theirs:
        text = f"you give up {pieces(t.theirs)} for {pieces(t.mine)}"
    else:
        text = f"you trade {pieces(t.theirs)} for {pieces(t.mine)}"
    if any(t.promoted):
        text = f"{text} and promote" if text else "you promote"
    if not all(t.promoted):
        text = f"{text} and they promote" if text else "they promote"
    if text and t.net:
        text += f" ({t.net:+d} in material)"
    return text


def gist(t: Trade) -> str:
    """What changes hands along a line, said of the move that starts it: 'wins a pawn', 'loses the queen',
    'wins a rook for a knight', 'ends in checkmate', 'keeps the material level'."""
    if t.mated is not None:
        return "gets you checkmated" if t.mated else "ends in checkmate"
    mine, theirs = sum(PIECE_VALUES[p] for p in t.mine), sum(PIECE_VALUES[p] for p in t.theirs)
    if not t.mine and not t.theirs:
        text = ""
    elif not t.theirs:
        text = f"wins {pieces(t.mine)}"
    elif not t.mine:
        text = f"loses {pieces(t.theirs)}"
    elif mine > theirs:
        text = f"wins {pieces(t.mine)} for {pieces(t.theirs)}"
    elif mine < theirs:
        text = f"gives up {pieces(t.theirs)} for {pieces(t.mine)}"
    else:
        text = f"trades {pieces(t.theirs)} for {pieces(t.mine)}"
    if any(t.promoted):
        text = f"{text} and promotes" if text else "promotes"
    if not all(t.promoted):
        text = f"{text} and lets them promote" if text else "lets them promote"
    return text or "keeps the material level"


def verdict(best: str, best_score: str, best_trade: Trade, played: str, played_score: str, played_trade: Trade) -> str:
    """'In Stockfish's lines, fxe6+ (mate in 3) ends in checkmate; your Rxa7+ (+1.4) wins a pawn.' The scores are
    Stockfish's; the rest is counted along its two lines."""
    mates = best_trade.mated is not None or played_trade.mated is not None
    if not mates and best_trade.net == played_trade.net:
        return (f"In Stockfish's lines, {best} ({best_score}) and your {played} ({played_score}) end with the same "
                "material, so the difference is in the position, which only Stockfish's score measures.")
    text = (f"In Stockfish's lines, {best} ({best_score}) {gist(best_trade)}; "
            f"your {played} ({played_score}) {gist(played_trade)}.")
    if not mates and best_trade.net < played_trade.net:
        text += f" {best} ends with less material, so what it gains is in the position, which only Stockfish's score measures."
    return text


def _san(board: chess.Board, uci: str) -> chess.Move | None:
    move = chess.Move.from_uci(uci)
    return move if move in board.legal_moves else None


def reply_story(after: chess.Board, reply: list[str], line_from: chess.Board, line: list[str], me: chess.Color,
                plies: int, tell: bool = True) -> str:
    """'Stockfish answers Qxe4, which takes the knight on e4, and in its line you win a rook for a knight (+2 in
    material)'. `after` is the position the reply is played in; the trade is counted over `line` from `line_from`
    (left out when `tell` is false: the verdict has said it)."""
    first = _san(after, reply[0]) if reply else None
    told = outcome(trade(line_from, line, me, plies)) if tell else ""
    if first is None:
        return f"in Stockfish's line {told}" if told else ""
    facts = move_facts(after, first)
    text = f"Stockfish answers {after.san(first)}" + (f", which {join(facts)}" if facts else "")
    return f"{text}, and in its line {told}" if told else text


def mistake_why(fen: str, played: str, best_line: list[str], reply_line: list[str], me: chess.Color,
                plies: int, previous: tuple[str, str] | None = None, scores: tuple[str, str] | None = None) -> str:
    """What Stockfish's best move does and where its line goes, then the same for the move I played.

    Material is counted from the position before my move, so both lines start level. `previous` is (FEN
    before, UCI) of the opponent's move just before: if it captured and either move takes back on that
    square, the text says what it took first, so taking back doesn't read as winning a piece. With `scores`
    (Stockfish's score for its best move and for mine, as text), the verdict leads and says what each line
    wins or loses, so the moves after it only say what they do on the board.
    """
    board = chess.Board(fen)
    parts, trades = [], []
    best = _san(board, best_line[0]) if best_line else None
    took_on = None
    if previous:
        prev_board, prev = chess.Board(previous[0]), chess.Move.from_uci(previous[1])
        if prev in prev_board.legal_moves and prev_board.is_capture(prev):
            firsts = [m for m in (best, _san(board, played)) if m is not None]
            if any(m.to_square == prev.to_square and board.is_capture(m) for m in firsts):
                took_on = prev.to_square
                taken = chess.PAWN if prev_board.is_en_passant(prev) else prev_board.piece_type_at(prev.to_square)
                parts.append(f"{prev_board.san(prev)} had just taken your {NAMES[taken]} on {chess.square_name(took_on)}.")

    def traded(line: list[str], n: int) -> Trade:
        return trade(board, line, me, n)

    mine = _san(board, played)
    if scores and best is not None and mine is not None and best.uci() != played:
        head = verdict(board.san(best), scores[0], traded(best_line, plies), board.san(mine), scores[1],
                       traded([played, *reply_line], plies + 1))
        facts = move_facts(board, best, took_on)
        detail = [f"{board.san(best)} {join(facts)}." if facts else "",
                  played_why(board, played, reply_line, me, plies, took_on, "your ", tell=False)]
        return " ".join(p for p in [head, *parts, *detail] if p)

    if best is not None and best.uci() != played:
        facts = move_facts(board, best, took_on)
        t = traded(best_line, plies)
        trades.append(t)
        line = outcome(t)
        if facts or line:
            text = board.san(best) + (f" {join(facts)}" if facts else "")
            parts.append(f"{text}; in Stockfish's line {line}." if line and facts else
                         f"{text}." if facts else f"After {board.san(best)}, in Stockfish's line {line}.")
    if _san(board, played) is not None:
        trades.append(traded([played, *reply_line], plies + 1))
        text = played_why(board, played, reply_line, me, plies, took_on, "your ")
        if text:
            parts.append(text)
    if all(t.mated is None for t in trades):
        nets = [t.net for t in trades]
        if len(set(nets)) == 1:
            same = "Neither line changes the material" if not nets[0] else "Both lines end with the same material"
            parts.append(f"{same}, so the difference is in the position, which only Stockfish's score measures.")
        elif len(nets) == 2 and nets[0] < nets[1]:
            parts.append("Stockfish's line ends with less material than yours, so what it gains is in the position, "
                         "which only its score measures.")
    return " ".join(parts)


def played_why(board: chess.Board, played: str, reply: list[str], me: chess.Color, plies: int,
               took_on: chess.Square | None = None, whose: str = "", tell: bool = True) -> str:
    """'Nf3 develops the knight; Stockfish answers d5, which ..., and in its line you win a pawn (+1 in material).'

    `reply` is Stockfish's line after the move; the trade is counted over the move and up to `plies` of it
    (and left out when `tell` is false).
    """
    move = _san(board, played)
    if move is None:
        return ""
    after = board.copy(stack=False)
    after.push(move)
    facts = move_facts(board, move, took_on)
    story = reply_story(after, reply, board, [played, *reply], me, plies + 1, tell)
    san = board.san(move)
    if facts:
        return f"{whose.capitalize()}{san} {join(facts)}" + (f"; {story}." if story else ".")
    return f"After {whose}{san}, {story}." if story else ""


def solution_why(fen: str, solution: list[str]) -> str:
    """The puzzle's first move and what the whole solution wins."""
    board = chess.Board(fen)
    first = _san(board, solution[0]) if solution else None
    if first is None:
        return ""
    facts = move_facts(board, first)
    line = outcome(trade(board, solution, board.turn, len(solution)))
    text = board.san(first) + (f" {join(facts)}" if facts else "")
    if line and len(solution) > 1:
        return f"{text}. By the end of the solution {line}."
    if facts and (line or len(solution) == 1):
        return f"{text}."
    return (f"{text}. The solution doesn't change the material, so what it gains is in the position, which only "
            "Stockfish's score measures.")
