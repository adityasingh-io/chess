"""Where a game leaves the trainer's lines, and the coverage lines built from my opponents' replies."""

from dataclasses import replace

import chess

from coach.book import book, check
from coach.positions import position_key
from coach.repertoire import KEEP, SIDES, coverage_lines, line_id, usual_move
from coach.reports import tree


def _long_game(r):
    return next(m for m in r.models if len(m.plies) > 10)


def _other(m, i: int) -> str:
    """A legal move at ply i + 1 that isn't the one played."""
    board = chess.Board(m.plies[i].move["fen_before"])
    return next(mv.uci() for mv in board.legal_moves if mv.uci() != m.plies[i].move["uci"])


def test_a_game_leaves_my_lines_by_my_move_their_move_or_a_line_end(recorded):
    m = _long_game(recorded)
    colour, ucis = m.row["my_color"], [p.move["uci"] for p in m.plies]
    mine = next(i for i, p in enumerate(m.plies) if p.mine and i > 2)
    theirs = next(i for i, p in enumerate(m.plies) if not p.mine and i > 2)

    assert check(book([(colour, "L", "repertoire", ucis[:6], 0)]), m) == {
        "result": "end", "ply": 7, "san": m.plies[6].move["san"], "expected": [], "line": None}

    line = [*ucis[:mine], _other(m, mine)]
    c = check(book([(colour, "L", "repertoire", line, 0)]), m)
    board = chess.Board(m.plies[mine].move["fen_before"])
    assert c == {"result": "mine", "ply": mine + 1, "san": m.plies[mine].move["san"],
                 "expected": [board.san(chess.Move.from_uci(line[-1]))], "line": line_id(colour, line)}

    c = check(book([(colour, "L", "repertoire", [*ucis[:theirs], _other(m, theirs)], 0)]), m)
    assert c["result"] == "theirs" and c["ply"] == theirs + 1 and c["line"] is None

    # A second line with the game's move keeps the game in the lines: any line's move counts.
    both = book([(colour, "A", "repertoire", line, 0), (colour, "B", "coverage", ucis[: mine + 2], mine)])
    assert check(both, m)["result"] == "end"
    assert check(book([(colour, "L", "repertoire", ucis, 0)]), m) == {   # the game ended inside the line
        "result": "over", "ply": len(ucis) + 1, "san": None, "expected": [], "line": None}


def test_a_leak_line_teaches_only_its_last_move(recorded):
    m = _long_game(recorded)
    colour, ucis = m.row["my_color"], [p.move["uci"] for p in m.plies]
    leak = book([(colour, "L", "leak", ucis[:6], 5)])
    assert check(leak, m) is None   # the moves to the leak position aren't lines to follow
    assert check(book([("white" if colour == "black" else "black", "L", "repertoire", ucis[:4], 0)]), m) is None


def test_coverage_lines_follow_replies_seen_often_enough_and_my_move_where_stockfish_rates_it(recorded):
    r = recorded
    cfg = replace(r.cfg, repertoire=replace(r.cfg.repertoire, cover_min_games=2))
    pgn = [("white", "PGN", ["d2d4"])]
    lines = coverage_lines(cfg, r.models, r.evals1, pgn)
    assert lines
    for colour, name, moves, start in lines:
        me, nodes = SIDES[colour], tree(cfg, r.models, colour, r.evals1)
        board = chess.Board()
        assert name and len(moves) % 2 == (1 if me == chess.WHITE else 0)   # ends on my move
        for i, uci in enumerate(moves):
            node = nodes[position_key(board)]
            if board.turn == me:
                in_pgn = colour == "white" and i == 0
                usual = usual_move(node)
                kept = usual if node.moves[usual][0].label in KEEP else node.best
                assert uci == ("d2d4" if in_pgn else kept)
                assert (i < start) == in_pgn   # the drill asks from the first move the PGN doesn't have
            else:
                assert len({p.move["game_id"] for p in node.moves[uci]}) >= 2
            board.push_uci(uci)
