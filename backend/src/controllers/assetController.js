// assetController.js — Asset Allocation (laptop kit, fan, chair, …) per employee
// One row per allocated item, with qty / serial / status (allocated|returned).
const db = require('../config/db');

const HR_ROLES = ['hr', 'accounts', 'admin', 'super_admin', 'client_admin'];

// Default dropdown items (the UI also allows a free-text "Other").
const DEFAULT_ITEMS = [
  'Laptop Kit (laptop + charger + bag)', 'Monitor', 'Keyboard', 'Mouse',
  'Fan', 'Chair', 'Desk / Table', 'SIM Card', 'ID Card', 'Headset',
];

// ── Lazy schema (created once) ────────────────────────────────────────────────
let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS asset_allocations (
      id           SERIAL PRIMARY KEY,
      employee_id  INTEGER NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
      item_name    TEXT    NOT NULL,
      quantity     INTEGER NOT NULL DEFAULT 1,
      serial_no    TEXT,
      remark       TEXT,
      status       TEXT    NOT NULL DEFAULT 'allocated',   -- allocated | returned
      allocated_by INTEGER,
      allocated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      returned_at  TIMESTAMPTZ,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await db.query(`CREATE INDEX IF NOT EXISTS idx_asset_alloc_emp ON asset_allocations(employee_id)`);
  schemaReady = true;
}

// HR roles can manage; anyone can view their own.
const canManage = (u) => HR_ROLES.includes(u.role);
const canAccess = (u, empId) => canManage(u) || parseInt(empId) === parseInt(u.id);

// A client_admin may only touch their own client's employees.
async function inClientScope(reqUser, employeeId) {
  if (reqUser.role !== 'client_admin') return true;
  if (!reqUser.client_id) return false;
  const r = await db.query('SELECT client_id FROM employees WHERE id = $1', [employeeId]);
  return r.rows[0] && parseInt(r.rows[0].client_id) === parseInt(reqUser.client_id);
}

// ── GET /assets/items — dropdown catalogue ────────────────────────────────────
exports.getItems = async (_req, res) => {
  res.json({ success: true, data: DEFAULT_ITEMS });
};

// ── GET /assets/employees — employee picker (scoped for client_admin) ─────────
exports.getEmployees = async (req, res) => {
  try {
    if (!canManage(req.user)) return res.status(403).json({ success: false, message: 'Access denied' });
    const clientFilter = (req.user.role === 'client_admin' && req.user.client_id)
      ? `AND client_id = ${parseInt(req.user.client_id)}` : '';
    const r = await db.query(
      `SELECT id, employee_code, first_name, last_name
         FROM employees WHERE is_active = true ${clientFilter} ORDER BY first_name ASC`);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[assets/getEmployees]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── GET /assets?employee_id=X — allocations for one employee ──────────────────
exports.list = async (req, res) => {
  try {
    await ensureSchema();
    const empId = req.query.employee_id ? parseInt(req.query.employee_id) : parseInt(req.user.id);
    if (!canAccess(req.user, empId)) return res.status(403).json({ success: false, message: 'Access denied' });
    if (!(await inClientScope(req.user, empId))) return res.status(403).json({ success: false, message: 'Access denied' });
    const r = await db.query(
      `SELECT a.*, CONCAT(b.first_name,' ',b.last_name) AS allocated_by_name
         FROM asset_allocations a
         LEFT JOIN employees b ON b.id = a.allocated_by
        WHERE a.employee_id = $1
        ORDER BY a.status ASC, a.allocated_at DESC`, [empId]);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[assets/list]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── GET /assets/my — the requesting user's own assets (Android employee app) ──
exports.myAssets = async (req, res) => {
  try {
    await ensureSchema();
    const r = await db.query(
      `SELECT * FROM asset_allocations WHERE employee_id = $1 ORDER BY status ASC, allocated_at DESC`,
      [parseInt(req.user.id)]);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[assets/my]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── POST /assets — allocate one or more items to an employee ──────────────────
// Body: { employee_id, items: [{ item_name, quantity?, serial_no?, remark? }, …] }
exports.create = async (req, res) => {
  try {
    await ensureSchema();
    if (!canManage(req.user)) return res.status(403).json({ success: false, message: 'Access denied' });
    const employeeId = parseInt(req.body.employee_id);
    const items = Array.isArray(req.body.items) ? req.body.items : [];
    if (!employeeId) return res.status(400).json({ success: false, message: 'employee_id is required' });
    if (!items.length) return res.status(400).json({ success: false, message: 'At least one item is required' });
    if (!(await inClientScope(req.user, employeeId))) return res.status(403).json({ success: false, message: 'Access denied' });

    const created = [];
    for (const it of items) {
      const name = String(it.item_name || '').trim();
      if (!name) continue;
      const qty    = Math.max(1, parseInt(it.quantity) || 1);
      const serial = it.serial_no ? String(it.serial_no).trim() : null;
      const remark = it.remark ? String(it.remark).trim() : null;
      const r = await db.query(
        `INSERT INTO asset_allocations (employee_id, item_name, quantity, serial_no, remark, allocated_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [employeeId, name, qty, serial, remark, parseInt(req.user.id)]);
      created.push(r.rows[0]);
    }
    if (!created.length) return res.status(400).json({ success: false, message: 'No valid items to allocate' });
    res.status(201).json({ success: true, data: created });
  } catch (err) {
    console.error('[assets/create]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── PATCH /assets/:id — edit an item or mark it returned ──────────────────────
// Body may include: item_name, quantity, serial_no, remark, status ('returned'|'allocated')
exports.update = async (req, res) => {
  try {
    await ensureSchema();
    if (!canManage(req.user)) return res.status(403).json({ success: false, message: 'Access denied' });
    const id = parseInt(req.params.id);
    const existing = await db.query('SELECT employee_id FROM asset_allocations WHERE id = $1', [id]);
    if (!existing.rows[0]) return res.status(404).json({ success: false, message: 'Allocation not found' });
    if (!(await inClientScope(req.user, existing.rows[0].employee_id)))
      return res.status(403).json({ success: false, message: 'Access denied' });

    const { item_name, quantity, serial_no, remark, status } = req.body;
    const sets = [], vals = [];
    let i = 1;
    if (item_name !== undefined) { sets.push(`item_name = $${i++}`); vals.push(String(item_name).trim()); }
    if (quantity !== undefined)  { sets.push(`quantity = $${i++}`);  vals.push(Math.max(1, parseInt(quantity) || 1)); }
    if (serial_no !== undefined) { sets.push(`serial_no = $${i++}`); vals.push(serial_no ? String(serial_no).trim() : null); }
    if (remark !== undefined)    { sets.push(`remark = $${i++}`);    vals.push(remark ? String(remark).trim() : null); }
    if (status !== undefined) {
      const st = status === 'returned' ? 'returned' : 'allocated';
      sets.push(`status = $${i++}`); vals.push(st);
      sets.push(`returned_at = ${st === 'returned' ? 'now()' : 'NULL'}`);
    }
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to update' });
    sets.push(`updated_at = now()`);
    vals.push(id);
    const r = await db.query(`UPDATE asset_allocations SET ${sets.join(', ')} WHERE id = $${i} RETURNING *`, vals);
    res.json({ success: true, data: r.rows[0] });
  } catch (err) {
    console.error('[assets/update]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── DELETE /assets/:id ────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    await ensureSchema();
    if (!canManage(req.user)) return res.status(403).json({ success: false, message: 'Access denied' });
    const id = parseInt(req.params.id);
    const existing = await db.query('SELECT employee_id FROM asset_allocations WHERE id = $1', [id]);
    if (!existing.rows[0]) return res.status(404).json({ success: false, message: 'Allocation not found' });
    if (!(await inClientScope(req.user, existing.rows[0].employee_id)))
      return res.status(403).json({ success: false, message: 'Access denied' });
    await db.query('DELETE FROM asset_allocations WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (err) {
    console.error('[assets/remove]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
