/* Service worker: cache-first over a small precache.

   The point is not speed, it is that theaters are cellular dead zones. A
   home-screen bookmark with no worker will sit on a white screen trying to
   fetch index.html at exactly the moment the tool is needed.

   Cache-first means a deploy is invisible until CACHE changes, so bump the
   version on every release -- the activate handler deletes the older caches. */
const CACHE = "screen-sextant-v3";

/* Relative paths throughout: this ships on GitHub Pages under a project
   subpath, where a leading "/" would resolve to the user root and 404. */
const ASSETS = [
  "./",
  "./index.html",
  "./geom.js",
  "./exif.js",
  "./probe.html",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-maskable-512.png",
  "./apple-touch-icon.png",
];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if(req.method !== "GET") return;
  if(new URL(req.url).origin !== self.location.origin) return;

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      // Cache anything else same-origin we end up fetching (tests.html and
      // friends), so a second visit works offline too.
      if(res && res.ok && res.type === "basic"){
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
      }
      return res;
    }).catch(() => {
      // Offline and not precached: a navigation should still land on the app.
      if(req.mode === "navigate") return caches.match("./index.html");
      return Response.error();
    }))
  );
});
