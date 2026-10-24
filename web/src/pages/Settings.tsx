// Settings: the board options, where training progress lives, export and import of it as JSON, sync sign-in
// (when this build has sync configured), and the theme.
import { useRef, useState, useSyncExternalStore } from "react";
import { Link } from "react-router";
import { Board } from "../components/Board";
import { setSetting, useSettings, type Settings as BoardSettings } from "../lib/settings";
import { play } from "../lib/sound";
import { exportProgress, importProgress, useProgress } from "../lib/progress";
import { getSyncState, onSyncState, sendLink, signOut, syncConfigured, syncNow } from "../lib/sync";
import { setPref, useThemePref, type ThemePref } from "../lib/theme";
import { dateTime, grouped } from "../lib/format";

export default function Settings() {
  const p = useProgress();
  const items = Object.values(p.items);
  const file = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState<string | null>(null);

  const download = () => {
    const url = URL.createObjectURL(new Blob([exportProgress()], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `chess-coach-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  const upload = async (f: File | undefined) => {
    if (!f) return;
    try {
      const n = importProgress(await f.text());
      setNote(`Imported: ${n} puzzles or lines updated.`);
    } catch (e) {
      setNote(`Couldn't import that file: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (file.current) file.current.value = "";
  };

  return (
    <>
      <div className="page-head">
        <h1>Settings</h1>
        <p className="muted">Board options and training progress are kept on this device first, so drills work offline.</p>
      </div>
      <div className="grid-2">
        <BoardCard />
        <section className="card">
          <div className="card-head"><h2>Progress</h2></div>
          <dl className="pos-facts">
            <div><dt>Puzzles tried</dt><dd className="num">{grouped(items.filter((i) => i.kind === "puzzle").length)}</dd></div>
            <div><dt>Lines tried</dt><dd className="num">{grouped(items.filter((i) => i.kind === "line").length)}</dd></div>
            <div><dt>Answers</dt><dd className="num">{grouped(p.attempts.length)}</dd></div>
            <div><dt>Puzzle level</dt><dd className="num">{p.level}</dd></div>
            <div><dt>Last change</dt><dd>{p.updated ? dateTime(p.updated / 1000) : "–"}</dd></div>
          </dl>
          <div className="puzzle-actions">
            <button type="button" className="btn ghost" onClick={download}>Export as JSON</button>
            <label className="btn ghost">
              Import JSON
              <input ref={file} type="file" accept="application/json,.json" className="sr-only" onChange={(e) => void upload(e.target.files?.[0])} />
            </label>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            Importing merges: for each puzzle or line the newer answer wins, so nothing is lost either way.
          </p>
          {note && <p className="small" role="status">{note}</p>}
        </section>
        <SyncCard />
        <ThemeCard />
      </div>
    </>
  );
}

function SyncCard() {
  const s = useSyncExternalStore(onSyncState, getSyncState, getSyncState);
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!syncConfigured) {
    return (
      <section className="card">
        <div className="card-head"><h2>Sync</h2><span className="pill">off</span></div>
        <p className="muted small" style={{ margin: 0 }}>
          This build has no sync set up, so progress stays on this device. Export it above to move it to another one.
          Sync between phone and Mac uses Supabase; docs/DEPLOY.md says how to switch it on.
        </p>
      </section>
    );
  }
  return (
    <section className="card">
      <div className="card-head"><h2>Sync</h2><span className="pill">{s.signedIn ? "on" : "signed out"}</span></div>
      {s.signedIn ? (
        <>
          <p className="small" style={{ margin: 0 }}>Signed in as {s.email}. Progress syncs when it changes and when you come back online.</p>
          <p className="muted small" style={{ margin: 0 }}>{s.busy ? "Syncing…" : s.last ? `Last synced ${dateTime(s.last / 1000)}` : "Not synced yet"}</p>
          {s.error && <p className="small bad-text" role="alert">{s.error}</p>}
          <div className="puzzle-actions">
            <button type="button" className="btn ghost" onClick={() => void syncNow()} disabled={s.busy}>Sync now</button>
            <button type="button" className="btn ghost" onClick={() => void signOut()}>Sign out</button>
          </div>
        </>
      ) : sent ? (
        <p className="small" role="status">Check your email for the sign-in link, then open it on this device.</p>
      ) : (
        <form className="signin" onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          sendLink(email).then(() => setSent(true), (err: unknown) => setError(err instanceof Error ? err.message : String(err)));
        }}>
          <label className="small" htmlFor="sync-email">Email for the sign-in link</label>
          <input id="sync-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <button type="submit" className="btn">Send link</button>
          {error && <p className="small bad-text" role="alert">{error}</p>}
        </form>
      )}
    </section>
  );
}

// 1. e4 d5 2. Nc3 Bg4 3. Bc4: the bishops on c4 and g4 are attacked and not defended.
const PREVIEW = "rn1qkbnr/ppp1pppp/8/3p4/2B1P1b1/2N5/PPPP1PPP/R1BQK1NR b KQkq - 3 3";
const BOARD: [keyof BoardSettings, string, string][] = [
  ["squareNames", "Square names on every square",
    "Each square shows its name (e4, g7, h2…) in its top-left corner, in place of the letters and numbers along the edges."],
  ["hanging", "Mark hanging pieces",
    "A ring around a piece that's attacked and has no defender: red for the side at the bottom of the board, teal for the side at the top. It counts attackers and defenders on the board; Stockfish isn't asked. Hidden while a puzzle or the trainer waits for your move."],
  ["sounds", "Move sounds", "A knock for each move, a sharper one for a capture and two notes for check."],
];

function BoardCard() {
  const s = useSettings();
  return (
    <section className="card">
      <div className="card-head"><h2>Board</h2></div>
      <div className="toggles">
        {BOARD.map(([key, label, what]) => (
          <label key={key} className="toggle">
            <input type="checkbox" checked={s[key]} onChange={(e) => {
              setSetting(key, e.target.checked);
              if (key === "sounds" && e.target.checked) play("move");
            }} />
            <span><b>{label}</b><span className="muted small">{what}</span></span>
          </label>
        ))}
      </div>
      <div className="settings-preview">
        <Board id="settings-preview" fen={PREVIEW} orientation="white" label="Preview of the board options" />
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        Still learning the squares? <Link to="/coordinates">The coordinates drill</Link> asks for one square at a time.
      </p>
    </section>
  );
}

const THEMES: [ThemePref, string][] = [["auto", "Follow the system"], ["light", "Light"], ["dark", "Dark"]];
function ThemeCard() {
  const pref = useThemePref();
  return (
    <section className="card">
      <div className="card-head"><h2>Theme</h2></div>
      <span className="seg" role="group" aria-label="Theme">
        {THEMES.map(([t, label]) => <button key={t} type="button" aria-pressed={pref === t} onClick={() => setPref(t)}>{label}</button>)}
      </span>
    </section>
  );
}
