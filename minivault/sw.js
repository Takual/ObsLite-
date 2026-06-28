const CACHE_NAME = 'minivault-v2';
const ASSETS = [
    './',
    './index.html',
    './app.js',
    './style.css',
    './manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
    );
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    if (url.searchParams.has('shared_title') || url.searchParams.has('shared_text') || url.searchParams.has('shared_url')) {
        e.respondWith(Response.redirect(url.pathname + '?' + url.searchParams.toString()));
        return;
    }

    e.respondWith(
        fetch(e.request).catch(() => caches.match(e.request))
    );
});
