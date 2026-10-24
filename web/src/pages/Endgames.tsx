// Endgames: every game that reached one, by its type and my Win% when it started, and how it turned out.
// Spoiled endgames show the move that spoiled them and Stockfish's line, and open in the viewer there.
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useEndgames, useGameSummaries, useSummary } from "../lib/data";
import { day, grouped, moveName, n1, plural, sanTokens } from "../lib/format";
import { ENDGAME_TYPE, ENDGAME_TYPE_DESC, OUTCOME, OUTCOME_DESC, OUTCOMES, RESULT_WORD } from "../lib/names";

const PAGE = 20;
const LINE_PLIES = 6;          // the rest of Stockfish's line is in the compare view
const short = (line: string) => {
  const t = sanTokens(line);
  return t.slice(0, LINE_PLIES).join(" ") + (t.length > LINE_PLIES ? " …" : "");
};
const count = (row: { [o: string]: number } | undefined, o?: string) =>
  row ? (o ? row[o] ?? 0 : Object.values(row).reduce((a, b) => a + b, 0)) : 0;

export default function Endgames() {
  const e = useEndgames();
  const s = useSummary();
  const games = useGameSummaries();
  const [params, setParams] = useSearchParams();
  const [shown, setShown] = useState(PAGE);
  // The list shows one cell of the table; spoiled endgames of every type to begin with.
  const outcome = params.get("outcome") ?? "spoiled";
  const type = params.get("type") ?? "";
  const pick = (o: string, t: string) => {
    setParams({ ...(o !== "spoiled" ? { outcome: o } : {}), ...(t ? { type: t } : {}) }, { replace: true });
    setShown(PAGE);
  };

  const types = useMemo(() => Object.keys(e.table).sort((a, b) => count(e.table[b]) - count(e.table[a])), [e]);
  const outcomes = useMemo(() => [...OUTCOMES, ...new Set(types.flatMap((t) => Object.keys(e.table[t])))]
    .filter((o, i, all) => all.indexOf(o) === i && types.some((t) => count(e.table[t], o))), [e, types]);
  const list = useMemo(() => e.endgames
    .filter((x) => (outcome === "all" || x.info.outcome === outcome) && (!type || x.info.type === type))
    .sort((a, b) => b.ts - a.ts), [e, outcome, type]);
  const cell = (o: string, t: string, n: number) => (
    <button type="button" className="cell num" aria-pressed={outcome === o && type === t} disabled={!n}
      aria-label={`${o === "all" ? "All outcomes" : OUTCOME[o] ?? o}, ${t ? ENDGAME_TYPE[t] ?? t : "every type"}: ${n}`} onClick={() => pick(o, t)}>{n}</button>
  );

  return (
    <>
      <div className="page-head">
        <h1>Endgames</h1>
        <p className="muted">
          {grouped(e.games)} of your {grouped(s.analysed)} games reached an endgame: the first position where each side has 13 or
          fewer points of pieces besides pawns. Its outcome compares your Win% then with the result.
        </p>
      </div>
      <section className="card">
        <div className="card-head"><h2>Outcome by type</h2><span className="muted small">pick a number to list those games</span></div>
        <table className="eg">
          <thead>
            <tr>
              <th scope="col"><span className="sr-only">Outcome</span></th>
              {types.map((t) => (
                <th key={t} scope="col" className="n" title={ENDGAME_TYPE_DESC[t]}>{ENDGAME_TYPE[t] ?? t}</th>
              ))}
              <th scope="col" className="n">All</th>
            </tr>
          </thead>
          <tbody>
            {outcomes.map((o) => (
              <tr key={o} className={o === "spoiled" ? "bad" : undefined}>
                <th scope="row">
                  <span className="oname">{OUTCOME[o] ?? o}</span>
                  {OUTCOME_DESC[o] && <span className="odesc">{OUTCOME_DESC[o]}</span>}
                </th>
                {types.map((t) => <td key={t} className="n">{cell(o, t, count(e.table[t], o))}</td>)}
                <td className="n">{cell(o, "", types.reduce((a, t) => a + count(e.table[t], o), 0))}</td>
              </tr>
            ))}
            <tr className="total">
              <th scope="row"><span className="oname">All outcomes</span></th>
              {types.map((t) => <td key={t} className="n">{cell("all", t, count(e.table[t]))}</td>)}
              <td className="n">{cell("all", "", e.endgames.length)}</td>
            </tr>
          </tbody>
        </table>
        <p className="muted small" style={{ margin: 0 }}>
          Types, by the material when the endgame starts: {types.map((t) => `${ENDGAME_TYPE[t] ?? t} (${(ENDGAME_TYPE_DESC[t] ?? "").toLowerCase()})`).join(", ")}.
        </p>
      </section>
      <section className="card" aria-live="polite">
        <div className="card-head">
          <h2>{outcome === "all" ? "All endgames" : OUTCOME[outcome] ?? outcome}{type ? ` · ${ENDGAME_TYPE[type] ?? type}` : ""}</h2>
          <span className="muted small">{plural(list.length, "game")}, newest first</span>
        </div>
        {outcome === "spoiled" && (
          <p className="muted small" style={{ margin: 0 }}>
            The spoiling move is your endgame move that dropped your Win% the most. Open one to compare it with Stockfish's best.
          </p>
        )}
        <div className="rows">
          {list.slice(0, shown).map((x) => {
            const g = games.get(x.game), i = x.info;
            const spoiled = i.spoiler_ply != null && i.spoiler_san != null;
            return (
              <Link key={x.game} className="row" to={spoiled ? `/games/${x.game}?ply=${i.spoiler_ply}&compare=1` : `/games/${x.game}?ply=${i.start_ply}`}>
                <span className="t">
                  vs {g?.opponent ?? "?"} {g?.opp_rating != null && <span className="muted num">({g.opp_rating})</span>}
                  <span className="muted"> · {ENDGAME_TYPE[i.type] ?? i.type}</span>
                </span>
                <span className="s">
                  {day(x.ts)} · Win% <span className="num">{n1(i.win_start)}</span> at the start · {RESULT_WORD[x.result].toLowerCase()}
                  {outcome === "all" ? ` · ${(OUTCOME[i.outcome] ?? i.outcome).toLowerCase()}` : ""}
                </span>
                {spoiled && (
                  <span className="s">
                    Spoiled by <b className="san">{moveName(i.spoiler_ply!, i.spoiler_san!)}</b>
                    {i.spoiler_drop != null && <span className="num"> (−{n1(i.spoiler_drop)} Win%)</span>}
                    {i.spoiler_best_line_san && <> · Stockfish: <span className="san">{short(i.spoiler_best_line_san)}</span></>}
                  </span>
                )}
                <span className="r" aria-hidden="true">›</span>
              </Link>
            );
          })}
          {!list.length && <div className="empty">No endgames here.</div>}
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
