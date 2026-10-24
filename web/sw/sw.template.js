// Offline support (written into dist/sw.js at build, with the build's file list). The app shell and every
// built file are cached at install, along with the data the dashboard and training pages need; other data
// files are fetched network-first and kept, so a game or page opened once works offline. Engine files are
// cached on first use. Responses are stored whole, headers included (the shell keeps its COOP/COEP headers).
const BUILD = self.__BUILD__;
const FILES = self.__FILES__;
const DATA = ["summary.json", "insights.json", "losses.json", "games/index.json", "leaks.json", "puzzles/index.json", "puzzles/mine.json", "puzzles/lichess.json", "repertoire.json"];
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

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== scope.origin || !url.href.startsWith(scope.href)) return;
  const path = url.href.slice(scope.href.length);
  if (request.mode === "navigate") {
    // Every route is the one page: fresh when online, the cached shell when not.
    event.respondWith(fetch(request).catch(async () => (await match(at("./"))) ?? Response.error()));
  } else if (path.startsWith("data/")) {
    event.respondWith(networkFirst(request, at(path.split("?")[0])));
  } else if (path.startsWith("assets/") || path.startsWith("engine/") || FILES.includes(path)) {
    event.respondWith(cacheFirst(request));
  }
});
