// The one board: react-chessboard with the walnut squares, highlights for the move just played and
// arrows for my move vs Stockfish's best. Arrow colours must be concrete values, so they come from
// useColors(); everything else styles through CSS variables.
import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Chessboard } from "react-chessboard";
import { useColors } from "../lib/theme";

export type ArrowKind = "you" | "best" | "them" | "live";
export type HighlightKind = "you" | "best" | "them";

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
};

const notation: CSSProperties = { fontFamily: "var(--font-num)", fontWeight: 600, fontSize: "clamp(8px, 2.4cqw, 13px)" };
const fill = (c: string) => `linear-gradient(${c}, ${c})`;
const DOT = "radial-gradient(circle, rgba(13, 20, 27, .32) 17%, transparent 19%)";

export function Board({ id, fen, orientation, label, arrows = [], highlight, selected, dots = [], onDrop, onSquare }: Props) {
  const colors = useColors();
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

  const squareStyles = useMemo(() => {
    const s: { [square: string]: CSSProperties } = {};
    const add = (sq: string, layer: string) => { s[sq] = { backgroundImage: [layer, s[sq]?.backgroundImage].filter(Boolean).join(", ") }; };
    if (highlight && highlight.uci.length >= 4) {
      add(highlight.uci.slice(0, 2), fill(`var(--hl-${highlight.kind})`));
      add(highlight.uci.slice(2, 4), fill(`var(--hl-${highlight.kind})`));
    }
    if (selected) add(selected, fill("var(--hl-best)"));
    for (const d of dots) add(d, DOT);
    return s;
  }, [highlight, selected, dots]);

  const arrowList = useMemo(
    () => arrows.filter((a) => a.uci.length >= 4 && a.uci.slice(0, 2) !== a.uci.slice(2, 4))
      .map((a) => ({ startSquare: a.uci.slice(0, 2), endSquare: a.uci.slice(2, 4), color: colors[a.kind] })),
    [arrows, colors],
  );

  return (
    <div ref={box} className={interactive ? "board interactive" : "board"} role={interactive ? "group" : "img"} aria-label={label}
      style={{ containerType: "inline-size" }}>
      <Chessboard
        options={{
          id,
          position: fen,
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
          dropSquareStyle: { boxShadow: "inset 0 0 0 3px var(--best)" },
          animationDurationInMs: 140,
          showAnimations: laidOut,
          allowDragging: !!onDrop,
          allowDrawingArrows: false,
          clearArrowsOnPositionChange: false,
          onPieceDrop: onDrop ? ({ sourceSquare, targetSquare }) => !!targetSquare && onDrop(sourceSquare, targetSquare) : undefined,
          onSquareClick: onSquare ? ({ square }) => onSquare(square) : undefined,
        }}
      />
    </div>
  );
}
