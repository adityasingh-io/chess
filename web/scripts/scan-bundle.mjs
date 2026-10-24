// Fails the build if anything secret-looking reached dist/. Two checks: known key formats, and the value of
// every pipeline secret (the repo-root .env's non-VITE_ variables and the CI secrets in the environment).
// Only file and pattern names are printed, never what matched.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const PATTERNS = {
  "Anthropic API key": /sk-ant-[A-Za-z0-9_-]{20,}/,
  "Supabase secret key": /sb_secret_[A-Za-z0-9_-]{10,}/,
  "Lichess token": /\blip_[A-Za-z0-9]{10,}/,
  "GitHub token": /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/,
  "AWS access key": /\bAKIA[0-9A-Z]{16}\b/,
  "private key": /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
};
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.(eyJ[A-Za-z0-9_-]{10,})\.[A-Za-z0-9_-]{10,}/g;
// Secrets the pipeline and the nightly Action use; their values must never be in the bundle.
export const SECRET_NAMES = ["LICHESS_TOKEN", "CHESSCOM_CONTACT_EMAIL", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN",
  "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY", "GITHUB_TOKEN"];
const TEXT = /\.(?:js|mjs|css|html|json|webmanifest|txt|svg|map)$|^_headers$/;

/** Names of what was found in one file's text (empty when clean). */
export function findings(text, secrets) {
  const found = Object.entries(PATTERNS).filter(([, re]) => re.test(text)).map(([name]) => name);
  for (const m of text.matchAll(JWT)) {
    try {
      if (JSON.parse(Buffer.from(m[1], "base64url").toString()).role === "service_role") found.push("Supabase service-role key");
    } catch { /* not a JWT after all */ }
  }
  for (const [name, value] of Object.entries(secrets)) if (text.includes(value)) found.push(`the value of ${name}`);
  return found;
}

/** The secret values to look for: non-VITE_ variables in the .env file and known secret names in env. */
export function secretValues(envText, env) {
  const out = {};
  for (const line of envText.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && !m[1].startsWith("VITE_")) out[m[1]] = m[2].trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  for (const name of SECRET_NAMES) if (env[name]) out[name] = env[name];
  // Short values ("1", "true") would match by accident; real secrets are longer.
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v.length >= 8));
}

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : TEXT.test(name) ? [path] : [];
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const web = join(dirname(fileURLToPath(import.meta.url)), "..");
  const dist = join(web, "dist");
  const envFile = join(web, "..", ".env");
  const secrets = secretValues(existsSync(envFile) ? readFileSync(envFile, "utf8") : "", process.env);
  const list = files(dist);
  let bad = 0;
  for (const path of list) {
    for (const what of findings(readFileSync(path, "utf8"), secrets)) {
      console.error(`scan: ${relative(web, path)} contains ${what}`);
      bad++;
    }
  }
  if (bad) {
    console.error("scan: the bundle must not hold secrets (see docs/DEPLOY.md); nothing should be deployed from this build");
    process.exit(1);
  }
  console.log(`scan: ${list.length} files in dist/, no secrets (${Object.keys(secrets).length} secret values checked)`);
}
