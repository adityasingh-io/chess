"""Opening names come from the vendored chess-openings dataset."""

from pathlib import Path

import chess

from coach.openings import Opening, load_openings, openings_dir
from coach.positions import position_key

ROOT = Path(__file__).resolve().parents[1]


def _key(*sans: str) -> str:
    board = chess.Board()
    for san in sans:
        board.push_san(san)
    return position_key(board)


def test_names_from_dataset(tmp_path):
    openings = load_openings(openings_dir(ROOT), tmp_path)
    assert openings[_key("e4", "c6")].family == "Caro-Kann Defense"
    advance = openings[_key("e4", "c6", "d4", "d5", "e5")]
    assert (advance.family, advance.variation) == ("Caro-Kann Defense", "Advance Variation")
    assert _key("h4", "a5", "Rh3", "Ra6", "Rg3") not in openings
    # the cached index gives the same answer
    assert load_openings.__wrapped__(openings_dir(ROOT), tmp_path) == openings


def test_name_parts():
    o = Opening("B90", "Sicilian Defense: Najdorf Variation, English Attack")
    assert (o.family, o.variation) == ("Sicilian Defense", "Najdorf Variation")
    assert Opening("C20", "King's Pawn Game").variation is None
