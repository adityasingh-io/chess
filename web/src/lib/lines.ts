// Repertoire trainer lines: the exported ones (repertoire PGN and leak positions) plus lines I added from
// the opening tree. Each is an FSRS card with the id r-<line id>.
import { useMemo } from "react";
import { useRepertoire } from "./data";
import { lineSan } from "./chess";
import { activeLines, endOfToday, isDue, useProgress, type Progress } from "./progress";
import type { RepertoireLine } from "../types/export";

export const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
export type Line = RepertoireLine | (Omit<RepertoireLine, "source"> & { source: "tree" });
export const cardId = (l: Line) => `r-${l.id}`;

export function useLines(): Line[] {
  const rep = useRepertoire();
  const p = useProgress();
  return useMemo(() => [
    ...rep.lines,
    ...activeLines(p).map((l): Line => ({ id: l.id, colour: l.colour, name: l.name, source: "tree", moves: l.moves,
      san: lineSan(START, l.moves), start: 0, steps: [] })),
  ], [rep, p]);
}

export const dueLines = (lines: Line[], p: Progress) => lines.filter((l) => isDue(p.items[cardId(l)], endOfToday()));
export const newLines = (lines: Line[], p: Progress) => lines.filter((l) => !p.items[cardId(l)]);
