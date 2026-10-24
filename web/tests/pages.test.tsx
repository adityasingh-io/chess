// Pages rendered with the real exports (fetch reads public/data in tests/setup.ts): numbers on screen must
// be the exported ones.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { routes } from "../src/router";
import type { Game, Leaks, Losses, Summary } from "../src/types/export";

const data = <T,>(p: string): T => JSON.parse(readFileSync(join(__dirname, "../public/data", p), "utf8"));
const summary = data<Summary>("summary.json");
const losses = data<Losses>("losses.json");

async function open(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  await act(async () => { render(<RouterProvider router={router} />); });
  return router;
}
const SLOW = { timeout: 10_000 };   // first render waits for the lazily loaded page module

test("dashboard shows the exported rating and loss shares", async () => {
  await open("/");
  expect(await screen.findByText(String(summary.rating), { selector: ".big" }, SLOW)).toBeTruthy();
  const total = Object.values(losses.causes_30_days).reduce((a, b) => a + b, 0);
  expect(screen.getByText(`Last 30 days (${total} losses)`)).toBeTruthy();
  const [cause, count] = Object.entries(losses.causes_30_days).sort((a, b) => b[1] - a[1])[0];
  const row = (await screen.findAllByRole("link")).find((a) => a.getAttribute("href") === `/games?cause=${cause}`)!;
  expect(within(row).getByText(`${Math.round((count / total) * 100)}%`)).toBeTruthy();
}, 20_000);

test("leaks list every tag with its count", async () => {
  await open("/leaks");
  const leaks = data<Leaks>("leaks.json").leaks.filter((l) => l.count > 0);
  expect(await screen.findAllByRole("link", { name: /Win% lost/ }, SLOW)).toHaveLength(leaks.length);
}, 20_000);

test("the viewer steps through a game with the keyboard", async () => {
  const id = "164948678288";
  const g = data<Game>(`games/${id}.json`);
  await open(`/games/${id}?ply=0`);
  expect(await screen.findByText("Start position", {}, SLOW)).toBeTruthy();
  for (let i = 0; i < 3; i++) await act(async () => { fireEvent.keyDown(window, { key: "ArrowRight" }); });
  expect(screen.getByText(`3 of ${g.moves.length}`, { exact: false })).toBeTruthy();
  await act(async () => { fireEvent.keyDown(window, { key: "End" }); });
  expect(screen.getByText(`${g.moves.length} of ${g.moves.length}`, { exact: false })).toBeTruthy();
  // A mistake record's explanation is the pipeline's template text, shown as is.
  const r = g.records[0];
  fireEvent.click(document.querySelector(`.mv[data-ply="${r.ply}"]`)!);
  expect(await screen.findByText(r.explanation)).toBeTruthy();
}, 20_000);
