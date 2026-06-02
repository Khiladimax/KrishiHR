/**
 * KrishiHR Movement Tracking Service Worker
 * ─────────────────────────────────────────────────────────────────────────────
 * FIXES in this version:
 *  1. 500m distance gate  — only logs a point if employee moved ≥500m from
 *                           the last saved point (or it's the very first point)
 *  2. Accuracy tightened  — skips points with GPS accuracy > 50m (was 200m)
 *  3. Offline buffer      — when no internet, stores points in IndexedDB queue
 *  4. Batch flush         — on reconnect, flushes queued points in order via
 *                           POST /attendance/movement/log-batch
 *  5. Watchdog preserved  — main page PING still restarts dead loop
 * ─────────────────────────────────────────────────────────────────────────────
 */

const API_BASE     = 'https://krishihr-zuui.onrender.com/api';
const INTERVAL     = 30 * 1000;   // 30 seconds between GPS checks
const MAX_GPS_WAIT = 10000;        // 10 sec GPS timeout
const MAX_ACCURACY = 50;           // metres — reject readings worse than this
const MIN_DIST_M   = 500;          // metres — skip if employee hasn't moved this far

let _token    = null;
let _timerId  = null;
let _inFlight = false;
let _lastTick = 0;

// ── Message handler ───────────────────────────────────────────────────────────
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
    if (_token && _lastTick > 0 && (Date.now() - _lastTick) > 650000 && !_timerId) {
      console.warn('[SW] Watchdog restarting dead loop');
      startLoop();
    }
    event.source?.postMessage({ type: 'PONG', tracking: !!_token, lastTick: _lastTick });
  }

  if (type === 'FORCE_TICK') {
    if (_token && !_inFlight) await doTick();
  }
});

self.addEventListener('install', () => self.skipWaiting());

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

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'krishi-tracking') {
    event.waitUntil((async () => {
      if (_token && !_inFlight) await doTick();
    })());
  }
});

// ── Loop ──────────────────────────────────────────────────────────────────────
function startLoop() { stopLoop(); scheduleTick(); }

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

// ── Haversine distance in metres ──────────────────────────────────────────────
function haversineMetres(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2
          + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── Main tick ─────────────────────────────────────────────────────────────────
async function doTick() {
  if (_inFlight) return;
  _inFlight = true;
  try {
    // 1. Flush any buffered offline points first (in order)
    await flushOfflineBuffer();

    // 2. Get current GPS position
    const pos = await getLocationWithTimeout(MAX_GPS_WAIT);
    if (!pos) { console.log('[SW] No GPS fix — skipping'); return; }

    // 3. Accuracy gate — skip poor readings
    if (pos.coords.accuracy > MAX_ACCURACY) {
      console.warn(`[SW] Poor accuracy ${pos.coords.accuracy.toFixed(0)}m > ${MAX_ACCURACY}m — skipping`);
      return;
    }

    const lat = pos.coords.latitude;
    const lng = pos.coords.longitude;
    const acc = pos.coords.accuracy;

    // 4. Distance gate — only log if moved ≥500m from last saved point
    const lastPt = await dbGet('last_logged_point');
    if (lastPt) {
      const distM = haversineMetres(lastPt.lat, lastPt.lng, lat, lng);
      if (distM < MIN_DIST_M) {
        console.log(`[SW] Moved only ${distM.toFixed(0)}m — below 500m gate, skipping`);
        _lastTick = Date.now();
        return;
      }
      console.log(`[SW] Moved ${distM.toFixed(0)}m — logging point`);
    }

    // 5. Try to upload; if offline, buffer for later
    const uploaded = await uploadPoint(lat, lng, acc);
    if (uploaded) {
      await dbSet('last_logged_point', { lat, lng, ts: Date.now() });
    } else {
      // Offline — push to buffer queue
      await pushOfflineBuffer({ lat, lng, acc, ts: Date.now() });
      console.log('[SW] Offline — point buffered for later upload');
    }

    _lastTick = Date.now();
  } catch (err) {
    console.warn('[SW] Tick error (will retry):', err.message);
  } finally {
    _inFlight = false;
  }
}

// ── Upload single point ───────────────────────────────────────────────────────
async function uploadPoint(lat, lng, acc) {
  try {
    const base = self._apiBase || API_BASE;
    const resp = await fetch(`${base}/attendance/movement/log`, {
      method:    'POST',
      keepalive: true,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${_token}`
      },
      body: JSON.stringify({ lat, lng, accuracy: acc })
    });
    if (resp.status === 401) {
      console.warn('[SW] 401 — token expired, stopping');
      stopLoop();
      await clearStorage();
      return false;
    }
    console.log(`[SW] ✅ Uploaded ${lat.toFixed(5)},${lng.toFixed(5)} ±${acc.toFixed(0)}m`);
    return true;
  } catch (_) {
    return false; // offline or network error
  }
}

// ── Offline buffer: queue of points waiting to be uploaded ────────────────────
async function pushOfflineBuffer(point) {
  const buf = (await dbGet('offline_buffer')) || [];
  buf.push(point);
  // Cap buffer at 500 points (~250km at 500m spacing) to avoid bloat
  if (buf.length > 500) buf.splice(0, buf.length - 500);
  await dbSet('offline_buffer', buf);
}

async function flushOfflineBuffer() {
  const buf = (await dbGet('offline_buffer')) || [];
  if (!buf.length) return;

  console.log(`[SW] Flushing ${buf.length} buffered points`);
  const base = self._apiBase || API_BASE;

  try {
    const resp = await fetch(`${base}/attendance/movement/log-batch`, {
      method:    'POST',
      keepalive: true,
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${_token}`
      },
      body: JSON.stringify({ points: buf })
    });

    if (resp.ok) {
      const lastPt = buf[buf.length - 1];
      await dbSet('last_logged_point', { lat: lastPt.lat, lng: lastPt.lng, ts: lastPt.ts });
      await dbDel('offline_buffer');
      console.log(`[SW] ✅ Batch flushed ${buf.length} points`);
    } else if (resp.status === 401) {
      stopLoop();
      await clearStorage();
    }
    // If still offline, buffer stays intact for next attempt
  } catch (_) {
    console.log('[SW] Batch flush failed — still offline, will retry');
  }
}

// ── GPS with timeout ──────────────────────────────────────────────────────────
function getLocationWithTimeout(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    navigator.geolocation.getCurrentPosition(
      (pos) => { clearTimeout(timer); resolve(pos); },
      ()    => { clearTimeout(timer); resolve(null); },
      { enableHighAccuracy: true, timeout: ms, maximumAge: 20000 }
    );
  });
}

// ── IndexedDB ─────────────────────────────────────────────────────────────────
function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('KrishiHR_SW', 3);
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
      req.onsuccess = () => resolve(req.result ?? null);
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
  await dbDel('last_logged_point');
  // Keep offline_buffer — don't lose queued points on token refresh
}
