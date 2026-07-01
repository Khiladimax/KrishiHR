// src/controllers/clientController.js
// Client Deployment Management — auto-creates clients table, CRUD, scoping
const db = require('../config/db');

// ── Auto-migration: runs on first require ─────────────────────────────────────
async function ensureSchema() {
  try {
    // 1. Create clients table
    await db.query(`
      CREATE TABLE IF NOT EXISTS clients (
        id            SERIAL PRIMARY KEY,
        name          VARCHAR(200) NOT NULL UNIQUE,
        admin_email   VARCHAR(200),
        admin_phone   VARCHAR(20),
        status        VARCHAR(20) DEFAULT 'active',
        notes         TEXT,
        created_at    TIMESTAMPTZ DEFAULT NOW(),
        updated_at    TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    // 2. Add client_id column to employees (NULL = own employee)
    await db.query(`
      ALTER TABLE employees ADD COLUMN IF NOT EXISTS client_id INT
        REFERENCES clients(id) ON DELETE SET NULL
    `);

    // 3. Add index for fast filtering
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_employees_client_id ON employees(client_id)
    `);

    // 4. Create client_payroll_cycles table
    await db.query(`
      CREATE TABLE IF NOT EXISTS client_payroll_cycles (
        id              SERIAL PRIMARY KEY,
        employee_id     INT NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
        cycle_month     INT  NOT NULL CHECK (cycle_month BETWEEN 1 AND 12),
        cycle_year      INT  NOT NULL,
        gross_salary    NUMERIC(12,2) NOT NULL DEFAULT 0,
        tds_amount      NUMERIC(12,2) NOT NULL DEFAULT 0,
        amount_payable  NUMERIC(12,2) NOT NULL DEFAULT 0,
        notes           TEXT,
        created_at      TIMESTAMPTZ DEFAULT NOW(),
        updated_at      TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (employee_id, cycle_month, cycle_year)
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_client_payroll_emp   ON client_payroll_cycles(employee_id)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_client_payroll_cycle ON client_payroll_cycles(cycle_year, cycle_month)`);

    console.log('✅ Client deployment schema ready');
  } catch (err) {
    console.error('⚠️  Client schema migration error:', err.message);
  }
}
ensureSchema();

// ── Helper: find or create client by name ──────────────────────────────────────
async function findOrCreateClient(clientName, txClient) {
  const q = txClient || db;
  const trimmed = clientName.trim();
  if (!trimmed) return null;

  // Check if exists (case-insensitive exact match)
  const existing = await q.query(
    `SELECT id, name FROM clients WHERE LOWER(name) = LOWER($1)`,
    [trimmed]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  // Auto-create
  const created = await q.query(
    `INSERT INTO clients (name) VALUES ($1) RETURNING id, name`,
    [trimmed]
  );
  console.log(`🏢 Auto-created client: "${trimmed}" (ID: ${created.rows[0].id})`);
  return created.rows[0].id;
}

// ── GET /api/clients — list all clients (admin only) ───────────────────────────
async function listClients(req, res) {
  try {
    // client_admin can only see their own client
    let query, params;
    if (req.user.role === 'client_admin') {
      query = `
        SELECT c.*, 
               COUNT(e.id) AS employee_count
        FROM clients c
        LEFT JOIN employees e ON e.client_id = c.id AND e.is_active = true
        WHERE c.id = $1
        GROUP BY c.id
        ORDER BY c.name
      `;
      params = [req.user.client_id];
    } else {
      query = `
        SELECT c.*, 
               COUNT(e.id) AS employee_count
        FROM clients c
        LEFT JOIN employees e ON e.client_id = c.id AND e.is_active = true
        GROUP BY c.id
        ORDER BY c.name
      `;
      params = [];
    }

    const result = await db.query(query, params);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('List clients error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── POST /api/clients — create a new client ────────────────────────────────────
async function createClient(req, res) {
  try {
    const { name, admin_email, admin_phone, notes } = req.body;
    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Client name is required' });
    }

    // Check duplicate
    const dup = await db.query(
      `SELECT id FROM clients WHERE LOWER(name) = LOWER($1)`, [name.trim()]
    );
    if (dup.rows.length > 0) {
      return res.status(409).json({ success: false, message: `Client "${name}" already exists` });
    }

    const result = await db.query(
      `INSERT INTO clients (name, admin_email, admin_phone, notes)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [name.trim(), admin_email || null, admin_phone || null, notes || null]
    );

    res.status(201).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error('Create client error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── PUT /api/clients/:id — update client details ───────────────────────────────
async function updateClient(req, res) {
  try {
    const { name, admin_email, admin_phone, status, notes } = req.body;
    const clientId = req.params.id;

    // Get current status to detect change
    const current = await db.query(`SELECT status FROM clients WHERE id=$1`, [clientId]);
    if (!current.rows.length)
      return res.status(404).json({ success: false, message: 'Client not found' });

    const prevStatus = current.rows[0].status;
    const newStatus  = status || prevStatus;

    const result = await db.query(
      `UPDATE clients SET
         name = COALESCE($1, name),
         admin_email = COALESCE($2, admin_email),
         admin_phone = COALESCE($3, admin_phone),
         status = COALESCE($4, status),
         notes = COALESCE($5, notes),
         updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [name, admin_email, admin_phone, status, notes, clientId]
    );

    // ── If status changed → bulk update all employees ─────────────────────────
    if (newStatus !== prevStatus) {
      const isActive = newStatus === 'active';
      await db.query(
        `UPDATE employees SET is_active=$1 WHERE client_id=$2`,
        [isActive, clientId]
      );
      console.log(`[Client] ${isActive ? 'Reactivated' : 'Deactivated'} all employees for client ${clientId}`);
    }

    res.json({
      success: true,
      data: result.rows[0],
      message: newStatus !== prevStatus
        ? `Client ${newStatus === 'active' ? 'activated' : 'deactivated'} — all employees updated`
        : 'Client updated'
    });
  } catch (err) {
    console.error('Update client error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── GET /api/clients/:id/employees — list employees for a client ───────────────
async function listClientEmployees(req, res) {
  try {
    const clientId = req.params.id;

    // client_admin can only see their own
    if (req.user.role === 'client_admin' && req.user.client_id != clientId) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }

    const result = await db.query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.email, e.phone,
              e.role, e.is_active, d.name AS department, des.title AS designation,
              e.joining_date
       FROM employees e
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       WHERE e.client_id = $1
       ORDER BY e.first_name, e.last_name`,
      [clientId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('List client employees error:', err);
    res.status(500).json({ success: false, message: err.message });
  }
}

// ── Middleware: scope queries for client_admin ──────────────────────────────────
// Adds client_id filter to req so all downstream controllers can use it
function clientScope(req, res, next) {
  if (req.user.role === 'client_admin') {
    if (!req.user.client_id) {
      return res.status(403).json({ 
        success: false, 
        message: 'Client admin account not linked to any client' 
      });
    }
    // Attach for downstream use
    req.clientScope = { client_id: req.user.client_id };
  } else {
    req.clientScope = null; // super admin sees all
  }
  next();
}

module.exports = {
  findOrCreateClient,
  listClients,
  createClient,
  updateClient,
  listClientEmployees,
  clientScope,
};
