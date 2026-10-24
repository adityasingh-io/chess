// The one board: react-chessboard with the walnut squares, highlights for the move just played and
// arrows for my move vs Stockfish's best. Arrow colours must be concrete values, so they come from
// useColors(); everything else styles through CSS variables. The board settings (lib/settings.ts) add
// square names, rings on hanging pieces and move sounds; a peek (hovering a move or square named in an
// explanation) shows that move or square on the board for as long as it lasts.
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Chessboard } from "react-chessboard";
import { hanging, moveBetween } from "../lib/chess";
import { useSettings } from "../lib/settings";
import { play } from "../lib/sound";
import { useColors } from "../lib/theme";

export type ArrowKind = "you" | "best" | "them" | "live";
export type HighlightKind = "you" | "best" | "them";
/** A move or square named in an explanation, shown while it's hovered or tapped: a move from the position
    before it (`fen`, with its arrow), or squares on the board as it is. */
export type Peek = ({ fen: string; uci: string; kind: ArrowKind } | { squares: string[] }) & { pinned?: boolean };

type Props = {
  id: string;
  fen: string;
  orientation: "white" | "black";
  label: string;
  arrows?: { uci: string; kind: ArrowKind }[];
  highlight?: { uci: string; kind: HighlightKind } | null;
  /** Tap-to-move: the selected square and where it can go. */
  selected?: string | null;
  dots?: string[];
  onDrop?: (from: string, to: string) => boolean;
  onSquare?: (square: string) => void;
  peek?: Peek | null;
  /** False while a drill asks for a move, so the hanging-piece rings don't give the answer away. */
  marks?: boolean;
  /** False where square names would give the answer away (the coordinates drill). */
  names?: boolean;
};

const notation: CSSProperties = { fontFamily: "var(--font-num)", fontWeight: 600, fontSize: "clamp(8px, 2.4cqw, 13px)" };
const fill = (c: string) => `linear-gradient(${c}, ${c})`;
const DOT = "radial-gradient(circle, rgba(13, 20, 27, .32) 17%, transparent 19%)";
const FILES = "abcdefgh";

export function Board({ id, fen, orientation, label, arrows = [], highlight, selected, dots = [], onDrop, onSquare, peek,
  marks = true, names = true }: Props) {
  const colors = useColors();
  const settings = useSettings();
  const interactive = !!onDrop || !!onSquare;
  // react-chessboard measures squares to animate a move and throws if they have no size (a hidden board),
  // so moves animate only while the board is laid out.
  const box = useRef<HTMLDivElement>(null);
  const [laidOut, setLaidOut] = useState(false);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    setLaidOut(el.getBoundingClientRect().width > 0);
    const ro = new ResizeObserver(([e]) => setLaidOut(e.contentRect.width > 0));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // A sound when the board steps one move forward; jumps and steps back are silent.
  const shown = useRef(fen);
  useEffect(() => {
    const before = shown.current;
    shown.current = fen;
    if (!settings.sounds || before === fen) return;
    const m = moveBetween(before, fen);
    if (m) play(m.check || m.mate ? "check" : m.capture ? "capture" : m.castle ? "castle" : "move");
  }, [fen, settings.sounds]);

  // A tapped move or square brings the board back into view when it's scrolled right off the screen.
  useEffect(() => {
    const el = box.current;
    if (!peek?.pinned || !el) return;
    const r = el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > window.innerHeight) el.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [peek]);

  const peekMove = peek && "fen" in peek ? peek : null;
  const peekSquares = peek && "squares" in peek ? peek.squares : [];
  const position = peekMove?.fen ?? fen;
  const lit = peekMove ? (peekMove.kind === "live" ? null : { uci: peekMove.uci, kind: peekMove.kind }) : highlight;
  const rings = useMemo(() => (settings.hanging && marks ? hanging(position) : []), [settings.hanging, marks, position]);

  const squareStyles = useMemo(() => {
    const s: { [square: string]: CSSProperties } = {};
    const add = (sq: string, layer: string) => { s[sq] = { ...s[sq], backgroundImage: [layer, s[sq]?.backgroundImage].filter(Boolean).join(", ") }; };
    const ring = (sq: string, c: string) => { s[sq] = { ...s[sq], boxShadow: [s[sq]?.boxShadow, `inset 0 0 0 3px ${c}`].filter(Boolean).join(", ") }; };
    if (lit && lit.uci.length >= 4) {
      add(lit.uci.slice(0, 2), fill(`var(--hl-${lit.kind})`));
      add(lit.uci.slice(2, 4), fill(`var(--hl-${lit.kind})`));
    }
    if (selected && !peekMove) add(selected, fill("var(--hl-best)"));
    if (!peekMove) for (const d of dots) add(d, DOT);
    // Hanging pieces: the bottom side's in red, the top side's in teal.
    for (const r of rings) ring(r.square, r.side === orientation ? "var(--bad)" : "var(--good)");
    for (const sq of peekSquares) { add(sq, fill("var(--hl-them)")); ring(sq, "var(--you)"); }
    return s;
  }, [lit, selected, dots, peekMove, rings, peekSquares, orientation]);

  const arrowList = useMemo(
    () => (peekMove ? [{ uci: peekMove.uci, kind: peekMove.kind }] : arrows)
      .filter((a) => a.uci.length >= 4 && a.uci.slice(0, 2) !== a.uci.slice(2, 4))
      .map((a) => ({ startSquare: a.uci.slice(0, 2), endSquare: a.uci.slice(2, 4), color: colors[a.kind] })),
    [arrows, peekMove, colors],
  );

  const named = settings.squareNames && names;
  return (
    <div ref={box} className={interactive ? "board interactive" : "board"} role={interactive ? "group" : "img"} aria-label={label}
      style={{ containerType: "inline-size" }}>
      <Chessboard
        options={{
          id,
          position,
          boardOrientation: orientation,
          arrows: arrowList,
          arrowOptions: {
            colors: { default: colors.you, shift: colors.best, ctrl: colors.them, alt: colors.live, meta: colors.you },
            color: colors.you, secondaryColor: colors.best, tertiaryColor: colors.them,
            arrowLengthReducerDenominator: 8, sameTargetArrowLengthReducerDenominator: 4, arrowWidthDenominator: 6,
            activeArrowWidthMultiplier: 0.9, opacity: 0.88, activeOpacity: 0.6, arrowStartOffset: 0,
          },
          squareStyles,
          lightSquareStyle: { backgroundColor: "var(--sq-l)" },
          darkSquareStyle: { backgroundColor: "var(--sq-d)" },
          lightSquareNotationStyle: { ...notation, color: "var(--coord-l)" },
          darkSquareNotationStyle: { ...notation, color: "var(--coord-d)" },
          showNotation: !named,
          dropSquareStyle: { boxShadow: "inset 0 0 0 3px var(--best)" },
          animationDurationInMs: 140,
          showAnimations: laidOut,
          allowDragging: !!onDrop && !peekMove,
          allowDrawingArrows: false,
          clearArrowsOnPositionChange: false,
          onPieceDrop: onDrop ? ({ sourceSquare, targetSquare }) => !!targetSquare && onDrop(sourceSquare, targetSquare) : undefined,
          onSquareClick: onSquare ? ({ square }) => onSquare(square) : undefined,
        }}
      />
      {named && <SquareNames orientation={orientation} />}
    </div>
  );
}

/** Every square's name in its top-left corner, over the board (it takes no clicks). */
function SquareNames({ orientation }: { orientation: "white" | "black" }) {
  const cells = [];
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const file = orientation === "white" ? col : 7 - col, rank = orientation === "white" ? 8 - row : row + 1;
      const light = (file + rank) % 2 === 0;
      cells.push(<span key={`${row}${col}`} className={light ? "l" : "d"}>{FILES[file]}{rank}</span>);
    }
  }
  return <div className="square-names" aria-hidden="true">{cells}</div>;
}
