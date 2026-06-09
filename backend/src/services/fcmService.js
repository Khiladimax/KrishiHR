// src/services/fcmService.js — Firebase Admin Push Notifications

let messaging = null;
let initialized = false;

function init() {
  if (initialized) return;
  initialized = true;
  try {
    const admin = require('firebase-admin');
    if (admin.apps.length) {
      messaging = admin.messaging();
      console.log('[FCM] ✅ Already initialized.');
      return;
    }
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      console.warn('[FCM] ⚠️  FIREBASE_SERVICE_ACCOUNT not set — push disabled.');
      return;
    }
    const fixed = raw.replace(/\\\\n/g, '\\n');
    const sa = JSON.parse(fixed);
    admin.initializeApp({ credential: admin.credential.cert(sa) });
    messaging = admin.messaging();
    console.log('[FCM] ✅ Initialized. Project:', sa.project_id);
  } catch (err) {
    console.error('[FCM] ❌ Init FAILED:', err.message);
    messaging = null;
  }
}

async function sendToEmployee(db, employeeId, title, body, data = {}) {
  init();
  if (!messaging) {
    console.warn('[FCM] sendToEmployee skipped — messaging not initialized');
    return;
  }

  try {
    const result = await db.query(
      `SELECT fcm_token FROM employees WHERE id = $1 AND fcm_token IS NOT NULL`,
      [employeeId]
    );
    if (!result.rows.length) {
      console.log(`[FCM] No token for employee ${employeeId} — skipping push`);
      return;
    }

    const token = result.rows[0].fcm_token;
    console.log(`[FCM] Sending "${title}" to employee ${employeeId} (token: ${token.substring(0,20)}...)`);

    const message = {
      token,
      notification: { title, body },
      data: {
        channel: data.channel || 'krishihr_general',
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        ),
      },
      android: {
        priority: data.channel === 'krishihr_alerts' ? 'high' : 'normal',
        notification: {
          channelId: data.channel || 'krishihr_general',
          icon: 'ic_notification',
        },
      },
    };

    const msgId = await messaging.send(message);
    console.log(`[FCM] ✅ Sent to employee ${employeeId}. Message ID: ${msgId}`);
  } catch (err) {
    if (err.code === 'messaging/registration-token-not-registered') {
      console.warn(`[FCM] Stale token for employee ${employeeId} — clearing`);
      try { await db.query(`UPDATE employees SET fcm_token = NULL WHERE id = $1`, [employeeId]); } catch (_) {}
    } else {
      console.error(`[FCM] ❌ Send failed for employee ${employeeId}:`, err.code, err.message);
    }
  }
}

async function sendToEmployees(db, employeeIds, title, body, data = {}) {
  if (!employeeIds || !employeeIds.length) return;
  await Promise.allSettled(
    employeeIds.map(id => sendToEmployee(db, id, title, body, data))
  );
}

module.exports = { sendToEmployee, sendToEmployees, init };
