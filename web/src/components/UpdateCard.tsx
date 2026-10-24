// "Fetch new games": shows what chess.com has that the site doesn't, starts the nightly update on GitHub
// (through the update Worker), follows it, and offers a reload once the new games are published.
import { useCallback, useEffect, useState } from "react";
import { startUpdate, updateStatus, updateUrl, type Status } from "../lib/update";

const POLL_MS = 15_000;
const RECENT_S = 900;   // a finished run counts as "just now" for this long
const games = (n: number) => `${n} new ${n === 1 ? "game" : "games"}`;

export default function UpdateCard() {
  if (!updateUrl) return null;
  return <Card />;
}

function Card() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The games an update is fetching; they're in once the site's data has them (the Worker stops listing them).
  const [expected, setExpected] = useState<string[]>([]);

  const refresh = useCallback(() => updateStatus().then((s) => { setStatus(s); setError(null); },
                                                       (e: Error) => setError(`Couldn't check: ${e.message}`)), []);
  useEffect(() => { void refresh(); }, [refresh]);

  const now = Date.now() / 1000;
  const run = status?.run ?? null;
  const running = !!run && run.status !== "completed";
  const recent = !!run && run.status === "completed" && now - run.finished < RECENT_S;
  const left = status ? expected.filter((id) => status.waiting.some((w) => w.id === id)) : expected;
  const ready = expected.length > 0 && !!status && left.length === 0;
  const failed = recent && run?.conclusion !== "success" && expected.length > 0;
  const publishing = recent && run?.conclusion === "success" && !!status?.waiting.length;
  const following = running || publishing || (expected.length > 0 && !ready && !failed);

  // Opened mid-update (the nightly, or another device's press): follow the games it's fetching too.
  useEffect(() => {
    if ((running || publishing) && !expected.length && status?.waiting.length) setExpected(status.waiting.map((w) => w.id));
  }, [running, publishing, expected.length, status]);

  useEffect(() => {
    if (!following) return;
    const t = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(t);
  }, [following, refresh]);

  const press = async () => {
    setBusy(true);
    setNote(null);
    try {
      const r = await startUpdate();
      setStatus(r.status);
      setError(null);
      if (r.started || r.reason === "running" || r.reason === "publishing") setExpected(r.status.waiting.map((w) => w.id));
      else if (r.reason === "none") setNote("No new games on chess.com yet. A game can take a few minutes to appear there.");
      else if (r.reason === "no-token") setNote("The update service isn't set up yet (docs/DEPLOY.md).");
    } catch (e) {
      setError(`Couldn't start it: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const waiting = status?.waiting.length ?? 0;
  let line: string;
  if (ready) line = `${games(expected.length)} ${expected.length === 1 ? "is" : "are"} in.`;
  else if (running) line = `Stockfish is scoring ${waiting ? games(waiting) : "your games"} on GitHub, started ${Math.max(1, Math.round((now - run!.started) / 60))} min ago. They show up here when they're in.`;
  else if (failed) line = "The update failed on GitHub.";
  else if (publishing) line = "Scored. Publishing to the site, usually a minute or two.";
  else if (waiting) line = `${games(waiting)} on chess.com ${waiting === 1 ? "isn't" : "aren't"} analysed yet.`;
  else if (status) line = "Up to date with chess.com.";
  else line = error ? "" : "Checking chess.com…";

  return (
    <section className="card update" aria-label="New games">
      <div className="card-head">
        <p>{line}{error && <span className="muted"> {error}</span>}</p>
        <div className="actions">
          {ready ? <button type="button" className="btn" onClick={() => location.reload()}>Show them</button>
            : <button type="button" className={waiting ? "btn" : "btn ghost"} onClick={() => void press()} disabled={busy || following}>
                {busy ? "Checking…" : "Fetch new games"}
              </button>}
          {(running || failed) && run && <a className="small" href={run.url} target="_blank" rel="noreferrer">Follow it on GitHub ↗</a>}
        </div>
      </div>
      {note && <p className="muted small">{note}</p>}
    </section>
  );
}
