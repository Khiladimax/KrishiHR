// src/services/fcmService.js — Firebase Admin Push Notifications
// Uses GOOGLE_APPLICATION_CREDENTIALS env var (path to serviceAccount.json)
// OR FIREBASE_SERVICE_ACCOUNT env var (JSON string for Railway/cloud deploys)

let admin = null;

function getAdmin() {
  if (admin) return admin;
  try {
    admin = require('firebase-admin');
    if (!admin.apps.length) {
      let credential;
      if (process.env.FIREBASE_SERVICE_ACCOUNT) {
        // Cloud deploy: JSON string in env var
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        credential = admin.credential.cert(serviceAccount);
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        // Local dev: path to serviceAccount.json file
        credential = admin.credential.applicationDefault();
      } else {
        console.warn('[FCM] No Firebase credentials configured — push notifications disabled.');
        return null;
      }
      admin.initializeApp({ credential });
      console.log('[FCM] Firebase Admin SDK initialized.');
    }
    return admin;
  } catch (err) {
    console.warn('[FCM] firebase-admin not available:', err.message);
    return null;
  }
}

/**
 * Send a push notification to a single employee.
 * Looks up the employee's fcm_token from the DB, then sends via FCM.
 *
 * @param {object} db         - pg pool instance
 * @param {number} employeeId - employee.id
 * @param {string} title      - notification title
 * @param {string} body       - notification body
 * @param {object} [data]     - optional key-value data payload (e.g. { screen: 'leaves', channel: 'krishihr_alerts' })
 */
async function sendToEmployee(db, employeeId, title, body, data = {}) {
  const firebaseAdmin = getAdmin();
  if (!firebaseAdmin) return; // FCM not configured — silently skip

  try {
    const result = await db.query(
      `SELECT fcm_token FROM employees WHERE id = $1 AND fcm_token IS NOT NULL`,
      [employeeId]
    );
    if (!result.rows.length) return; // No FCM token registered for this employee

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

    await firebaseAdmin.messaging().send(message);
  } catch (err) {
    // Log but never throw — push failure should never break the main request
    if (err.code === 'messaging/registration-token-not-registered') {
      // Token is stale — clear it
      try {
        await db.query(`UPDATE employees SET fcm_token = NULL WHERE id = $1`, [employeeId]);
      } catch (_) {}
    } else {
      console.warn(`[FCM] sendToEmployee(${employeeId}) failed:`, err.message);
    }
  }
}

/**
 * Send push to multiple employees at once.
 * Fires all sends in parallel (non-blocking on failure).
 *
 * @param {object}   db          - pg pool
 * @param {number[]} employeeIds - array of employee IDs
 * @param {string}   title
 * @param {string}   body
 * @param {object}   [data]
 */
async function sendToEmployees(db, employeeIds, title, body, data = {}) {
  if (!employeeIds || !employeeIds.length) return;
  await Promise.allSettled(
    employeeIds.map(id => sendToEmployee(db, id, title, body, data))
  );
}

module.exports = { sendToEmployee, sendToEmployees };
