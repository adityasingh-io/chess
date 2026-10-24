// The build's secret scan (scripts/scan-bundle.mjs). The "secrets" here are made-up strings in each format.
import { findings, secretValues } from "../scripts/scan-bundle.mjs";

const jwt = (payload: object) =>
  ["eyJhbGciOiJIUzI1NiJ9", Buffer.from(JSON.stringify(payload)).toString("base64url"), "c2lnbmF0dXJlLXBhcnQtaGVyZQ"].join(".");

test("known key formats are caught, and the publishable Supabase key is allowed", () => {
  expect(findings(`const k="sk-ant-api03-${"x".repeat(30)}"`, {})).toEqual(["Anthropic API key"]);
  expect(findings(`a="sb_secret_${"y".repeat(20)}"`, {})).toEqual(["Supabase secret key"]);
  expect(findings(`t="lip_${"z".repeat(20)}"`, {})).toEqual(["Lichess token"]);
  expect(findings(`x="${jwt({ role: "service_role", iss: "supabase-demo" })}"`, {})).toEqual(["Supabase service-role key"]);
  expect(findings(`x="${jwt({ role: "anon", iss: "supabase-demo" })}" y="sb_publishable_${"p".repeat(20)}"`, {})).toEqual([]);
});

test("pipeline secret values are looked for by name, VITE_ ones are public", () => {
  const env = "LICHESS_TOKEN=made-up-token-123\nVITE_SUPABASE_URL=https://example.supabase.co\nSTOCKFISH_PATH=/opt/sf\n# comment\n";
  const secrets = secretValues(env, { GITHUB_TOKEN: "made-up-ci-token", PATH: "/usr/bin:/bin" });
  expect(Object.keys(secrets).sort()).toEqual(["GITHUB_TOKEN", "LICHESS_TOKEN"]);
  expect(findings("fetch('https://example.supabase.co')", secrets)).toEqual([]);
  expect(findings("headers:{a:'made-up-token-123'}", secrets)).toEqual(["the value of LICHESS_TOKEN"]);
});
