import { Component, Suspense, type ReactNode } from "react";
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from "react-router";
import { useSummary } from "../lib/data";
import { setPref, useThemePref, type ThemePref } from "../lib/theme";

const ICON = {
  home: "M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z",
  leak: "M12 3c3 4.2 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 3-6.8 6-11z",
  games: "M4 4h16v16H4zM4 12h16M12 4v16",
  tree: "M6 3v18M6 9c6 0 10 2 10 6v6M6 9c3 0 5-2 5-6",
  more: "M5 12h.01M12 12h.01M19 12h.01",
};
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

// The top bar has room for every section; the phone's bottom bar keeps four and puts the rest under More.
// Puzzles arrive in phase 5; its tab shows where it will go.
type Tab = { to?: string; long: string; end?: boolean; later?: string };
const TOP: Tab[] = [
  { to: "/", long: "Dashboard", end: true }, { to: "/leaks", long: "Leaks" }, { to: "/games", long: "Games" },
  { to: "/openings", long: "Openings" }, { to: "/endgames", long: "Endgames" }, { to: "/insights", long: "Insights" },
  { later: "Arrives in phase 5", long: "Puzzles" },
];
const BOTTOM = [
  { to: "/", short: "Home", icon: ICON.home, end: true }, { to: "/leaks", short: "Leaks", icon: ICON.leak },
  { to: "/games", short: "Games", icon: ICON.games }, { to: "/openings", short: "Openings", icon: ICON.tree },
  { to: "/more", short: "More", icon: ICON.more, also: ["/endgames", "/insights"] },
];
export const MORE = [
  { to: "/endgames", name: "Endgames", what: "How your endgames turn out, by type, and the moves that spoiled them" },
  { to: "/insights", name: "Insights", what: "Score and accuracy by colour, opponent, time of day and more; think time; trends" },
];

function TopTabs() {
  return TOP.map((t) => t.to ? (
    <NavLink key={t.long} to={t.to} end={t.end}>{t.long}</NavLink>
  ) : (
    <span key={t.long} className="later" title={t.later} aria-disabled="true">{t.long}</span>
  ));
}

function BottomTabs() {
  const { pathname } = useLocation();
  return BOTTOM.map((t) => (
    <NavLink key={t.short} to={t.to} end={t.end}
      className={({ isActive }) => (isActive || t.also?.some((p) => pathname.startsWith(p)) ? "active" : "")}>
      <Icon d={t.icon} />{t.short}
    </NavLink>
  ));
}

function Who() {
  const s = useSummary();
  return <span className="who">{s.username}{s.rating != null && <> · <span className="num">{s.rating}</span></>}</span>;
}

const NEXT: { [p in ThemePref]: ThemePref } = { auto: "light", light: "dark", dark: "auto" };
const THEME_LABEL: { [p in ThemePref]: string } = { auto: "Auto", light: "Light", dark: "Dark" };
function ThemeButton() {
  const pref = useThemePref();
  return (
    <button type="button" className="theme-btn" onClick={() => setPref(NEXT[pref])}
      aria-label={`Theme: ${THEME_LABEL[pref]}. Switch to ${THEME_LABEL[NEXT[pref]]}`}>
      {THEME_LABEL[pref]}
    </button>
  );
}

export function Loading({ what = "Loading" }: { what?: string }) {
  return <div className="loading" role="status">{what}…</div>;
}

export function Problem({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="problem" role="alert">
      <b>Couldn't load this page.</b>
      <span className="muted">{message}</span>
      <Link to="/">Back to the dashboard</Link>
    </div>
  );
}

/** Catches a failed data load inside the page, so the tabs keep working. */
export class Boundary extends Component<{ children: ReactNode; reset?: string; fallback?: ReactNode }, { error: unknown }> {
  state = { error: null as unknown };
  static getDerivedStateFromError(error: unknown) { return { error }; }
  componentDidUpdate(prev: { reset?: string }) {
    if (prev.reset !== this.props.reset && this.state.error) this.setState({ error: null });
  }
  render() {
    if (!this.state.error) return this.props.children;
    return this.props.fallback !== undefined ? this.props.fallback : <Problem error={this.state.error} />;
  }
}

export function AppShell() {
  const { pathname } = useLocation();
  return (
    <>
      <header className="appbar">
        <div className="appbar-in">
          <Link className="brand" to="/">
            <span className="brand-mark" aria-hidden="true"><i /><i /><i /><i /></span>Coach
          </Link>
          <nav className="tabs-top" aria-label="Sections"><TopTabs /></nav>
          <Boundary fallback={<span className="who" />}><Suspense fallback={<span className="who" />}><Who /></Suspense></Boundary>
          <ThemeButton />
        </div>
      </header>
      <main className="page">
        <Boundary reset={pathname}>
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </Boundary>
      </main>
      <nav className="tabbar" aria-label="Sections"><BottomTabs /></nav>
      <ScrollRestoration />
    </>
  );
}
