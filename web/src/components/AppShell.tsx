import { Component, Suspense, type ReactNode } from "react";
import { Link, NavLink, Outlet, ScrollRestoration, useLocation } from "react-router";
import { useSummary } from "../lib/data";
import { setPref, useThemePref, type ThemePref } from "../lib/theme";

const ICON = {
  home: "M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z",
  leak: "M12 3c3 4.2 6 7.6 6 11a6 6 0 0 1-12 0c0-3.4 3-6.8 6-11z",
  games: "M4 4h16v16H4zM4 12h16M12 4v16",
  tree: "M6 3v18M6 9c6 0 10 2 10 6v6M6 9c3 0 5-2 5-6",
  puzzle: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 8a4 4 0 1 0 0 8 4 4 0 1 0 0-8z",
};
const Icon = ({ d }: { d: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

// Openings and puzzles arrive in later phases; their tabs show where they will go.
const TABS = [
  { to: "/", short: "Home", long: "Dashboard", icon: ICON.home, end: true },
  { to: "/leaks", short: "Leaks", long: "Leaks", icon: ICON.leak },
  { to: "/games", short: "Games", long: "Games", icon: ICON.games },
  { later: "Arrives in phase 4", short: "Openings", long: "Openings", icon: ICON.tree },
  { later: "Arrives in phase 5", short: "Puzzles", long: "Puzzles", icon: ICON.puzzle },
];

function Tabs({ top }: { top: boolean }) {
  return TABS.map((t) =>
    t.to ? (
      <NavLink key={t.long} to={t.to} end={t.end}>
        {!top && <Icon d={t.icon} />}
        {top ? t.long : t.short}
      </NavLink>
    ) : (
      <span key={t.long} className="later" title={t.later} aria-disabled="true">
        {!top && <Icon d={t.icon} />}
        {top ? t.long : t.short}
      </span>
    ),
  );
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
          <nav className="tabs-top" aria-label="Sections"><Tabs top /></nav>
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
      <nav className="tabbar" aria-label="Sections"><Tabs top={false} /></nav>
      <ScrollRestoration />
    </>
  );
}
