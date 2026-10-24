// The in-browser Stockfish for Explore. Its evaluations are shown labelled "live" and are never stored or
// sent anywhere. Multi-threaded lite build when the page is cross-origin isolated (COOP/COEP headers),
// otherwise the single-threaded lite build, which works on any static host.
import { useEffect, useRef, useState } from "react";
import type { Eval } from "../types/export";

export const LIVE_LINES = 3;

export type LiveLine = { multipv: number; depth: number; eval: Eval; pv: string[] };
export type LiveState = {
  status: "off" | "loading" | "thinking" | "done" | "error";
  fen: string | null;
  lines: LiveLine[];
  depth: number;
  nps: number | null;
  engine: string;
  error?: string;
};

/** One UCI "info" line → a scored line from White's point of view, or null for lines without a usable score. */
export function parseInfo(line: string, whiteToMove: boolean): (LiveLine & { nps: number | null }) | null {
  if (!line.startsWith("info ")) return null;
  const t = line.trim().split(/\s+/);
  let depth: number | null = null, multipv = 1, cp: number | null = null, mate: number | null = null;
  let nps: number | null = null, bound = false, pv: string[] = [];
  for (let i = 1; i < t.length; i++) {
    switch (t[i]) {
      case "string": return null;
      case "depth": depth = Number(t[++i]); break;
      case "multipv": multipv = Number(t[++i]); break;
      case "nps": nps = Number(t[++i]); break;
      case "score": {
        const kind = t[++i], value = Number(t[++i]);
        if (kind === "cp") cp = value;
        else if (kind === "mate") mate = value;
        if (t[i + 1] === "lowerbound" || t[i + 1] === "upperbound") { bound = true; i++; }
        break;
      }
      case "pv": pv = t.slice(i + 1); i = t.length; break;
    }
  }
  if (depth == null || bound || !pv.length || (cp == null && mate == null)) return null;
  const s = whiteToMove ? 1 : -1;   // UCI scores are from the side to move
  return { multipv, depth, nps, pv, eval: { cp: cp == null ? null : cp * s, mate: mate == null ? null : mate * s } };
}

/** Which Stockfish build this page can run: multi-threaded when cross-origin isolated, else single-threaded. */
export function engineBuild(): { file: string; threads: number } {
  const threaded = typeof SharedArrayBuffer !== "undefined" && globalThis.crossOriginIsolated === true;
  const threads = threaded ? Math.max(1, Math.min((navigator.hardwareConcurrency || 2) - 1, 8)) : 1;
  return { file: `${import.meta.env.BASE_URL}engine/${threaded ? "stockfish-19-lite.js" : "stockfish-19-lite-single.js"}`, threads };
}

class LiveEngine {
  private worker: Worker;
  private ready = false;
  private searching = false;
  private stopping = false;
  private pending: string | null = null;
  private lines = new Map<number, LiveLine>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly threads: number;
  state: LiveState;

  constructor(private onChange: (s: LiveState) => void) {
    const build = engineBuild();
    this.threads = build.threads;
    this.state = { status: "loading", fen: null, lines: [], depth: 0, nps: null,
                   engine: `Stockfish 19 lite · ${this.threads === 1 ? "1 thread" : `${this.threads} threads`}` };
    this.worker = new Worker(build.file);
    this.worker.onmessage = (e) => this.onLine(String(e.data));
    this.worker.onerror = () => this.set({ status: "error", error: "The in-browser engine failed to load." });
    this.worker.postMessage("uci");
  }

  private send(cmd: string) { this.worker.postMessage(cmd); }

  private set(patch: Partial<LiveState>) {
    this.state = { ...this.state, ...patch };
    this.onChange(this.state);
  }

  private onLine(line: string) {
    if (line.startsWith("id name ")) {
      const threads = this.threads === 1 ? "1 thread" : `${this.threads} threads`;
      this.state.engine = `${line.slice(8).trim()} · ${threads}`;
    } else if (line === "uciok") {
      this.send(`setoption name MultiPV value ${LIVE_LINES}`);
      if (this.threads > 1) this.send(`setoption name Threads value ${this.threads}`);
      this.send("setoption name Hash value 64");
      this.send("isready");
    } else if (line === "readyok") {
      if (!this.ready) {
        this.ready = true;
        if (this.pending) this.start(this.pending);
      }
    } else if (line.startsWith("bestmove")) {
      this.searching = false;
      this.flush();
      if (this.pending) this.start(this.pending);
      else if (!this.stopping) this.set({ status: "done" });
      this.stopping = false;
    } else if (this.searching && !this.stopping && this.state.fen) {
      // While a stop is pending, info lines still belong to the old position and are dropped.
      const info = parseInfo(line, this.state.fen.split(" ")[1] !== "b");
      if (!info) return;
      this.lines.set(info.multipv, { multipv: info.multipv, depth: info.depth, eval: info.eval, pv: info.pv });
      if (info.nps) this.state.nps = info.nps;
      this.timer ??= setTimeout(() => this.flush(), 120);
    }
  }

  private flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const lines = [...this.lines.values()].sort((a, b) => a.multipv - b.multipv);
    this.set({ lines, depth: lines[0]?.depth ?? 0 });
  }

  private start(fen: string) {
    this.pending = null;
    this.stopping = false;
    this.searching = true;
    this.lines.clear();
    this.set({ status: "thinking", fen, lines: [], depth: 0 });
    this.send(`position fen ${fen}`);
    this.send(`go depth ${this.threads > 1 ? 24 : 20}`);
  }

  analyse(fen: string) {
    if (fen === this.state.fen && (this.searching || this.state.status === "done") && !this.pending) return;
    this.pending = fen;
    if (!this.ready) return;
    if (this.searching) {
      if (!this.stopping) { this.stopping = true; this.send("stop"); }
      return;
    }
    this.start(fen);
  }

  stop() {
    this.pending = null;
    if (this.searching && !this.stopping) { this.stopping = true; this.send("stop"); }
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.worker.terminate();
  }
}

const OFF: LiveState = { status: "off", fen: null, lines: [], depth: 0, nps: null, engine: "" };

/** Analyse `fen` live while it is non-null. The engine loads on first use and is shut down on unmount. */
export function useLiveEngine(fen: string | null): LiveState {
  const engine = useRef<LiveEngine | null>(null);
  const [state, setState] = useState<LiveState>(OFF);

  useEffect(() => {
    if (fen == null) {
      engine.current?.stop();
      return;
    }
    engine.current ??= new LiveEngine(setState);
    engine.current.analyse(fen);
  }, [fen]);

  useEffect(() => () => { engine.current?.destroy(); engine.current = null; }, []);

  return fen == null ? OFF : state;
}
