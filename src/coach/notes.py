"""AI-worded coach notes (optional, off in config.toml): Claude rewords the templated explanation of my most
costly mistakes into a few friendlier sentences.

The model gets only stored Stockfish facts and may only rephrase them. Every reply is checked: each move
it names must be one of the facts' moves, each square must appear in them, and each number must be one of
the facts' numbers; a reply that fails is dropped and the template stays. Results are cached in SQLite by
the facts they were written from, so a note is asked for once.

Credentials are short-lived (docs/PLAN.md): an `ant auth login` profile on the Mac, Workload Identity
Federation in the nightly Action. The client is built with no key, and a stored ANTHROPIC_API_KEY is
refused rather than used. Nothing here runs in the browser.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import time
from collections.abc import Callable
from dataclasses import dataclass

from dotenv import dotenv_values

from coach.config import Config
from coach.model import GameModel, Record
from coach.templates import eval_text, explain, line_san, move_san

PROMPT_VERSION = "1"
SCHEMA = """
CREATE TABLE IF NOT EXISTS notes (
    record_id   TEXT NOT NULL,
    facts_hash  TEXT NOT NULL,              -- sha256 of the facts text, the model and the prompt version
    model       TEXT NOT NULL,
    note        TEXT,                       -- NULL: the reply failed the checks, keep the template
    created_at  INTEGER NOT NULL,
    PRIMARY KEY (record_id, facts_hash)
);
"""

SYSTEM = """You reword short chess coaching notes for a club player rated about 650.

You are given facts that the Stockfish engine produced about one of the player's mistakes, and a
templated explanation built from them. Rewrite the explanation as 2 or 3 plain, friendly sentences that
speak to the player as "you".

Rules:
- Use only the facts given. Do not add any move, line, square, evaluation, number or judgement that is
  not in the facts, and do not say why a move is good or bad beyond what the facts state.
- Write moves exactly as they appear in the facts (for example Qxe7 or 30. Qxc5), and numbers as digits.
- No headings, lists or quotation marks. Reply with the sentences only."""

MOVE_NUMBER = re.compile(r"\b\d+\.(?:\.\.)?\s*(?=[KQRBNOa-h])")
SAN = re.compile(r"\b(?:O-O(?:-O)?|[KQRBN][a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?|[a-h]x[a-h][1-8](?:=[QRBN])?|[a-h][1-8]=[QRBN])[+#]?")
SQUARE = re.compile(r"\b[a-h][1-8]\b")
NUMBER = re.compile(r"(?<![\w.])[-+−]?\d+(?:\.\d+)?")
NUMBER_WORDS = re.compile(r"\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b", re.I)

# As in web/src/lib/names.ts.
TAGS = {
    "allowed_mate": "allowed mate", "hung_piece": "hung a piece", "tactic": "walked into a tactic",
    "missed_mate": "missed mate", "missed_win": "missed a win", "quiet": "quiet mistake",
    "free_material": "free material", "other": "other tactic", "threw_away_win": "threw away a win",
    "opening": "in the opening", "endgame": "in the endgame", "fast": "played fast",
    "time_trouble": "in time trouble", "after_loss": "game started right after a loss",
}


@dataclass(frozen=True)
class Facts:
    record_id: str
    text: str           # what the model sees
    template: str


def facts(r: Record) -> Facts:
    move = r.ply.move
    white = r.ply.white
    number = (r.ply.number + 1) // 2
    played = f"{number}{'.' if white else '...'}{move['san']}"
    best = move_san(move["fen_before"], r.best_line[0] if r.best_line else None)
    template = explain(r)
    # No FEN: the model is not to read the position, only to reword what Stockfish found in it.
    lines = [
        f"You played: {played}",
        f"Your Win% before the move: {r.ply.win_before:.1f}; after it: {r.ply.win_after:.1f}; lost: {r.ply.drop:.1f}",
        f"Stockfish's score after your move: {eval_text(r.after_top, white, r.after_terminal)}",
        f"Stockfish's line after your move: {line_san(move['fen_after'], r.reply_line) or 'none'}",
        f"Material at the end of that line, against before your move: {r.net_after:+d}",
    ]
    if best:
        lines += [
            f"Stockfish's best move instead: {number}{'.' if white else '...'}{best}, with a score of {eval_text(r.before_top, white)}",
            f"Stockfish's line from the best move: {line_san(move['fen_before'], r.best_line)}",
        ]
        if r.net_best is not None:
            lines.append(f"Material at the end of the best line: {r.net_best:+d}")
    lines += [f"Mistake type: {', '.join(TAGS.get(t, t.replace('_', ' ')) for t in r.tags)}", f"Template explanation: {template}"]
    return Facts(r.id, "\n".join(lines), template)


def _bare(san: str) -> str:
    return re.sub(r"^\d+\.+", "", san).rstrip("+#")


def check(note: str, f: Facts) -> str | None:
    """None if the note passes; otherwise why it fails."""
    sentences = [s for s in re.split(r"(?<=[.!?])\s+", MOVE_NUMBER.sub("", note.strip())) if s]
    if not 1 <= len(sentences) <= 4 or len(note) > 600:
        return "length"
    allowed_moves = {_bare(m) for m in SAN.findall(f.text)}
    for m in SAN.findall(note):
        if _bare(m) not in allowed_moves:
            return f"move {m} is not in the facts"
    rest = SAN.sub(" ", note)
    for sq in SQUARE.findall(rest):
        if sq not in f.text:
            return f"square {sq} is not in the facts"
    given = [_num(n) for n in NUMBER.findall(f.text)]
    allowed_numbers = {*given, *(float(round(n)) for n in given)}  # 45.3 may be said as 45
    for n in NUMBER.findall(SQUARE.sub(" ", rest)):
        if _num(n) not in allowed_numbers:
            return f"number {n} is not in the facts"
    if NUMBER_WORDS.search(note):
        return "a number written as a word"
    return None


def _num(s: str) -> float:
    return abs(float(s.replace("−", "-").lstrip("+")))


def _key(f: Facts, model: str) -> str:
    return hashlib.sha256(f"{PROMPT_VERSION}\n{model}\n{f.text}".encode()).hexdigest()


def costliest(cfg: Config, models: list[GameModel]) -> list[Record]:
    """My N most costly mistakes that pass 2 confirms, by Win% lost (newest first on ties)."""
    records = [r for m in models for r in m.records if r.confirmed]
    records.sort(key=lambda r: (-r.ply.drop, -r.game.row["start_ts"], r.ply.number))
    return records[: cfg.notes.count]


def load(conn: sqlite3.Connection, cfg: Config, records: list[Record]) -> dict[str, str]:
    """Cached notes that pass for these records (record id -> note)."""
    conn.executescript(SCHEMA)
    out = {}
    for r in records:
        f = facts(r)
        row = conn.execute("SELECT note FROM notes WHERE record_id = ? AND facts_hash = ?",
                           (r.id, _key(f, cfg.notes.model))).fetchone()
        if row and row["note"] and check(row["note"], f) is None:
            out[r.id] = row["note"]
    return out


Ask = Callable[[str], str]


def claude(cfg: Config) -> Ask:
    """Asks Claude with short-lived credentials only (profile or federation; see the module docstring)."""
    if "ANTHROPIC_API_KEY" in os.environ or "ANTHROPIC_API_KEY" in dotenv_values(cfg.root / ".env"):
        raise RuntimeError("ANTHROPIC_API_KEY is set; notes use an `ant auth login` profile or Workload Identity "
                           "Federation instead (docs/PLAN.md). Unset it to continue.")
    import anthropic  # optional: uv sync --extra notes

    client = anthropic.Anthropic(max_retries=3)

    def ask(text: str) -> str:
        reply = client.messages.create(
            model=cfg.notes.model, max_tokens=cfg.notes.max_tokens, system=SYSTEM,
            output_config={"effort": cfg.notes.effort},
            messages=[{"role": "user", "content": text}],
        )
        if reply.stop_reason != "end_turn":
            return ""
        return "".join(b.text for b in reply.content if b.type == "text").strip()

    return ask


def write(conn: sqlite3.Connection, cfg: Config, records: list[Record], ask: Ask, log: Callable[[str], None]) -> tuple[int, int]:
    """Ask for every record without a cached answer. Returns (notes kept, notes dropped)."""
    conn.executescript(SCHEMA)
    kept = dropped = 0
    for r in records:
        f = facts(r)
        key = _key(f, cfg.notes.model)
        if conn.execute("SELECT 1 FROM notes WHERE record_id = ? AND facts_hash = ?", (r.id, key)).fetchone():
            continue
        note = ask(f.text)
        problem = check(note, f) if note else "no reply"
        if problem:
            dropped += 1
            log(f"notes: {r.id} kept the template ({problem})")
        else:
            kept += 1
        conn.execute("INSERT OR REPLACE INTO notes VALUES (?, ?, ?, ?, ?)",
                     (r.id, key, cfg.notes.model, None if problem else note, int(time.time())))
        conn.commit()
    return kept, dropped


def dump(conn: sqlite3.Connection) -> str:
    """Every cached note, for review."""
    conn.executescript(SCHEMA)
    rows = conn.execute("SELECT record_id, model, note FROM notes ORDER BY created_at").fetchall()
    return json.dumps([dict(r) for r in rows], indent=1)
