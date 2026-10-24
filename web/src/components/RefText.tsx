// Explanation text whose moves and squares show on the board: hover one (or focus it) to see it while the
// pointer stays, tap or click it to keep it shown until it's tapped again. The page owns the peek
// (usePeek) and passes it to its Board.
import { useMemo, useState, type FocusEvent, type PointerEvent } from "react";
import type { Peek } from "./Board";
import { segments, type RefLine } from "../lib/refs";
import type { Side } from "../lib/chess";

type State = { context: string; hover: Peek | null; pin: Peek | null; pinId: string | null };
export type PeekControl = {
  shown: Peek | null;
  pinId: string | null;
  hover: (p: Peek | null) => void;
  toggle: (id: string, p: Peek) => void;
};

/** What the board should show from the explanation. It clears itself when `context` changes (another move). */
export function usePeek(context: string): PeekControl {
  const empty: State = { context, hover: null, pin: null, pinId: null };
  const [s, set] = useState<State>(empty);
  const cur = s.context === context ? s : empty;
  const at = (x: State) => (x.context === context ? x : empty);
  return {
    shown: cur.hover ?? (cur.pin && { ...cur.pin, pinned: true }),
    pinId: cur.pinId,
    hover: (p) => set((x) => ({ ...at(x), hover: p })),
    toggle: (id, p) => set((x) => {
      const base = at(x);
      return base.pinId === id ? { ...base, hover: null, pin: null, pinId: null } : { ...base, hover: null, pin: p, pinId: id };
    }),
  };
}

/** Focus from the keyboard (not a tap or click, which pin instead). */
const keyboard = (e: FocusEvent) => { try { return e.target.matches(":focus-visible"); } catch { return false; } };
const describe = (p: Peek, text: string) => ("fen" in p ? `Show ${text} on the board` : `Show the square ${text} on the board`);

export function RefText({ id, text, lines, me, peek }: { id: string; text: string; lines: RefLine[]; me?: Side; peek: PeekControl }) {
  const segs = useMemo(() => segments(text, lines, me), [text, lines, me]);
  return segs.map((s, i) => {
    if (typeof s === "string") return s;
    const key = `${id}:${i}`;
    return (
      <button key={key} type="button" className={`ref ${"fen" in s.peek ? "move" : "square"}`} aria-pressed={peek.pinId === key}
        aria-label={describe(s.peek, s.text)}
        onPointerEnter={(e) => { if (e.pointerType === "mouse") peek.hover(s.peek); }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") peek.hover(null); }}
        onFocus={(e) => { if (keyboard(e)) peek.hover(s.peek); }}
        onBlur={() => peek.hover(null)}
        onClick={() => peek.toggle(key, s.peek)}>
        {s.text}
      </button>
    );
  });
}

/** Hover handlers for a chip that stands for a move (the line chips under an explanation). */
export function peekProps(peek: PeekControl, p: Peek | null) {
  if (!p) return {};
  return {
    onPointerEnter: (e: PointerEvent) => { if (e.pointerType === "mouse") peek.hover(p); },
    onPointerLeave: (e: PointerEvent) => { if (e.pointerType === "mouse") peek.hover(null); },
    onFocus: (e: FocusEvent) => { if (keyboard(e)) peek.hover(p); },
    onBlur: () => peek.hover(null),
  };
}
