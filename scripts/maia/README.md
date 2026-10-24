# Maia-2 for Play on

`web/public/maia/maia2-rapid.onnx` is Maia-2's rapid model (CSSLab, MIT licence, `LICENSE-maia2.txt` beside
it), exported to ONNX with its weights stored as float16 and cast back to float32 when it loads, so it's half
the size and computes exactly as before. It only picks the bot's moves in Play on (see docs/PLAN.md).

To remake it (needs PyTorch, so it runs in its own environment, not the pipeline's):

```bash
uv venv maia-env --python 3.12
uv pip install --python maia-env/bin/python maia2==0.11.0 onnx onnxruntime onnxscript onnxconverter-common
mkdir -p out
maia-env/bin/python -I scripts/maia/export.py out          # downloads the weights (checksum-checked by maia2)
maia-env/bin/python -I scripts/maia/half.py out/maia2-rapid.onnx web/public/maia/maia2-rapid.onnx
maia-env/bin/python -I scripts/maia/check.py out web/public/data/games      # variants against PyTorch
maia-env/bin/python -I scripts/maia/fixture.py out web/public/data/games web/tests/fixtures/maia.json
```

`check.py` compared the variants on 600 positions from my games at three ratings (2026-10-24): float32 and
float16 picked the same top move as PyTorch every time; 8-bit picked it 81% of the time (95% with only the
matrix multiplications in 8 bits), so it isn't used.

SHA-256 of the committed model: `ad61363a3ca2477810ae6537ffe7eee319c0dfaeca29b8944da965340c399385`.
