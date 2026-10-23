"""`coach review`: print mistake records with everything needed to check the rules by eye."""

from __future__ import annotations

import random

import chess
from rich.console import Console

from coach.model import Record, line_material, material_reference
from coach.positions import board_from_key
from coach.templates import eval_text


def _clock(seconds: float | None) -> str:
    if seconds is None:
        return "?"
    return f"{int(seconds // 60)}:{int(seconds % 60):02d}"


def _line(items: list[tuple[str, int]], first_ply: int) -> str:
    parts = []
    for i, (san, net) in enumerate(items):
        ply = first_ply + i
        number = f"{(ply + 1) // 2}." if ply % 2 == 1 else (f"{ply // 2}..." if i == 0 else "")
        parts.append(f"{number}{san} ({net:+d})")
    return " ".join(parts)


def pick(records: list[Record], n: int, tag: str | None, seed: int | None) -> list[Record]:
    pool = [r for r in records if tag is None or tag in r.tags]
    return random.Random(seed).sample(pool, min(n, len(pool)))


def show(console: Console, r: Record, index: int) -> None:
    move, me = r.ply.move, r.ply.white
    color = chess.WHITE if me else chess.BLACK
    before, after = board_from_key(move["key_before"]), board_from_key(move["key_after"])
    best = chess.Move.from_uci(r.best_line[0]) if r.best_line else None
    previous = r.game.game.moves[r.ply.number - 2] if r.ply.number > 1 else None
    reference, exchange = material_reference(before, chess.Move.from_uci(move["uci"]), best, previous)
    since = "from before the exchange" if exchange else "from before your move"
    console.rule(f"#{index} {r.id}  move {(r.ply.number + 1) // 2}, you are {'White' if me else 'Black'}")
    console.print(r.game.row["url"])
    console.print(move["fen_before"])
    console.print(str(chess.Board(move["fen_before"])), highlight=False)
    console.print(f"You played [bold]{move['san']}[/]: {r.severity}, Win% {r.ply.win_before:.0f} -> {r.ply.win_after:.0f} "
                  f"(drop {r.ply.drop:.1f}), think {move['think_time'] or 0:.1f}s, clock {_clock(move['clock'])}")
    console.print(f"Type: [bold]{r.primary}[/]" + (f" / {r.subtype}" if r.subtype else "")
                  + (f"   flags: {', '.join(r.flags)}" if r.flags else "")
                  + f"   ({r.source}{'' if r.confirmed is None else ', confirmed' if r.confirmed else ', not confirmed'})")
    console.print(f"Rule: {r.rule}")
    console.print(f"Material is your net material {since}, after each move.")
    console.print(f"After your move ({eval_text(r.after_top, me, r.after_terminal)}): "
                  + (_line(line_material(after, r.reply_line, color, reference), r.ply.number + 1) or "game over"), highlight=False)
    console.print(f"Best line ({eval_text(r.before_top, me)}): "
                  + _line(line_material(before, r.best_line, color, reference), r.ply.number), highlight=False)
