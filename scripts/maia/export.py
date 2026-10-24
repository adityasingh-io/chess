"""Export Maia-2 rapid to ONNX: inputs board [N,18,8,8] float32, elo_self/elo_oppo [N] int64; outputs move logits and value."""
import sys
import torch
from maia2 import model as maia_model

out_dir = sys.argv[1]
m = maia_model.from_pretrained(type="rapid", device="cpu", save_root=f"{out_dir}/weights")
m.eval()


class Wrap(torch.nn.Module):
    def __init__(self, inner):
        super().__init__()
        self.inner = inner

    def forward(self, board, elo_self, elo_oppo):
        logits, _side, value = self.inner(board, elo_self, elo_oppo)
        return logits, value


w = Wrap(m).eval()
board = torch.zeros(1, 18, 8, 8)
elo = torch.zeros(1, dtype=torch.long)
torch.onnx.export(
    w, (board, elo, elo), f"{out_dir}/maia2-rapid.onnx",
    input_names=["board", "elo_self", "elo_oppo"], output_names=["logits", "value"],
    dynamic_axes={"board": {0: "n"}, "elo_self": {0: "n"}, "elo_oppo": {0: "n"}, "logits": {0: "n"}, "value": {0: "n"}},
    opset_version=17, dynamo=False,
)
print("params", sum(p.numel() for p in m.parameters()))
