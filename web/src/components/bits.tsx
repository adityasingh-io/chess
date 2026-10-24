import { NAG, SEV } from "../lib/names";

/** Per-game trend: count in the last N games against the N before. */
export function Trend({ now, before }: { now: number; before: number }) {
  const cls = now < before ? "better" : now > before ? "worse" : "flat";
  const text = cls === "better" ? "↓ fewer" : cls === "worse" ? "↑ more" : "= same";
  return <span className={`trend ${cls}`}>{text}</span>;
}

/** Severity as the chess annotation symbol, never colour alone. */
export function Nag({ severity }: { severity: string | null | undefined }) {
  if (!severity || !(severity in NAG)) return null;
  return <span className={`nag ${severity}`} title={SEV[severity]} aria-label={SEV[severity]}>{NAG[severity]}</span>;
}

/** A row of SAN chips that steps a board through a stored line. Disabled when the line doesn't replay. */
export function LineChips({ tokens, playable, active, onPick, max = tokens.length, label }: {
  tokens: string[]; playable: boolean; active: number | null; onPick: (i: number) => void; max?: number; label: string;
}) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {tokens.slice(0, max).map((t, i) => (
        <button key={i} type="button" disabled={!playable} aria-pressed={active === i} onClick={() => onPick(i)}>{t}</button>
      ))}
      {tokens.length > max && <span className="muted small">…</span>}
    </div>
  );
}
