import { lazy } from "react";
import { createBrowserRouter } from "react-router";
import { AppShell, Problem } from "./components/AppShell";

// Pages load on first visit (the shell's Suspense shows "Loading…"), so the dashboard doesn't wait for
// the board and the viewer doesn't wait for the charts it doesn't use.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Today = lazy(() => import("./pages/Today"));
const Leaks = lazy(() => import("./pages/Leaks"));
const Games = lazy(() => import("./pages/Games"));
const GameViewer = lazy(() => import("./pages/GameViewer"));
const Openings = lazy(() => import("./pages/Openings"));
const Endgames = lazy(() => import("./pages/Endgames"));
const Insights = lazy(() => import("./pages/Insights"));
const More = lazy(() => import("./pages/More"));
const Puzzles = lazy(() => import("./pages/Puzzles"));
const Trainer = lazy(() => import("./pages/Trainer"));
const PlayOut = lazy(() => import("./pages/PlayOut"));
const Settings = lazy(() => import("./pages/Settings"));
const Coordinates = lazy(() => import("./pages/Coordinates"));
const NotFound = lazy(() => import("./pages/NotFound"));

export const routes = [
  {
    path: "/",
    element: <AppShell />,
    errorElement: <main className="page"><Problem error="Something went wrong drawing this page." /></main>,
    children: [
      { index: true, element: <Dashboard /> },
      { path: "today", element: <Today /> },
      { path: "leaks", element: <Leaks /> },
      { path: "leaks/:tag", element: <Leaks /> },
      { path: "games", element: <Games /> },
      { path: "games/:id", element: <GameViewer /> },
      { path: "openings", element: <Openings /> },
      { path: "openings/:colour", element: <Openings /> },
      { path: "endgames", element: <Endgames /> },
      { path: "insights", element: <Insights /> },
      { path: "more", element: <More /> },
      { path: "puzzles", element: <Puzzles /> },
      { path: "trainer", element: <Trainer /> },
      { path: "play", element: <PlayOut /> },
      { path: "settings", element: <Settings /> },
      { path: "coordinates", element: <Coordinates /> },
      { path: "*", element: <NotFound /> },
    ],
  },
];

export const router = createBrowserRouter(routes, { basename: import.meta.env.BASE_URL.replace(/\/$/, "") || "/" });
