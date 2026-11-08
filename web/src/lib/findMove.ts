// Finding a move where every legal move has a stored score: a key moment (components/KeyMoment.tsx), or the answer
// to a rival's costly move (components/PrepBoard.tsx). A move whose stored label is Best, Excellent or Good finds
// one; any other is a miss, kept to show what it loses. Hint marks the piece the answer moves; Show ends it.
import { useRef, useState } from "react";
import type { KeyMove } from "../types/export";
import { tryMove } from "./chess";
import type { Outcome } from "./drill";
import { useMoveInput } from "./moveInput";

/** The labels that find a move: less than 5 Win% lost (config.toml, analysis.labels). */
export const FOUND = new Set(["best", "excellent", "good"]);
export type FindStatus = "play" | "found" | "shown";

export function useFindMove(fen: string, byUci: Map<string, KeyMove>, answer: KeyMove, onDone: (o: Outcome) => void) {
  const [status, setStatus] = useState<FindStatus>("play");
  const [wrong, setWrong] = useState(0);
  const [miss, setMiss] = useState<KeyMove | null>(null);
  const [hint, setHint] = useState(false);
  const [found, setFound] = useState<{ move: KeyMove; fen: string } | null>(null);
  const reported = useRef(false);

  const finish = (s: FindStatus, o: Outcome) => {
    setStatus(s);
    setMiss(null);
    if (!reported.current) { reported.current = true; onDone(o); }
  };
  const onMove = (from: string, to: string) => {
    if (status !== "play") return false;
    const mv = tryMove(fen, from, to, answer.uci.startsWith(from + to) ? answer.uci[4] : undefined);
    const x = mv ? byUci.get(mv.uci) : undefined;
    if (!mv || !x) return false;
    if (x.label && FOUND.has(x.label)) {
      setFound({ move: x, fen: mv.fen });
      finish("found", { solved: true, wrong, hint, revealed: false });
      return true;
    }
    setWrong((w) => w + 1);
    setMiss(x);
    return false;
  };
  const playing = status === "play";
  const input = useMoveInput(fen, playing, onMove);
  return {
    status, wrong, miss, hint, found, playing, input,
    selected: hint && playing ? answer.uci.slice(0, 2) : input.selected,
    showHint: () => setHint(true),
    reveal: () => finish("shown", { solved: false, wrong, hint, revealed: true }),
    retry: () => { setStatus("play"); setFound(null); setMiss(null); setHint(false); },
  };
}
