// Pages rendered with the real exports (fetch reads public/data in tests/setup.ts): numbers on screen must
// be the exported ones.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { posKey, replay } from "../src/lib/chess";
import { evalFor, sanTokens } from "../src/lib/format";
import { ENDGAME_TYPE, OUTCOME } from "../src/lib/names";
import { routes } from "../src/router";
import type { Endgames, Game, Insights, Leaks, Losses, OpeningReport, Summary } from "../src/types/export";

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

const pctText = (x: number | null) => (x == null ? "–" : `${x.toFixed(1)}%`);

test("the opening tree shows the exported counts and steps into a child position", async () => {
  const report = data<OpeningReport>("openings/white.json");
  const root = report.tree[0];
  await open("/openings/white");
  const tree = await screen.findByRole("region", { name: "Your opening tree as White" }, SLOW);
  expect(within(tree).getByText(`${root.games} games`)).toBeTruthy();
  expect(within(tree).getByText(`your score ${pctText(root.score)}`)).toBeTruthy();
  // The first row of the moves table is my most played move with its games and score.
  const top = root.moves[0];
  const row = within(tree).getAllByRole("row").find((r) => r.textContent?.includes(top.san))!;
  expect(within(row).getByText(String(top.games))).toBeTruthy();
  expect(within(row).getByText(pctText(top.score))).toBeTruthy();
  // ▶ follows my most played move; the position after it is a tree node with its own count.
  await act(async () => { fireEvent.click(within(tree).getByRole("button", { name: "Forward along your most played move" })); });
  const child = report.tree.find((n) => n.key === posKey(replay(root.fen, [top.uci])[0]))!;
  expect(within(tree).getByText(`${child.games} games`)).toBeTruthy();
  expect(within(tree).getByRole("button", { name: /^1\. / , pressed: true })).toBeTruthy();
  expect(document.querySelectorAll(".fam")).toHaveLength(report.families.length);
}, 20_000);

test("the endgame table matches the export and a cell filters the list", async () => {
  const e = data<Endgames>("endgames.json");
  await open("/endgames");
  expect(await screen.findByRole("button", { name: `All outcomes, every type: ${e.endgames.length}` }, SLOW)).toBeTruthy();
  for (const [type, row] of Object.entries(e.table)) {
    for (const [outcome, n] of Object.entries(row)) {
      expect(screen.getByRole("button", { name: `${OUTCOME[outcome]}, ${ENDGAME_TYPE[type]}: ${n}` })).toBeTruthy();
    }
  }
  const words = (n: number) => `${n} game${n === 1 ? "" : "s"}, newest first`;
  const spoiled = e.endgames.filter((x) => x.info.outcome === "spoiled");
  expect(screen.getByText(words(spoiled.length))).toBeTruthy();
  const rook = e.endgames.filter((x) => x.info.type === "rook");
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: `All outcomes, Rook: ${rook.length}` })); });
  expect(screen.getByText(words(rook.length))).toBeTruthy();
}, 20_000);

test("insights show the exported group scores, leak rates and time losses", async () => {
  const ins = data<Insights>("insights.json");
  await open("/insights");
  const colour = await screen.findByRole("table", { name: "Score and accuracy by colour" }, SLOW);
  for (const c of ins.by_colour) {
    const row = within(colour).getByRole("row", { name: new RegExp(`^As ${c.key === "white" ? "White" : "Black"}`) });
    expect(within(row).getByText(String(c.games))).toBeTruthy();
    expect(within(row).getByText(pctText(c.score))).toBeTruthy();
  }
  const rates = ins.leak_rates as { recent: Record<string, number>; previous: Record<string, number> };
  const hung = screen.getByRole("link", { name: /^Hung a piece/ });
  expect(within(hung).getByText(rates.recent.hung_piece.toFixed(2))).toBeTruthy();
  expect(within(hung).getByText(rates.previous.hung_piece.toFixed(2))).toBeTruthy();
  const losses = ins.time_losses as { count: number };
  expect(screen.getByText(`${losses.count} games in all`)).toBeTruthy();
}, 20_000);
