// src/controllers/securityController.js
// Device-lock + anti-tamper "Security Logs" — mobile reports violations here,
// admins manage device locks / blocks from the Security Logs page.
const db = require('../config/db');
const fcm = require('../services/fcmService');

const ADMIN_CONTACT = 'Akshay Rai (7651900038)';
const BLOCK_HOURS = 24;

// ── Mobile: report a security violation (mock GPS, dev options, mock time) ──────
// Blocks the account for 24h and notifies the reporting manager.
exports.reportViolation = async (req, res) => {
  try {
    const empId = req.user.id;
    const rawType = (req.body.type || req.body.reason || 'tamper').toString().slice(0, 64);
    const isMock = /mock|fake|gps|location/i.test(rawType);

    const upd = await db.query(
      `UPDATE employees
          SET blocked_until        = NOW() + INTERVAL '${BLOCK_HOURS} hours',
              security_violations   = COALESCE(security_violations,0) + 1,
              mock_gps_attempts     = COALESCE(mock_gps_attempts,0) + $2,
              last_violation_type   = $3,
              last_violation_at     = NOW()
        WHERE id = $1
        RETURNING first_name, last_name, employee_code, reporting_manager_id`,
      [empId, isMock ? 1 : 0, rawType]
    );
    if (!upd.rows.length) return res.status(404).json({ success: false, message: 'Employee not found' });

    const emp = upd.rows[0];
    const empName = `${emp.first_name || ''} ${emp.last_name || ''}`.trim();

    // Notify the reporting manager (in-app + push)
    if (emp.reporting_manager_id) {
      const title = '⚠️ Security violation';
      const body  = `${empName} (${emp.employee_code || '—'}) was blocked for ${BLOCK_HOURS}h — ${rawType}.`;
      try {
        await db.query(
          `INSERT INTO notifications(employee_id, type, title, message)
           VALUES($1,'security',$2,$3)`,
          [emp.reporting_manager_id, title, body]
        );
        fcm.sendToEmployee(db, emp.reporting_manager_id, title, body,
          { screen: 'security', channel: 'krishihr_alerts' }).catch(() => {});
      } catch (_) {}
    }

    res.json({
      success: true,
      code: 'ACCOUNT_BLOCKED',
      blocked_hours: BLOCK_HOURS,
      message: `Your account has been locked for ${BLOCK_HOURS} hours due to a security violation. Try again after that.\n\nContact Admin to unlock: ${ADMIN_CONTACT}`
    });
  } catch (err) {
    console.error('[reportViolation]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Admin: Security Logs listing ────────────────────────────────────────────────
exports.getSecurityLogs = async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const params = [];
    let where = `WHERE e.is_active = true AND LOWER(e.role) NOT IN ('super_admin')`;
    if (q) {
      params.push(`%${q}%`);
      where += ` AND (e.first_name ILIKE $1 OR e.last_name ILIKE $1 OR e.employee_code ILIKE $1
                      OR e.phone ILIKE $1 OR e.locked_device_id ILIKE $1)`;
    }
    const rows = (await db.query(
      `SELECT e.id, CONCAT(e.first_name,' ',e.last_name) AS name, e.role, e.phone,
              e.employee_code, e.locked_device_id, e.last_login_model, e.last_login_device,
              TO_CHAR(e.last_login_at,'DD/MM/YYYY HH24:MI:SS') AS last_login,
              COALESCE(e.security_violations,0)  AS violations,
              COALESCE(e.mock_gps_attempts,0)    AS mock_gps,
              COALESCE(e.other_device_logins,0)  AS other_device_logins,
              e.allow_multi_device,
              e.blocked_until,
              (e.blocked_until IS NOT NULL AND e.blocked_until > NOW()) AS is_blocked
         FROM employees e
         ${where}
         ORDER BY e.first_name`,
      params
    )).rows;

    const summary = {
      total_surveyors: rows.length,
      device_locked:   rows.filter(r => r.locked_device_id).length,
      blocked:         rows.filter(r => r.is_blocked).length,
      total_violations: rows.reduce((s, r) => s + Number(r.violations), 0),
      mock_gps:        rows.reduce((s, r) => s + Number(r.mock_gps), 0),
      multi_device:    rows.filter(r => r.allow_multi_device).length
    };
    res.json({ success: true, data: rows, summary });
  } catch (err) {
    console.error('[getSecurityLogs]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Admin: clear the locked device so the user can log in on a new phone ────────
exports.resetDevice = async (req, res) => {
  try {
    const id = req.params.id || req.body.employee_id;
    await db.query(`UPDATE employees SET locked_device_id=NULL, device_token=NULL WHERE id=$1`, [id]);
    res.json({ success: true, message: 'Device reset — user can now log in on a new device' });
  } catch (err) {
    console.error('[resetDevice]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Admin: block / unblock account ──────────────────────────────────────────────
exports.blockAccount = async (req, res) => {
  try {
    const id = req.params.id || req.body.employee_id;
    const hours = Number(req.body.hours) > 0 ? Number(req.body.hours) : BLOCK_HOURS;
    await db.query(`UPDATE employees SET blocked_until = NOW() + ($2 || ' hours')::interval WHERE id=$1`, [id, hours]);
    res.json({ success: true, message: `Account blocked for ${hours}h` });
  } catch (err) {
    console.error('[blockAccount]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.unblockAccount = async (req, res) => {
  try {
    const id = req.params.id || req.body.employee_id;
    await db.query(`UPDATE employees SET blocked_until=NULL WHERE id=$1`, [id]);
    res.json({ success: true, message: 'Account unblocked' });
  } catch (err) {
    console.error('[unblockAccount]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Admin: toggle multi-device exemption ────────────────────────────────────────
exports.setMultiDevice = async (req, res) => {
  try {
    const id = req.params.id || req.body.employee_id;
    const allow = req.body.allow === true || req.body.allow === 'true';
    await db.query(`UPDATE employees SET allow_multi_device=$2 WHERE id=$1`, [id, allow]);
    res.json({ success: true, message: allow ? 'Multi-device allowed' : 'Locked to one device' });
  } catch (err) {
    console.error('[setMultiDevice]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
