import { lazy } from "react";
import { createBrowserRouter } from "react-router";
import { AppShell, Problem } from "./components/AppShell";

// Pages load on first visit (the shell's Suspense shows "Loading…"), so the dashboard doesn't wait for
// the board and the viewer doesn't wait for the charts it doesn't use.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Leaks = lazy(() => import("./pages/Leaks"));
const Games = lazy(() => import("./pages/Games"));
const GameViewer = lazy(() => import("./pages/GameViewer"));
const NotFound = lazy(() => import("./pages/NotFound"));

export const routes = [
  {
    path: "/",
    element: <AppShell />,
    errorElement: <main className="page"><Problem error="Something went wrong drawing this page." /></main>,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "leaks", element: <Leaks /> },
      { path: "leaks/:tag", element: <Leaks /> },
      { path: "games", element: <Games /> },
      { path: "games/:id", element: <GameViewer /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];

export const router = createBrowserRouter(routes, { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" });
