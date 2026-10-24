"""Record Maia-2 (PyTorch, rapid) outputs for the web tests: the move list, encodings and top moves.

argv: out_dir games_dir fixture_path"""
import glob
import json
import random
import sys

import chess
from maia2 import inference, model as maia_model

out_dir, games_dir, dest = sys.argv[1], sys.argv[2], sys.argv[3]
random.seed(7)
files = sorted(glob.glob(f"{games_dir}/[0-9]*.json"))
fens, ep = [], []
for f in random.sample(files, 60):
    g = json.load(open(f))
    b = chess.Board(g["initial_fen"])
    for i, m in enumerate(g["moves"]):
        if not b.is_game_over():
            (ep if b.fen().split()[3] != "-" else fens).append(b.fen())
        b.push_uci(m["uci"])
random.shuffle(fens)
# Both sides to move, a few with en passant and partial castling rights, opening to endgame.
picked = ep[:3] + [f for f in fens if f.split()[1] == "w"][:7] + [f for f in fens if f.split()[1] == "b"][:8]
picked += [f for f in fens if f.split()[2] not in ("-", "KQkq")][:2]

model = maia_model.from_pretrained(type="rapid", device="cpu", save_root=f"{out_dir}/weights")
prepared = inference.prepare()
all_moves_dict, elo_dict, _ = prepared
cases = []
for fen in picked:
    board, _, _, legal = inference.preprocessing(fen, 1000, 1029, elo_dict, all_moves_dict)
    case = {"fen": fen, "planes": [int(i) for i in board.flatten().nonzero().flatten().tolist()],
            "legal": [int(i) for i in legal.nonzero().flatten().tolist()], "top": {}}
    for elo in (980, 1165, 1350):
        probs, _ = inference.inference_each(model, prepared, fen, elo, 1029)
        case["top"][str(elo)] = [[m, p] for m, p in list(probs.items())[:3]]
    cases.append(case)
json.dump({"source": "maia2 0.11.0 rapid (PyTorch), opponent 1029", "moves": inference.get_all_possible_moves(),
           "categories": {str(e): inference.map_to_category(e, elo_dict) for e in (900, 1099, 1100, 1165, 1350, 1999, 2000, 2400)},
           "cases": cases}, open(dest, "w"), separators=(",", ":"))
print(len(cases), "cases;", sum(1 for c in cases if c["fen"].split()[3] != "-"), "with en passant")
