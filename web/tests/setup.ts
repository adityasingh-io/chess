// jsdom lacks a few browser APIs the app touches; fetch reads the real exports from public/data.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(cleanup);

class NoResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof window !== "undefined") window.scrollTo = () => {};
globalThis.ResizeObserver ??= NoResizeObserver as unknown as typeof ResizeObserver;

const DATA = join(__dirname, "../public/data/");
globalThis.fetch = (async (input: string | URL | Request) => {
  const url = String(input instanceof Request ? input.url : input);
  const path = decodeURIComponent(url.replace(/^.*?\/data\//, ""));
  try {
    return new Response(await readFile(DATA + path, "utf8"), { status: 200 });
  } catch {
    return new Response("not found", { status: 404 });
  }
}) as typeof fetch;
