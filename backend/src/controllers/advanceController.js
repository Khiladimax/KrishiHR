// src/controllers/advanceController.js — COMPLETE with approval chain
// Advance chain: Employee → Manager → COO (KC718) → MD (KC01) → HR notified
// For direct-reports-of-COO: COO → MD → HR notified

const db       = require('../config/db');
const emailSvc = require('../config/emailService');

const COO_CODE      = 'KC718';  // Gurudatt
const MD_CODE       = 'KC01';   // Sunil
const ACCOUNTS_CODE = 'KC7708'; // Anshu

// ── Dynamic advance chain — no hardcoded employee codes ──────────────────────
// Chain is determined by employee's role:
//   admin role      → skip_manager = true → goes directly to COO → MD → Accounts
//   hr role         → skip_manager = true → goes directly to COO → MD → Accounts
//   accounts role   → COO → MD (no self-loop)
//   super_admin/MD  → Accounts only
//   COO             → MD → Accounts
//   everyone else   → Reporting Manager → COO → MD → Accounts
// HR can update employee role via employees.html to control the chain

async function getAdvanceChain(employeeId) {
  const emp = await db.query(
    `SELECT e.employee_code, e.role, e.reporting_manager_id,
            m.employee_code AS manager_code
     FROM employees e
     LEFT JOIN employees m ON e.reporting_manager_id = m.id
     WHERE e.id=$1`, [employeeId]
  );
  if (!emp.rows.length) return [COO_CODE, MD_CODE, ACCOUNTS_CODE];
  const { employee_code, role, manager_code } = emp.rows[0];

  // COO applies → MD → Accounts
  if (employee_code === COO_CODE) return [MD_CODE, ACCOUNTS_CODE];

  // MD / super_admin applies → Accounts only
  if (employee_code === MD_CODE || role === 'super_admin') return [ACCOUNTS_CODE];

  // Accounts applies → COO → MD (no self-loop)
  if (employee_code === ACCOUNTS_CODE) return [COO_CODE, MD_CODE];

  // admin / hr roles → skip reporting manager, go directly to COO → MD → Accounts
  // This replaces the old hardcoded DIRECT_TO_COO set
  // HR can assign admin/hr role to any employee in employees.html to give them this chain
  if (['admin', 'hr'].includes(role)) return [COO_CODE, MD_CODE, ACCOUNTS_CODE];

  // Everyone else (manager, TL, employee): Reporting Manager → COO → MD → Accounts
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
    const { amount, reason, repayment_months } = req.body;

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
          approval_chain, current_approver_code, status, purpose)
       VALUES($1,$2,$3,$4,$5,$6,$7,'pending',$8)
       RETURNING id`,
      [empId, amount, reason || null, emi, repayment_months || 1,
       JSON.stringify(chain), chain[0], String(amount)]
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
    await client.query('BEGIN');
    const { id } = req.params;
    const { action, remarks, payment_date, project_id } = req.body;
    const actorCode = req.user.employee_code;
    const actorRole = req.user.role;

    if (!['approve','reject'].includes(action))
      return res.status(400).json({ success: false, message: 'action must be approve or reject' });

    // If approver is redirecting to a different project, save it immediately
    if (project_id) {
      await client.query(
        `ALTER TABLE advance_salary ADD COLUMN IF NOT EXISTS project_id INT`
      ).catch(()=>{});
      await client.query(
        `UPDATE advance_salary SET project_id=$1 WHERE id=$2`,
        [parseInt(project_id), req.params.id]
      ).catch(()=>{});
    }
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
    const isSuperAdmin = actorRole === 'super_admin';
    const isCurrentApprover = actorCode === currentCode;

    // Block self-approval
    if (advance.employee_id === req.user.id)
      return res.status(403).json({ success: false, message: 'You cannot approve your own advance request' });

    if (!isSuperAdmin && !isCurrentApprover)
      return res.status(403).json({ success: false, message: 'You are not the current approver' });

    // Log this approval step
    const currentLevel = chain.indexOf(currentCode) + 1;
    await client.query(
      `INSERT INTO advance_approvals(advance_id, level, level_label, approver_id, action, remarks)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [id, currentLevel, currentCode, req.user.id, action, remarks || null]
    );

    // Self-correct chain for admin/hr employees whose old records had 4 levels
    const empCheck = await client.query(
      `SELECT e.employee_code, e.role FROM employees e WHERE e.id=$1`, [advance.employee_id]
    );
    const empCode = empCheck.rows[0]?.employee_code;
    const empRole = empCheck.rows[0]?.role;
    // admin/hr roles should have 3-level chain (COO→MD→Accounts), not 4
    if (['admin','hr'].includes(empRole) && chain.length === 4) {
      const correctedChain = [COO_CODE, MD_CODE, ACCOUNTS_CODE];
      await client.query(
        `UPDATE advance_salary SET approval_chain=$1, current_approver_code=$2, current_level=1 WHERE id=$3`,
        [JSON.stringify(correctedChain), COO_CODE, id]
      );
      chain.splice(0, chain.length, ...correctedChain);
      console.log(`[AUTO-FIX] Corrected chain for ${empCode} (${empRole}) advance #${id}: 4→3 levels`);
    }

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
          await client.query(
            `INSERT INTO notifications(employee_id, title, message, type) VALUES($1,'⚠️ Advance Amount Revised',$2,'advance')`,
            [advance.employee_id,
             `Your advance request of Rs.${originalAmount.toLocaleString('en-IN')} was revised to Rs.${overrideAmt.toLocaleString('en-IN')} by ${approverName} (${lvlLabel}).${remarks ? ' Remarks: ' + remarks : ''}`]
          );
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
      } catch (_) {}
      return res.json({ success: true, message: 'Advance rejected' });
    }

    // Approve — advance chain
    const currentIdx = chain.indexOf(currentCode);
    const nextCode   = chain[currentIdx + 1] || null;

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
            await db.query(
              `INSERT INTO notifications(employee_id, title, message, type) VALUES($1,'💰 Advance Request',$2,'advance')`,
              [r.id, `${info.full_name}'s advance request of ₹${advance.amount} is awaiting your approval.`]
            );
          }
        }
      } catch (_) {}

      return res.json({ success: true, message: 'Approved. Forwarded to next approver.' });
    }

    // Final approval
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
      await db.query(
        `INSERT INTO notifications(employee_id, title, message, type) VALUES($1,'✅ Advance Approved',$2,'advance')`,
        [advance.employee_id, `Your advance salary request of ₹${advance.amount} has been fully approved.`]
      );
    } catch (_) {}
    res.json({ success: true, message: 'Advance fully approved' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally { client.release(); }
};

// ── Get Advances ──────────────────────────────────────────────────────────────
// Visibility rules:
//   super_admin / hr  → see ALL requests
// ── Get MY advances — simple, no role logic, just own requests ───────────────
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

    } else if (userRole === 'super_admin') {
      // MD (super_admin / KC01) sees ONLY:
      //   1. Requests where it is currently THEIR turn (current_approver_code = their code)
      //   2. Requests they have already approved (passed through them)
      //   3. Their own requests
      // NOT requests still sitting at manager/COO level — those are not their business yet
      conds.push(`(
        a.current_approver_code = $${idx++}
        OR (
          a.approval_chain::text LIKE $${idx++}
          AND a.current_approver_code IS DISTINCT FROM $${idx++}
          AND EXISTS (
            SELECT 1 FROM advance_approvals aa
            WHERE aa.advance_id = a.id
              AND aa.approver_id = $${idx++}
              AND aa.action = 'approve'
          )
        )
        OR a.employee_id = $${idx++}
      )`);
      params.push(userCode, `%"${userCode}"%`, userCode, userId, userId);

    } else if (userRole === 'accounts') {
      // Accounts sees:
      //   1. Requests where they are the current approver (pending, awaiting their action)
      //   2. Requests that are fully approved (disbursement queue — status=approved, no pending approver)
      //   3. Their own requests
      conds.push(`(
        a.current_approver_code = $${idx++}
        OR (a.status = 'approved' AND a.current_approver_code IS NULL)
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
    } else if (['super_admin', 'admin', 'accounts'].includes(userRole)) {
      // COO/MD/Accounts: stats scoped to requests where it's their turn OR they already acted OR their own
      scopeFilter = `WHERE (current_approver_code=$1 OR employee_id=$2 OR EXISTS (
        SELECT 1 FROM advance_approvals aa WHERE aa.advance_id=advance_salary.id AND aa.approver_id=$2
      ))`;
      params = [userCode, userId];
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
    const { amount, reason, repayment_months } = req.body;

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
    await client.query('BEGIN');
    const { id } = req.params;
    const { payment_date, payment_mode, remarks } = req.body;

    if (!payment_date || !remarks)
      return res.status(400).json({ success: false, message: 'payment_date and remarks are required' });

    const adv = await client.query(
      `SELECT * FROM advance_salary WHERE id=$1 FOR UPDATE`, [id]
    );
    if (!adv.rows.length)
      return res.status(404).json({ success: false, message: 'Advance not found' });

    if (adv.rows[0].status !== 'approved')
      return res.status(400).json({ success: false, message: 'Only fully approved advances can be processed for payment' });

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
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally { client.release(); }
};
