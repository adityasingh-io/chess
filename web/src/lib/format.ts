// Formatting only: every number shown is passed in from the exports or the live engine.
import type { Eval } from "../types/export";

const LOCALE = "en-GB";

export const day = (ts: number) => new Date(ts * 1000).toLocaleDateString(LOCALE, { day: "numeric", month: "short" });
export const dayYear = (ts: number) =>
  new Date(ts * 1000).toLocaleDateString(LOCALE, { day: "numeric", month: "short", year: "numeric" });
export const dateTime = (ts: number) =>
  new Date(ts * 1000).toLocaleString(LOCALE, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const n1 = (x: number) => x.toFixed(1);
export const grouped = (x: number) => Math.round(x).toLocaleString(LOCALE);
export const pct = (x: number) => `${Math.round(x)}%`;
export const signed = (x: number, digits = 1) => (x > 0 ? "+" : x < 0 ? "−" : "") + Math.abs(x).toFixed(digits);
export const perGame = (x: number) => (x < 0.005 ? "<0.01" : x < 0.1 ? x.toFixed(2) : x.toFixed(1));

/** "14. Qa5" for White's moves and "14…Rb6" for Black's. */
export const moveName = (ply: number, san: string) => `${Math.ceil(ply / 2)}${ply % 2 ? ". " : "…"}${san}`;

/** m:ss, or h:mm:ss for daily-length clocks. */
export function clock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** "10 min", "3 min + 2", from chess.com's "600" or "180+2". */
export function timeControl(tc: string) {
  const [base, inc] = tc.split("+").map(Number);
  if (!Number.isFinite(base)) return tc;
  const mins = base >= 60 ? `${+(base / 60).toFixed(1)} min` : `${base} s`;
  return inc ? `${mins} + ${inc}` : mins;
}

/** Stockfish's score from one side's point of view: "+0.8", "−2.3", "#3", "#−2". Scores arrive from White's view. */
export function evalFor(ev: Eval | null | undefined, side: "white" | "black") {
  if (!ev) return "–";
  const s = side === "black" ? -1 : 1;
  if (ev.mate != null) {
    const m = ev.mate * s;
    return m > 0 ? `#${m}` : `#−${-m}`;
  }
  return ev.cp == null ? "–" : signed((ev.cp * s) / 100);
}

/** The short score written on the eval bar, without a sign (its end of the bar says who is ahead): "0.8",
    "12", "M3". */
export function barText(ev: Eval) {
  if (ev.mate != null) return `M${Math.abs(ev.mate)}`;
  if (ev.cp == null) return "";
  const p = Math.abs(ev.cp) / 100;
  return p < 9.95 ? p.toFixed(1) : String(Math.round(p));
}

/** Split a SAN line as exported ("14...Rb6 15. Qa5 Rb8") into one label per move ("14…Rb6", "15. Qa5", "Rb8"). */
export function sanTokens(line: string): string[] {
  const out: string[] = [];
  let no = "";
  for (const t of line.split(/\s+/).filter(Boolean)) {
    if (/^\d+\.$/.test(t)) { no = t + " "; continue; }
    const black = /^(\d+)\.\.\.(.+)$/.exec(t);
    out.push(black ? `${black[1]}…${black[2]}` : no + t);
    no = "";
  }
  return out;
}

export const plural = (n: number, one: string, many = one + "s") => `${grouped(n)} ${n === 1 ? one : many}`;
