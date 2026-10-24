import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Cross-origin isolation lets the multi-threaded Stockfish build run; without it the app falls back to
// the single-threaded build. The deployed site sets the same headers in public/_headers.
const isolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react()],
  server: { headers: isolation },
  preview: { headers: isolation },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
  },
});
