// Moving pieces on a training board: drag, or tap a piece and then a highlighted square. `onMove` says
// whether the move stands (a wrong answer snaps back). Rules-level only: the legal targets come from chess.js.
import { useMemo, useState } from "react";
import { targets } from "./chess";

export function useMoveInput(fen: string, enabled: boolean, onMove: (from: string, to: string) => boolean) {
  // The selection belongs to a position, so a new position clears it without an effect.
  const [sel, setSel] = useState<{ fen: string; square: string } | null>(null);
  const selected = enabled && sel?.fen === fen ? sel.square : null;
  const dots = useMemo(() => (selected ? targets(fen, selected) : []), [selected, fen]);
  if (!enabled) return { selected: null, dots: [] as string[] };
  return {
    selected,
    dots,
    onDrop: (from: string, to: string) => { setSel(null); return onMove(from, to); },
    onSquare: (square: string) => {
      if (selected && dots.includes(square)) { setSel(null); onMove(selected, square); return; }
      setSel(targets(fen, square).length ? { fen, square } : null);
    },
  };
}
