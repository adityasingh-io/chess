// Board settings, kept per device in localStorage under "coach-settings" (like the theme, they aren't synced):
// square names on every square, rings on attacked pieces with no defender, and move sounds.
import { useSyncExternalStore } from "react";

export type Settings = {
  squareNames: boolean;   // each square's name in its corner, instead of letters and numbers along the edges
  hanging: boolean;       // ring pieces that are attacked and not defended (hidden while a drill asks for a move)
  sounds: boolean;        // a sound for each move, capture and check
};

const KEY = "coach-settings";
const EVENT = "coach-settings";
export const DEFAULTS: Settings = { squareNames: false, hanging: false, sounds: false };

let state: Settings | null = null;

function read(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Settings>;
    const out = { ...DEFAULTS };
    for (const k of Object.keys(DEFAULTS) as (keyof Settings)[]) if (typeof raw[k] === "boolean") out[k] = raw[k];
    return out;
  } catch {
    return { ...DEFAULTS };
  }
}

export const getSettings = (): Settings => (state ??= read());

export function setSetting<K extends keyof Settings>(key: K, value: Settings[K]) {
  state = { ...getSettings(), [key]: value };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked: lasts for this page */ }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { state = null; cb(); } };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", onStorage); };
}

export const useSettings = () => useSyncExternalStore(subscribe, getSettings, () => DEFAULTS);
