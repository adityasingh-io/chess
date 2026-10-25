"""The trainer's lines: which positions get every move scored, and the exported steps."""

import chess

from coach.positions import position_key
from coach.trainer import all_lines, repertoire_out, wanted


def test_every_legal_move_is_scored_where_the_drill_asks():
    # White line, asked from the start: both of White's positions get every legal move; Black's gets its line move.
    lines = [("white", "test", "repertoire", ["e2e4", "e7e5", "g1f3"], 0)]
    engine, stats = wanted(lines)
    board, expected = chess.Board(), set()
    for i, uci in enumerate(lines[0][3]):
        for move in list(board.legal_moves) if i in (0, 2) else [chess.Move.from_uci(uci)]:
            board.push(move)
            expected.add(position_key(board))
            board.pop()
        board.push_uci(uci)
    assert engine == expected and len(stats) == 3


def test_a_leak_line_asks_only_at_its_end():
    lines = [("white", "test", "leak", ["e2e4", "e7e5", "g1f3"], 2)]
    engine, _ = wanted(lines)
    board = chess.Board()
    board.push_uci("e2e4")
    board.push_uci("e7e5")
    assert len(engine) == 2 + board.legal_moves.count()


def test_export_has_a_step_per_move_and_every_move_where_it_asks(recorded):
    r = recorded
    (r.cfg.root / r.cfg.repertoire.pgn).write_text(
        '[Repertoire "white"]\n[Opening "Test"]\n\n1. d4 d5 2. c4 e6 (2... c6 3. Nf3) 3. Nc3 *\n'
        '\n[Repertoire "black"]\n[Opening "Test"]\n\n1. e4 c6 2. d4 d5 *\n')
    lines = all_lines(r.cfg, r.models, r.evals1)
    rep = repertoire_out(r.cfg, lines, r.evals1, {}, {}, {}, 0)
    assert len(rep.lines) >= 3 and len(rep.lines) == len(lines)
    for line in rep.lines:
        assert len(line.steps) == len(line.moves) and [s.san for s in line.steps] == line.san
        board = chess.Board()
        for i, (uci, step) in enumerate(zip(line.moves, line.steps)):
            asks = i >= line.start and board.turn == (chess.WHITE if line.colour == "white" else chess.BLACK)
            assert (step.key is not None) == asks
            if asks:
                alts = rep.positions[step.key]
                assert {a.uci for a in alts} == {m.uci() for m in board.legal_moves}
                wins = [a.win for a in alts if a.win is not None]
                assert wins == sorted(wins, reverse=True)
            board.push_uci(uci)
