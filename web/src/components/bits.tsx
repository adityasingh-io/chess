import { MARK, MARK_SYMBOL, NAG, SEV } from "../lib/names";
import type { Peek } from "./Board";
import { peekProps, type PeekControl } from "./RefText";

/** Per-game trend: count in the last N games against the N before. */
export function Trend({ now, before, higherIsBetter = false }: { now: number; before: number; higherIsBetter?: boolean }) {
  const cls = now === before ? "flat" : (now > before) === higherIsBetter ? "better" : "worse";
  const text = now === before ? "= same" : higherIsBetter ? (now > before ? "↑ up" : "↓ down") : now < before ? "↓ fewer" : "↑ more";
  return <span className={`trend ${cls}`}>{text}</span>;
}

/** Severity as the chess annotation symbol, never colour alone. */
export function Nag({ severity }: { severity: string | null | undefined }) {
  if (!severity || !(severity in NAG)) return null;
  return <span className={`nag ${severity}`} title={SEV[severity]} aria-label={SEV[severity]}>{NAG[severity]}</span>;
}

/** Brilliant, Great or Miss as a symbol (!!, !, ✕), named for screen readers and on hover. */
export function MarkBadge({ kind }: { kind: string | null | undefined }) {
  if (!kind || !(kind in MARK)) return null;
  return <span className={`markb ${kind}`} title={MARK[kind]} aria-label={MARK[kind]}>{MARK_SYMBOL[kind]}</span>;
}

/** A row of SAN chips that steps a board through a stored line. Disabled when the line doesn't replay. With
    `peek`, hovering a chip shows its move on the board (`peekAt`). */
export function LineChips({ tokens, playable, active, onPick, max = tokens.length, label, peek, peekAt }: {
  tokens: string[]; playable: boolean; active: number | null; onPick: (i: number) => void; max?: number; label: string;
  peek?: PeekControl; peekAt?: (i: number) => Peek | null;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {tokens.slice(0, max).map((t, i) => (
        <button key={i} type="button" disabled={!playable} aria-pressed={active === i} onClick={() => onPick(i)}
          {...(peek && peekAt && playable ? peekProps(peek, peekAt(i)) : {})}>{t}</button>
      ))}
      {tokens.length > max && <span className="muted small">…</span>}
    </div>
  );
}
