/// <reference lib="webworker" />

// Bump this whenever the caching strategy changes — the `activate` handler
// deletes every cache that isn't the current name, so an old cache holding a
// stale build is purged.
const CACHE_NAME = 'bookly-v1';
// Only truly-static, public assets. Auth-gated HTML documents (e.g.
// /dashboard) are NOT precached — their markup embeds build-specific chunk
// URLs that go stale, which would resurrect the stale-code class of bug.
const STATIC_ASSETS = [
    '/',
    '/login',
    '/register',
    '/offline',
    '/manifest.json',
];

// Install event — cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate event — clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch event — network-first with cache fallback strategy
self.addEventListener('fetch', (event) => {
    const { request } = event;

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Skip API calls and external requests — always go to network.
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/') || url.origin !== self.location.origin) {
        return;
    }

    // Never intercept application code/CSS chunks. Caching `/_next/` assets
    // would let the SW serve a stale build of a page (the cause of the
    // `ReferenceError: webhookUrl is not defined` crash). The browser's own
    // HTTP cache handles these correctly — content-hashed in prod, always
    // fresh in dev.
    if (url.pathname.startsWith('/_next/')) {
        return;
    }

    // For navigation requests, use network-first
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then((cache) => {
                        cache.put(request, responseClone);
                    });
                    return response;
                })
                .catch(async () => {
                    // Offline fallback. `respondWith` rejects ("Failed to
                    // convert value to 'Response'") if handed `undefined`, so
                    // always resolve to a real Response: the requested page if
                    // cached, else the branded /offline screen, else a minimal
                    // inline document.
                    const cached =
                        (await caches.match(request)) ||
                        (await caches.match('/offline')) ||
                        (await caches.match('/'));
                    return (
                        cached ||
                        new Response(
                            '<!doctype html><meta charset="utf-8"><title>Offline</title><p>You are offline. Reconnect and try again.',
                            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
                        )
                    );
                })
        );
        return;
    }

    // For static assets, use stale-while-revalidate
    event.respondWith(
        caches.match(request).then((cachedResponse) => {
            const fetchPromise = fetch(request)
                .then((networkResponse) => {
                    if (networkResponse && networkResponse.status === 200) {
                        const responseClone = networkResponse.clone();
                        caches.open(CACHE_NAME).then((cache) => {
                            cache.put(request, responseClone);
                        });
                    }
                    return networkResponse;
                })
                .catch(() => cachedResponse);

            return cachedResponse || fetchPromise;
        })
    );
});
