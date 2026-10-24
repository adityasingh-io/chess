// Coordinates drill: the page names a square, I tap it on the board, as many as I can in 30 seconds. Knowing
// where e6 or h2 is makes every explanation quicker to follow. The best score per side is kept on this
// device (localStorage "coach-coords"); square names on the board are switched off while it runs.
import { useEffect, useRef, useState } from "react";
import { Board } from "../components/Board";
import { START } from "../lib/lines";
import { play } from "../lib/sound";
import { useSettings } from "../lib/settings";
import type { Side } from "../lib/chess";

const ROUND_MS = 30_000;
const KEY = "coach-coords";
const EMPTY = "8/8/8/8/8/8/8/8 w - - 0 1";
const SQUARES = [..."abcdefgh"].flatMap((f) => [1, 2, 3, 4, 5, 6, 7, 8].map((r) => `${f}${r}`));

type Best = { [side in Side]: number };
function readBest(): Best {
  try {
    const b = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Best>;
    return { white: Number(b.white) || 0, black: Number(b.black) || 0 };
  } catch {
    return { white: 0, black: 0 };
  }
}
function saveBest(b: Best) {
  try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* storage blocked: the best lasts for this page */ }
}

const pick = (not?: string) => {
  let sq = not;
  while (sq === not) sq = SQUARES[Math.floor(Math.random() * SQUARES.length)];
  return sq!;
};

type Round = { target: string; score: number; misses: number; ends: number };

export default function Coordinates() {
  const [side, setSide] = useState<Side>("white");
  const [pieces, setPieces] = useState(false);
  const [round, setRound] = useState<Round | null>(null);
  const [left, setLeft] = useState(ROUND_MS);
  const [last, setLast] = useState<{ score: number; misses: number; record: boolean } | null>(null);
  const [flash, setFlash] = useState<{ square: string; ok: boolean } | null>(null);
  const [best, setBest] = useState(readBest);
  const { sounds } = useSettings();
  const flashTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!round) return;
    const t = window.setInterval(() => {
      const ms = round.ends - Date.now();
      setLeft(Math.max(0, ms));
      if (ms > 0) return;
      setRound(null);
      const record = round.score > best[side];
      if (record) { const b = { ...best, [side]: round.score }; setBest(b); saveBest(b); }
      setLast({ score: round.score, misses: round.misses, record });
    }, 100);
    return () => window.clearInterval(t);
  }, [round, best, side]);
  useEffect(() => () => window.clearTimeout(flashTimer.current), []);

  const start = () => {
    setLast(null);
    setLeft(ROUND_MS);
    setRound({ target: pick(), score: 0, misses: 0, ends: Date.now() + ROUND_MS });
  };
  const tap = (square: string) => {
    if (!round) return;
    const ok = square === round.target;
    setRound({ ...round, target: ok ? pick(round.target) : round.target, score: round.score + (ok ? 1 : 0), misses: round.misses + (ok ? 0 : 1) });
    setFlash({ square, ok });
    if (sounds) play(ok ? "move" : "capture");
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 350);
  };

  return (
    <>
      <div className="page-head">
        <h1>Coordinates</h1>
        <p className="muted">The page names a square: tap it on the board. As many as you can in 30 seconds.</p>
      </div>
      <section className="card">
        <div className="puzzle">
          <div className="puzzle-board">
            <Board id="coords" fen={pieces ? START : EMPTY} orientation={side} label={`Coordinates drill, ${side} at the bottom`}
              onSquare={round ? tap : undefined} names={false} marks={false}
              highlight={flash ? { uci: flash.square + flash.square, kind: flash.ok ? "best" : "you" } : null} />
          </div>
          <div className="puzzle-side">
            {round ? (
              <>
                <div className="coord-target" aria-live="assertive"><span className="label">Tap</span><b className="san">{round.target}</b></div>
                <p className="num">{Math.ceil(left / 1000)}s left · <b>{round.score}</b> found{round.misses ? ` · ${round.misses} missed` : ""}</p>
                {flash && !flash.ok && <p className="small bad-text">That was {flash.square}.</p>}
              </>
            ) : (
              <>
                {last && (
                  <p className="puzzle-result solved" role="status">
                    {last.score} {last.score === 1 ? "square" : "squares"}{last.misses ? `, ${last.misses} missed` : ""}.
                    {last.record ? " A new best." : ""}
                  </p>
                )}
                <span className="seg" role="group" aria-label="Side at the bottom">
                  {(["white", "black"] as const).map((s) => (
                    <button key={s} type="button" aria-pressed={side === s} onClick={() => setSide(s)}>
                      {s === "white" ? "As White" : "As Black"}
                    </button>
                  ))}
                </span>
                <label className="toggle">
                  <input type="checkbox" checked={pieces} onChange={(e) => setPieces(e.target.checked)} />
                  <span><b>Pieces on the board</b></span>
                </label>
                <p className="muted small num">Best as White: {best.white || "–"} · as Black: {best.black || "–"}</p>
                <div className="puzzle-actions"><button type="button" className="btn" onClick={start}>{last ? "Again" : "Start"}</button></div>
              </>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
