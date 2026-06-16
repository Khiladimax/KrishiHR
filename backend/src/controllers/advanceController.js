const fcm = require('../services/fcmService');
// src/controllers/advanceController.js — COMPLETE with approval chain
// Advance chain: Employee → Manager → COO (KC718) → MD (KC01) → HR notified
// For direct-reports-of-COO: COO → MD → HR notified

const db       = require('../config/db');
const emailSvc = require('../config/emailService');

const COO_CODE      = 'KC718';  // Gurudatt
const MD_CODE       = 'KC01';   // Sunil
const CBO_CODE      = 'KC03';   // CBO — same approval power as MD
const ACCOUNTS_CODE = 'KC7708'; // Anshu

// ── Dynamic advance chain — no hardcoded employee codes ──────────────────────
// Chain is determined by employee's role:
//   admin role      → skip_manager = true → goes directly to COO → MD → Accounts
//   hr role         → skip_manager = true → goes directly to COO → MD → Accounts
//   accounts role   → COO → MD (no self-loop)
//   super_admin/MD  → Accounts only
//   CBO (KC03)      → Accounts only (same as MD)
//   COO             → MD → Accounts
//   everyone else   → Reporting Manager → COO → MD → Accounts
// HR can update employee role via employees.html to control the chain

async function getAdvanceChain(employeeId) {
  const emp = await db.query(
    `SELECT e.employee_code, e.role, e.reporting_manager_id, e.client_id,
            m.employee_code AS manager_code
     FROM employees e
     LEFT JOIN employees m ON e.reporting_manager_id = m.id
     WHERE e.id=$1`, [employeeId]
  );
  if (!emp.rows.length) return [COO_CODE, MD_CODE, ACCOUNTS_CODE];
  const { employee_code, role, manager_code, client_id } = emp.rows[0];

  // Client deployed employee → client_admin is the ONLY approver
  if (client_id) {
    const clientAdmin = await db.query(
      `SELECT employee_code FROM employees
       WHERE client_id=$1 AND role='client_admin' AND is_active=true LIMIT 1`,
      [client_id]
    );
    if (clientAdmin.rows.length) return [clientAdmin.rows[0].employee_code];
    return [COO_CODE]; // fallback if no client_admin found
  }

  // COO applies → MD → Accounts
  if (employee_code === COO_CODE) return [MD_CODE, ACCOUNTS_CODE];

  // MD / super_admin / CBO applies → Accounts only
  if (employee_code === MD_CODE || employee_code === CBO_CODE || role === 'super_admin') return [ACCOUNTS_CODE];

  // Accounts applies → COO → MD (no self-loop)
  if (employee_code === ACCOUNTS_CODE) return [COO_CODE, MD_CODE];

  // admin / hr roles → skip reporting manager, go directly to COO → MD → Accounts
  if (['manager', 'tl', 'admin', 'hr'].includes(role)) return [COO_CODE, MD_CODE, ACCOUNTS_CODE];

  // Regular employee → Reporting Manager → COO → MD → Accounts (4 steps)
  const hasMgr = manager_code &&
    manager_code !== COO_CODE &&
    manager_code !== MD_CODE &&
    manager_code !== ACCOUNTS_CODE;
  if (hasMgr) return [manager_code, COO_CODE, MD_CODE, ACCOUNTS_CODE];
  return [COO_CODE, MD_CODE, ACCOUNTS_CODE];
}

// ── Apply ─────────────────────────────────────────────────────────────────────
exports.apply = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const empId = req.user.id;
    const { amount, reason, repayment_months, project_id } = req.body;

    if (!amount || amount <= 0)
      return res.status(400).json({ success: false, message: 'Valid amount required' });

    // Block advance if employee has submitted/active separation
    const sepCheck = await client.query(
      `SELECT id FROM separations WHERE employee_id=$1 AND status NOT IN ('rejected','withdrawn')`,
      [empId]
    );
    if (sepCheck.rows.length)
      return res.status(403).json({ success: false, message: 'You have an active resignation. Advance requests are not allowed.' });

    // Check no PENDING advance
    const existing = await client.query(
      `SELECT id FROM advance_salary WHERE employee_id=$1 AND status = 'pending'`,
      [empId]
    );
    if (existing.rows.length)
      return res.status(400).json({ success: false, message: 'You already have a pending advance request awaiting approval' });

    const chain = await getAdvanceChain(empId);
    const emi   = repayment_months ? Math.ceil(amount / repayment_months) : amount;

    const result = await client.query(
      `INSERT INTO advance_salary
         (employee_id, amount, reason, monthly_emi, total_installments,
          approval_chain, current_approver_code, current_level, status, purpose, project_id)
       VALUES($1,$2,$3,$4,$5,$6,$7,1,'pending',$8,$9)
       RETURNING id`,
      [empId, amount, reason || null, emi, repayment_months || 1,
       JSON.stringify(chain), chain[0], String(amount), project_id ? parseInt(project_id) : null]
    );

    await client.query('COMMIT');
    const advId = result.rows[0].id;
    emailSvc.notifyAdvanceApplied(advId).catch(console.error);

    // ── In-app notification to first approver in chain ────────────────────
    if (chain.length > 0) {
      try {
        const empInfo = await db.query(
          `SELECT CONCAT(first_name,' ',last_name) AS full_name FROM employees WHERE id=$1`, [empId]
        );
        const fullName = empInfo.rows[0]?.full_name || 'An employee';
        const notifMsg = `${fullName} requested advance salary of ₹${amount}. Reason: ${reason || 'N/A'}`;
        // Notify only first approver (current_approver_code)
        const firstApproverCode = chain[0];
        const approverRow = await db.query(
          `SELECT id FROM employees WHERE employee_code=$1 AND is_active=true`, [firstApproverCode]
        );
        for (const r of approverRow.rows) {
          await db.query(
            `INSERT INTO notifications(employee_id, title, message, type) VALUES($1,'💰 Advance Request',$2,'advance')`,
            [r.id, notifMsg]
          );
          fcm.sendToEmployee(db, r.id, '💰 Advance Request', notifMsg, { screen: 'approvals', tab: '3' }).catch(() => {});
        }
      } catch (notifErr) {
        console.error('Advance notification error:', notifErr.message);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Advance request submitted',
      data: { id: advId, approval_chain: chain }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally { client.release(); }
};

// ── Approve / Reject ──────────────────────────────────────────────────────────
exports.action = async (req, res) => {
  const client = await db.getClient();
  try {
    const { id } = req.params;
    const { action, remarks, payment_date, project_id } = req.body;

    // ── DDL + project_id save OUTSIDE the transaction ──────────────────────
    // ALTER TABLE must never run inside BEGIN…COMMIT — a DDL failure aborts
    // the whole transaction even with .catch(), breaking all subsequent queries.
    // Run these on a plain db query (auto-committed) before we open our transaction.
    await db.query(`ALTER TABLE advance_salary ADD COLUMN IF NOT EXISTS project_id INT`).catch(() => {});
    await db.query(`ALTER TABLE advance_salary ADD COLUMN IF NOT EXISTS current_level SMALLINT DEFAULT 1`).catch(() => {});
    await db.query(`ALTER TABLE advance_salary DROP CONSTRAINT IF EXISTS advance_salary_status_check`).catch(() => {});
    await db.query(`ALTER TABLE advance_salary ADD CONSTRAINT advance_salary_status_check CHECK (status IN ('pending','approved','rejected','recovered','disbursed','cleared'))`).catch(() => {});
    // Persist project_id chosen by the approver before the transaction locks the row
    if (project_id) {
      await db.query(`UPDATE advance_salary SET project_id=$1 WHERE id=$2`, [parseInt(project_id), id]).catch(() => {});
    }

    await client.query('BEGIN');
    const actorCode = req.user.employee_code;
    const actorRole = req.user.role;

    if (!['approve','reject'].includes(action))
      return res.status(400).json({ success: false, message: 'action must be approve or reject' });

    const adv = await client.query(
      `SELECT * FROM advance_salary WHERE id=$1 FOR UPDATE`, [id]
    );
    if (!adv.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const advance = adv.rows[0];

    if (advance.status !== 'pending')
      return res.status(400).json({ success: false, message: `Advance is already ${advance.status}` });

    const rawChain = advance.approval_chain || [];
    let chain;
    if (Array.isArray(rawChain)) {
      chain = rawChain;
    } else if (typeof rawChain === 'string') {
      try { chain = JSON.parse(rawChain); } catch (_) { chain = rawChain.split(',').map(s => s.trim()).filter(Boolean); }
    } else { chain = []; }

    const currentCode = advance.current_approver_code;
    const isSuperAdmin = actorRole === 'super_admin' || actorCode === CBO_CODE;
    const isClientAdmin = actorRole === 'client_admin';
    const isCurrentApprover = actorCode === currentCode;

    // Block self-approval
    if (advance.employee_id === req.user.id)
      return res.status(403).json({ success: false, message: 'You cannot approve your own advance request' });

    if (!isSuperAdmin && !isClientAdmin && !isCurrentApprover)
      return res.status(403).json({ success: false, message: 'You are not the current approver' });

    // Log this approval step
    const currentLevel = chain.indexOf(currentCode) + 1;
    await client.query(
      `INSERT INTO advance_approvals(advance_id, level, level_label, approver_id, action, remarks)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [id, currentLevel, currentCode, req.user.id, action, remarks || null]
    );

    // Manager can override the approved amount (reduce if employee asked too much)
    let amountWasOverridden = false;
    const originalAmount = parseFloat(advance.amount);
    if (req.body.approved_amount) {
      const overrideAmt = parseFloat(req.body.approved_amount);
      if (!isNaN(overrideAmt) && overrideAmt > 0 && overrideAmt < originalAmount) {
        const newEmi = advance.total_installments
          ? Math.ceil(overrideAmt / parseInt(advance.total_installments))
          : overrideAmt;
        await client.query(
          `UPDATE advance_salary SET amount=$1, monthly_emi=$2, balance_remaining=$3, updated_at=NOW() WHERE id=$4`,
          [overrideAmt, newEmi, overrideAmt, id]
        );
        amountWasOverridden = true;
        // Notify employee immediately that their amount was revised
        const approverName = (req.user.first_name + ' ' + req.user.last_name).trim();
        const lvlLabel = currentLevel === 1 ? 'Manager' : currentLevel === 2 ? 'COO' : currentLevel === 3 ? 'MD' : 'Approver';
        try {
          const reviseMsg = `Your advance request of Rs.${originalAmount.toLocaleString('en-IN')} was revised to Rs.${overrideAmt.toLocaleString('en-IN')} by ${approverName} (${lvlLabel}).${remarks ? ' Remarks: ' + remarks : ''}`;
          await client.query(
            `INSERT INTO notifications(employee_id, title, message, type) VALUES($1,'⚠️ Advance Amount Revised',$2,'advance')`,
            [advance.employee_id, reviseMsg]
          );
          fcm.sendToEmployee(db, advance.employee_id, '⚠️ Advance Amount Revised', reviseMsg, { screen: 'more', channel: 'krishihr_alerts' }).catch(() => {});
        } catch (_) {}
      }
    }

    if (action === 'reject') {
      await client.query(
        `UPDATE advance_salary SET status='rejected', updated_at=NOW() WHERE id=$1`, [id]
      );
      await client.query('COMMIT');
      emailSvc.notifyAdvanceRejected(id, remarks).catch(console.error);
      // Notify employee
      try {
        const rejMsg = remarks ? `Your advance request was rejected. Remarks: ${remarks}` : 'Your advance salary request has been rejected.';
        await db.query(
          `INSERT INTO notifications(employee_id, title, message, type) VALUES($1,'❌ Advance Rejected',$2,'advance')`,
          [advance.employee_id, rejMsg]
        );
        fcm.sendToEmployee(db, advance.employee_id, '❌ Advance Rejected', rejMsg, { screen: 'more', channel: 'krishihr_alerts' }).catch(() => {});
      } catch (_) {}
      return res.json({ success: true, message: 'Advance rejected' });
    }

    // Approve — use current_level as index (reliable vs indexOf which can fail on whitespace)
    const currentIdx = parseInt(advance.current_level) - 1;
    const nextCode   = chain[currentIdx + 1] || null;
    console.log(`[advance] chain=${JSON.stringify(chain)} level=${advance.current_level} idx=${currentIdx} next=${nextCode}`);

    if (nextCode) {
      await client.query(
        `UPDATE advance_salary SET current_approver_code=$1, current_level=$2, updated_at=NOW() WHERE id=$3`,
        [nextCode, currentIdx + 2, id]
      );
      await client.query('COMMIT');

      if (nextCode === COO_CODE) {
        emailSvc.notifyAdvanceApprovedByManager(id).catch(console.error);
      } else if (nextCode === MD_CODE) {
        emailSvc.notifyAdvanceApprovedByCOO(id).catch(console.error);
      }

      // In-app notification to next approver
      try {
        const empName = await db.query(
          `SELECT CONCAT(first_name,' ',last_name) AS full_name, amount FROM employees e
           JOIN advance_salary a ON a.employee_id=e.id WHERE a.id=$1`, [id]
        );
        const info = empName.rows[0];
        if (info) {
          const nextApproverRow = await db.query(
            `SELECT id FROM employees WHERE employee_code=$1 AND is_active=true`, [nextCode]
          );
          for (const r of nextApproverRow.rows) {
            const fwdMsg = `${info.full_name}'s advance request of ₹${advance.amount} is awaiting your approval.`;
            await db.query(
              `INSERT INTO notifications(employee_id, title, message, type) VALUES($1,'💰 Advance Request',$2,'advance')`,
              [r.id, fwdMsg]
            );
            fcm.sendToEmployee(db, r.id, '💰 Advance Request', fwdMsg, { screen: 'approvals', tab: '3' }).catch(() => {});
          }
        }
      } catch (_) {}

      return res.json({ success: true, message: 'Approved. Forwarded to next approver.' });
    }

    // Final approval
    // Ensure the project_id column and disbursed status exist before we touch the row
    await client.query(`ALTER TABLE advance_salary ADD COLUMN IF NOT EXISTS project_id INT`).catch(() => {});
    await client.query(`ALTER TABLE advance_salary DROP CONSTRAINT IF EXISTS advance_salary_status_check`).catch(() => {});
    await client.query(`ALTER TABLE advance_salary ADD CONSTRAINT advance_salary_status_check CHECK (status IN ('pending','approved','rejected','recovered','disbursed','cleared'))`).catch(() => {});

    const emi = Math.ceil(parseFloat(advance.amount) / (parseInt(advance.total_installments) || 1));
    const now = new Date();
    await client.query(
      `UPDATE advance_salary
       SET status='approved', approved_at=NOW(), current_approver_code=NULL,
           monthly_emi=$1, balance_remaining=$2,
           emi_start_month=$3, emi_start_year=$4,
           updated_at=NOW()
       WHERE id=$5`,
      [emi, advance.amount, now.getMonth() + 2 > 12 ? 1 : now.getMonth() + 2,
       now.getMonth() + 2 > 12 ? now.getFullYear() + 1 : now.getFullYear(), id]
    );

    await client.query('COMMIT');
    emailSvc.notifyAdvanceFullyApproved(id).catch(console.error);
    // Notify employee their advance is fully approved
    try {
      const approvedMsg = `Your advance salary request of ₹${advance.amount} has been fully approved.`;
      await db.query(
        `INSERT INTO notifications(employee_id, title, message, type) VALUES($1,'✅ Advance Approved',$2,'advance')`,
        [advance.employee_id, approvedMsg]
      );
      fcm.sendToEmployee(db, advance.employee_id, '✅ Advance Approved', approvedMsg, { screen: 'more' }).catch(() => {});
    } catch (_) {}

    // ── Auto-record in project_expenditures when advance is fully approved ──
    // This ensures the project budget reflects the cost immediately upon accounts approval,
    // not just when disbursement is processed later.
    // Re-fetch the row so we get the latest project_id (approver may have set it during this action).
    try {
      const freshAdv = await db.query(`SELECT project_id, employee_id, amount FROM advance_salary WHERE id=$1`, [id]);
      const finalProjectId = freshAdv.rows[0]?.project_id || null;
      if (finalProjectId) {
        const projCtrl = require('./projectController');
        await projCtrl.hookFinanceExpenditure(
          advance.employee_id, advance.amount, 'advance',
          parseInt(id), finalProjectId, 'Advance approved'
        );
      }
    } catch (hookErr) { console.error('[advance.approval hook]', hookErr.message); }

    res.json({ success: true, message: 'Advance fully approved' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally { client.release(); }
};

// ── Get MY advances — no role logic, just own requests ───────────────────────
exports.getMine = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT a.*,
              CONCAT(e.first_name,' ',e.last_name) AS employee_name,
              e.employee_code, d.name AS department_name
       FROM advance_salary a
       JOIN employees e ON a.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE a.employee_id = $1
       ORDER BY a.requested_at DESC`,
      [req.user.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[getMine]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Get Advances ──────────────────────────────────────────────────────────────
// Visibility rules:
//   super_admin / hr  → see ALL requests
//   CBO (KC03)        → same as super_admin: pending for them + already approved + own
//   accounts          → see requests where they are current_approver OR fully approved (status=approved) OR own requests
//   admin (COO etc.)  → see requests where they are current_approver OR already passed through them (approval_chain contains their code) OR own requests
//   manager / tl      → see requests where they are current_approver OR own requests
//   employee          → see ONLY their own requests
exports.getAll = async (req, res) => {
  try {
    const userId   = req.user.id;
    const userRole = req.user.role;
    const userCode = req.user.employee_code;
    const { status, employee_id } = req.query;

    let conds = [], params = [], idx = 1;

    // Explicit employee_id filter (e.g. "My Requests" tab on frontend)
    if (employee_id) {
      conds.push(`a.employee_id=$${idx++}`);
      params.push(employee_id);

    } else if (userRole === 'hr') {
      // HR sees everything (read-only oversight) — no scope filter

    } else if (userRole === 'super_admin' || userCode === CBO_CODE) {
      // MD (KC01) and CBO (KC03) see requests that have REACHED their level:
      //   1. Currently awaiting their action (current_approver_code = MD_CODE or CBO_CODE)
      //   2. Already passed through MD or CBO (they approved it) — now at Accounts or done
      //   3. Their own requests
      // NOT requests still sitting at Manager or COO level — those haven't reached them yet
      conds.push(`(
        a.current_approver_code IN ($${idx++}, $${idx++})
        OR (
          EXISTS (
            SELECT 1 FROM advance_approvals aa
            WHERE aa.advance_id = a.id
              AND aa.approver_id = $${idx++}
              AND aa.action = 'approve'
          )
        )
        OR a.employee_id = $${idx++}
      )`);
      params.push(MD_CODE, CBO_CODE, userId, userId);

    } else if (userRole === 'accounts') {
      // Accounts sees:
      //   1. Requests where they are the current approver (pending, awaiting their action)
      //   2. Requests that are fully approved (disbursement queue — status=approved, no pending approver)
      //   3. Their own requests
      conds.push(`(
        a.current_approver_code = $${idx++}
        OR a.status = 'approved'
        OR a.status = 'disbursed'
        OR a.employee_id = $${idx++}
      )`);
      params.push(userCode, userId);

    } else if (userRole === 'admin') {
      // COO (admin) sees:
      //   1. Requests where it is currently THEIR turn (current_approver_code = their code)
      //   2. Requests they have already approved (passed through them) — chain contains code AND they acted
      //   3. Their own requests
      // NOT requests still at manager level awaiting L1 approval
      conds.push(`(
        a.current_approver_code = $${idx++}
        OR (
          a.approval_chain::text LIKE $${idx++}
          AND a.current_approver_code IS DISTINCT FROM $${idx++}
          AND EXISTS (
            SELECT 1 FROM advance_approvals aa
            WHERE aa.advance_id = a.id
              AND aa.level_label = $${idx++}
              AND aa.action = 'approve'
          )
        )
        OR a.employee_id = $${idx++}
      )`);
      params.push(userCode, `%"${userCode}"%`, userCode, userCode, userId);

    } else if (userRole === 'client_admin' && req.user.client_id) {
      // client_admin sees all requests from employees in their client org
      conds.push(`a.employee_id IN (SELECT id FROM employees WHERE client_id=$${idx++} AND is_active=true)`);
      params.push(req.user.client_id);

    } else if (['manager', 'tl'].includes(userRole)) {
      // Manager / TL sees:
      //   1. Requests where they are the current approver (pending action)
      //   2. Requests they already approved (passed through them)
      //   3. Their own requests
      //   4. Requests from employees who report to them (reporting_manager_id OR team_leader_id)
      conds.push(`(
        a.current_approver_code = $${idx++}
        OR (
          a.approval_chain::text LIKE $${idx++}
          AND EXISTS (
            SELECT 1 FROM advance_approvals aa
            WHERE aa.advance_id = a.id
              AND aa.level_label = $${idx++}
              AND aa.action = 'approve'
          )
        )
        OR a.employee_id = $${idx++}
        OR EXISTS (
          SELECT 1 FROM employees sub
          WHERE sub.id = a.employee_id
            AND (sub.reporting_manager_id = $${idx++} OR sub.team_leader_id = $${idx++})
        )
      )`);
      params.push(userCode, `%"${userCode}"%`, userCode, userId, userId, userId);

    } else {
      // Regular employee — ONLY their own requests
      conds.push(`a.employee_id = $${idx++}`);
      params.push(userId);
    }

    if (status) {
      conds.push(`a.status = $${idx++}`);
      params.push(status);
    }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const result = await db.query(
      `SELECT a.*,
              COALESCE(NULLIF(a.purpose,''), a.amount::text)::numeric AS original_requested_amount,
              CONCAT(e.first_name,' ',e.last_name) AS employee_name,
              e.employee_code, d.name AS department_name
       FROM advance_salary a
       JOIN employees e ON a.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       ${where}
       ORDER BY a.requested_at DESC`,
      params
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Get Approvals Log ─────────────────────────────────────────────────────────
exports.getApprovals = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT aa.*,
              CONCAT(e.first_name,' ',e.last_name) AS approver_name
       FROM advance_approvals aa
       JOIN employees e ON aa.approver_id = e.id
       WHERE aa.advance_id=$1
       ORDER BY aa.level`, [req.params.id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Stats (for admin/COO/MD/Accounts summary cards) ──────────────────────────
exports.getStats = async (req, res) => {
  try {
    const userId   = req.user.id;
    const userRole = req.user.role;
    const userCode = req.user.employee_code;

    let scopeFilter = '';
    let params = [];

    if (userRole === 'hr') {
      // HR sees all for oversight
    } else if (userRole === 'accounts') {
      scopeFilter = `WHERE (status='approved' OR status='disbursed' OR current_approver_code=$1 OR employee_id=$2)`;
      params = [userCode, userId];
    } else if (userRole === 'super_admin' || userCode === CBO_CODE) {
      // MD and CBO see stats for requests at their level or already approved by them
      scopeFilter = `WHERE (
        current_approver_code IN ('${MD_CODE}','${CBO_CODE}')
        OR EXISTS (SELECT 1 FROM advance_approvals aa WHERE aa.advance_id=advance_salary.id AND aa.approver_id=$1)
        OR employee_id=$1
      )`;
      params = [userId];
    } else if (userRole === 'admin') {
      scopeFilter = `WHERE (current_approver_code=$1 OR employee_id=$2 OR EXISTS (
        SELECT 1 FROM advance_approvals aa WHERE aa.advance_id=advance_salary.id AND aa.approver_id=$2
      ))`;
      params = [userCode, userId];
    } else if (userRole === 'client_admin' && req.user.client_id) {
      scopeFilter = `WHERE employee_id IN (
        SELECT id FROM employees WHERE client_id=$1 AND is_active=true
      )`;
      params = [req.user.client_id];
    } else if (['manager', 'tl'].includes(userRole)) {
      scopeFilter = `WHERE (current_approver_code=$1 OR employee_id=$2)`;
      params = [userCode, userId];
    } else {
      scopeFilter = `WHERE employee_id=$1`;
      params = [userId];
    }

    const r = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status='pending')  AS pending,
         COUNT(*) FILTER (WHERE status='approved') AS approved,
         COUNT(*) FILTER (WHERE status='rejected') AS rejected,
         COALESCE(SUM(amount) FILTER (WHERE status='approved'),0) AS total_approved_amount
       FROM advance_salary ${scopeFilter}`,
      params
    );

    const s = r.rows[0];
    res.json({
      success: true,
      data: {
        pending:               parseInt(s.pending),
        approved:              parseInt(s.approved),
        rejected:              parseInt(s.rejected),
        total_approved_amount: parseFloat(s.total_approved_amount)
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Revoke (Employee cancels their own pending request) ───────────────────────
exports.revoke = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const empId = req.user.id;

    const adv = await client.query(
      `SELECT * FROM advance_salary WHERE id=$1 FOR UPDATE`, [id]
    );
    if (!adv.rows.length)
      return res.status(404).json({ success: false, message: 'Advance not found' });

    const advance = adv.rows[0];

    if (parseInt(advance.employee_id) !== parseInt(empId))
      return res.status(403).json({ success: false, message: 'You can only revoke your own requests' });

    if (advance.status !== 'pending')
      return res.status(400).json({ success: false, message: `Cannot revoke an advance that is already ${advance.status}` });

    await client.query(
      `UPDATE advance_salary SET status='rejected', remarks='Revoked by employee', updated_at=NOW() WHERE id=$1`, [id]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Advance request revoked successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally { client.release(); }
};

// ── Dismiss (Employee removes a rejected/revoked advance from their history) ──
exports.dismiss = async (req, res) => {
  try {
    const { id } = req.params;
    const empId = req.user.id;

    const adv = await db.query(
      `SELECT * FROM advance_salary WHERE id=$1`, [id]
    );
    if (!adv.rows.length)
      return res.status(404).json({ success: false, message: 'Advance not found' });

    const advance = adv.rows[0];

    if (parseInt(advance.employee_id) !== parseInt(empId))
      return res.status(403).json({ success: false, message: 'You can only dismiss your own requests' });

    if (!['rejected'].includes(advance.status))
      return res.status(400).json({ success: false, message: 'Only rejected requests can be dismissed' });

    await db.query(`DELETE FROM advance_salary WHERE id=$1`, [id]);
    res.json({ success: true, message: 'Request dismissed' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Edit (Employee edits their own pending request before first approval) ─────
exports.edit = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const empId = req.user.id;
    const { amount, reason, repayment_months, project_id } = req.body;

    if (!amount || amount <= 0)
      return res.status(400).json({ success: false, message: 'Valid amount required' });

    const adv = await client.query(
      `SELECT * FROM advance_salary WHERE id=$1 FOR UPDATE`, [id]
    );
    if (!adv.rows.length)
      return res.status(404).json({ success: false, message: 'Advance not found' });

    const advance = adv.rows[0];

    if (parseInt(advance.employee_id) !== parseInt(empId))
      return res.status(403).json({ success: false, message: 'You can only edit your own requests' });

    if (advance.status !== 'pending')
      return res.status(400).json({ success: false, message: `Cannot edit an advance that is already ${advance.status}` });

    // Only allow edit if no approvals have been recorded yet (no one has acted)
    const approvals = await client.query(
      `SELECT id FROM advance_approvals WHERE advance_id=$1 LIMIT 1`, [id]
    );
    if (approvals.rows.length)
      return res.status(400).json({ success: false, message: 'Cannot edit after an approver has already acted on this request' });

    const emi = repayment_months ? Math.ceil(amount / repayment_months) : amount;

    await client.query(
      `UPDATE advance_salary
       SET amount=$1, reason=$2, monthly_emi=$3, total_installments=$4, updated_at=NOW()
       WHERE id=$5`,
      [amount, reason || null, emi, repayment_months || 1, id]
    );

    await client.query('COMMIT');
    res.json({ success: true, message: 'Advance request updated successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally { client.release(); }
};

// ── Process Payment (Accounts marks advance as paid/disbursed) ────────────────
exports.processPayment = async (req, res) => {
  const client = await db.getClient();
  try {
    const { id } = req.params;
    const { payment_date, payment_mode, remarks, project_id } = req.body;

    if (!payment_date || !remarks)
      return res.status(400).json({ success: false, message: 'payment_date and remarks are required' });

    // DDL outside transaction — same reason as in action()
    await db.query(`ALTER TABLE advance_salary ADD COLUMN IF NOT EXISTS project_id INT`).catch(() => {});
    await db.query(`ALTER TABLE advance_salary DROP CONSTRAINT IF EXISTS advance_salary_status_check`).catch(() => {});
    await db.query(`ALTER TABLE advance_salary ADD CONSTRAINT advance_salary_status_check CHECK (status IN ('pending','approved','rejected','recovered','disbursed','cleared'))`).catch(() => {});

    await client.query('BEGIN');

    const adv = await client.query(
      `SELECT * FROM advance_salary WHERE id=$1 FOR UPDATE`, [id]
    );
    if (!adv.rows.length)
      return res.status(404).json({ success: false, message: 'Advance not found' });

    if (adv.rows[0].status !== 'approved')
      return res.status(400).json({ success: false, message: 'Only fully approved advances can be processed for payment' });

    // Accounts can override project_id at payment time
    const finalProjectId = project_id ? parseInt(project_id) : (adv.rows[0].project_id || null);
    if (finalProjectId) await client.query(`UPDATE advance_salary SET project_id=$1 WHERE id=$2`, [finalProjectId, id]).catch(() => {});

    try {
      await client.query(
        `UPDATE advance_salary
         SET status='disbursed', payment_date=$1, payment_mode=$2,
             payment_remarks=$3, disbursed_by=$4, updated_at=NOW()
         WHERE id=$5`,
        [payment_date, payment_mode || 'bank_transfer', remarks, req.user.id, id]
      );
    } catch (colErr) {
      await client.query(
        `UPDATE advance_salary SET status='disbursed', updated_at=NOW() WHERE id=$1`, [id]
      );
    }

    await client.query(
      `INSERT INTO advance_approvals(advance_id, level, level_label, approver_id, action, remarks)
       VALUES($1, 99, 'Accounts', $2, 'processed', $3)`,
      [id, req.user.id, remarks]
    ).catch(() => {});

    emailSvc.notifyAdvanceFullyApproved(id).catch(() => {});

    await client.query('COMMIT');
    res.json({ success: true, message: 'Payment processed successfully' });

    // Auto-record in project_expenditures
    try {
      if (finalProjectId) {
        const projCtrl = require('./projectController');
        await projCtrl.hookFinanceExpenditure(
          adv.rows[0].employee_id, adv.rows[0].amount, 'advance',
          parseInt(id), finalProjectId, 'Advance disbursed'
        );
      }
    } catch(e) { console.error('[advance.payment hook]', e.message); }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally { client.release(); }
};

// ═══════════════════════════════════════════════════════════════════════════
// EMI MANAGEMENT (Accounts only)
// ═══════════════════════════════════════════════════════════════════════════

// ── List all active EMI / advance loans ──────────────────────────────────────
exports.getEMIList = async (req, res) => {
  try {
    // Ensure payment_date column exists (may not exist on older DBs)
    await db.query(`ALTER TABLE advance_salary ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ`).catch(()=>{});

    const result = await db.query(`
      SELECT
        a.id, a.employee_id,
        CONCAT(e.first_name,' ',e.last_name) AS employee_name,
        e.employee_code, d.name AS department,
        a.amount        AS loan_amount,
        a.reason        AS loan_reason,
        a.monthly_emi,
        a.total_installments,
        a.installments_paid,
        a.total_installments - a.installments_paid AS installments_remaining,
        a.emi_start_month, a.emi_start_year,
        a.emi_end_month,   a.emi_end_year,
        a.status,
        COALESCE(a.payment_date, a.approved_at, a.updated_at) AS disbursed_date,
        ROUND(a.amount - (a.installments_paid * a.monthly_emi), 2) AS outstanding_balance,
        COALESCE(
          (SELECT SUM(lr.emi_amount) FROM loan_recovery_log lr WHERE lr.advance_id = a.id),
          0
        ) AS total_recovered
      FROM advance_salary a
      JOIN employees   e ON e.id = a.employee_id
      LEFT JOIN departments d ON d.id = e.department_id
      WHERE a.status IN ('disbursed','cleared')
        AND a.total_installments > 0
      ORDER BY
        CASE a.status WHEN 'disbursed' THEN 0 ELSE 1 END,
        e.first_name
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[getEMIList]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Create or update a loan/EMI directly (Accounts) ─────────────────────────
// POST /advance/emi  — create new loan for employee
// PUT  /advance/emi/:id — edit existing
exports.upsertEMI = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { id } = req.params; // present on PUT, absent on POST
    const {
      employee_id, loan_amount, reason,
      monthly_emi, total_installments,
      emi_start_month, emi_start_year,
      installments_paid = 0
    } = req.body;

    if (!employee_id || !loan_amount || !monthly_emi || !total_installments || !emi_start_month || !emi_start_year)
      return res.status(400).json({ success: false, message: 'employee_id, loan_amount, monthly_emi, total_installments, emi_start_month, emi_start_year are required' });

    // Calculate end month/year
    let endMonth = parseInt(emi_start_month) + parseInt(total_installments) - 1;
    let endYear  = parseInt(emi_start_year);
    while (endMonth > 12) { endMonth -= 12; endYear++; }

    if (id) {
      // Update existing
      await client.query(`
        UPDATE advance_salary SET
          amount = $1, reason = $2, monthly_emi = $3,
          total_installments = $4, installments_paid = $5,
          emi_start_month = $6, emi_start_year = $7,
          emi_end_month = $8, emi_end_year = $9,
          status = CASE WHEN $5::int >= $4::int THEN 'cleared' ELSE 'disbursed' END,
          updated_at = NOW()
        WHERE id = $10`,
        [loan_amount, reason||'Salary Advance', monthly_emi, total_installments,
         installments_paid, emi_start_month, emi_start_year,
         endMonth, endYear, id]
      );
      await client.query('COMMIT');
      res.json({ success: true, message: 'EMI updated successfully' });
    } else {
      // Create new — directly as disbursed (accounts is creating it directly)
      // Ensure payment_date column exists
      await client.query(`ALTER TABLE advance_salary ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ`).catch(()=>{});

      const r = await client.query(`
        INSERT INTO advance_salary
          (employee_id, amount, reason, monthly_emi, total_installments, installments_paid,
           emi_start_month, emi_start_year, emi_end_month, emi_end_year,
           status, approval_chain, current_approver_code, current_level,
           disbursed_by, payment_date, updated_at)
        VALUES
          ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
           'disbursed','[]',NULL,1,
           $11,NOW(),NOW())
        RETURNING id`,
        [employee_id, loan_amount, reason||'Salary Advance', monthly_emi, total_installments,
         installments_paid, emi_start_month, emi_start_year, endMonth, endYear,
         req.user.id]
      );
      // Notify employee
      const loanSetupMsg = `A loan of ₹${parseFloat(loan_amount).toLocaleString('en-IN')} has been set up for you. Monthly EMI: ₹${parseFloat(monthly_emi).toLocaleString('en-IN')} × ${total_installments} installments starting ${emi_start_month}/${emi_start_year}.`;
      await client.query(
        `INSERT INTO notifications(employee_id,type,title,message)
         VALUES($1,'advance','💰 Loan/EMI Setup',
           $2)`,
        [employee_id, loanSetupMsg]
      );
      fcm.sendToEmployee(db, employee_id, '💰 Loan/EMI Setup', loanSetupMsg, { screen: 'more' }).catch(() => {});
      await client.query('COMMIT');
      res.json({ success: true, message: 'EMI loan created successfully', id: r.rows[0].id });
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[upsertEMI]', err.message);
    res.status(500).json({ success: false, message: err.message });
  } finally { client.release(); }
};

// ── Get active EMI for a specific employee (for payroll template) ─────────────
exports.getActiveEMI = async (req, res) => {
  try {
    const { employee_id } = req.params;
    const result = await db.query(`
      SELECT id, amount, monthly_emi, total_installments, installments_paid,
             total_installments - installments_paid AS installments_remaining,
             emi_start_month, emi_start_year
      FROM advance_salary
      WHERE employee_id=$1 AND status='disbursed' AND total_installments > 0
        AND installments_paid < total_installments
      ORDER BY COALESCE(payment_date, approved_at, updated_at) ASC
      LIMIT 1`,
      [employee_id]
    );
    res.json({ success: true, data: result.rows[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Mark Approved Advance as Disbursed + Set EMI Schedule (Accounts) ─────────
// POST /advance/:id/mark-disbursed
exports.markDisbursedWithEMI = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const {
      payment_date, monthly_emi, total_installments,
      installments_paid = 0, emi_start_month, emi_start_year,
      payment_mode = 'bank_transfer', remarks
    } = req.body;

    if (!monthly_emi || !total_installments || !emi_start_month || !emi_start_year)
      return res.status(400).json({ success: false, message: 'monthly_emi, total_installments, emi_start_month, emi_start_year required' });

    const adv = await client.query(
      `SELECT * FROM advance_salary WHERE id=$1 FOR UPDATE`, [id]
    );
    if (!adv.rows.length)
      return res.status(404).json({ success: false, message: 'Advance not found' });
    if (!['approved','disbursed'].includes(adv.rows[0].status))
      return res.status(400).json({ success: false, message: 'Only approved advances can be marked disbursed' });

    // Calculate end month/year
    let endMonth = parseInt(emi_start_month) + parseInt(total_installments) - 1;
    let endYear  = parseInt(emi_start_year);
    while (endMonth > 12) { endMonth -= 12; endYear++; }

    // DDL safety
    await db.query(`ALTER TABLE advance_salary ADD COLUMN IF NOT EXISTS monthly_emi NUMERIC(12,2) DEFAULT 0`).catch(()=>{});
    await db.query(`ALTER TABLE advance_salary ADD COLUMN IF NOT EXISTS total_installments INT DEFAULT 1`).catch(()=>{});
    await db.query(`ALTER TABLE advance_salary ADD COLUMN IF NOT EXISTS installments_paid INT DEFAULT 0`).catch(()=>{});
    await db.query(`ALTER TABLE advance_salary ADD COLUMN IF NOT EXISTS emi_start_month INT`).catch(()=>{});
    await db.query(`ALTER TABLE advance_salary ADD COLUMN IF NOT EXISTS emi_start_year INT`).catch(()=>{});
    await db.query(`ALTER TABLE advance_salary ADD COLUMN IF NOT EXISTS emi_end_month INT`).catch(()=>{});
    await db.query(`ALTER TABLE advance_salary ADD COLUMN IF NOT EXISTS emi_end_year INT`).catch(()=>{});
    await db.query(`ALTER TABLE advance_salary ADD COLUMN IF NOT EXISTS payment_date TIMESTAMPTZ`).catch(()=>{});
    await db.query(`ALTER TABLE advance_salary DROP CONSTRAINT IF EXISTS advance_salary_status_check`).catch(()=>{});
    await db.query(`ALTER TABLE advance_salary ADD CONSTRAINT advance_salary_status_check CHECK (status IN ('pending','approved','rejected','recovered','disbursed','cleared'))`).catch(()=>{});

    await client.query(`
      UPDATE advance_salary SET
        status             = CASE WHEN $1::int >= $2::int THEN 'cleared' ELSE 'disbursed' END,
        monthly_emi        = $3,
        total_installments = $2,
        installments_paid  = $1,
        emi_start_month    = $4,
        emi_start_year     = $5,
        emi_end_month      = $6,
        emi_end_year       = $7,
        payment_date       = COALESCE($8, payment_date, NOW()),
        payment_mode       = $9,
        disbursed_by       = $10,
        updated_at         = NOW()
      WHERE id = $11`,
      [installments_paid, total_installments, monthly_emi,
       emi_start_month, emi_start_year, endMonth, endYear,
       payment_date || null, payment_mode, req.user.id, id]
    );

    // Notify employee
    const emp = adv.rows[0];
    const paidN = parseInt(installments_paid);
    const totalN = parseInt(total_installments);
    const disbMsg = `Your advance of ₹${parseFloat(emp.amount).toLocaleString('en-IN')} has been disbursed. EMI: ₹${parseFloat(monthly_emi).toLocaleString('en-IN')}/month × ${totalN} installments. ${paidN > 0 ? paidN + ' installment(s) already marked paid. Remaining: ' + (totalN - paidN) + '.' : 'Starting ' + emi_start_month + '/' + emi_start_year + '.'}`;
    await client.query(
      `INSERT INTO notifications(employee_id,type,title,message) VALUES($1,'advance','💰 Loan Disbursed',$2)`,
      [emp.employee_id, disbMsg]
    ).catch(()=>{});
    fcm.sendToEmployee(db, emp.employee_id, '💰 Loan Disbursed', disbMsg, { screen: 'more' }).catch(() => {});

    await client.query('COMMIT');
    res.json({ success: true, message: `Advance marked as disbursed with ${totalN} EMI installments (${paidN} already paid)` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[markDisbursedWithEMI]', err.message);
    res.status(500).json({ success: false, message: err.message });
  } finally { client.release(); }
};

// ── Mark single EMI installment as paid (manual, by Accounts) ────────────────
// POST /advance/emi/:id/mark-paid
exports.markEMIPaid = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { payroll_month, payroll_year, remarks } = req.body;

    const adv = await client.query(
      `SELECT * FROM advance_salary WHERE id=$1 FOR UPDATE`, [id]
    );
    if (!adv.rows.length)
      return res.status(404).json({ success: false, message: 'Loan not found' });

    const loan = adv.rows[0];
    if (loan.status !== 'disbursed')
      return res.status(400).json({ success: false, message: 'Loan is not active' });
    if (loan.installments_paid >= loan.total_installments)
      return res.status(400).json({ success: false, message: 'All installments already paid' });

    const m = parseInt(payroll_month) || new Date().getMonth() + 1;
    const y = parseInt(payroll_year)  || new Date().getFullYear();
    const newPaid   = parseInt(loan.installments_paid) + 1;
    const isCleared = newPaid >= parseInt(loan.total_installments);

    // Insert recovery log
    await client.query(
      `INSERT INTO loan_recovery_log
         (advance_id, employee_id, payroll_month, payroll_year, emi_amount, installment_no, notes)
       VALUES($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT(advance_id,payroll_month,payroll_year) DO UPDATE
         SET emi_amount=$5, installment_no=$6, notes=$7`,
      [id, loan.employee_id, m, y, loan.monthly_emi, newPaid,
       remarks || ('Installment ' + newPaid + '/' + loan.total_installments + ' — manual')]
    );

    // Update advance
    await client.query(
      `UPDATE advance_salary
       SET installments_paid = $1,
           status = CASE WHEN $2 THEN 'cleared' ELSE 'disbursed' END,
           updated_at = NOW()
       WHERE id = $3`,
      [newPaid, isCleared, id]
    );

    // Notify employee
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const msg = isCleared
      ? `🎉 Your loan is fully repaid! Final installment (${newPaid}/${loan.total_installments}) recorded for ${MONTHS[m-1]} ${y}.`
      : `💳 EMI installment ${newPaid}/${loan.total_installments} of ₹${parseFloat(loan.monthly_emi).toLocaleString('en-IN')} recorded for ${MONTHS[m-1]} ${y}.`;
    await client.query(
      `INSERT INTO notifications(employee_id,type,title,message) VALUES($1,'advance',$2,$3)`,
      [loan.employee_id, isCleared ? '✅ Loan Cleared!' : '💳 EMI Recorded', msg]
    ).catch(()=>{});
    fcm.sendToEmployee(db, loan.employee_id, isCleared ? '✅ Loan Cleared!' : '💳 EMI Recorded', msg, { screen: 'more' }).catch(() => {});

    await client.query('COMMIT');
    res.json({
      success: true,
      message: `Installment ${newPaid}/${loan.total_installments} marked paid${isCleared ? ' — LOAN CLEARED! 🎉' : ''}`,
      installments_paid: newPaid,
      total_installments: parseInt(loan.total_installments),
      is_cleared: isCleared
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[markEMIPaid]', err.message);
    res.status(500).json({ success: false, message: err.message });
  } finally { client.release(); }
};
