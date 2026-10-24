// Training progress, kept on this device first (localStorage) so drills work offline: an FSRS card for
// every puzzle and repertoire line I've tried, a log of attempts for the stats, lines I added from the
// opening tree, and my puzzle level for picking Lichess puzzles. Sync (lib/sync.ts) merges the same
// structure with the server when it's configured. Export and import use it as JSON.
import { useSyncExternalStore } from "react";
import { createEmptyCard, fsrs, Rating, type Card, type Grade } from "ts-fsrs";

export type Kind = "puzzle" | "line";
export type StoredCard = Omit<Card, "due" | "last_review"> & { due: number; last_review: number | null };
export type Item = { kind: Kind; card: StoredCard; updated: number };
export type Attempt = { id: string; kind: Kind; at: number; grade: Grade; tags: string[] };
export type CustomLine = {
  id: string; colour: "white" | "black"; name: string; moves: string[]; added: number; removed?: number;
};
export type Progress = {
  version: 1;
  items: { [id: string]: Item };
  attempts: Attempt[];
  lines: { [id: string]: CustomLine };
  level: number;             // my Lichess puzzle level, Elo-style from solved and missed puzzles
  updated: number;
};

export { Rating };
const KEY = "coach-progress-v1";
const EVENT = "coach-progress";
const MAX_ATTEMPTS = 5000;
export const START_LEVEL = 900;
// Day-based steps only: a puzzle solved today comes back in days, not in ten minutes.
const scheduler = fsrs({ enable_fuzz: true, enable_short_term: false });

const empty = (): Progress => ({ version: 1, items: {}, attempts: [], lines: {}, level: START_LEVEL, updated: 0 });

let state: Progress | null = null;

function read(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return normalise(JSON.parse(raw));
  } catch { /* unreadable or blocked storage: start empty */ }
  return empty();
}

/** A progress object from storage or an import, with anything missing filled in. */
export function normalise(raw: unknown): Progress {
  const p = (raw ?? {}) as Partial<Progress>;
  if (p.version !== undefined && p.version !== 1) throw new Error(`Unknown progress version ${String(p.version)}`);
  return {
    version: 1, items: p.items ?? {}, attempts: Array.isArray(p.attempts) ? p.attempts : [], lines: p.lines ?? {},
    level: typeof p.level === "number" ? p.level : START_LEVEL, updated: p.updated ?? 0,
  };
}

export function getProgress(): Progress {
  return (state ??= read());
}

export function setProgress(next: Progress, { silent = false } = {}) {
  state = next;
  try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage full or blocked: kept for this page */ }
  if (!silent) window.dispatchEvent(new Event(EVENT));
}

function update(f: (p: Progress) => Progress) {
  setProgress({ ...f(getProgress()), updated: Date.now() });
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { state = null; cb(); } };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", onStorage); };
}

export const useProgress = () => useSyncExternalStore(subscribe, getProgress, getProgress);

const toCard = (c: StoredCard): Card => ({ ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined });
const fromCard = (c: Card): StoredCard => ({ ...c, due: c.due.getTime(), last_review: c.last_review ? c.last_review.getTime() : null });

/** Record an answer: the item's next review comes from FSRS. */
export function grade(id: string, kind: Kind, g: Grade, tags: string[] = [], now = new Date()) {
  update((p) => {
    const before = p.items[id] ? toCard(p.items[id].card) : createEmptyCard(now);
    const { card } = scheduler.next(before, now, g);
    const attempts = [...p.attempts, { id, kind, at: now.getTime(), grade: g, tags }].slice(-MAX_ATTEMPTS);
    return { ...p, items: { ...p.items, [id]: { kind, card: fromCard(card), updated: now.getTime() } }, attempts };
  });
}

/** Move my puzzle level towards a Lichess puzzle's rating, as Elo does: up when I solve it, down when I don't. */
export function rateLevel(puzzleRating: number, solved: boolean) {
  update((p) => {
    const expected = 1 / (1 + 10 ** ((puzzleRating - p.level) / 400));
    return { ...p, level: Math.round(p.level + 40 * ((solved ? 1 : 0) - expected)) };
  });
}

export const isDue = (item: Item | undefined, now = Date.now()) => !!item && item.card.due <= now;
/** The end of today, local time: anything due before then counts as due today. */
export const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };

export function addLine(line: Omit<CustomLine, "added">) {
  update((p) => ({ ...p, lines: { ...p.lines, [line.id]: { ...line, added: Date.now() } } }));
}
export function removeLine(id: string) {
  update((p) => (p.lines[id] ? { ...p, lines: { ...p.lines, [id]: { ...p.lines[id], removed: Date.now() } } } : p));
}
export const activeLines = (p: Progress) => Object.values(p.lines).filter((l) => !l.removed || l.removed < l.added);

/** Two progress records combined: per item the newer answer wins, attempts are pooled, lines keep their
    latest add or remove, and the level comes from the record updated last. */
export function merge(a: Progress, b: Progress): Progress {
  const items = { ...a.items };
  for (const [id, item] of Object.entries(b.items)) if (!items[id] || items[id].updated < item.updated) items[id] = item;
  const seen = new Set<string>();
  const attempts = [...a.attempts, ...b.attempts]
    .filter((x) => { const k = `${x.id}@${x.at}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((x, y) => x.at - y.at).slice(-MAX_ATTEMPTS);
  const lines = { ...a.lines };
  for (const [id, line] of Object.entries(b.lines)) {
    const mine = lines[id];
    const stamp = (l: CustomLine) => Math.max(l.added, l.removed ?? 0);
    if (!mine || stamp(mine) < stamp(line)) lines[id] = line;
  }
  const newer = b.updated > a.updated ? b : a;
  return { version: 1, items, attempts, lines, level: newer.level, updated: Math.max(a.updated, b.updated) };
}

export const exportProgress = () => JSON.stringify(getProgress(), null, 1);

/** Merge an exported file into this device's progress; returns how many items it brought. */
export function importProgress(text: string): number {
  const incoming = normalise(JSON.parse(text));
  const before = getProgress();
  setProgress(merge(before, incoming));
  return Object.keys(incoming.items).filter((id) => getProgress().items[id] !== before.items[id]).length;
}

/** Solved share and count per tag, from the attempts log. A puzzle answered again the same day counts once
    (its first answer), so repeating one doesn't pad the numbers. */
export function tagStats(p: Progress, kind: Kind = "puzzle") {
  const out = new Map<string, { tries: number; good: number }>();
  const seen = new Set<string>();
  for (const a of p.attempts) {
    if (a.kind !== kind) continue;
    const key = `${a.id}@${dayStart(a.at)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    for (const t of a.tags) {
      const s = out.get(t) ?? { tries: 0, good: 0 };
      s.tries += 1;
      if (a.grade >= Rating.Good) s.good += 1;
      out.set(t, s);
    }
  }
  return out;
}

/** Midnight, local time, of the day `at` falls on. */
export const dayStart = (at: number) => { const d = new Date(at); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Answers today, and the run of days up to today (or yesterday, if nothing yet today) with at least one. */
export function streak(p: Progress, now = Date.now()) {
  const days = new Set(p.attempts.map((a) => dayStart(a.at)));
  const today = dayStart(now);
  const answered = p.attempts.filter((a) => a.at >= today).length;
  let d = new Date(today);
  if (!days.has(today)) d.setDate(d.getDate() - 1);
  let run = 0;
  while (days.has(d.getTime())) { run += 1; d = new Date(d); d.setDate(d.getDate() - 1); }
  return { today: answered, days: run };
}
