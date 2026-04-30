// compoffController.js — Comp Off Credit & Usage Management
const db = require('../config/db');

// ── Grant comp off credit to an employee (HR/Admin only) ─────────────────────
exports.grantCredit = async (req, res) => {
  try {
    const { employee_id, worked_date, worked_type, holiday_name, days_credited, remarks, expiry_date } = req.body;

    if (!employee_id || !worked_date || !worked_type)
      return res.status(400).json({ success: false, message: 'employee_id, worked_date, worked_type required' });

    if (!['holiday', 'weekend'].includes(worked_type))
      return res.status(400).json({ success: false, message: 'worked_type must be holiday or weekend' });

    const days = parseFloat(days_credited) || 1;
    if (days <= 0 || days > 2)
      return res.status(400).json({ success: false, message: 'days_credited must be between 0.5 and 2' });

    // Check if already credited for this date
    const exists = await db.query(
      `SELECT id FROM compoff_credits WHERE employee_id=$1 AND worked_date=$2`,
      [employee_id, worked_date]
    );
    if (exists.rows.length)
      return res.status(409).json({ success: false, message: 'Comp off already credited for this employee on this date' });

    // Insert credit
    const result = await db.query(
      `INSERT INTO compoff_credits
         (employee_id, worked_date, worked_type, holiday_name, days_credited, granted_by, remarks, expiry_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [employee_id, worked_date, worked_type, holiday_name || null, days, req.user.id, remarks || null, expiry_date || null]
    );

    // Also add to leave_balances so existing leave apply flow works
    const compoffType = await db.query(`SELECT id FROM leave_types WHERE code='COMPOFF'`);
    if (compoffType.rows.length) {
      const ltId = compoffType.rows[0].id;
      const year = new Date(worked_date).getFullYear();
      await db.query(
        `INSERT INTO leave_balances (employee_id, leave_type_id, year, allocated)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (employee_id, leave_type_id, year)
         DO UPDATE SET allocated = leave_balances.allocated + $4`,
        [employee_id, ltId, year, days]
      );
    }

    res.json({ success: true, message: `Comp off of ${days} day(s) credited successfully`, data: result.rows[0] });
  } catch (err) {
    console.error('grantCredit error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── List comp off credits (HR sees all, employee sees own) ────────────────────
exports.listCredits = async (req, res) => {
  try {
    const isHR = ['hr', 'admin', 'super_admin'].includes(req.user.role);
    const empFilter = isHR && req.query.employee_id ? parseInt(req.query.employee_id) : null;
    const targetEmpId = (!isHR) ? req.user.id : (empFilter || null);

    const whereClause = targetEmpId
      ? `WHERE cc.employee_id = ${targetEmpId}`
      : '';

    const rows = await db.query(
      `SELECT cc.*,
              e.first_name, e.last_name, e.employee_code,
              g.first_name AS granted_by_name
       FROM compoff_credits cc
       JOIN employees e ON cc.employee_id = e.id
       LEFT JOIN employees g ON cc.granted_by = g.id
       ${whereClause}
       ORDER BY cc.worked_date DESC
       LIMIT 200`
    );

    res.json({ success: true, data: rows.rows });
  } catch (err) {
    console.error('listCredits error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Get comp off balance for an employee ─────────────────────────────────────
exports.getBalance = async (req, res) => {
  try {
    const empId = req.query.employee_id ? parseInt(req.query.employee_id) : req.user.id;
    const year  = parseInt(req.query.year) || new Date().getFullYear();

    const balance = await db.query(
      `SELECT
         COALESCE(SUM(CASE WHEN status='available' THEN days_credited ELSE 0 END), 0) AS available,
         COALESCE(SUM(days_credited), 0) AS total_credited,
         COALESCE(SUM(CASE WHEN status='used' THEN days_credited ELSE 0 END), 0) AS used
       FROM compoff_credits
       WHERE employee_id=$1 AND EXTRACT(YEAR FROM worked_date)=$2`,
      [empId, year]
    );

    const credits = await db.query(
      `SELECT cc.*, g.first_name AS granted_by_name
       FROM compoff_credits cc
       LEFT JOIN employees g ON cc.granted_by = g.id
       WHERE cc.employee_id=$1 AND EXTRACT(YEAR FROM cc.worked_date)=$2
       ORDER BY cc.worked_date DESC`,
      [empId, year]
    );

    res.json({ success: true, data: { ...balance.rows[0], credits: credits.rows } });
  } catch (err) {
    console.error('getBalance error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Revoke a comp off credit (HR only, only if status=available) ─────────────
exports.revokeCredit = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { id } = req.params;

    const credit = await client.query(
      `SELECT * FROM compoff_credits WHERE id=$1`, [id]
    );
    if (!credit.rows.length)
      return res.status(404).json({ success: false, message: 'Credit not found' });

    if (credit.rows[0].status !== 'available')
      return res.status(400).json({ success: false, message: 'Cannot revoke a used or expired credit' });

    const { employee_id, days_credited, worked_date } = credit.rows[0];

    // Remove from compoff_credits
    await client.query(`DELETE FROM compoff_credits WHERE id=$1`, [id]);

    // Reduce from leave_balances
    const compoffType = await client.query(`SELECT id FROM leave_types WHERE code='COMPOFF'`);
    if (compoffType.rows.length) {
      const ltId = compoffType.rows[0].id;
      const year = new Date(worked_date).getFullYear();
      await client.query(
        `UPDATE leave_balances
         SET allocated = GREATEST(0, allocated - $1)
         WHERE employee_id=$2 AND leave_type_id=$3 AND year=$4`,
        [days_credited, employee_id, ltId, year]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, message: 'Comp off credit revoked' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('revokeCredit error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Bulk grant comp offs (HR uploads list or selects all onsite on a date) ────
exports.bulkGrant = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { employee_ids, worked_date, worked_type, holiday_name, days_credited, remarks, expiry_date } = req.body;

    if (!employee_ids?.length || !worked_date || !worked_type)
      return res.status(400).json({ success: false, message: 'employee_ids[], worked_date, worked_type required' });

    const days   = parseFloat(days_credited) || 1;
    const compoffType = await client.query(`SELECT id FROM leave_types WHERE code='COMPOFF'`);
    const ltId   = compoffType.rows[0]?.id;
    const year   = new Date(worked_date).getFullYear();

    let credited = 0, skipped = 0;
    for (const empId of employee_ids) {
      const exists = await client.query(
        `SELECT id FROM compoff_credits WHERE employee_id=$1 AND worked_date=$2`, [empId, worked_date]
      );
      if (exists.rows.length) { skipped++; continue; }

      await client.query(
        `INSERT INTO compoff_credits (employee_id, worked_date, worked_type, holiday_name, days_credited, granted_by, remarks, expiry_date)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [empId, worked_date, worked_type, holiday_name || null, days, req.user.id, remarks || null, expiry_date || null]
      );

      if (ltId) {
        await client.query(
          `INSERT INTO leave_balances (employee_id, leave_type_id, year, allocated)
           VALUES ($1,$2,$3,$4)
           ON CONFLICT (employee_id, leave_type_id, year)
           DO UPDATE SET allocated = leave_balances.allocated + $4`,
          [empId, ltId, year, days]
        );
      }
      credited++;
    }

    await client.query('COMMIT');
    res.json({ success: true, message: `Credited ${credited} employee(s). Skipped ${skipped} (already credited).` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('bulkGrant error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Helper: is this Saturday the 2nd or 4th of the month? ────────────────────
function isOffSaturday(date) {
  const d = new Date(date);
  if (d.getDay() !== 6) return false;
  const weekNumber = Math.ceil(d.getDate() / 7);
  return weekNumber === 2 || weekNumber === 4;
}

// ── Helper: check if a date is a public holiday ───────────────────────────────
async function isPublicHoliday(date) {
  const result = await db.query(
    `SELECT id, name FROM holidays WHERE date = $1 LIMIT 1`,
    [date]
  );
  return result.rows.length ? result.rows[0] : null;
}

// ── Auto-grant comp off for a given date (called by cron) ────────────────────
// Logic:
//   sunday          → BOTH policies earn COMPOFF
//   public holiday  → BOTH policies earn COMPOFF
//   2nd/4th Saturday (off saturday) → only '2nd_4th_off' policy earns COMPOFF
//   1st/3rd/5th Saturday            → NO COMPOFF (normal working day for both)
//   weekday (non-holiday)           → NO COMPOFF
exports.autoGrantForDate = async (dateStr) => {
  const date = new Date(dateStr);
  const day  = date.getDay(); // 0=Sun, 6=Sat

  const isSunday    = day === 0;
  const isSaturday  = day === 6;
  const holiday     = await isPublicHoliday(dateStr);
  const isHoliday   = !!holiday;

  // Nothing to grant on a regular weekday
  if (!isSunday && !isSaturday && !isHoliday) {
    console.log(`[COMPOFF CRON] ${dateStr} is a regular weekday — no grants needed`);
    return { granted: 0, skipped: 0 };
  }

  let workedType   = isSunday ? 'weekend' : (isHoliday ? 'holiday' : 'weekend');
  let holidayName  = isHoliday ? holiday.name : null;
  let saturdayPolicyFilter = null; // null means all active employees eligible

  if (isSaturday && !isHoliday) {
    if (!isOffSaturday(dateStr)) {
      console.log(`[COMPOFF CRON] ${dateStr} is a working Saturday (1st/3rd/5th) — no grants`);
      return { granted: 0, skipped: 0 };
    }
    // Off Saturday (2nd/4th) — only '2nd_4th_off' employees earn COMPOFF
    saturdayPolicyFilter = '2nd_4th_off';
  }

  // If it's a holiday that falls on a Saturday, only '2nd_4th_off' off-Sat employees
  // get it as a holiday bonus — but actually both policies get holiday COMPOFF regardless
  // So saturdayPolicyFilter stays null for holidays (both policies eligible)

  // Get all active employees who punched in on this date, including hours worked
  let query = `
    SELECT a.employee_id, e.saturday_policy,
           COALESCE(a.working_hours, 0) AS working_hours
    FROM attendance a
    JOIN employees e ON a.employee_id = e.id
    WHERE a.date = $1
      AND a.punch_in IS NOT NULL
      AND e.is_active = true
  `;
  const params = [dateStr];

  if (saturdayPolicyFilter) {
    query += ` AND e.saturday_policy = $2`;
    params.push(saturdayPolicyFilter);
  }

  const attendees = await db.query(query, params);

  if (!attendees.rows.length) {
    console.log(`[COMPOFF CRON] ${dateStr} — no eligible attendees found`);
    return { granted: 0, skipped: 0 };
  }

  // Get COMPOFF leave_type id
  const compoffType = await db.query(`SELECT id FROM leave_types WHERE code='COMPOFF'`);
  const ltId = compoffType.rows[0]?.id;
  const year = date.getFullYear();
  const expiryDate = new Date(date);
  expiryDate.setDate(expiryDate.getDate() + 30); // 30-day expiry

  let granted = 0, skipped = 0, insufficient = 0;

  for (const row of attendees.rows) {
    const empId       = row.employee_id;
    const hoursWorked = parseFloat(row.working_hours) || 0;

    // ── Determine days to credit based on hours worked ────────────────────────
    // < 4 hours  → no compoff
    // 4–7.99 hrs → 0.5 day (half day)
    // 8+ hours   → 1.0 day (full day)
    let daysToCredit = 0;
    let hoursLabel   = '';
    if (hoursWorked >= 8) {
      daysToCredit = 1.00;
      hoursLabel   = 'full day';
    } else if (hoursWorked >= 4) {
      daysToCredit = 0.50;
      hoursLabel   = 'half day';
    } else {
      console.log(`[COMPOFF CRON] emp ${empId} worked only ${hoursWorked}h on ${dateStr} — no compoff`);
      insufficient++;
      continue;
    }

    // Skip if already credited for this date (UNIQUE constraint guard)
    const exists = await db.query(
      `SELECT id FROM compoff_credits WHERE employee_id=$1 AND worked_date=$2`,
      [empId, dateStr]
    );
    if (exists.rows.length) { skipped++; continue; }

    // Insert comp off credit
    await db.query(
      `INSERT INTO compoff_credits
         (employee_id, worked_date, worked_type, holiday_name, days_credited, granted_by, expiry_date, remarks, status)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7, 'available')`,
      [
        empId, dateStr, workedType, holidayName, daysToCredit,
        expiryDate.toISOString().split('T')[0],
        `Auto-granted by system (${hoursWorked.toFixed(2)}h worked = ${hoursLabel})`
      ]
    );

    // Update leave_balances so the existing leave apply flow works
    if (ltId) {
      await db.query(
        `INSERT INTO leave_balances (employee_id, leave_type_id, year, allocated)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (employee_id, leave_type_id, year)
         DO UPDATE SET allocated = leave_balances.allocated + $4`,
        [empId, ltId, year, daysToCredit]
      );
    }

    granted++;
  }

  console.log(`[COMPOFF CRON] ${dateStr} (${workedType}${holidayName ? ': ' + holidayName : ''}) — granted: ${granted}, skipped: ${skipped}, insufficient hours: ${insufficient}`);
  return { granted, skipped };
};

// ── Expire comp off credits past their expiry_date ────────────────────────────
exports.expireOldCredits = async () => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Find all available credits past expiry
    const expired = await db.query(
      `UPDATE compoff_credits
       SET status = 'expired'
       WHERE status = 'available'
         AND expiry_date IS NOT NULL
         AND expiry_date < $1
       RETURNING employee_id, days_credited, worked_date`,
      [today]
    );

    if (!expired.rows.length) {
      console.log('[COMPOFF CRON] No credits to expire today');
      return;
    }

    // Reduce leave_balances for expired credits
    const compoffType = await db.query(`SELECT id FROM leave_types WHERE code='COMPOFF'`);
    const ltId = compoffType.rows[0]?.id;

    if (ltId) {
      for (const row of expired.rows) {
        const year = new Date(row.worked_date).getFullYear();
        await db.query(
          `UPDATE leave_balances
           SET allocated = GREATEST(0, allocated - $1)
           WHERE employee_id=$2 AND leave_type_id=$3 AND year=$4`,
          [row.days_credited, row.employee_id, ltId, year]
        );
      }
    }

    console.log(`[COMPOFF CRON] Expired ${expired.rows.length} credit(s)`);
  } catch (err) {
    console.error('[COMPOFF CRON] expireOldCredits error:', err.message);
  }
};
