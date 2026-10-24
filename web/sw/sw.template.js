// Offline support (written into dist/sw.js at build, with the build's file list). The app shell and every
// built file are cached at install, along with the data the dashboard and training pages need; other data
// files are fetched network-first and kept, so a game or page opened once works offline. Engine files, and
// Maia-2's model and runtime, are cached on first use. Responses are stored whole, headers included.
//
// Every response it serves also gets the cross-origin isolation headers the multi-threaded engine needs.
// GitHub Pages can't send headers, so there the engine runs single-threaded on the first visit and
// multi-threaded once this worker controls the page; hosts that send the headers get the same values.
const BUILD = self.__BUILD__;
const FILES = self.__FILES__;
const DATA = ["summary.json", "insights.json", "losses.json", "games/index.json", "leaks.json", "endgames.json", "puzzles/index.json", "puzzles/mine.json", "puzzles/lichess.json", "repertoire.json"];
const SHELL = `shell-${BUILD}`, RUNTIME = "runtime-v1";
const scope = new URL(self.registration.scope);
const at = (path) => new URL(path, scope).href;
// Responses are stored from plain requests, while module scripts and fonts are fetched in CORS mode with
// an Origin header; a server's "Vary: Origin" would then keep the cached copy from matching.
const match = (request) => caches.match(request, { ignoreVary: true });

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll([at("./"), ...FILES.map(at)]);
    const runtime = await caches.open(RUNTIME);
    await Promise.all(DATA.map((d) => fetch(at(`data/${d}`)).then((r) => r.ok && runtime.put(at(`data/${d}`), r)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith("shell-") && key !== SHELL) await caches.delete(key);
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheKey = request) {
  const runtime = await caches.open(RUNTIME);
  try {
    const response = await fetch(request);
    if (response.ok) await runtime.put(cacheKey, response.clone());
    return response;
  } catch (e) {
    const cached = await match(cacheKey);
    if (cached) return cached;
    throw e;
  }
}

async function cacheFirst(request) {
  const cached = await match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(RUNTIME)).put(request, response.clone());
  return response;
}

const ISOLATION = { "Cross-Origin-Opener-Policy": "same-origin", "Cross-Origin-Embedder-Policy": "require-corp" };
const NO_BODY = [101, 204, 205, 304];

function isolated(response) {
  // Redirects and opaque responses can't be rebuilt; they carry no page or script anyway.
  if (response.status === 0 || NO_BODY.includes(response.status)) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(ISOLATION)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== scope.origin || !url.href.startsWith(scope.href)) return;
  const path = url.href.slice(scope.href.length);
  let response;
  if (request.mode === "navigate") {
    // Every route is the one page: fresh when online, the cached shell when not.
    response = fetch(request).catch(async () => (await match(at("./"))) ?? Response.error());
  } else if (path.startsWith("data/")) {
    response = networkFirst(request, at(path.split("?")[0]));
  } else if (path.startsWith("assets/") || path.startsWith("engine/") || path.startsWith("maia/") || FILES.includes(path)) {
    response = cacheFirst(request);
  } else {
    response = fetch(request);
  }
  event.respondWith(response.then(isolated));
});
