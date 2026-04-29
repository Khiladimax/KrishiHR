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
