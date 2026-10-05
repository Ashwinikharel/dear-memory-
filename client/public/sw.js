// Minimal service worker: makes Dear Memory installable on phones.
// It deliberately caches NOTHING, so guest photos are never stored on the device.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => { /* network only */ });
