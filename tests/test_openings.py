"""Opening names come from the vendored chess-openings dataset, and Scid's ECO file adds positions to it."""

from pathlib import Path

import csv

import chess

from coach.openings import _INDEXES, Opening, load_openings, openings_dir, scid_lines
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
    _INDEXES.clear()
    assert load_openings(openings_dir(ROOT), tmp_path) == openings


def test_name_parts():
    o = Opening("B90", "Sicilian Defense: Najdorf Variation, English Attack")
    assert (o.family, o.variation) == ("Sicilian Defense", "Najdorf Variation")
    assert Opening("C20", "King's Pawn Game").variation is None


def test_scid_adds_positions_named_in_lichess_terms(tmp_path):
    """Scid's 1. d4 d5 2. c4 dxc4 3. e4 Nf6 4. Nc3, which Lichess's list doesn't name, is named after the deepest
    position Lichess's list names on that line (3...Nf6), and reached by another move order it's the same."""
    openings = load_openings(openings_dir(ROOT), tmp_path)
    alekhine = Opening("D20", "Queen's Gambit Accepted: Central Variation, Alekhine System")
    assert openings[_key("d4", "d5", "c4", "dxc4", "e4", "Nf6")] == alekhine          # Lichess's own position
    assert openings[_key("d4", "d5", "c4", "dxc4", "e4", "Nf6", "Nc3")] == alekhine   # Scid's, one move on
    assert openings[_key("d4", "d5", "c4", "Nf6", "Nc3", "dxc4", "e4")] == alekhine   # the same, transposed
    # Lichess's name wins where both lists name a position.
    assert openings[_key("d4", "d5", "c4", "Nf6")].name == "Queen's Gambit Declined: Marshall Defense"
    # Every name is one of Lichess's, and Scid adds thousands of positions.
    names = {row["name"] for path in openings_dir(ROOT).glob("*.tsv") for row in csv.DictReader(path.open(newline=""), delimiter="\t")}
    assert {o.name for o in openings.values()} <= names and len(openings) > 2 * len(names)


def test_scid_lines_read_codes_names_comments_and_wrapped_moves(tmp_path):
    eco = tmp_path / "scid.eco"
    eco.write_text('# a comment\nA00a "Start position"  *\nD20 "QGA: 3.e4"  1.d4 d5 2.c4 dxc4\n  3.e4 *\n'
                   'B10a "Caro-Kann: 2.Nc3"  1.e4 c6 2.Nc3 * # trailing comment\n')
    assert scid_lines(eco) == [[], ["d4", "d5", "c4", "dxc4", "e4"], ["e4", "c6", "Nc3"]]
