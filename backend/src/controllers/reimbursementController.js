// src/controllers/reimbursementController.js
// Approval chain: same logic as advance (Manager → COO → MD → Accounts)

const db       = require('../config/db');
const emailSvc = require('../config/emailService');
const multer   = require('multer');

const COO_CODE      = 'KC718';
const MD_CODE       = 'KC01';
const ACCOUNTS_CODE = 'KC7708';

// ── File upload middleware (same as IT declaration — base64 in DB) ─────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg','image/png','image/gif','image/webp',
                     'application/pdf'];
    cb(null, allowed.includes(file.mimetype));
  }
});
exports.uploadMiddleware = upload.single('attachment');

// ── Shared: same chain logic as advance ───────────────────────────────────────
async function getChain(employeeId) {
  const emp = await db.query(
    `SELECT e.employee_code, e.role,
            m.employee_code AS manager_code
     FROM employees e
     LEFT JOIN employees m ON e.reporting_manager_id = m.id
     WHERE e.id=$1`, [employeeId]
  );
  if (!emp.rows.length) return [COO_CODE, MD_CODE, ACCOUNTS_CODE];
  const { employee_code, role, manager_code } = emp.rows[0];

  if (employee_code === COO_CODE)      return [MD_CODE, ACCOUNTS_CODE];
  if (employee_code === MD_CODE || role === 'super_admin') return [ACCOUNTS_CODE];
  if (employee_code === ACCOUNTS_CODE) return [COO_CODE, MD_CODE];
  if (['admin','hr'].includes(role))   return [COO_CODE, MD_CODE, ACCOUNTS_CODE];

  const hasMgr = manager_code &&
    ![COO_CODE, MD_CODE, ACCOUNTS_CODE].includes(manager_code);
  return hasMgr
    ? [manager_code, COO_CODE, MD_CODE, ACCOUNTS_CODE]
    : [COO_CODE, MD_CODE, ACCOUNTS_CODE];
}

// ── Notify helper ─────────────────────────────────────────────────────────────
async function notifyEmployee(employeeId, title, message) {
  await db.query(
    `INSERT INTO notifications(employee_id,title,message,type) VALUES($1,$2,$3,'reimbursement')`,
    [employeeId, title, message]
  ).catch(() => {});
}
async function notifyByCode(code, title, message) {
  const rows = await db.query(
    `SELECT id FROM employees WHERE employee_code=$1 AND is_active=true`, [code]
  ).catch(() => ({ rows: [] }));
  for (const r of rows.rows) await notifyEmployee(r.id, title, message);
}

// ══════════════════════════════════════════════════════════════════════════════
// APPLY — POST /reimbursement/apply  (multipart, one item at a time OR JSON list)
// ══════════════════════════════════════════════════════════════════════════════
exports.apply = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const empId = req.user.id;
    const { title, items } = req.body;          // items = JSON string array

    if (!title || !title.trim())
      return res.status(400).json({ success: false, message: 'Title is required' });

    let parsedItems = [];
    try { parsedItems = typeof items === 'string' ? JSON.parse(items) : (items || []); }
    catch (_) { return res.status(400).json({ success: false, message: 'Invalid items JSON' }); }

    if (!parsedItems.length)
      return res.status(400).json({ success: false, message: 'At least one expense item is required' });

    const chain = await getChain(empId);
    const total = parsedItems.reduce((s, i) => s + parseFloat(i.amount || 0), 0);

    const result = await client.query(
      `INSERT INTO reimbursements
         (employee_id, title, total_amount, approved_amount, approval_chain,
          current_approver_code, current_level, status)
       VALUES($1,$2,$3,$3,$4,$5,1,'pending') RETURNING id`,
      [empId, title.trim(), total, JSON.stringify(chain), chain[0]]
    );
    const reimbId = result.rows[0].id;

    for (const item of parsedItems) {
      await client.query(
        `INSERT INTO reimbursement_items
           (reimbursement_id, category, description, amount, expense_date,
            attachment_data, attachment_name, attachment_mime, attachment_size)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [reimbId, item.category, item.description,
         parseFloat(item.amount), item.expense_date,
         item.attachment_data   || null,
         item.attachment_name   || null,
         item.attachment_mime   || null,
         item.attachment_size   || null]
      );
    }

    await client.query('COMMIT');

    // Notify first approver
    const empInfo = await db.query(
      `SELECT CONCAT(first_name,' ',last_name) AS name FROM employees WHERE id=$1`, [empId]
    );
    const empName = empInfo.rows[0]?.name || 'An employee';
    await notifyByCode(chain[0], '🧾 Reimbursement Request',
      `${empName} submitted a reimbursement of ₹${total.toLocaleString('en-IN')} — "${title}". Awaiting your approval.`);

    res.status(201).json({ success: true, message: 'Reimbursement submitted', data: { id: reimbId, total, chain } });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[reimbursement.apply]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally { client.release(); }
};

// ══════════════════════════════════════════════════════════════════════════════
// UPLOAD ATTACHMENT — POST /reimbursement/item/:id/attachment
// ══════════════════════════════════════════════════════════════════════════════
exports.uploadAttachment = async (req, res) => {
  try {
    const file = req.file;
    const { id } = req.params;
    if (!file) return res.status(400).json({ success: false, message: 'No file uploaded' });

    const base64 = file.buffer.toString('base64');
    await db.query(
      `UPDATE reimbursement_items
       SET attachment_data=$1, attachment_name=$2, attachment_mime=$3, attachment_size=$4
       WHERE id=$5`,
      [base64, file.originalname, file.mimetype, file.size, id]
    );
    res.json({ success: true, message: 'Attachment saved' });
  } catch (err) {
    console.error('[reimbursement.uploadAttachment]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// GET ATTACHMENT — GET /reimbursement/item/:id/attachment
// ══════════════════════════════════════════════════════════════════════════════
exports.getAttachment = async (req, res) => {
  try {
    const { id } = req.params;
    const r = await db.query(
      `SELECT attachment_data, attachment_name, attachment_mime FROM reimbursement_items WHERE id=$1`, [id]
    );
    if (!r.rows.length || !r.rows[0].attachment_data)
      return res.status(404).json({ success: false, message: 'No attachment found' });

    const { attachment_data, attachment_name, attachment_mime } = r.rows[0];
    const buffer = Buffer.from(attachment_data, 'base64');
    res.setHeader('Content-Type', attachment_mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${attachment_name || 'attachment'}"`);
    res.send(buffer);
  } catch (err) {
    console.error('[reimbursement.getAttachment]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// GET ALL — GET /reimbursement  (same visibility rules as advance)
// ══════════════════════════════════════════════════════════════════════════════
exports.getAll = async (req, res) => {
  try {
    const userId   = req.user.id;
    const userRole = req.user.role;
    const userCode = req.user.employee_code;
    const { employee_id, status } = req.query;

    let conds = [], params = [], idx = 1;

    if (employee_id) {
      conds.push(`r.employee_id=$${idx++}`); params.push(employee_id);
    } else if (userRole === 'hr') {
      // see all
    } else if (userRole === 'super_admin') {
      conds.push(`(r.current_approver_code=$${idx++} OR (r.approval_chain::text LIKE $${idx++} AND EXISTS(SELECT 1 FROM reimbursement_approvals ra WHERE ra.reimbursement_id=r.id AND ra.approver_id=$${idx++} AND ra.action='approve')) OR r.employee_id=$${idx++})`);
      params.push(userCode, `%"${userCode}"%`, userId, userId);
    } else if (userRole === 'accounts') {
      conds.push(`(r.current_approver_code=$${idx++} OR (r.status='approved' AND r.current_approver_code IS NULL) OR r.employee_id=$${idx++})`);
      params.push(userCode, userId);
    } else if (userRole === 'admin') {
      conds.push(`(r.current_approver_code=$${idx++} OR (r.approval_chain::text LIKE $${idx++} AND EXISTS(SELECT 1 FROM reimbursement_approvals ra WHERE ra.reimbursement_id=r.id AND ra.level_label=$${idx++} AND ra.action='approve')) OR r.employee_id=$${idx++})`);
      params.push(userCode, `%"${userCode}"%`, userCode, userId);
    } else if (['manager','tl'].includes(userRole)) {
      conds.push(`(r.current_approver_code=$${idx++} OR (r.approval_chain::text LIKE $${idx++} AND EXISTS(SELECT 1 FROM reimbursement_approvals ra WHERE ra.reimbursement_id=r.id AND ra.level_label=$${idx++} AND ra.action='approve')) OR r.employee_id=$${idx++} OR EXISTS(SELECT 1 FROM employees sub WHERE sub.id=r.employee_id AND (sub.reporting_manager_id=$${idx++} OR sub.team_leader_id=$${idx++})))`);
      params.push(userCode, `%"${userCode}"%`, userCode, userId, userId, userId);
    } else {
      conds.push(`r.employee_id=$${idx++}`); params.push(userId);
    }

    if (status) { conds.push(`r.status=$${idx++}`); params.push(status); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const result = await db.query(
      `SELECT r.*,
              CONCAT(e.first_name,' ',e.last_name) AS employee_name,
              e.employee_code, d.name AS department_name
       FROM reimbursements r
       JOIN employees e ON r.employee_id=e.id
       LEFT JOIN departments d ON e.department_id=d.id
       ${where}
       ORDER BY r.requested_at DESC`,
      params
    );

    // Attach items to each reimbursement
    const ids = result.rows.map(r => r.id);
    let itemsMap = {};
    if (ids.length) {
      const itemsRes = await db.query(
        `SELECT id, reimbursement_id, category, description, amount,
                TO_CHAR(expense_date, 'YYYY-MM-DD') AS expense_date,
                attachment_name, attachment_mime, attachment_size, approved_amount,
                CASE WHEN attachment_data IS NOT NULL THEN true ELSE false END AS has_attachment
         FROM reimbursement_items
         WHERE reimbursement_id = ANY($1)
         ORDER BY id`, [ids]
      );
      for (const item of itemsRes.rows) {
        if (!itemsMap[item.reimbursement_id]) itemsMap[item.reimbursement_id] = [];
        itemsMap[item.reimbursement_id].push(item);
      }
    }

    const data = result.rows.map(r => ({ ...r, items: itemsMap[r.id] || [] }));
    res.json({ success: true, data });
  } catch (err) {
    console.error('[reimbursement.getAll]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// ACTION — POST /reimbursement/:id/action  (approve / reject + optional revise)
// ══════════════════════════════════════════════════════════════════════════════
exports.action = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { action, remarks, revised_amount, item_revisions } = req.body;
    // item_revisions = [{ item_id, approved_amount }] — optional per-item revision
    const actorCode = req.user.employee_code;
    const actorRole = req.user.role;

    if (!['approve','reject'].includes(action))
      return res.status(400).json({ success: false, message: 'action must be approve or reject' });

    const rRow = await client.query(`SELECT * FROM reimbursements WHERE id=$1 FOR UPDATE`, [id]);
    if (!rRow.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    const reimb = rRow.rows[0];

    if (reimb.status !== 'pending')
      return res.status(400).json({ success: false, message: `Already ${reimb.status}` });

    let chain;
    try { chain = Array.isArray(reimb.approval_chain) ? reimb.approval_chain : JSON.parse(reimb.approval_chain); }
    catch (_) { chain = []; }

    const isSuperAdmin      = actorRole === 'super_admin';
    const isCurrentApprover = actorCode === reimb.current_approver_code;
    if (!isSuperAdmin && !isCurrentApprover)
      return res.status(403).json({ success: false, message: 'You are not the current approver' });
    if (reimb.employee_id === req.user.id)
      return res.status(403).json({ success: false, message: 'Cannot approve your own request' });

    const currentIdx   = chain.indexOf(reimb.current_approver_code);
    const currentLevel = currentIdx + 1;

    // ── Handle amount revision (per item or total) ─────────────────────────
    let finalApprovedAmount = parseFloat(reimb.total_amount);
    let amountRevised       = false;
    const originalAmount    = parseFloat(reimb.total_amount);

    // Per-item revisions
    if (item_revisions && Array.isArray(item_revisions) && item_revisions.length) {
      for (const rev of item_revisions) {
        await client.query(
          `UPDATE reimbursement_items SET approved_amount=$1 WHERE id=$2 AND reimbursement_id=$3`,
          [parseFloat(rev.approved_amount), rev.item_id, id]
        );
      }
      // Recalculate total approved from items
      const sumRes = await client.query(
        `SELECT COALESCE(SUM(COALESCE(approved_amount, amount)),0) AS total
         FROM reimbursement_items WHERE reimbursement_id=$1`, [id]
      );
      finalApprovedAmount = parseFloat(sumRes.rows[0].total);
      amountRevised = finalApprovedAmount !== originalAmount;
    } else if (revised_amount && parseFloat(revised_amount) !== originalAmount) {
      // Top-level revision
      finalApprovedAmount = parseFloat(revised_amount);
      amountRevised       = true;
    }

    if (amountRevised) {
      await client.query(
        `UPDATE reimbursements SET approved_amount=$1, updated_at=NOW() WHERE id=$2`,
        [finalApprovedAmount, id]
      );
      // Notify employee of revision
      const approverName = `${req.user.first_name} ${req.user.last_name}`.trim();
      await notifyEmployee(reimb.employee_id, '⚠️ Reimbursement Amount Revised',
        `Your reimbursement "${reimb.title}" was revised from ₹${originalAmount.toLocaleString('en-IN')} to ₹${finalApprovedAmount.toLocaleString('en-IN')} by ${approverName}.${remarks ? ' Remarks: ' + remarks : ''}`
      );
      // Also notify all other approvers in chain about the revision
      for (const code of chain) {
        if (code !== actorCode) {
          await notifyByCode(code, '⚠️ Reimbursement Revised',
            `${approverName} revised reimbursement "${reimb.title}" (Employee ID: ${reimb.employee_id}) amount to ₹${finalApprovedAmount.toLocaleString('en-IN')}.`
          );
        }
      }
    }

    // Log this step
    await client.query(
      `INSERT INTO reimbursement_approvals
         (reimbursement_id, level, level_label, approver_id, action, original_amount, revised_amount, remarks)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, currentLevel, reimb.current_approver_code, req.user.id,
       action, originalAmount, amountRevised ? finalApprovedAmount : null, remarks || null]
    );

    if (action === 'reject') {
      await client.query(
        `UPDATE reimbursements SET status='rejected', remarks=$1, updated_at=NOW() WHERE id=$2`,
        [remarks || null, id]
      );
      await client.query('COMMIT');
      // Notify employee
      await notifyEmployee(reimb.employee_id, '❌ Reimbursement Rejected',
        `Your reimbursement "${reimb.title}" was rejected.${remarks ? ' Reason: ' + remarks : ''}`);
      // Notify all chain members
      const empName = (await db.query(`SELECT CONCAT(first_name,' ',last_name) AS n FROM employees WHERE id=$1`, [reimb.employee_id])).rows[0]?.n;
      for (const code of chain) {
        if (code !== actorCode) {
          await notifyByCode(code, '❌ Reimbursement Rejected',
            `${empName}'s reimbursement "${reimb.title}" was rejected by ${req.user.employee_code}.`);
        }
      }
      return res.json({ success: true, message: 'Reimbursement rejected' });
    }

    // Approve — advance chain
    const nextCode = chain[currentIdx + 1] || null;
    if (nextCode) {
      await client.query(
        `UPDATE reimbursements SET current_approver_code=$1, current_level=$2, updated_at=NOW() WHERE id=$3`,
        [nextCode, currentIdx + 2, id]
      );
      await client.query('COMMIT');
      // Notify next approver
      const empName = (await db.query(`SELECT CONCAT(first_name,' ',last_name) AS n FROM employees WHERE id=$1`, [reimb.employee_id])).rows[0]?.n;
      await notifyByCode(nextCode, '🧾 Reimbursement Request',
        `${empName}'s reimbursement "${reimb.title}" of ₹${finalApprovedAmount.toLocaleString('en-IN')} is awaiting your approval.`);
      return res.json({ success: true, message: 'Approved. Forwarded to next approver.' });
    }

    // Final approval
    await client.query(
      `UPDATE reimbursements
       SET status='approved', approved_amount=$1, approved_at=NOW(),
           current_approver_code=NULL, updated_at=NOW()
       WHERE id=$2`,
      [finalApprovedAmount, id]
    );
    await client.query('COMMIT');

    // Notify employee — fully approved
    await notifyEmployee(reimb.employee_id, '✅ Reimbursement Approved',
      `Your reimbursement "${reimb.title}" of ₹${finalApprovedAmount.toLocaleString('en-IN')} has been fully approved.`);
    // Notify all chain members
    const empN = (await db.query(`SELECT CONCAT(first_name,' ',last_name) AS n FROM employees WHERE id=$1`, [reimb.employee_id])).rows[0]?.n;
    for (const code of chain) {
      if (code !== actorCode) {
        await notifyByCode(code, '✅ Reimbursement Approved',
          `${empN}'s reimbursement "${reimb.title}" has been fully approved. Approved amount: ₹${finalApprovedAmount.toLocaleString('en-IN')}.`);
      }
    }

    res.json({ success: true, message: 'Reimbursement fully approved' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[reimbursement.action]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally { client.release(); }
};

// ── Process disbursement (Accounts) — POST /reimbursement/:id/disburse ────────
exports.disburse = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { payment_date, payment_mode, remarks } = req.body;
    if (!remarks) return res.status(400).json({ success: false, message: 'Remarks required' });

    const r = await client.query(`SELECT * FROM reimbursements WHERE id=$1 FOR UPDATE`, [id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    if (r.rows[0].status !== 'approved')
      return res.status(400).json({ success: false, message: 'Only approved reimbursements can be disbursed' });

    await client.query(
      `UPDATE reimbursements SET status='disbursed', disbursed_at=NOW(), disbursed_by=$1, remarks=$2, updated_at=NOW() WHERE id=$3`,
      [req.user.id, remarks, id]
    );
    await client.query(
      `INSERT INTO reimbursement_approvals(reimbursement_id,level,level_label,approver_id,action,remarks)
       VALUES($1,99,'Accounts',$2,'disbursed',$3)`,
      [id, req.user.id, remarks]
    );
    await client.query('COMMIT');

    const reimb = r.rows[0];
    await notifyEmployee(reimb.employee_id, '💰 Reimbursement Disbursed',
      `Your reimbursement "${reimb.title}" of ₹${parseFloat(reimb.approved_amount).toLocaleString('en-IN')} has been disbursed.${remarks ? ' Note: ' + remarks : ''}`);

    res.json({ success: true, message: 'Disbursed successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[reimbursement.disburse]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally { client.release(); }
};

// ── Revoke (employee cancels pending) ─────────────────────────────────────────
exports.revoke = async (req, res) => {
  try {
    const { id } = req.params;
    const empId = req.user.id;
    const r = await db.query(`SELECT * FROM reimbursements WHERE id=$1`, [id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    if (r.rows[0].employee_id !== empId)
      return res.status(403).json({ success: false, message: 'Not your request' });
    if (r.rows[0].status !== 'pending')
      return res.status(400).json({ success: false, message: 'Can only revoke pending requests' });
    await db.query(`UPDATE reimbursements SET status='rejected', remarks='Revoked by employee', updated_at=NOW() WHERE id=$1`, [id]);
    res.json({ success: true, message: 'Revoked' });
  } catch (err) {
    console.error('[reimbursement.revoke]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
// EXPORT — GET /reimbursement/export?from=YYYY-MM-DD&to=YYYY-MM-DD&status=all
// Accounts/HR/super_admin only — returns JSON for client-side Excel generation
// ══════════════════════════════════════════════════════════════════════════════
exports.exportData = async (req, res) => {
  try {
    const { from, to, status } = req.query;
    if (!from || !to)
      return res.status(400).json({ success: false, message: 'from and to dates are required' });

    // Build params and conditions
    const params = [from, to];
    let statusCond = '';
    if (status && status !== 'all') {
      params.push(status);
      statusCond = `AND r.status = $3`;
    }

    const result = await db.query(
      `SELECT
         r.id, r.title, r.status, r.total_amount, r.approved_amount,
         r.requested_at, r.approved_at, r.disbursed_at, r.remarks,
         CONCAT(e.first_name,' ',e.last_name) AS employee_name,
         e.employee_code, e.designation, e.mobile,
         d.name AS department_name
       FROM reimbursements r
       JOIN employees e ON r.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE r.requested_at::date BETWEEN $1 AND $2
       ${statusCond}
       ORDER BY r.requested_at DESC`,
      params
    );

    // For each reimbursement, fetch its items (with attachment flag + item id for URL)
    const ids = result.rows.map(r => r.id);
    let itemsMap = {};
    if (ids.length) {
      const itemsRes = await db.query(
        `SELECT id, reimbursement_id, category, description, amount,
                TO_CHAR(expense_date, 'YYYY-MM-DD') AS expense_date,
                approved_amount, attachment_name, attachment_mime,
                CASE WHEN attachment_data IS NOT NULL THEN true ELSE false END AS has_attachment
         FROM reimbursement_items
         WHERE reimbursement_id = ANY($1)
         ORDER BY id`, [ids]
      );
      for (const item of itemsRes.rows) {
        if (!itemsMap[item.reimbursement_id]) itemsMap[item.reimbursement_id] = [];
        itemsMap[item.reimbursement_id].push(item);
      }
    }

    const data = result.rows.map(r => ({ ...r, items: itemsMap[r.id] || [] }));
    res.json({ success: true, data, exported_at: new Date().toISOString() });
  } catch (err) {
    console.error('[reimbursement.exportData]', err);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// ── Get approval log ──────────────────────────────────────────────────────────
exports.getApprovals = async (req, res) => {
  try {
    const r = await db.query(
      `SELECT ra.*, CONCAT(e.first_name,' ',e.last_name) AS approver_name
       FROM reimbursement_approvals ra
       JOIN employees e ON ra.approver_id=e.id
       WHERE ra.reimbursement_id=$1 ORDER BY ra.level`, [req.params.id]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
