// KrishiHR PWA Service Worker
// Strategy: Network-first for API calls, Cache-first for static assets
// This makes the app installable on Windows/Mac/Linux via Chrome

const CACHE_NAME = 'krishihr-v1';
const STATIC_ASSETS = [
  '/login.html',
  '/dashboard.html',
  '/employees.html',
  '/attendance.html',
  '/leaves.html',
  '/payroll.html',
  '/payslip.html',
  '/reimbursement.html',
  '/advance.html',
  '/chat.html',
  '/announcements.html',
  '/movement.html',
  '/separation.html',
  '/provision.html',
  '/projects.html',
  '/geofence.html',
  '/offer-letter.html',
  '/it-declaration.html',
  '/form16.html',
  '/app.js',
  '/config.js',
  '/style.css',
  '/Logo_kcms.png',
  '/Logo.ico',
  '/manifest.json',
];

// ── Install: cache all static assets ────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(STATIC_ASSETS).catch(err => {
        console.warn('[SW] Some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// ── Activate: clean up old caches ───────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for API, cache-first for static ────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Skip non-GET and chrome-extension requests
  if (event.request.method !== 'GET') return;
  if (url.protocol === 'chrome-extension:') return;

  // API calls → network only (never cache auth tokens / live data)
  if (url.hostname.includes('onrender.com') || url.pathname.startsWith('/api/')) {
    return; // let it go to network normally
  }

  // Google Maps / CDN → network first, fall back to cache
  if (url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com')) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // Static assets → cache first, fall back to network
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        // Cache successful responses for static files
        if (response && response.status === 200 && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline fallback — return login page for HTML requests
        if (event.request.headers.get('accept')?.includes('text/html')) {
          return caches.match('/login.html');
        }
      });
    })
  );
});
