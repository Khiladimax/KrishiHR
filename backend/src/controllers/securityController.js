// src/controllers/securityController.js
// Device-lock + anti-tamper "Security Logs" — mobile reports violations here,
// admins manage device locks / blocks from the Security Logs page.
const db = require('../config/db');
const fcm = require('../services/fcmService');

const ADMIN_CONTACT = 'Akshay Rai (7651900038)';
const BLOCK_HOURS = 24;

// ── Mobile: report a security violation (mock GPS, dev options, mock time) ──────
// Blocks the account for 24h and notifies the reporting manager.
const PRIV_ROLES = ['super_admin', 'admin', 'client_admin', 'accounts', 'hr'];

exports.reportViolation = async (req, res) => {
  try {
    const empId = req.user.id;
    // Office/admin roles are exempt — never block them.
    if (PRIV_ROLES.includes((req.user.role || '').toLowerCase())) {
      return res.json({ success: true, exempt: true, message: 'Exempt role — not blocked' });
    }
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
    const q    = (req.query.q || '').trim();
    const role = (req.user.role || '').toLowerCase();
    const type = (req.query.type || 'kc').toLowerCase();   // 'kc' | 'client'
    const isClientAdmin = role === 'client_admin';
    const params = [];
    let where = `WHERE e.is_active = true AND LOWER(e.role) <> 'super_admin'`;

    if (isClientAdmin) {
      // Client admin sees ONLY their own client's manpower.
      params.push(req.user.client_id || 0);
      where += ` AND e.client_id = $${params.length}`;
    } else if (type === 'client') {
      where += ` AND e.client_id IS NOT NULL`;   // Client Employee tab
    } else {
      where += ` AND e.client_id IS NULL`;        // KC Employee tab
    }

    if (q) {
      params.push(`%${q}%`);
      const p = params.length;
      where += ` AND (e.first_name ILIKE $${p} OR e.last_name ILIKE $${p} OR e.employee_code ILIKE $${p}
                      OR e.phone ILIKE $${p} OR e.locked_device_id ILIKE $${p})`;
    }
    const rows = (await db.query(
      `SELECT e.id, CONCAT(e.first_name,' ',e.last_name) AS name, e.role, e.phone,
              e.employee_code, e.locked_device_id, e.last_login_model, e.last_login_device,
              e.app_version,
              TO_CHAR(e.last_login_at,'DD/MM/YYYY HH24:MI:SS') AS last_login,
              COALESCE(e.security_violations,0)  AS violations,
              COALESCE(e.mock_gps_attempts,0)    AS mock_gps,
              COALESCE(e.other_device_logins,0)  AS other_device_logins,
              e.allow_multi_device,
              e.blocked_until,
              c.name AS client_name,
              (e.blocked_until IS NOT NULL AND e.blocked_until > NOW()) AS is_blocked
         FROM employees e
         LEFT JOIN clients c ON c.id = e.client_id
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
    res.json({ success: true, data: rows, summary, is_client_admin: isClientAdmin });
  } catch (err) {
    console.error('[getSecurityLogs]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Shared scope/query used by both the JSON list and the Excel export.
async function fetchSecurityRows(req) {
  const q    = (req.query.q || '').trim();
  const role = (req.user.role || '').toLowerCase();
  const type = (req.query.type || 'kc').toLowerCase();
  const params = [];
  let where = `WHERE e.is_active = true AND LOWER(e.role) <> 'super_admin'`;
  if (role === 'client_admin') { params.push(req.user.client_id || 0); where += ` AND e.client_id = $${params.length}`; }
  else if (type === 'client')  { where += ` AND e.client_id IS NOT NULL`; }
  else                          { where += ` AND e.client_id IS NULL`; }
  if (q) {
    params.push(`%${q}%`); const p = params.length;
    where += ` AND (e.first_name ILIKE $${p} OR e.last_name ILIKE $${p} OR e.employee_code ILIKE $${p}
                    OR e.phone ILIKE $${p} OR e.locked_device_id ILIKE $${p})`;
  }
  return (await db.query(
    `SELECT e.id, CONCAT(e.first_name,' ',e.last_name) AS name, e.role, e.phone,
            e.employee_code, e.locked_device_id, e.last_login_model, e.last_login_device, e.app_version,
            TO_CHAR(e.last_login_at,'DD/MM/YYYY HH24:MI:SS') AS last_login,
            COALESCE(e.security_violations,0) AS violations, COALESCE(e.mock_gps_attempts,0) AS mock_gps,
            COALESCE(e.other_device_logins,0) AS other_device_logins, e.allow_multi_device, e.blocked_until,
            c.name AS client_name,
            (e.blocked_until IS NOT NULL AND e.blocked_until > NOW()) AS is_blocked
       FROM employees e
       LEFT JOIN clients c ON c.id = e.client_id
       ${where} ORDER BY e.first_name`, params)).rows;
}

const verNum = (v) => { if (!v) return 0; const m = String(v).match(/(\d+)(?:\.(\d+))?/); return m ? parseFloat(m[1] + '.' + (m[2] || 0)) : 0; };

// ── Admin: colourful Excel export ───────────────────────────────────────────────
exports.exportExcel = async (req, res) => {
  try {
    const rows = await fetchSecurityRows(req);
    const latest = rows.reduce((mx, r) => Math.max(mx, verNum(r.app_version)), 0);
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Security Logs');

    const cols = [
      ['#', 5], ['Surveyor', 24], ['Role', 12], ['Client', 22], ['Phone', 14], ['Emp ID', 10],
      ['Locked Device ID', 26], ['Phone Model', 18], ['App Version', 18], ['Last Login (IST)', 20],
      ['Violations', 11], ['Mock GPS', 10], ['Other Logins', 12], ['Status', 10], ['Multi-Device', 13]
    ];
    ws.columns = cols.map(([h, w]) => ({ header: h, width: w }));

    const border = { top:{style:'thin',color:{argb:'FFCBD5E1'}}, left:{style:'thin',color:{argb:'FFCBD5E1'}}, bottom:{style:'thin',color:{argb:'FFCBD5E1'}}, right:{style:'thin',color:{argb:'FFCBD5E1'}} };
    const hdr = ws.getRow(1);
    hdr.height = 22;
    hdr.eachCell(c => {
      c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FF1E293B'} };
      c.font = { color:{argb:'FFFFFFFF'}, bold:true, size:11 };
      c.alignment = { vertical:'middle', horizontal:'left' };
      c.border = border;
    });

    rows.forEach((r, i) => {
      const isOld = r.app_version && verNum(r.app_version) < latest;
      const row = ws.addRow([
        i + 1, r.name || '', r.role || '', r.client_name || '', r.phone || '', r.employee_code || '',
        r.locked_device_id || 'Not set', r.last_login_model || r.last_login_device || '',
        (r.app_version || '') + (isOld ? '  · old' : ''), r.last_login || '',
        Number(r.violations), Number(r.mock_gps), Number(r.other_device_logins),
        r.is_blocked ? 'Blocked' : 'Active', r.allow_multi_device ? 'Allowed' : 'Locked'
      ]);
      row.eachCell(c => { c.border = border; c.alignment = { vertical:'middle' }; });
      // zebra
      if (i % 2 === 1) row.eachCell(c => { if (!c.fill || c.fill.fgColor?.argb === undefined) c.fill = { type:'pattern', pattern:'solid', fgColor:{argb:'FFF1F5F9'} }; });
      const paint = (col, argb, fontArgb) => { const c = row.getCell(col); c.fill = { type:'pattern', pattern:'solid', fgColor:{argb} }; c.font = { bold:true, color:{argb: fontArgb || 'FF1A1A1A'} }; };
      if (isOld) paint(9, 'FFFCE7C3', 'FF92400E');                                   // App Version
      if (Number(r.violations) > 0) paint(11, 'FFFDE1E1', 'FF991B1B');                // Violations
      if (Number(r.mock_gps)   > 0) paint(12, 'FFFDE1E1', 'FF991B1B');                // Mock GPS
      paint(14, r.is_blocked ? 'FFFDE1E1' : 'FFDCFCE7', r.is_blocked ? 'FF991B1B' : 'FF166534'); // Status
      paint(15, r.allow_multi_device ? 'FFDCFCE7' : 'FFF1F5F9', r.allow_multi_device ? 'FF166534' : 'FF6B7280'); // Multi-Device
    });

    ws.autoFilter = 'A1:O1';
    ws.views = [{ state:'frozen', ySplit:1 }];
    const buf = await wb.xlsx.writeBuffer();
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="security-logs-${(req.query.type||'kc')}-${stamp}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.end(Buffer.from(buf));
  } catch (err) {
    console.error('[exportExcel]', err.message);
    res.status(500).json({ success: false, message: 'Export failed' });
  }
};

// ── Admin: full reset — unblock, clear device lock, zero the violation counts ───
exports.resetDevice = async (req, res) => {
  try {
    const id = req.params.id || req.body.employee_id;
    await db.query(
      `UPDATE employees
          SET locked_device_id=NULL, device_token=NULL, blocked_until=NULL,
              security_violations=0, mock_gps_attempts=0, other_device_logins=0,
              last_violation_type=NULL, last_violation_at=NULL
        WHERE id=$1`,
      [id]
    );
    res.json({ success: true, message: 'Reset done — account unblocked, device cleared, counters reset' });
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
