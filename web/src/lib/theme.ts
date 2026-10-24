// Theme: "auto" follows the OS (dark unless it asks for light, matching app.css); a choice is kept in
// localStorage under "coach-theme" and applied as data-theme on <html> (index.html applies it before paint).
import { useMemo, useSyncExternalStore } from "react";

export type ThemePref = "auto" | "light" | "dark";
const KEY = "coach-theme";
const EVENT = "coach-theme";
const light = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: light)") : null;

export function getPref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function setPref(pref: ThemePref) {
  try {
    if (pref === "auto") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, pref);
  } catch { /* storage blocked: the choice lasts for this page only */ }
  if (pref === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = pref;
  window.dispatchEvent(new Event(EVENT));
}

function effective(): "light" | "dark" {
  const attr = document.documentElement.dataset.theme;
  if (attr === "light" || attr === "dark") return attr;
  return light?.matches ? "light" : "dark";
}

function subscribe(cb: () => void) {
  light?.addEventListener("change", cb);
  window.addEventListener(EVENT, cb);
  return () => {
    light?.removeEventListener("change", cb);
    window.removeEventListener(EVENT, cb);
  };
}

export const useTheme = () => useSyncExternalStore(subscribe, effective, () => "dark" as const);
export const useThemePref = () => useSyncExternalStore(subscribe, getPref, () => "auto" as const);

const TOKENS = ["you", "best", "them", "live", "hl-you", "hl-best", "hl-them", "sq-l", "sq-d", "coord-l", "coord-d",
  "ink", "muted", "line", "soft", "bg", "surface", "bar", "bar-soft", "good", "bad", "inacc", "mist", "blun"] as const;
export type Colors = { [K in (typeof TOKENS)[number]]: string };

/** The theme's colour tokens as concrete values, for libraries that need them in JS (arrows, chart strokes). */
export function useColors(): Colors {
  const theme = useTheme();
  return useMemo(() => {
    const css = getComputedStyle(document.documentElement);
    const out = {} as Colors;
    for (const t of TOKENS) out[t] = css.getPropertyValue(`--${t}`).trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", out.bg);
    return out;
  }, [theme]);
}
