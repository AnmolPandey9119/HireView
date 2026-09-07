/* ════════════════════════════════════════════════
   HireView — Service Worker
   Purely a free, static-hosting trick (Vercel already serves these
   files) — no server, no cost. Two rules, both deliberately
   conservative so nothing here can ever go stale/wrong for a
   candidate mid-interview:

   1. NEVER intercept anything that isn't a same-origin GET. That
      means every call to BACKEND_URL (a different origin — Render)
      passes straight through untouched, and no POST/PUT/DELETE is
      ever cached. Auth, interview submission, payments etc. are
      completely unaffected by this file.
   2. Network-first, cache-fallback for the static shell (HTML/CSS/JS/
      icons). Freshest copy wins when online; last-seen copy still
      works if the connection drops mid-session.

   Bump CACHE_NAME whenever you want to force everyone onto a fresh
   cache after a deploy (old caches are swept in "activate" below).
   ════════════════════════════════════════════════ */

   const CACHE_NAME = 'hireview-shell-v1';

   const PRECACHE_URLS = [
     '/', '/css/main.css',
     '/js/config.js', '/js/auth.js', '/js/sidebar.js', '/js/footer.js',
     '/manifest.json',
     '/assets/favicon.ico', '/assets/icon-192.png', '/assets/icon-512.png'
   ];
   
   self.addEventListener('install', (event) => {
     event.waitUntil(
       caches.open(CACHE_NAME)
         .then((cache) => cache.addAll(PRECACHE_URLS).catch(() => {
           // Best-effort — a missing/renamed asset shouldn't block install.
         }))
         .then(() => self.skipWaiting())
     );
   });
   
   self.addEventListener('activate', (event) => {
     event.waitUntil(
       caches.keys().then((keys) =>
         Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
       ).then(() => self.clients.claim())
     );
   });
   
   self.addEventListener('fetch', (event) => {
     const req = event.request;
     const url = new URL(req.url);
   
     // Only ever handle same-origin GETs — everything else (API calls to
     // the Render backend, Razorpay, POSTs, etc.) is left completely alone.
     if (req.method !== 'GET' || url.origin !== self.location.origin) return;
   
     event.respondWith(
       fetch(req)
         .then((res) => {
           // Only cache real, successful, basic (same-origin) responses.
           if (res && res.ok && res.type === 'basic') {
             const clone = res.clone();
             caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
           }
           return res;
         })
         .catch(() => caches.match(req).then((cached) => cached || caches.match('/')))
     );
   });