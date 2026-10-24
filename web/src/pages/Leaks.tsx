import { Suspense, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Board } from "../components/Board";
import { LineChips, Nag, Trend } from "../components/bits";
import { Loading } from "../components/AppShell";
import { useGameSummaries, useLeaks, useRecords, useSummary } from "../lib/data";
import { day, evalFor, grouped, moveName, n1, perGame, plural, sanTokens } from "../lib/format";
import { replay } from "../lib/chess";
import { DESC, KIND_TITLE, tagName } from "../lib/names";
import type { GameSummary, Leak, Record as MistakeRecord } from "../types/export";

const PAGE = 12;
const KINDS = ["primary", "subtype", "flag"] as const;

export default function Leaks() {
  const { tag } = useParams();
  const s = useSummary();
  const leaks = useLeaks();
  const n = leaks.recent_games;
  return (
    <>
      <div className="page-head">
        <h1>Leaks</h1>
        <p className="muted">
          {grouped(s.records)} mistakes from {s.analysed} games, ranked by the Win% they cost. Trends compare your last {n} games
          with the {n} before.
        </p>
      </div>
      <div className={`grid-2 leaks-grid${tag ? " has-detail" : ""}`}>
        <section className="card leak-card" aria-label="All leaks">
          {KINDS.map((kind) => <LeakGroup key={kind} kind={kind} leaks={leaks.leaks} n={n} selected={tag} />)}
        </section>
        <section className="card detail" aria-live="polite">
          {tag ? (
            <Suspense fallback={<Loading what="Loading your positions" />}>
              <LeakDetail key={tag} tag={tag} />
            </Suspense>
          ) : (
            <div className="empty">Pick a leak to see every position behind it, with your move, Stockfish's best and its line.</div>
          )}
        </section>
      </div>
    </>
  );
}

function LeakGroup({ kind, leaks, n, selected }: { kind: (typeof KINDS)[number]; leaks: Leak[]; n: number; selected?: string }) {
  const items = leaks.filter((l) => l.kind === kind && l.count > 0).sort((a, b) => b.win_lost - a.win_lost);
  if (!items.length) return null;
  const max = Math.max(...items.map((l) => l.win_lost));
  return (
    <div className="leak-group">
      <div className="label">{KIND_TITLE[kind]}</div>
      <div className="leak-list">
        {items.map((l) => {
          const now = Math.round((l.recent ?? 0) * n), before = Math.round((l.previous ?? 0) * n);
          return (
            <Link key={l.tag} to={`/leaks/${l.tag}`} className={`leak${l.tag === selected ? " active" : ""}`}
              aria-current={l.tag === selected ? "page" : undefined}>
              <span className="leak-name">{tagName(l.tag)}</span>
              <span className="leak-lost">{grouped(l.win_lost)}<small>Win% lost</small></span>
              <span className="lostbar" aria-hidden="true"><span style={{ width: `${((l.win_lost / max) * 100).toFixed(1)}%` }} /></span>
              <span className="leak-meta">
                <span className="num">{plural(l.count, "time")}</span>
                <span className="num">{perGame(l.per_game)} a game</span>
                {l.recent != null && l.previous != null && (
                  <span><span className="num">last {n}: {now} vs {before} </span><Trend now={now} before={before} /></span>
                )}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

function LeakDetail({ tag }: { tag: string }) {
  const leaks = useLeaks();
  const records = useRecords();
  const games = useGameSummaries();
  const [shown, setShown] = useState(PAGE);
  const leak = leaks.leaks.find((l) => l.tag === tag);
  const list = useMemo(
    () => (leak?.records ?? []).map((id) => records.get(id)).filter((r): r is MistakeRecord => !!r)
      .sort((a, b) => b.ts - a.ts || b.ply - a.ply),
    [leak, records],
  );
  if (!leak) {
    return <div className="empty">There's no leak called “{tag}” in the exports. <Link to="/leaks">All leaks</Link></div>;
  }
  return (
    <>
      <div className="card-head">
        <div>
          <Link to="/leaks" className="small muted back-link">← All leaks</Link>
          <div className="label">Your positions</div>
          <h2 className="detail-title">{tagName(tag)}</h2>
        </div>
        <div className="drill-actions">
          <button className="btn" type="button" disabled title="Arrives in phase 5">Drill these</button>
          <span className="pill later">Phase 5</span>
        </div>
      </div>
      {DESC[tag] && <p className="muted" style={{ margin: 0 }}>{DESC[tag]}</p>}
      <div className="facts num">
        <span>{plural(list.length, "position")}</span>
        <span>{perGame(leak.per_game)} a game</span>
        <span>{grouped(leak.win_lost)} Win% lost</span>
        <span>newest first</span>
      </div>
      <div className="positions">
        {list.slice(0, shown).map((r) => <PositionCard key={r.id} r={r} game={games.get(r.game)} />)}
      </div>
      {shown < list.length && (
        <button className="btn ghost" type="button" onClick={() => setShown((k) => k + PAGE)}>
          Show {Math.min(PAGE, list.length - shown)} more of {grouped(list.length - shown)}
        </button>
      )}
    </>
  );
}

const RESULT = { loss: "lost", win: "won", draw: "drew" } as const;

/** One mistake: the position before my move, my move vs Stockfish's best; the chips step through its line. */
export function PositionCard({ r, game }: { r: MistakeRecord; game?: GameSummary }) {
  const [step, setStep] = useState<number | null>(null);
  const fens = useMemo(() => replay(r.fen, r.best_line), [r]);
  const tokens = useMemo(() => sanTokens(r.best_line_san), [r]);
  const playable = tokens.length === r.best_line.length && fens.length === r.best_line.length;
  const inLine = step != null && playable;
  const arrows = inLine ? [] : [
    ...(r.best && r.best !== r.uci ? [{ uci: r.best, kind: "best" as const }] : []),
    { uci: r.uci, kind: "you" as const },
  ];
  return (
    <article className="pos">
      <Board
        id={`pos-${r.id}`}
        fen={inLine ? fens[step] : r.fen}
        orientation={r.colour}
        arrows={arrows}
        highlight={inLine ? { uci: r.best_line[step], kind: "best" } : { uci: r.uci, kind: "you" }}
        label={inLine ? `Stockfish's line after ${tokens[step]}` : `You played ${r.san}; Stockfish's best was ${r.best_san ?? "not recorded"}`}
      />
      <div className="line1">
        <span className="san"><b>{moveName(r.ply, r.san)}</b> <Nag severity={r.severity} /></span>
        <span className="num" title="Your Win% before and after the move">{n1(r.win_before)} → {n1(r.win_after)}</span>
      </div>
      <div className="line2">
        {r.best_san && <>Best {moveName(r.ply, r.best_san)} ({evalFor(r.best_eval, r.colour)}) · </>}
        {game ? `vs ${game.opponent} · ` : ""}{day(r.ts)}{game ? ` · ${RESULT[game.result]}` : ""}
      </div>
      {tokens.length > 0 && (
        <>
          <div className="line2">
            <button type="button" className="linkish" onClick={() => setStep(null)} aria-pressed={!inLine}>Stockfish's line:</button>
          </div>
          <LineChips tokens={tokens} playable={playable} active={inLine ? step : null} onPick={setStep} max={6}
            label="Stockfish's line" />
        </>
      )}
      <Link to={`/games/${r.game}?ply=${r.ply}`}>Open in game viewer →</Link>
    </article>
  );
}
