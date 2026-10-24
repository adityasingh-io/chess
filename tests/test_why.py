"""Measured explanations: rules-level facts about moves and lines, and agreement with the records' own numbers."""

import json
import re
from pathlib import Path

import chess

from coach.measure import balance, play_line
from coach.puzzles import lichess_puzzle
from coach.templates import scores, why
from coach.why import gist, move_facts, outcome, solution_why, trade, verdict

PUZZLES = json.loads((Path(__file__).parent / "fixtures" / "puzzles.json").read_text())["puzzles"]


def _board(*sans: str) -> chess.Board:
    board = chess.Board()
    for san in sans:
        board.push_san(san)
    return board


def _facts(board: chess.Board, san: str, took_on=None) -> list[str]:
    return move_facts(board, board.parse_san(san), took_on)


def test_development_attacks_and_castling():
    assert _facts(_board("e4", "e5"), "Nf3") == ["develops the knight", "attacks the pawn on e5"]
    assert _facts(_board("e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"), "O-O") == ["castles kingside"]
    assert _facts(_board(), "e4") == ["puts a pawn in the centre on e4"]
    assert _facts(_board("e4", "Nf6", "e5"), "Nd5") == ["moves the knight on f6 out of attack"]


def test_captures_taking_back_check_and_mate():
    board = _board("e4", "d5", "exd5")
    assert _facts(board, "Qxd5", took_on=chess.D5)[0] == "takes back the pawn on d5"
    assert _facts(_board("e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6"), "Qxf7#") == ["takes the pawn on f7", "is checkmate"]
    assert _facts(_board("e4", "e5", "Bc4", "Nc6"), "Bxf7+") == ["takes the pawn on f7", "gives check"]


def test_pins():
    assert "pins the knight on c3 to the king" in _facts(_board("d4", "Nf6", "c4", "e6", "Nc3"), "Bb4")


def test_like_for_like_trades_cancel():
    t = trade(_board("e4", "d5"), ["e4d5", "d8d5"], chess.WHITE, 10)
    assert (t.mine, t.theirs, t.net) == ([], [], 0) and outcome(t) == ""
    t = trade(_board("e4", "d5"), ["e4d5"], chess.WHITE, 10)
    assert outcome(t) == "you win a pawn (+1 in material)"
    t = trade(_board("e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6"), ["h5f7"], chess.WHITE, 10)
    assert t.mated is False and outcome(t) == "it ends in checkmate"


def test_verdict_names_both_moves_and_what_each_line_wins():
    """The scores are passed in (they're Stockfish's); placeholders here, since only the wording is tested."""
    start = _board("e4", "d5")
    pawn, level = trade(start, ["e4d5"], chess.WHITE, 10), trade(start, ["g1f3"], chess.WHITE, 10)
    assert gist(pawn) == "wins a pawn" and gist(level) == "keeps the material level"
    assert verdict("exd5", "S1", pawn, "Nf3", "S2", level) == \
        "In Stockfish's lines, exd5 (S1) wins a pawn; your Nf3 (S2) keeps the material level."
    assert verdict("Nf3", "S1", level, "exd5", "S2", pawn).endswith(
        "Nf3 ends with less material, so what it gains is in the position, which only Stockfish's score measures.")
    assert "end with the same material" in verdict("Nf3", "S1", level, "Nc3", "S2", level)
    mate = trade(_board("e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6"), ["h5f7"], chess.WHITE, 10)
    assert gist(mate) == "ends in checkmate"


def test_record_explanations_lead_with_the_verdict(recorded):
    """A recorded mistake's text starts with Stockfish's best move and my move, each with its stored score."""
    checked = 0
    for m in recorded.models:
        for r in m.records:
            move = r.ply.move
            if not r.best_line or r.best_line[0] == move["uci"]:
                continue
            best = chess.Board(move["fen_before"]).san(chess.Move.from_uci(r.best_line[0]))
            best_score, my_score = scores(r)
            assert why(r).startswith(f"In Stockfish's lines, {best} ({best_score}) "), (r.id, why(r))
            assert f"your {move['san']} ({my_score})" in why(r), (r.id, why(r))
            checked += 1
    assert checked > 20


def test_record_explanations_match_measured_material(recorded):
    """Every '(+N in material)' in a recorded mistake's explanation is the net material at the end of one of
    its two Stockfish lines, and every move it names is in one of those lines or the move just before."""
    checked = 0
    for m in recorded.models:
        for r in m.records:
            text = why(r)
            move, me = r.ply.move, r.ply.white
            board = chess.Board(move["fen_before"])
            nets = {balance(play_line(board, r.best_line, len(r.best_line)), me) - balance(board, me),
                    balance(play_line(board, [move["uci"], *r.reply_line], len(r.reply_line) + 1), me) - balance(board, me)}
            for n in re.findall(r"\(([+-]\d+) in material\)", text):
                assert int(n) in nets, (r.id, text)
            sans = {move["san"]}
            if r.ply.number >= 2:
                sans.add(r.game.plies[r.ply.number - 2].move["san"])
            for line, start in ((r.best_line, board), ([move["uci"], *r.reply_line], board)):
                b = start.copy()
                for uci in line:
                    sans.add(b.san(chess.Move.from_uci(uci)))
                    b.push_uci(uci)
            for token in re.findall(r"\b(?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h]x[a-h][1-8]|O-O(?:-O)?)[+#]?", text):
                assert token in sans or token.rstrip("+#") in {s.rstrip("+#") for s in sans}, (r.id, token, text)
            checked += 1
    assert checked > 20


def test_lichess_solutions():
    """Recorded Lichess puzzles: the explanation starts with the first solution move, and mate puzzles end in
    checkmate."""
    for row in PUZZLES:
        p = lichess_puzzle({**row, "OpeningTags": []})
        text = solution_why(p["fen"], p["solution"])
        assert text.startswith(p["solution_san"][0]), (row["PuzzleId"], text)
        if "mateIn1" in row["Themes"]:
            assert "is checkmate" in text, (row["PuzzleId"], text)
        elif "mate" in row["Themes"]:
            assert "checkmate" in text, (row["PuzzleId"], text)
