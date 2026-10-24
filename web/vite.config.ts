import { readFileSync } from "node:fs";
import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

// The service worker (sw/sw.template.js) gets the build's file list and an id, so each build installs fresh.
function serviceWorker(): Plugin {
  return {
    name: "coach-service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith(".map"))
        .concat(["favicon.svg", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png"]);
      const build = Date.now().toString(36);
      const source = readFileSync(new URL("./sw/sw.template.js", import.meta.url), "utf8")
        .replace("self.__BUILD__", JSON.stringify(build)).replace("self.__FILES__", JSON.stringify(files));
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

// Cross-origin isolation lets the multi-threaded Stockfish build run; without it the app falls back to
// the single-threaded build. The deployed site sets the same headers in public/_headers.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react(), serviceWorker()],
  // One .env for the pipeline and the app, at the repo root. Vite exposes only VITE_ variables (the
  // Supabase URL and publishable key) to the bundle; the pipeline's secrets never reach it.
  envDir: "..",
  server: { headers: isolation },
  preview: { headers: isolation },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
  },
});
