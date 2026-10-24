import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useGamesIndex } from "../lib/data";
import { day, grouped, n1 } from "../lib/format";
import { TYPE } from "../lib/names";
import type { GameSummary } from "../types/export";

const PAGE = 50;
const ACCURACY = [
  { key: "", label: "Any accuracy" },
  { key: "lt60", label: "Below 60", test: (a: number) => a < 60 },
  { key: "60-75", label: "60 to 75", test: (a: number) => a >= 60 && a < 75 },
  { key: "75-90", label: "75 to 90", test: (a: number) => a >= 75 && a < 90 },
  { key: "90", label: "90 and up", test: (a: number) => a >= 90 },
];

function Seg({ value, options, onChange, label }: {
  value: string; options: [string, string][]; onChange: (v: string) => void; label: string;
}) {
  return (
    <span className="seg" role="group" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{text}</button>
      ))}
    </span>
  );
}

const dayStart = (iso: string) => new Date(`${iso}T00:00:00`).getTime() / 1000;

export default function Games() {
  const { games } = useGamesIndex();
  const [params, setParams] = useSearchParams();
  const [shown, setShown] = useState(PAGE);
  const f = {
    result: params.get("result") ?? "", colour: params.get("colour") ?? "", opening: params.get("opening") ?? "",
    from: params.get("from") ?? "", to: params.get("to") ?? "", acc: params.get("acc") ?? "",
    cause: params.get("cause") ?? "", thrown: params.get("thrown") === "1",
  };
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value); else next.delete(key);
    setParams(next, { replace: true });
    setShown(PAGE);
  };

  const openings = useMemo(() => {
    const count = new Map<string, number>();
    for (const g of games) if (g.opening) count.set(g.opening, (count.get(g.opening) ?? 0) + 1);
    return [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [games]);
  const causes = useMemo(() => [...new Set(games.map((g) => g.loss_cause).filter((c): c is string => !!c))], [games]);

  const list = useMemo(() => {
    const acc = ACCURACY.find((a) => a.key === f.acc)?.test;
    const from = f.from ? dayStart(f.from) : null, to = f.to ? dayStart(f.to) + 86400 : null;
    return games.filter((g) =>
      (!f.result || g.result === f.result) && (!f.colour || g.colour === f.colour) && (!f.opening || g.opening === f.opening) &&
      (from == null || g.start_ts >= from) && (to == null || g.start_ts < to) &&
      (!acc || (g.accuracy != null && acc(g.accuracy))) && (!f.cause || g.loss_cause === f.cause) && (!f.thrown || g.thrown));
  }, [games, f.result, f.colour, f.opening, f.from, f.to, f.acc, f.cause, f.thrown]);
  const filtered = Object.entries(f).some(([, v]) => v);

  return (
    <>
      <div className="page-head">
        <h1>Games</h1>
        <p className="muted">
          {filtered ? `${grouped(list.length)} of ${grouped(games.length)} games` : `${grouped(games.length)} games`}, newest first.
        </p>
      </div>
      <section className="card">
        <div className="filters" aria-label="Filters">
          <Seg label="Result" value={f.result} onChange={(v) => set("result", v)}
            options={[["", "All"], ["win", "Won"], ["loss", "Lost"], ["draw", "Drew"]]} />
          <Seg label="Colour" value={f.colour} onChange={(v) => set("colour", v)}
            options={[["", "Both"], ["white", "White"], ["black", "Black"]]} />
          <select aria-label="Opening" value={f.opening} onChange={(e) => set("opening", e.target.value)}>
            <option value="">Every opening</option>
            {openings.map(([name, n]) => <option key={name} value={name}>{name} ({n})</option>)}
          </select>
          <select aria-label="Accuracy" value={f.acc} onChange={(e) => set("acc", e.target.value)}>
            {ACCURACY.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
          <select aria-label="Why I lost" value={f.cause} onChange={(e) => set("cause", e.target.value)}>
            <option value="">Any loss cause</option>
            {causes.map((c) => <option key={c} value={c}>{TYPE[c] ?? c}</option>)}
          </select>
          <label className="small">From <input type="date" value={f.from} onChange={(e) => set("from", e.target.value)} /></label>
          <label className="small">To <input type="date" value={f.to} onChange={(e) => set("to", e.target.value)} /></label>
          <label className="small check">
            <input type="checkbox" checked={f.thrown} onChange={(e) => set("thrown", e.target.checked ? "1" : "")} />
            Winning, not won
          </label>
          {filtered && <button type="button" className="linkish small" onClick={() => { setParams({}, { replace: true }); setShown(PAGE); }}>Clear</button>}
        </div>
        <div className="game-list">
          {list.slice(0, shown).map((g) => <GameRow key={g.id} g={g} />)}
          {!list.length && <div className="empty">No games match these filters.</div>}
        </div>
        {shown < list.length && (
          <button className="btn ghost" type="button" onClick={() => setShown((k) => k + PAGE)}>
            Show {Math.min(PAGE, list.length - shown)} more of {grouped(list.length - shown)}
          </button>
        )}
      </section>
    </>
  );
}

const RES = { win: ["1", "Won"], loss: ["0", "Lost"], draw: ["½", "Drew"] } as const;

function GameRow({ g }: { g: GameSummary }) {
  const [mark, word] = RES[g.result];
  const moves = Math.ceil(g.plies / 2);
  return (
    <Link className="game-row" to={`/games/${g.id}`}>
      <span className="when">{day(g.start_ts)}</span>
      <span className="opp">
        <i className={`sw ${g.colour}`} title={g.colour === "white" ? "You had White" : "You had Black"} />
        <span className="name">vs {g.opponent}</span>
        {g.opp_rating != null && <span className="muted num small">{g.opp_rating}</span>}
      </span>
      <span className="stats">
        <span className={`res ${g.result}`} title={word}>{mark}</span>
        <span title="Your accuracy">{g.accuracy != null ? n1(g.accuracy) : "–"}</span>
        <span className="muted" title="Your blunders">{g.blunders} ??</span>
      </span>
      <span className="sub">
        {[g.opening, `${moves} ${moves === 1 ? "move" : "moves"}`, g.loss_cause ? TYPE[g.loss_cause] ?? g.loss_cause : null, g.thrown ? "was winning" : null]
          .filter(Boolean).join(" · ")}
      </span>
    </Link>
  );
}
