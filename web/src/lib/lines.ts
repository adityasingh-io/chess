// Repertoire trainer lines: the exported ones (repertoire PGN, coverage of my opponents' replies and leak
// positions) plus lines I added from the opening tree. Each is an FSRS card with the id r-<line id>. A line
// I left with my own move in a game since I last drilled it comes first among the lines to review.
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
      san: lineSan(START, l.moves), start: 0, steps: [], slips: [], slip_games: 0 })),
  ], [rep, p]);
}

/** I left the line with my own move in a game after I last drilled it (or haven't drilled it yet). */
export const slipped = (l: Line, p: Progress) => l.slips.length > 0 && l.slips[0].ts * 1000 > (p.items[cardId(l)]?.updated ?? 0);
/** Lines to review: ones I slipped on in a game, latest slip first, then ones due by the end of today. */
export const dueLines = (lines: Line[], p: Progress) => [
  ...lines.filter((l) => slipped(l, p)).sort((a, b) => b.slips[0].ts - a.slips[0].ts),
  ...lines.filter((l) => !slipped(l, p) && isDue(p.items[cardId(l)], endOfToday())),
];
export const newLines = (lines: Line[], p: Progress) => lines.filter((l) => !p.items[cardId(l)] && !slipped(l, p));
