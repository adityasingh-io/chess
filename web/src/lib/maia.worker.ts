// Runs Maia-2 (maia.ts) with onnxruntime-web's WebAssembly backend, off the page's thread. The model is
// fetched once, with progress, and the service worker keeps it. One thread: enough for one position at a time.
import * as ort from "onnxruntime-web/wasm";
import { encode, ranked } from "./maia";

/** `elo` and `oppo` are Maia-2 rating buckets (maia.ts `category`): the mover's and the opponent's. */
export type MaiaRequest = { id: number; url: string; fen: string; elo: number; oppo: number };
export type MaiaReply =
  | { id: number; moves: { uci: string; p: number }[] }
  | { id: number; error: string }
  | { progress: number };

ort.env.wasm.numThreads = 1;
let session: Promise<ort.InferenceSession> | null = null;

async function load(url: string): Promise<ort.InferenceSession> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`The Maia-2 model didn't download (${res.status}).`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  let got = 0, told = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total && got - told > total / 50) { told = got; postMessage({ progress: got / total } satisfies MaiaReply); }
  }
  const bytes = new Uint8Array(got);
  let at = 0;
  for (const p of parts) { bytes.set(p, at); at += p.length; }
  postMessage({ progress: 1 } satisfies MaiaReply);
  return ort.InferenceSession.create(bytes, { executionProviders: ["wasm"] });
}

onmessage = async (e: MessageEvent<MaiaRequest>) => {
  const { id, url, fen, elo, oppo } = e.data;
  try {
    session ??= load(url);
    const s = await session;
    const enc = encode(fen);
    if (!enc.legal.length) { postMessage({ id, moves: [] } satisfies MaiaReply); return; }
    const out = await s.run({
      board: new ort.Tensor("float32", enc.planes, [1, 18, 8, 8]),
      elo_self: new ort.Tensor("int64", BigInt64Array.from([BigInt(elo)]), [1]),
      elo_oppo: new ort.Tensor("int64", BigInt64Array.from([BigInt(oppo)]), [1]),
    });
    postMessage({ id, moves: ranked(out.logits.data as Float32Array, enc).slice(0, 5) } satisfies MaiaReply);
  } catch (err) {
    session = null;
    postMessage({ id, error: err instanceof Error ? err.message : String(err) } satisfies MaiaReply);
  }
};
