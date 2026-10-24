// Pages rendered with the real exports (fetch reads public/data in tests/setup.ts): numbers on screen must
// be the exported ones.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { evalFor, sanTokens } from "../src/lib/format";
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

test("the arrow buttons step the game and stop at its ends; the eval bar shows the stored score", async () => {
  const id = "164948678288";
  const g = data<Game>(`games/${id}.json`);
  await open(`/games/${id}?ply=0`);
  expect(await screen.findByText("Start position", {}, SLOW)).toBeTruthy();
  const button = (name: RegExp) => screen.getByRole("button", { name }) as HTMLButtonElement;
  expect(button(/^Previous move/).disabled).toBe(true);
  for (let i = 0; i < 5; i++) await act(async () => { fireEvent.click(button(/^Next move/)); });
  expect(screen.getByText(`5 of ${g.moves.length}`, { exact: false })).toBeTruthy();
  const m = g.moves[4];
  const bar = document.querySelector(".v-board .evalbar")!;
  expect(bar.getAttribute("data-win")).toBe(m.win.toFixed(1));
  expect(bar.getAttribute("aria-label")).toContain(`Stockfish ${evalFor(m.eval, g.colour)} for you`);
  await act(async () => { fireEvent.click(button(/^Last move/)); });
  expect(button(/^Next move/).disabled).toBe(true);
}, 20_000);

test("compare steps my move's line and Stockfish's best together", async () => {
  const id = "164948678288";
  const g = data<Game>(`games/${id}.json`);
  const r = g.records[0];
  await open(`/games/${id}?ply=${r.ply}&compare=1`);
  const you = await screen.findByRole("group", { name: "Your move, then Stockfish's line" }, SLOW);
  const best = screen.getByRole("group", { name: "Stockfish's best line" });
  expect(document.querySelectorAll(".cmp-side .board")).toHaveLength(2);
  const pressed = (el: HTMLElement) => within(el).queryByRole("button", { pressed: true })?.textContent ?? null;
  expect(pressed(you)).toBeNull();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Forward a move in both lines/ })); });
  await act(async () => { fireEvent.keyDown(window, { key: "ArrowRight" }); });
  expect(pressed(you)).toBe(sanTokens(r.reply_line_san)[0]);
  expect(pressed(best)).toBe(sanTokens(r.best_line_san)[1]);
  // Each board's bar is Stockfish's stored score for its line.
  const bars = document.querySelectorAll(".cmp-side .evalbar");
  expect(bars[0].getAttribute("aria-label")).toContain(evalFor(r.after_eval, r.colour));
  expect(bars[1].getAttribute("aria-label")).toContain(evalFor(r.best_eval, r.colour));
  await act(async () => { fireEvent.keyDown(window, { key: "Escape" }); });
  expect(document.querySelector(".cmp")).toBeNull();
  expect(screen.getByText(`${r.ply} of ${g.moves.length}`, { exact: false })).toBeTruthy();
}, 20_000);

test("a leak position steps through either line", async () => {
  await open("/leaks/hung_piece");
  const card = (await screen.findAllByRole("article", {}, SLOW))[0];
  const chips = () => within(card).getByRole("group", { name: /line/ });
  fireEvent.click(within(card).getByRole("button", { name: "Your move" }));
  fireEvent.click(within(card).getByRole("button", { name: "Forward a move" }));
  fireEvent.click(within(card).getByRole("button", { name: "Forward a move" }));
  const tokens = within(chips()).getAllByRole("button").map((b) => b.textContent);
  expect(within(chips()).getByRole("button", { pressed: true }).textContent).toBe(tokens[1]);
  fireEvent.click(within(card).getByRole("button", { name: "Stockfish's best" }));
  expect(within(chips()).queryByRole("button", { pressed: true })).toBeNull();
}, 20_000);
