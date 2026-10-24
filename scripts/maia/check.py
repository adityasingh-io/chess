"""Shrink the Maia-2 ONNX export and check each variant against the PyTorch model on positions from my games.

argv: out_dir games_dir"""
import glob
import json
import random
import sys

import chess
import numpy as np
import onnxruntime as ort
import torch
from onnxruntime.quantization import QuantType, quantize_dynamic
from maia2 import inference, model as maia_model

out_dir, games_dir = sys.argv[1], sys.argv[2]
fp32 = f"{out_dir}/maia2-rapid.onnx"

variants = {"fp32": fp32}
quantize_dynamic(fp32, f"{out_dir}/maia2-rapid.int8.onnx", weight_type=QuantType.QInt8)
variants["int8"] = f"{out_dir}/maia2-rapid.int8.onnx"
quantize_dynamic(fp32, f"{out_dir}/maia2-rapid.int8mm.onnx", weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gemm"])
variants["int8 matmul only"] = f"{out_dir}/maia2-rapid.int8mm.onnx"
try:
    import onnx
    from onnxconverter_common import float16
    m16 = float16.convert_float_to_float16(onnx.load(fp32), keep_io_types=True)
    onnx.save(m16, f"{out_dir}/maia2-rapid.fp16.onnx")
    variants["fp16"] = f"{out_dir}/maia2-rapid.fp16.onnx"
except ImportError:
    pass

# Positions from my games: every 3rd position of 120 random games.
random.seed(1)
files = sorted(glob.glob(f"{games_dir}/[0-9]*.json"))
fens = []
for f in random.sample(files, 120):
    g = json.load(open(f))
    b = chess.Board(g["initial_fen"])
    for i, m in enumerate(g["moves"]):
        if i % 3 == 0 and not b.is_game_over():
            fens.append(b.fen())
        b.push_uci(m["uci"])
fens = [f for f in fens if not chess.Board(f).is_game_over()][:600]

model = maia_model.from_pretrained(type="rapid", device="cpu", save_root=f"{out_dir}/weights")
prepared = inference.prepare()
all_moves_dict, elo_dict, rev = prepared
elos = [1000, 1150, 1350]   # Lichess: <1100, 1100-1199, 1300-1399

ref = {}
for fen in fens:
    for e in elos:
        probs, _ = inference.each(model, prepared, fen, e, 1050) if hasattr(inference, "each") else inference.inference_each(model, prepared, fen, e, 1050)
        ref[(fen, e)] = probs

def run(path):
    s = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    agree = n = 0
    worst = 0.0
    for fen in fens:
        for e in elos:
            board, es, eo, legal = inference.preprocessing(fen, e, 1050, elo_dict, all_moves_dict)
            logits, _ = s.run(None, {"board": board[None].numpy(), "elo_self": np.array([es], np.int64), "elo_oppo": np.array([eo], np.int64)})
            lg = np.where(legal.numpy() > 0, logits[0], -np.inf)
            p = np.exp(lg - lg.max()); p /= p.sum()
            top = rev[int(p.argmax())]
            if fen.split()[1] == "b":
                top = inference.mirror_move(top)
            r = ref[(fen, e)]
            best = next(iter(r))
            agree += top == best
            n += 1
            worst = max(worst, abs(float(p.max()) - r[best]))
    return agree / n, worst

import os
for name, path in variants.items():
    a, w = run(path)
    print(f"{name:18s} {os.path.getsize(path)/1e6:6.1f} MB  top move same as PyTorch {a:.1%}  worst top-prob gap {w:.3f}")
print("positions", len(fens), "x elos", len(elos))
