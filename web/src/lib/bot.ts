// Play on's bots: who answers a move played on a Compare board. Stockfish at full strength (opponent.ts), or
// Maia-2 playing like players at a chess.com rating (maia.ts, run in maia.worker.ts). A bot's moves are only
// played on the board; they're never scored by the bot, stored or sent anywhere. The choice stays on this device.
import { useState, useSyncExternalStore } from "react";
import { category } from "./maia";
import type { MaiaReply, MaiaRequest } from "./maia.worker";
import { useOpponent } from "./opponent";
import type { Bots } from "../types/export";

export type BotChoice = "off" | "stockfish" | `maia-${number}`;
export type BotMove = { uci: string; by: string; p?: number };
const KEY = "coach-bot";

/** One Maia-2 worker for the page, started on first use; `progress` is the model download (0 to 1). */
class MaiaClient {
  private worker: Worker | null = null;
  private next = 1;
  private waiting = new Map<number, { ok: (m: { uci: string; p: number }[]) => void; fail: (e: Error) => void }>();
  private listeners = new Set<() => void>();
  progress: number | null = null;

  subscribe = (f: () => void) => { this.listeners.add(f); return () => { this.listeners.delete(f); }; };
  private start() {
    const w = new Worker(new URL("./maia.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<MaiaReply>) => {
      const r = e.data;
      if ("progress" in r) { this.progress = r.progress; this.listeners.forEach((f) => f()); return; }
      const job = this.waiting.get(r.id);
      this.waiting.delete(r.id);
      if ("error" in r) job?.fail(new Error(r.error)); else job?.ok(r.moves);
    };
    w.onerror = () => {
      for (const job of this.waiting.values()) job.fail(new Error("Maia-2 couldn't start in this browser."));
      this.waiting.clear();
      this.worker = null;
    };
    return w;
  }
  /** The moves players in rating bucket `elo` most often play in `fen` against `oppo`, most likely first. */
  ask(fen: string, elo: number, oppo: number) {
    this.worker ??= this.start();
    const id = this.next++;
    const msg: MaiaRequest = { id, url: `${import.meta.env.BASE_URL}maia/maia2-rapid.onnx`, fen, elo, oppo };
    return new Promise<{ uci: string; p: number }[]>((ok, fail) => {
      this.waiting.set(id, { ok, fail });
      this.worker!.postMessage(msg);
    });
  }
}
const maia = new MaiaClient();

const valid = (c: string, bots: Bots): c is BotChoice =>
  c === "off" || c === "stockfish" || bots.maia.some((m) => c === `maia-${m.chesscom}`);

/** The chosen bot (kept on this device) and a function that asks it for a move. */
export function useBot(bots: Bots) {
  const [choice, setChoiceState] = useState<BotChoice>(() => {
    try { const c = localStorage.getItem(KEY); return c && valid(c, bots) ? c : "stockfish"; } catch { return "stockfish"; }
  });
  const setChoice = (c: BotChoice) => {
    setChoiceState(c);
    try { localStorage.setItem(KEY, c); } catch { /* storage blocked: the choice lasts for this page */ }
  };
  const stockfish = useOpponent(20);
  const progress = useSyncExternalStore(maia.subscribe, () => maia.progress);
  const level = choice.startsWith("maia-") ? bots.maia.find((m) => `maia-${m.chesscom}` === choice) ?? null : null;
  const name = level ? `Maia ~${level.chesscom}` : choice === "stockfish" ? "Stockfish" : null;

  /** The bot's move in `fen`, or null when it has none (or nobody answers). */
  const move = async (fen: string): Promise<BotMove | null> => {
    if (choice === "stockfish") {
      const uci = await stockfish.move(fen);
      return uci ? { uci, by: "Stockfish" } : null;
    }
    if (!level) return null;
    const moves = await maia.ask(fen, category(level.lichess), category(bots.me_lichess ?? level.lichess));
    return moves[0] ? { uci: moves[0].uci, by: name!, p: moves[0].p } : null;
  };
  return { choice, setChoice, move, level, name, progress, failed: stockfish.failed };
}
