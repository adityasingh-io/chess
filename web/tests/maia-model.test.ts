// @vitest-environment node
// The committed Maia-2 model run as the app runs it (onnxruntime-web, WebAssembly) against recorded Maia-2 output
// from the Python package (tests/fixtures/maia.json): the same most likely move, with the same probability.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import * as ort from "onnxruntime-web/wasm";
import { category, encode, ranked } from "../src/lib/maia";

type Fixture = { cases: { fen: string; top: Record<string, [string, number][]> }[] };
const fixture = JSON.parse(readFileSync(join(__dirname, "fixtures/maia.json"), "utf8")) as Fixture;
const OPPONENT = 1029;   // the fixture's opponent rating (Lichess)

test("the browser model picks Maia-2's moves", async () => {
  ort.env.wasm.numThreads = 1;
  const model = readFileSync(join(__dirname, "../public/maia/maia2-rapid.onnx"));
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
  let n = 0;
  for (const c of fixture.cases) {
    const enc = encode(c.fen);
    for (const [elo, top] of Object.entries(c.top)) {
      const out = await session.run({
        board: new ort.Tensor("float32", enc.planes, [1, 18, 8, 8]),
        elo_self: new ort.Tensor("int64", BigInt64Array.from([BigInt(category(Number(elo)))]), [1]),
        elo_oppo: new ort.Tensor("int64", BigInt64Array.from([BigInt(category(OPPONENT))]), [1]),
      });
      const [best] = ranked(out.logits.data as Float32Array, enc);
      // Moves within half a percent of each other count as tied (float16 weights can swap a 0.0001 lead).
      const recorded = new Map(top);
      expect(recorded.has(best.uci), `${c.fen} at ${elo}: ${best.uci}`).toBe(true);
      expect(top[0][1] - recorded.get(best.uci)!, `${c.fen} at ${elo}`).toBeLessThan(0.005);
      expect(Math.abs(best.p - top[0][1]), `${c.fen} at ${elo}`).toBeLessThan(0.005);
      n++;
    }
  }
  expect(n).toBe(fixture.cases.length * 3);
}, 120_000);
