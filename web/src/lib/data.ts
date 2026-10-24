// Loads the static exports in public/data. Each file is fetched once and its promise kept, so components
// can read it with React's use() under a Suspense boundary.
import { use } from "react";
import type {
  Game, GamesIndex, Insights, Leaks, Losses, MistakesIndex, Record as MistakeRecord, Summary,
} from "../types/export";

const BASE = `${import.meta.env.BASE_URL}data/`;
const cache = new Map<string, Promise<unknown>>();

export class DataError extends Error {}

export function load<T>(path: string): Promise<T> {
  let p = cache.get(path) as Promise<T> | undefined;
  if (!p) {
    p = fetch(BASE + path).then(async (r) => {
      if (!r.ok) throw new DataError(r.status === 404 ? `Not in the exports: ${path}` : `${path}: HTTP ${r.status}`);
      return (await r.json()) as T;
    });
    // A failed fetch isn't kept, so a retry (or a later export) can succeed.
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return p;
}

export const useSummary = () => use(load<Summary>("summary.json"));
export const useLeaks = () => use(load<Leaks>("leaks.json"));
export const useLosses = () => use(load<Losses>("losses.json"));
export const useInsights = () => use(load<Insights>("insights.json"));
export const useGamesIndex = () => use(load<GamesIndex>("games/index.json"));
export const useGame = (id: string) => use(load<Game>(`games/${encodeURIComponent(id)}.json`));

// The mistakes index is the largest file (a few MB); only leak detail pages read it.
const recordMaps = new WeakMap<MistakesIndex, Map<string, MistakeRecord>>();
export function useRecords() {
  const index = use(load<MistakesIndex>("mistakes/index.json"));
  let byId = recordMaps.get(index);
  if (!byId) {
    byId = new Map(index.records.map((r) => [r.id, r]));
    recordMaps.set(index, byId);
  }
  return byId;
}

const gameMaps = new WeakMap<GamesIndex, Map<string, GamesIndex["games"][number]>>();
export function useGameSummaries() {
  const index = useGamesIndex();
  let byId = gameMaps.get(index);
  if (!byId) {
    byId = new Map(index.games.map((g) => [g.id, g]));
    gameMaps.set(index, byId);
  }
  return byId;
}
