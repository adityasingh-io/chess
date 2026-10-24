// Stockfish's evaluation beside a board, like chess.com's and Lichess's bars: White's share fills from
// White's side of the board. The fill is a Win% (stored, or the live engine's score run through the same
// formula) and the number is the score itself, written at the end of the side that is ahead.
import { useState } from "react";
import { barText, evalFor, n1 } from "../lib/format";
import type { Side } from "../lib/chess";
import type { Eval } from "../types/export";

/** What a bar shows: White's Win%, the score it came from, or the result once the game is over. A null
    win means the engine hasn't answered yet; the bar keeps its last fill. */
export type BarValue = { win: number | null; ev?: Eval | null; outcome?: Side | "draw" | null };

const RESULT = { white: "1-0", black: "0-1", draw: "½" } as const;

export function EvalBar({ value, orientation, me, live = false, note }: {
  value: BarValue; orientation: Side; me: Side; live?: boolean; note?: string;
}) {
  const [shown, setShown] = useState(value.win ?? 50);
  if (value.win != null && value.win !== shown) setShown(value.win);
  const pending = value.win == null;
  const { ev, outcome } = value;
  const text = outcome ? RESULT[outcome] : ev ? barText(ev) : pending ? "…" : "";
  const whiteAhead = outcome ? outcome !== "black" : ev ? (ev.mate != null ? ev.mate > 0 : (ev.cp ?? 0) >= 0) : shown >= 50;
  const atBottom = whiteAhead === (orientation === "white");
  const mine = me === "white" ? shown : 100 - shown;
  const title = pending ? "Waiting for the engine" : [
    outcome ? (outcome === "draw" ? "Drawn" : outcome === me ? "You won" : "You lost")
      : ev ? `Stockfish ${evalFor(ev, me)} for you` : null,
    `your Win% ${n1(mine)}`, note,
  ].filter(Boolean).join(" · ");
  return (
    <div className={`evalbar${orientation === "black" ? " flipped" : ""}${live ? " live" : ""}${pending ? " pending" : ""}`}
      role="img" aria-label={title} title={title} data-win={shown.toFixed(1)}>
      <div className="evalbar-fill" style={{ height: `${shown}%` }} />
      {text && <span className={`evalbar-text ${atBottom ? "bottom" : "top"} ${whiteAhead ? "on-white" : "on-black"}`}>{text}</span>}
    </div>
  );
}
