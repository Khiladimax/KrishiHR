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
      console.log('[FCM] ✅ Firebase Admin SDK already initialized.');
      return;
    }
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      console.warn('[FCM] ⚠️  FIREBASE_SERVICE_ACCOUNT env var not set — push disabled.');
      return;
    }
    // Fix: Render sometimes double-escapes \n in the private_key — unescape it
    const fixed = raw.replace(/\\\\n/g, '\\n');
    const serviceAccount = JSON.parse(fixed);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    messaging = admin.messaging();
    console.log('[FCM] ✅ Firebase Admin SDK initialized. Project:', serviceAccount.project_id);
  } catch (err) {
    console.error('[FCM] ❌ Firebase Admin SDK init FAILED:', err.message);
    messaging = null;
  }
}

/**
 * Send push notification to a single employee.
 */
async function sendToEmployee(db, employeeId, title, body, data = {}) {
  init();
  if (!messaging) return;

  try {
    const result = await db.query(
      `SELECT fcm_token FROM employees WHERE id = $1 AND fcm_token IS NOT NULL`,
      [employeeId]
    );
    if (!result.rows.length) return;

    const token = result.rows[0].fcm_token;
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

    await messaging.send(message);
  } catch (err) {
    if (err.code === 'messaging/registration-token-not-registered') {
      try { await db.query(`UPDATE employees SET fcm_token = NULL WHERE id = $1`, [employeeId]); } catch (_) {}
    } else {
      console.warn(`[FCM] sendToEmployee(${employeeId}) failed:`, err.message);
    }
  }
}

/**
 * Send push to multiple employees in parallel.
 */
async function sendToEmployees(db, employeeIds, title, body, data = {}) {
  if (!employeeIds || !employeeIds.length) return;
  await Promise.allSettled(
    employeeIds.map(id => sendToEmployee(db, id, title, body, data))
  );
}

module.exports = { sendToEmployee, sendToEmployees, init };
