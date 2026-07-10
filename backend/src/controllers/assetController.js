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

// Tab scoping: "main" = own-company staff (client_id IS NULL); "client" =
// deployed staff. A client_admin is always locked to their own client.
function scopeWhere(reqUser, scope, col) {
  if (reqUser.role === 'client_admin') return reqUser.client_id ? `${col} = ${parseInt(reqUser.client_id)}` : '1=0';
  return scope === 'client' ? `${col} IS NOT NULL` : `${col} IS NULL`;
}

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
    const scope = req.query.scope === 'client' ? 'client' : 'main';
    const cond  = scopeWhere(req.user, scope, 'client_id');
    const r = await db.query(
      `SELECT id, employee_code, first_name, last_name
         FROM employees WHERE is_active = true AND (${cond}) ORDER BY first_name ASC`);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[assets/getEmployees]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── GET /assets/all?scope=main|client — every allocation in the scope ─────────
exports.listAll = async (req, res) => {
  try {
    await ensureSchema();
    if (!canManage(req.user)) return res.status(403).json({ success: false, message: 'Access denied' });
    const scope = req.query.scope === 'client' ? 'client' : 'main';
    const cond  = scopeWhere(req.user, scope, 'e.client_id');
    const r = await db.query(
      `SELECT a.*, e.employee_code,
              CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS emp_name,
              CONCAT(b.first_name,' ',b.last_name) AS allocated_by_name
         FROM asset_allocations a
         JOIN employees e ON e.id = a.employee_id
         LEFT JOIN employees b ON b.id = a.allocated_by
        WHERE ${cond}
        ORDER BY e.employee_code, a.allocated_at DESC`);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error('[assets/listAll]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── GET /assets/matrix?scope=main|client — employees × items, count per cell ──
exports.matrix = async (req, res) => {
  try {
    await ensureSchema();
    if (!canManage(req.user)) return res.status(403).json({ success: false, message: 'Access denied' });
    const scope = req.query.scope === 'client' ? 'client' : 'main';

    const emps = await db.query(
      `SELECT id, employee_code, CONCAT(first_name,' ',COALESCE(last_name,'')) AS emp_name
         FROM employees
        WHERE is_active = true AND (${scopeWhere(req.user, scope, 'client_id')})
        ORDER BY employee_code`);

    // Currently-allocated (not returned) qty + serials per employee per item.
    const allocs = await db.query(
      `SELECT a.employee_id, a.item_name, SUM(a.quantity)::int AS qty,
              STRING_AGG(NULLIF(a.serial_no,''), ', ') AS serials
         FROM asset_allocations a
         JOIN employees e ON e.id = a.employee_id
        WHERE a.status = 'allocated' AND (${scopeWhere(req.user, scope, 'e.client_id')})
        GROUP BY a.employee_id, a.item_name`);

    // Columns: the catalogue first, then any custom item names that appear.
    const extra = [...new Set(allocs.rows.map(r => r.item_name).filter(n => !DEFAULT_ITEMS.includes(n)))];
    const items = [...DEFAULT_ITEMS, ...extra];

    const byEmp = {};
    allocs.rows.forEach(r => {
      (byEmp[r.employee_id] = byEmp[r.employee_id] || {})[r.item_name] = { qty: r.qty, serials: r.serials || '' };
    });
    const rows = emps.rows.map(e => ({
      employee_code: e.employee_code, emp_name: e.emp_name, counts: byEmp[e.id] || {},
    }));
    res.json({ success: true, items, rows });
  } catch (err) {
    console.error('[assets/matrix]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── GET /assets/export?scope=main|client — colourful Excel ────────────────────
exports.exportExcel = async (req, res) => {
  try {
    await ensureSchema();
    if (!canManage(req.user)) return res.status(403).json({ success: false, message: 'Access denied' });
    const scope = req.query.scope === 'client' ? 'client' : 'main';
    const cond  = scopeWhere(req.user, scope, 'e.client_id');
    const r = await db.query(
      `SELECT a.item_name, a.quantity, a.serial_no, a.remark, a.status, a.allocated_at,
              e.employee_code,
              CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS emp_name
         FROM asset_allocations a
         JOIN employees e ON e.id = a.employee_id
        WHERE ${cond}
        ORDER BY e.employee_code, a.allocated_at DESC`);

    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    wb.creator = 'KrishiHR';
    const ws = wb.addWorksheet('Asset Allocation');
    const HEADERS = ['S.No', 'Employee ID', 'Employee Name', 'Item', 'Qty', 'Serial / Asset Tag', 'Remark', 'Status', 'Date of Allotment'];
    const scopeLabel = scope === 'client' ? 'Client Employees' : 'Main (KCMS) Employees';

    // Title
    ws.mergeCells(1, 1, 1, HEADERS.length);
    const t = ws.getCell(1, 1);
    t.value = `KrishiHR — Asset Allocation | ${scopeLabel}`;
    t.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } };
    t.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 26;

    // Header row
    HEADERS.forEach((h, i) => {
      const c = ws.getCell(2, i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      c.border = { bottom: { style: 'thin', color: { argb: 'FFBBBBBB' } } };
    });
    ws.getRow(2).height = 20;
    [6, 14, 26, 30, 6, 20, 26, 12, 18].forEach((w, i) => { ws.getColumn(i + 1).width = w; });
    ws.views = [{ state: 'frozen', ySplit: 2 }];

    r.rows.forEach((row, idx) => {
      const rn = idx + 3;
      const alt = idx % 2 === 1;
      const bg = alt ? 'FFF1F8E9' : 'FFFFFFFF';
      const vals = [
        idx + 1, row.employee_code, row.emp_name, row.item_name, row.quantity,
        row.serial_no || '', row.remark || '',
        row.status === 'returned' ? 'Returned' : 'Allocated',
        row.allocated_at ? new Date(row.allocated_at).toLocaleDateString('en-IN') : '',
      ];
      vals.forEach((v, i) => {
        const c = ws.getCell(rn, i + 1);
        c.value = v;
        c.font = { size: 10 };
        c.alignment = { vertical: 'middle', horizontal: (i === 0 || i === 4) ? 'center' : 'left' };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        c.border = { bottom: { style: 'hair', color: { argb: 'FFDDDDDD' } } };
      });
      // Colour the Status cell
      const sc = ws.getCell(rn, 8);
      const returned = row.status === 'returned';
      sc.font = { size: 10, bold: true, color: { argb: returned ? 'FFE65100' : 'FF2E7D32' } };
      sc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: returned ? 'FFFFF3E0' : 'FFE8F5E9' } };
      sc.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    const buf = await wb.xlsx.writeBuffer();
    const fname = `Asset_Allocation_${scope === 'client' ? 'Client' : 'Main'}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}"`);
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('[assets/exportExcel]', err.message);
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
