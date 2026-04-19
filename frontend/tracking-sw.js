/**
 * KrishiHR Movement Tracking Service Worker
 * Keeps GPS pinging every 30 seconds across ALL pages — survives navigation,
 * tab switching, and page reloads.
 *
 * Android keep-alive fixes:
 *  - keepalive:true on fetch so Android doesn't kill in-flight requests
 *  - Watchdog: main page pings SW every 25s; if loop died it restarts
 *  - clients.claim() on activate so SW takes control immediately
 *  - maximumAge:15000 so GPS doesn't hang waiting for fresh fix every time
 *  - Saves apiBase to IndexedDB so it survives SW restart
 */

const API_BASE    = 'https://krishihr.onrender.com/api';
const INTERVAL    = 30 * 1000;   // 30 seconds
const MAX_GPS_WAIT = 10000;      // 10 second GPS timeout per tick

let _token    = null;
let _timerId  = null;
let _inFlight = false;
let _lastTick = 0;   // timestamp of last successful ping — used by watchdog

// ── Message handler (from main thread) ───────────────────────────────────────
self.addEventListener('message', async (event) => {
  const { type, token, apiBase } = event.data || {};

  if (type === 'START_TRACKING') {
    _token = token;
    if (apiBase) self._apiBase = apiBase;
    await saveToken(token);
    await saveApiBase(apiBase || API_BASE);
    _lastTick = Date.now();
    startLoop();
    event.source?.postMessage({ type: 'TRACKING_STARTED' });
  }

  if (type === 'STOP_TRACKING') {
    stopLoop();
    await clearStorage();
    event.source?.postMessage({ type: 'TRACKING_STOPPED' });
  }

  if (type === 'PING') {
    // Watchdog: if we have a token but loop died (no tick in >70s), restart it
    if (_token && _lastTick > 0 && (Date.now() - _lastTick) > 70000 && !_timerId) {
      console.warn('[SW] Watchdog restarting dead loop');
      startLoop();
    }
    event.source?.postMessage({ type: 'PONG', tracking: !!_token, lastTick: _lastTick });
  }

  if (type === 'FORCE_TICK') {
    if (_token && !_inFlight) await doTick();
  }
});

// ── Install: skip waiting so new SW activates immediately ────────────────────
self.addEventListener('install', () => self.skipWaiting());

// ── Activate: claim all clients + restore tracking if it was running ─────────
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const token   = await loadToken();
    const apiBase = await loadApiBase();
    if (token) {
      _token = token;
      if (apiBase) self._apiBase = apiBase;
      _lastTick = Date.now();
      startLoop();
      console.log('[SW] Resumed tracking after SW restart');
    }
  })());
});

// ── Periodic Sync (Android Chrome — keeps SW alive in background) ────────────
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'krishi-tracking') {
    event.waitUntil((async () => {
      if (_token && !_inFlight) await doTick();
    })());
  }
});

// ── Loop ─────────────────────────────────────────────────────────────────────
function startLoop() {
  stopLoop();
  scheduleTick();
}

function stopLoop() {
  if (_timerId !== null) { clearTimeout(_timerId); _timerId = null; }
  _token    = null;
  _inFlight = false;
}

function scheduleTick() {
  _timerId = setTimeout(async () => {
    if (!_token) return;
    await doTick();
    if (_token) scheduleTick();
  }, INTERVAL);
}

async function doTick() {
  if (_inFlight) return;
  _inFlight = true;
  try {
    const pos = await getLocationWithTimeout(MAX_GPS_WAIT);
    if (!pos) { console.log('[SW] No GPS fix — skipping'); return; }
    // ✅ FIX: Raised threshold from 50m → 200m. Log poor accuracy but never skip the ping.
    if (pos.coords.accuracy > 200) {
      console.warn(`[SW] Poor accuracy ${pos.coords.accuracy.toFixed(0)}m — logging anyway`);
    }

    const base = self._apiBase || API_BASE;

    // keepalive:true = browser keeps this fetch alive even if SW is suspended by Android
    const resp = await fetch(`${base}/attendance/movement/log`, {
      method:    'POST',
      keepalive: true,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${_token}`
      },
      body: JSON.stringify({
        lat:      pos.coords.latitude,
        lng:      pos.coords.longitude,
        accuracy: pos.coords.accuracy
      })
    });

    if (resp.status === 401) {
      console.warn('[SW] 401 — token expired, stopping');
      stopLoop();
      await clearStorage();
    } else {
      _lastTick = Date.now();
      console.log(`[SW] ✅ ${pos.coords.latitude.toFixed(5)},${pos.coords.longitude.toFixed(5)} ±${pos.coords.accuracy.toFixed(0)}m`);
    }
  } catch (err) {
    console.warn('[SW] Tick error (will retry):', err.message);
  } finally {
    _inFlight = false;
  }
}

// ── GPS with timeout ──────────────────────────────────────────────────────────
function getLocationWithTimeout(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve(pos); },
      ()    => { clearTimeout(timer); resolve(null); },
      // ✅ FIX: maximumAge 0 → 20000ms — avoids fresh-fix timeout on every tick
      { enableHighAccuracy: true, timeout: ms, maximumAge: 20000 }
    );
  });
}

// ── IndexedDB ─────────────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('KrishiHR_SW', 2);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror   = ()  => reject(req.error);
  });
}

async function dbSet(key, value) {
  try {
    const db = await openDB();
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    await new Promise((r, j) => { tx.oncomplete = r; tx.onerror = j; });
  } catch (e) { console.warn('[SW] dbSet failed:', e); }
}

async function dbGet(key) {
  try {
    const db = await openDB();
    const tx = db.transaction('kv', 'readonly');
    return new Promise((resolve) => {
      const req = tx.objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => resolve(null);
    });
  } catch { return null; }
}

async function dbDel(key) {
  try {
    const db = await openDB();
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(key);
  } catch (e) { console.warn('[SW] dbDel failed:', e); }
}

const saveToken   = (v) => dbSet('tracking_token', v);
const loadToken   = ()  => dbGet('tracking_token');
const saveApiBase = (v) => dbSet('api_base', v);
const loadApiBase = ()  => dbGet('api_base');

async function clearStorage() {
  await dbDel('tracking_token');
  await dbDel('api_base');
}
