// Rivals (PLAN.md, reading 26): my games against a player I prepare for, from rivals/index.json (my analysed games,
// current after every update), then their openings from their own chess.com games, from rivals/<name>.json
// (refreshed only when `coach rivals` runs): the costly moves they make in positions my games reach, their habits
// elsewhere, their tree, and how their games end. Every verdict on a move is a stored Stockfish label or drop.
import { Suspense, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { Boundary, Loading } from "../components/AppShell";
import { Board, type ArrowKind } from "../components/Board";
import { LineChips, Nag } from "../components/bits";
import { lineSan, numberedLine, posKey, replay, sideToMove, type Side } from "../lib/chess";
import { useGameSummaries, useRival, useRivals } from "../lib/data";
import { day, evalFor, grouped, moveName, n1, pct, perGame, plural, sanTokens } from "../lib/format";
import { LABEL, TYPE, tagName } from "../lib/names";
import type { Habit, HeadToHead, HeadToHeadGame, Rival, RivalNode } from "../types/export";

const NAME = { white: "White", black: "Black" } as const;
const OTHER = { white: "black", black: "white" } as const;
const MARK = { win: "1", draw: "½", loss: "0" } as const;
const HABITS_SHOWN = 6;
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -";
// chess.com result codes, as the way a game ended (the loser's code, or the drawn game's).
const ENDING: { [code: string]: string } = {
  resigned: "resignation", checkmated: "checkmate", timeout: "time", abandoned: "abandonment", agreed: "agreement",
  repetition: "repetition", stalemate: "stalemate", insufficient: "insufficient material",
  timevsinsufficient: "time against insufficient material", "50move": "the 50-move rule",
};

/** The ply number of the next move in a full FEN ("… b KQkq - 0 4" → 8). */
const nextPly = (fen: string) => {
  const f = fen.split(" ");
  return (Number(f[5]) - 1) * 2 + (f[1] === "w" ? 1 : 2);
};
const monthName = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleDateString("en-GB", { month: "short", year: "numeric" });

export default function Rivals() {
  const { name } = useParams();
  const index = useRivals();
  if (!name) return <RivalList rivals={index.rivals} />;
  const h = index.rivals.find((r) => r.username.toLowerCase() === name.toLowerCase());
  if (!h) return <div className="problem"><b>No rival called “{name}”.</b><Link to="/rivals">All rivals</Link></div>;
  return <RivalPage key={h.username} h={h} />;
}

function RivalList({ rivals }: { rivals: HeadToHead[] }) {
  return (
    <>
      <div className="page-head">
        <h1>Rivals</h1>
        <p className="muted">Players you prepare for: your games against them, and their openings from their own games.</p>
      </div>
      <section className="card">
        {rivals.length ? (
          <div className="rows">
            {rivals.map((h) => (
              <Link key={h.username} className="row" to={`/rivals/${h.username}`}>
                <span className="t">vs {h.username}</span>
                <span className="s">{plural(h.games.length, "game")} together{h.score != null ? `, you scored ${pct(h.score)}` : ""}</span>
                <span className="r" aria-hidden="true">›</span>
              </Link>
            ))}
          </div>
        ) : <div className="empty">No rivals yet.</div>}
      </section>
    </>
  );
}

function RivalPage({ h }: { h: HeadToHead }) {
  return (
    <>
      <div className="page-head">
        <h1>vs {h.username}</h1>
        <p className="muted">Your games together, then their openings from their own games on chess.com. Every verdict on a move is Stockfish's.</p>
      </div>
      <section className="card today-card" aria-label="Prepare for them">
        <div className="card-head"><h2>Prepare for them</h2></div>
        <p className="small" style={{ margin: 0 }}>
          A short session before you play {h.username}: what they're likely to play against you, the costly moves of theirs in
          your openings to punish, then your key moments against them.
        </p>
        <div className="puzzle-actions"><Link className="btn" to={`/rivals/${h.username}/prep`}>Start</Link></div>
      </section>
      <div className="grid-2">
        <Together h={h} />
        <WhenYouLose h={h} />
      </div>
      <Boundary reset={h.username} fallback={<section className="card"><div className="empty">{h.username}'s own games haven't been fetched yet.</div></section>}>
        <Suspense fallback={<Loading what="Loading their games" />}>
          <TheirGames name={h.username} />
        </Suspense>
      </Boundary>
    </>
  );
}

const tally = (games: HeadToHeadGame[], colour?: Side) => {
  const gs = games.filter((g) => !colour || g.colour === colour);
  return { n: gs.length, win: gs.filter((g) => g.result === "win").length, draw: gs.filter((g) => g.result === "draw").length,
           loss: gs.filter((g) => g.result === "loss").length };
};
const record = (t: ReturnType<typeof tally>) =>
  t.n ? `${t.win} won, ${t.draw ? `${t.draw} drawn, ` : ""}${t.loss} lost` : "no games";

function Together({ h }: { h: HeadToHead }) {
  const all = tally(h.games);
  return (
    <section className="card" aria-label="Head to head">
      <div className="card-head"><h2>Head to head</h2><span className="muted small">{plural(h.games.length, "game")}</span></div>
      {h.games.length ? (
        <>
          <p className="small" style={{ margin: 0 }}>
            You won <b className="num">{all.win}</b>{all.draw ? <>, drew <b className="num">{all.draw}</b></> : null} and
            lost <b className="num">{all.loss}</b>{h.score != null && <> (score {pct(h.score)})</>}. As White: {record(tally(h.games, "white"))};
            as Black: {record(tally(h.games, "black"))}.
          </p>
          <div className="rows">
            {h.games.map((g) => (
              <Link key={g.id} className="row" to={`/games/${g.id}${g.key_ply != null ? "?key=1" : ""}`}>
                <span className="t">{day(g.ts)} · {NAME[g.colour]}{g.opening ? ` · ${g.opening}` : ""}</span>
                <span className="s">
                  Accuracy: you {g.accuracy != null ? n1(g.accuracy) : "–"}, them {g.their_accuracy != null ? n1(g.their_accuracy) : "–"}
                  {g.loss ? ` · ${TYPE[g.loss.cause] ?? g.loss.cause}` : ""}{g.thrown ? " · you were winning" : ""}
                  {g.key_ply != null ? " · opens at its key moment" : ""}
                </span>
                <span className="r"><span className={`res ${g.result}`} title={g.result}>{MARK[g.result]}</span></span>
              </Link>
            ))}
          </div>
        </>
      ) : <div className="empty">No games against them yet.</div>}
    </section>
  );
}

function WhenYouLose({ h }: { h: HeadToHead }) {
  const lost = h.games.filter((g) => g.result === "loss" && g.loss);
  const n = h.games.length;
  // Types I make against them or usually make, most above my usual rate first.
  const rates = h.rates.filter((r) => r.against > 0 || r.usual >= 0.05).sort((a, b) => b.against - b.usual - (a.against - a.usual));
  return (
    <section className="card" aria-label="When you lose to them">
      <div className="card-head"><h2>When you lose to them</h2></div>
      {lost.length ? (
        <div className="rows">
          {lost.map((g) => {
            const turn = g.loss!.turning_ply;
            return (
              <Link key={g.id} className="row" to={`/games/${g.id}${turn ? `?ply=${turn}` : ""}`}>
                <span className="t">{TYPE[g.loss!.cause] ?? g.loss!.cause}</span>
                <span className="s">
                  {day(g.ts)} · {NAME[g.colour]} ·{" "}
                  {turn && g.turning_san ? (
                    <>turned on <span className="san">{moveName(turn, g.turning_san)}</span>{g.turning_drop != null ? ` (−${n1(g.turning_drop)} Win%)` : ""}</>
                  ) : "no single move decided it"}
                </span>
                <span className="r" aria-hidden="true">›</span>
              </Link>
            );
          })}
        </div>
      ) : <div className="empty">{n ? "You haven't lost to them yet." : "No games against them yet."}</div>}
      {n > 0 && (
        <>
          <h3 className="small">Your mistakes per game: against them, and usually</h3>
          <table className="tm plain">
            <thead><tr><th scope="col">Type</th><th scope="col" className="n">Against them</th><th scope="col" className="n">Usually</th></tr></thead>
            <tbody>
              {rates.map((r) => (
                <tr key={r.tag}>
                  <th scope="row">{TYPE[r.tag] ?? tagName(r.tag)}</th>
                  <td className="n" title={`${grouped(r.against * n)} in ${plural(n, "game")}`}>{perGame(r.against)}</td>
                  <td className="n">{perGame(r.usual)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="small">Average move accuracy by phase in your games</h3>
          <table className="tm plain">
            <thead><tr><th scope="col">Phase</th><th scope="col" className="n">You</th><th scope="col" className="n">Them</th></tr></thead>
            <tbody>
              {h.phases.filter((p) => p.my_moves || p.their_moves).map((p) => (
                <tr key={p.phase}>
                  <th scope="row">{p.phase[0].toUpperCase() + p.phase.slice(1)}</th>
                  <td className="n" title={plural(p.my_moves, "move")}>{p.mine != null ? n1(p.mine) : "–"}</td>
                  <td className="n" title={plural(p.their_moves, "move")}>{p.theirs != null ? n1(p.theirs) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

function TheirGames({ name }: { name: string }) {
  const r = useRival(name);
  const elsewhere = r.habits.filter((h) => !h.yours);
  return (
    <>
      <section className="card" aria-label="Their openings">
        <div className="card-head">
          <h2>Their openings</h2>
          <span className="muted small">{plural(r.games, "rapid game")}, {monthName(r.months[0])} to {monthName(r.months[r.months.length - 1])}</span>
        </div>
        <FirstMoves r={r} />
        <p className="muted small" style={{ margin: 0 }}>
          From their own games on chess.com, the newest ending {day(r.as_of)}; {plural(r.vs_me, "game")} of them against you.
        </p>
      </section>
      <HabitList id="yours" r={r} list={r.your_openings} title="Their costly moves in your openings"
        what="Moves of theirs from positions your own games reach that Stockfish says cost them at least an Inaccuracy's Win%, however often they played them. Most Win% given away first."
        empty="None yet: in the positions your games reach, they haven't played a costly move." />
      <HabitList id="habits" r={r} list={elsewhere} title="Their habits elsewhere"
        what={`Costly moves they played at least ${r.min_times} times from one position, in openings your games don't reach: worth knowing if you switch.`}
        empty="No other habits." />
      <TreeCard r={r} />
      <Endings r={r} />
    </>
  );
}

function FirstMoves({ r }: { r: Rival }) {
  const white = r.white.tree.find((n) => n.key === START);
  const black = r.black.tree.find((n) => n.key === START);
  const byKey = new Map(r.black.tree.map((n) => [n.key, n]));
  const list = (n: RivalNode | undefined, limit = 3) =>
    n ? n.moves.slice(0, limit).map((m) => `${moveName(nextPly(n.fen), m.san)} ${grouped(m.games)}`).join(" · ") : "–";
  return (
    <div className="small facts-list">
      <p style={{ margin: 0 }}>
        <b>As White</b> ({plural(r.white.games, "game")}{r.white.score != null ? `, score ${pct(r.white.score)}` : ""}): {list(white)}
      </p>
      <p style={{ margin: 0 }}>
        <b>As Black</b> ({plural(r.black.games, "game")}{r.black.score != null ? `, score ${pct(r.black.score)}` : ""}):{" "}
        {black ? black.moves.slice(0, 3).map((m, i) => {
          const after = replay(black.fen, [m.uci])[0];
          const reply = after ? byKey.get(posKey(after)) : undefined;
          return <span key={m.uci}>{i ? "; " : ""}against <span className="san">{moveName(1, m.san)}</span> {list(reply, 2)}</span>;
        }) : "–"}
      </p>
    </div>
  );
}

function HabitList({ id, r, list, title, what, empty }: {
  id: string; r: Rival; list: Habit[]; title: string; what: string; empty: string;
}) {
  const [all, setAll] = useState(false);
  return (
    <section className="card" aria-label={title}>
      <div className="card-head"><h2>{title}</h2>{list.length > 0 && <span className="muted small">{plural(list.length, "move")}</span>}</div>
      <p className="muted small" style={{ margin: 0 }}>{what}</p>
      {list.length ? (
        <div className="positions">
          {(all ? list : list.slice(0, HABITS_SHOWN)).map((h, i) => <HabitCard key={`${h.colour}-${h.key}-${h.move.uci}`} h={h} id={`${id}-${i}`} rival={r.username} />)}
        </div>
      ) : <div className="empty">{empty}</div>}
      {list.length > HABITS_SHOWN && (
        <button type="button" className="linkish small" onClick={() => setAll(!all)}>{all ? "Show fewer" : `Show all ${list.length}`}</button>
      )}
    </section>
  );
}

function HabitCard({ h, id, rival }: { h: Habit; id: string; rival: string }) {
  const games = useGameSummaries();
  const me = OTHER[h.colour];
  const m = h.move;
  const after = useMemo(() => replay(h.fen, [m.uci])[0] ?? h.fen, [h.fen, m.uci]);
  const line = useMemo(() => replay(after, m.reply_line), [after, m.reply_line]);
  const [k, setK] = useState(0);   // 0: right after their move; i: after i moves of Stockfish's line from your answer
  const fen = k ? line[k - 1] : after;
  const ply = nextPly(h.fen);
  const arrows: { uci: string; kind: ArrowKind }[] = !k && m.reply ? [{ uci: m.reply, kind: "best" }] : [];
  return (
    <article className="pos">
      <Board id={`rival-${id}`} fen={fen} orientation={me} arrows={arrows}
        highlight={k ? { uci: m.reply_line[k - 1], kind: k % 2 ? "you" : "them" } : { uci: m.uci, kind: "them" }}
        label={`${rival} plays ${m.san}; Stockfish's answer is ${m.reply_san ?? "not recorded"}`} />
      <div className="line1">
        <span><b className="san">{moveName(ply, m.san)}</b> <Nag severity={m.label} /></span>
        <span className="num">−{n1(m.drop ?? 0)} Win%</span>
      </div>
      <p className="small" style={{ margin: 0 }}>
        {h.opening ?? "Opening"}: played in {m.games} of {plural(h.reached, "game")} that reached it
        {m.label === "book" ? ", a named line but costly by Stockfish's score" : ` (${LABEL[m.label ?? ""] ?? m.label})`}.
        {h.best_san && <> Stockfish's best there: <span className="san">{moveName(ply, h.best_san)}</span>.</>}
      </p>
      {m.reply_san && (
        <p className="small" style={{ margin: 0 }}>
          Your answer: <b className="san">{moveName(ply + 1, m.reply_san)}</b> <span className="muted num">({evalFor(m.eval, me)})</span>
        </p>
      )}
      {m.reply_line.length > 0 && (
        <LineChips tokens={sanTokens(m.reply_line_san)} playable={line.length === m.reply_line.length} active={k ? k - 1 : null}
          onPick={(i) => setK(k === i + 1 ? 0 : i + 1)} label="Stockfish's line from your answer" max={8} />
      )}
      {h.vs_me.length > 0 && (
        <div className="line2">
          Played against you on {h.vs_me.map((g, i) => (
            <span key={g}>{i ? ", " : ""}<Link to={`/games/${g}`}>{games.get(g) ? day(games.get(g)!.start_ts) : "a game"}</Link></span>
          ))}
        </div>
      )}
    </article>
  );
}

// Their tree: what they and their opponents played from each position, from your side of the board.
function TreeCard({ r }: { r: Rival }) {
  const [you, setYou] = useState<Side>("white");
  const side = r[OTHER[you]];
  const byKey = useMemo(() => new Map(side.tree.map((n) => [n.key, n])), [side]);
  const root = byKey.get(START);
  const [line, setLine] = useState<string[]>([]);
  const fens = useMemo(() => (root ? replay(root.fen, line) : []), [root, line]);
  if (!root) return null;
  const fen = fens.at(-1) ?? root.fen;
  const node = byKey.get(posKey(fen));
  const crumbs = numberedLine(root.fen, lineSan(root.fen, line));
  const theirTurn = sideToMove(fen) !== you;
  const pick = (c: Side) => { setYou(c); setLine([]); };
  const arrows: { uci: string; kind: ArrowKind }[] = [];
  if (node?.best) arrows.push({ uci: node.best, kind: "best" });
  if (node?.moves[0] && node.moves[0].uci !== node.best) arrows.push({ uci: node.moves[0].uci, kind: theirTurn ? "them" : "you" });
  return (
    <section className="card tree-card" aria-label="Their tree">
      <div className="card-head">
        <h2>Their tree</h2>
        <span className="seg" role="group" aria-label="Your colour">
          {(["white", "black"] as const).map((c) => (
            <button key={c} type="button" aria-pressed={c === you} onClick={() => pick(c)}>You're {NAME[c]}</button>
          ))}
        </span>
      </div>
      <div className="chips crumbs" role="group" aria-label="Moves to this position">
        <button type="button" aria-pressed={!line.length} onClick={() => setLine([])}>Start</button>
        {crumbs.map((t, i) => (
          <button key={i} type="button" aria-pressed={i === line.length - 1} onClick={() => setLine(line.slice(0, i + 1))}>{t}</button>
        ))}
      </div>
      <div className="tree">
        <div className="tree-board">
          <Board id="rival-tree" fen={fen} orientation={you} arrows={arrows}
            label={crumbs.length ? `Position after ${crumbs.join(" ")}` : "Start position"} />
          <div className="navbtns tree-nav">
            <button type="button" aria-label="Start" disabled={!line.length} onClick={() => setLine([])}>⏮</button>
            <button type="button" aria-label="Back a move" disabled={!line.length} onClick={() => setLine(line.slice(0, -1))}>◀</button>
          </div>
        </div>
        <div className="tree-info">
          {node ? (
            <>
              <div className="facts num">
                <span>{theirTurn ? "Their move" : "Their opponent's move"}</span>
                <span>{plural(node.games, "game")}</span>
                <span>their score {node.score != null ? pct(node.score) : "–"}</span>
                {node.yours && <span>your games reach this</span>}
              </div>
              {node.best_san && (
                <p className="small" style={{ margin: 0 }}>
                  Stockfish: <b className="san">{moveName(nextPly(node.fen), node.best_san)}</b> <span className="num">({evalFor(node.eval, you)})</span>
                </p>
              )}
              <TreeMoves node={node} byKey={byKey} theirTurn={theirTurn} onPick={(uci) => setLine([...line, uci])} />
            </>
          ) : <div className="empty">They reached this position in fewer than {r.min_times} games, and your games don't reach it.</div>}
        </div>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Positions they reached in at least {r.min_times} games, or that your own games reach, in their first {r.plies / 2} moves.
        Verdicts are on their moves.
      </p>
    </section>
  );
}

function TreeMoves({ node, byKey, theirTurn, onPick }: {
  node: RivalNode; byKey: Map<string, RivalNode>; theirTurn: boolean; onPick: (uci: string) => void;
}) {
  const ply = nextPly(node.fen);
  return (
    <table className="tm">
      <thead>
        <tr>
          <th scope="col">Move</th><th scope="col" className="n">Games</th><th scope="col" className="n">Their score</th>
          {theirTurn && <th scope="col" className="n">Stockfish</th>}
        </tr>
      </thead>
      <tbody>
        {node.moves.map((m) => {
          const after = replay(node.fen, [m.uci])[0];
          const child = after ? byKey.get(posKey(after)) : undefined;
          return (
            <tr key={m.uci} className={child ? "go" : "end"} onClick={child ? () => onPick(m.uci) : undefined}>
              <th scope="row">
                {child ? (
                  <button type="button" className="san" onClick={(e) => { e.stopPropagation(); onPick(m.uci); }}>{moveName(ply, m.san)}</button>
                ) : <span className="san">{moveName(ply, m.san)}</span>}
                {m.uci === node.best && <span className="star" title="Stockfish's best" aria-label="Stockfish's best">★</span>}
              </th>
              <td className="n">{grouped(m.games)}</td>
              <td className="n">{pct(m.score)}</td>
              {theirTurn && (
                <td className="n">
                  {m.label ? <>{LABEL[m.label] ?? m.label}{m.drop != null && m.drop >= 0.05 ? ` −${n1(m.drop)}%` : ""} <Nag severity={m.label} /></> : "–"}
                </td>
              )}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Endings({ r }: { r: Rival }) {
  const t = r.time_trouble;
  const row = (label: string, counts: { [code: string]: number }) => {
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return (
      <p className="small" style={{ margin: 0 }}>
        <b>{label}</b> <span className="num">{grouped(total)}</span>:{" "}
        {total ? Object.entries(counts).map(([code, n]) => `${ENDING[code] ?? code} ${grouped(n)}`).join(" · ") : "none"}
      </p>
    );
  };
  return (
    <section className="card" aria-label="How their games end">
      <div className="card-head"><h2>How their games end</h2></div>
      {row("Wins", r.endings.won)}
      {row("Losses", r.endings.lost)}
      {row("Draws", r.endings.drawn)}
      <p className="small" style={{ margin: 0 }}>
        Their clock fell below {pct(100 * t.share)} of the starting time in <b className="num">{grouped(t.games)}</b> of{" "}
        {plural(t.timed, "game")} with clocks
        {t.games ? <>; they lost {grouped(t.lost_on_time)} of those on time{t.score != null ? ` and scored ${pct(t.score)}` : ""}</> : null}.
      </p>
    </section>
  );
}
