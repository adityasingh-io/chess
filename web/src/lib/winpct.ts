// Win% from a Stockfish score, ported from src/coach/winpct.py (Lichess's formula): centipawns are clamped
// to ±1000 and a mate counts as ±1000. Pure maths; the scores themselves come from the exports or the
// live engine, always from White's point of view.
import type { Eval } from "../types/export";

const CP_CEILING = 1000;
const WIN_MULTIPLIER = -0.00368208;

export function winFromCp(cp: number): number {
  const c = Math.max(-CP_CEILING, Math.min(CP_CEILING, cp));
  const chances = 2 / (1 + Math.exp(WIN_MULTIPLIER * c)) - 1;
  return 50 + 50 * Math.max(-1, Math.min(1, chances));
}

/** White's Win% for a score, or null when it has neither centipawns nor a mate. */
export function winOf(ev: Eval | null | undefined): number | null {
  if (!ev) return null;
  if (ev.mate != null) return winFromCp(ev.mate > 0 ? CP_CEILING : -CP_CEILING);
  return ev.cp == null ? null : winFromCp(ev.cp);
}

/** White's Win% for a finished game, scored as the pipeline scores game-over positions. */
export const winOfOutcome = (o: "white" | "black" | "draw") => (o === "draw" ? 50 : winFromCp(o === "white" ? CP_CEILING : -CP_CEILING));
