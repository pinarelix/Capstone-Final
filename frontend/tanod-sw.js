/* ============================================================
   TANOD-SW.JS — Service worker for the Tanod field portal only.
   Registered with scope "/tanod" (see tanod.js), so it never controls
   the admin/captain pages - only tanod-login.html, tanod-dashboard.html,
   and their own assets, all of which happen to start with "tanod".
============================================================ */

// Bumped from v1: the old cache could hold private incident photos and
// avatars (see /uploads below) - activate() deletes any other cache name.
const CACHE_NAME = 'tanod-portal-v2';
const APP_SHELL = [
    '/tanod-login.html',
    '/tanod-dashboard.html',
    '/tanod.css',
    '/tanod.js',
    '/locationList.js',
    '/login.css',
    '/logo_jpeg.jfif',
    '/background_jpeg.jfif',
    '/tanod-manifest.json',
    '/icons/icon-192.png',
    '/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Never intercept API calls - the tanod portal polls live data every
    // 15s (incidents, schedules, logs) and a cached response would show
    // stale info or silently break that.
    if (url.pathname.startsWith('/api/')) return;

    // Never cache uploaded photos/avatars either - they're private case
    // evidence that would otherwise stay on a shared phone after logout,
    // and each short-lived ?ftoken= makes a new URL, so the cache would
    // only keep growing.
    if (url.pathname.startsWith('/uploads/')) return;

    // Only handle GETs for same-origin static assets - anything else
    // (POST submissions, cross-origin requests) passes straight through.
    if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

    // Network-first: always try for the freshest asset, only falling
    // back to the cached copy when offline. Refreshes the cache on
    // every successful fetch.
    event.respondWith(
        fetch(event.request)
            .then((response) => {
                // Don't overwrite a good cached copy with a 404/500 page.
                if (response.ok) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});
