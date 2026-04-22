// src/controllers/employeeController.js
// UPDATED: provision/contractual/permanent support + dual employee code series
// KC10000+  -> permanent & provision employees
// Cont0001+ -> contractual employees
const bcrypt = require('bcryptjs');

// ── IST-safe date formatter ───────────────────────────────────────────────────
// Server runs on Render (UTC). toISOString() gives wrong date for IST users
// after 18:30 IST (midnight UTC). Always use this instead of toISOString().
function toISTDateString(date) {
  if (!date) return null;
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date(date)); // returns "YYYY-MM-DD" in IST
}
const { getEmployeeRegion } = require('../config/regionHelper');
const db = require('../config/db');

// Auto-generate employee code
async function generateEmployeeCode(client, employeeCategory) {
  const isContractual = (employeeCategory || '').toLowerCase() === 'contractual';
  if (isContractual) {
    const res = await client.query(
      `SELECT employee_code FROM employees WHERE employee_code ILIKE 'Cont%' ORDER BY id DESC LIMIT 1`
    );
    let nextNum = 1;
    if (res.rows.length) {
      const m = res.rows[0].employee_code.match(/\d+/);
      if (m) nextNum = parseInt(m[0]) + 1;
    }
    return `Cont${String(nextNum).padStart(4, '0')}`;
  } else {
    const res = await client.query(
      `SELECT employee_code FROM employees WHERE employee_code ILIKE 'KC%' ORDER BY id DESC LIMIT 1`
    );
    let nextNum = 10000;
    if (res.rows.length) {
      const m = res.rows[0].employee_code.match(/\d+/);
      if (m) nextNum = Math.max(parseInt(m[0]) + 1, 10000);
    }
    return `KC${nextNum}`;
  }
}

// Get All (role-filtered)
exports.getAll = async (req, res) => {
  try {
    const { department_id, search, role: filterRole, is_active, employee_category } = req.query;
    const userRole = req.user.role;
    const userId   = req.user.id;

    let conditions = [];
    let params = [];
    let idx = 1;

    if (is_active === 'false') {
      // Separated tab: deactivated OR completed-separation (even if LWD is future)
      conditions.push("(e.is_active = false OR EXISTS (SELECT 1 FROM separations sep WHERE sep.employee_id = e.id AND sep.status = 'completed'))");
    } else {
      // Directory tab: active only, exclude completed-separation employees
      conditions.push("(e.is_active = true AND NOT EXISTS (SELECT 1 FROM separations sep WHERE sep.employee_id = e.id AND sep.status = 'completed'))");
    }

    if (userRole === 'manager') {
      conditions.push(`e.department_id = (SELECT department_id FROM employees WHERE id=$${idx++})`);
      params.push(userId);
    } else if (userRole === 'tl') {
      conditions.push(`(e.team_leader_id=$${idx} OR e.id=$${idx})`);
      params.push(userId); idx++;
    } else if (userRole === 'employee') {
      conditions.push(`e.id=$${idx++}`);
      params.push(userId);
    }

    if (department_id)     { conditions.push(`e.department_id=$${idx++}`);    params.push(parseInt(department_id)); }
    if (filterRole)        { conditions.push(`e.role=$${idx++}`);              params.push(filterRole); }
    if (employee_category) { conditions.push(`e.employee_category=$${idx++}`); params.push(employee_category); }
    if (search) {
      conditions.push(
        `(LOWER(CONCAT(e.first_name,' ',e.last_name)) LIKE LOWER($${idx})
          OR LOWER(e.email)         LIKE LOWER($${idx})
          OR LOWER(e.employee_code) LIKE LOWER($${idx})
          OR e.phone LIKE $${idx})`
      );
      params.push(`%${search}%`); idx++;
    }

    const result = await db.query(
      `SELECT
         e.id, e.employee_code, e.first_name, e.last_name, e.email, e.phone,
         e.gender, e.joining_date, e.role, e.is_active, e.employment_type,
         e.employee_category, e.provision_end_date, e.confirmed_date,
         e.saturday_policy,
         e.department_id, e.designation_id, e.reporting_manager_id, e.team_leader_id,
         e.basic_salary, e.ctc, e.city,
         e.separation_date, e.separation_type, e.separation_reason,
         sep_active.last_working_date AS sep_last_working_date,
         d.name   AS department_name,
         des.title AS designation_title,
         CONCAT(m.first_name,' ',m.last_name)   AS manager_name,
         CONCAT(tl.first_name,' ',tl.last_name) AS team_leader_name,
         pc.overall_status AS confirmation_status,
         e.provision_end_date - CURRENT_DATE    AS days_to_confirmation
       FROM employees e
       LEFT JOIN departments  d   ON e.department_id  = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       LEFT JOIN employees    m   ON e.reporting_manager_id = m.id
       LEFT JOIN employees    tl  ON e.team_leader_id  = tl.id
       LEFT JOIN provision_confirmations pc ON pc.employee_id = e.id
       LEFT JOIN separations sep_active ON sep_active.employee_id = e.id AND sep_active.status = 'completed'
       WHERE ${conditions.join(' AND ')}
       ORDER BY d.name, e.first_name`,
      params
    );
    res.json({ success: true, data: result.rows, total: result.rows.length });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Get One
exports.getOne = async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    const role     = req.user.role;
    const userId   = req.user.id;

    if (role === 'employee' && targetId !== userId)
      return res.status(403).json({ success: false, message: 'Access denied' });

    const result = await db.query(
      `SELECT e.*,
         d.name AS department_name, des.title AS designation_title,
         CONCAT(m.first_name,' ',m.last_name)   AS manager_name,
         CONCAT(tl.first_name,' ',tl.last_name) AS team_leader_name,
         pc.overall_status AS confirmation_status,
         pc.manager_status, pc.hr_status, pc.initiated_at, pc.confirmed_at
       FROM employees e
       LEFT JOIN departments  d   ON e.department_id  = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       LEFT JOIN employees    m   ON e.reporting_manager_id = m.id
       LEFT JOIN employees    tl  ON e.team_leader_id  = tl.id
       LEFT JOIN provision_confirmations pc ON pc.employee_id = e.id
       WHERE e.id=$1`,
      [targetId]
    );

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: 'Employee not found' });

    const emp = result.rows[0];
    if (!['admin','super_admin','hr'].includes(role) && targetId !== userId) {
      delete emp.password_hash; delete emp.pan_number;
      delete emp.aadhar_number; delete emp.bank_account;
      delete emp.bank_ifsc;     delete emp.uan_number;
    } else {
      delete emp.password_hash;
    }

    res.json({ success: true, data: emp });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Create — Supports employee_category: permanent | provision | contractual
exports.create = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const {
      employee_code, first_name, last_name = '', email, phone, gender,
      date_of_birth, joining_date, department_id, designation_id,
      reporting_manager_id, team_leader_id, role = 'employee',
      employment_type = 'Full-Time',
      employee_category = 'permanent',
      password,
      basic_salary = 0, hra = 0, special_allowance = 0, travel_allowance = 0, ctc = 0,
      pan_number, aadhar_number, bank_name, bank_account, bank_ifsc, bank_branch,
      address_line1, city, state, pincode, blood_group, level
    } = req.body;

    if (!first_name || !email)
      return res.status(400).json({ success: false, message: 'first_name and email are required' });

    const validCats = ['permanent', 'provision', 'contractual'];
    if (!validCats.includes(employee_category))
      return res.status(400).json({ success: false, message: `employee_category must be: ${validCats.join(', ')}` });

    const finalCode = employee_code || await generateEmployeeCode(client, employee_category);

    const jDate = joining_date ? new Date(joining_date) : new Date();
    let provisionEndDate = null;
    if (employee_category === 'provision') {
      const pe = new Date(jDate);
      pe.setMonth(pe.getMonth() + 6);
      provisionEndDate = toISTDateString(pe); // FIX: IST instead of UTC
    }

    const pwHash = await bcrypt.hash(password || finalCode, 10);

    const result = await client.query(
      `INSERT INTO employees (
         employee_code, first_name, last_name, email, phone, gender,
         date_of_birth, joining_date, department_id, designation_id,
         reporting_manager_id, team_leader_id, role, password_hash,
         employment_type, employee_category, provision_end_date,
         basic_salary, hra, special_allowance, travel_allowance, ctc,
         pan_number, aadhar_number, bank_name, bank_account, bank_ifsc, bank_branch,
         address_line1, city, state, pincode, blood_group, level, is_active, saturday_policy
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
                 $18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,true,$35)
       RETURNING id, employee_code, first_name, last_name, email, role, employee_category, provision_end_date`,
      [finalCode, first_name, last_name, email, phone||null, gender||null,
       date_of_birth||null, toISTDateString(jDate), // FIX: IST instead of UTC
       department_id||null, designation_id||null,
       reporting_manager_id||null, team_leader_id||null,
       role, pwHash, employment_type||'Full-Time', employee_category, provisionEndDate,
       basic_salary||0, hra||0, special_allowance||0, travel_allowance||0, ctc||0,
       pan_number||null, aadhar_number||null,
       bank_name||null, bank_account||null, bank_ifsc||null, bank_branch||null,
       address_line1||null, city||null, state||null, pincode||null, blood_group||null, level||null,
       req.body.saturday_policy || '2nd_4th_off']
    );

    const newEmp = result.rows[0];
    const yr = new Date().getFullYear();

    // Auto-seed leave balances based on joining date and category
    // Rule: < 6 months from today → PL=6 (all categories)
    //       >= 6 months → EL=18, CL=6, SL=6 (permanent & contractual confirmed)
    //       provision category still on provision period → PL=6 only
    {
      const today = new Date();
      const sixMonthMark = new Date(jDate);
      sixMonthMark.setMonth(sixMonthMark.getMonth() + 6);
      const isUnderSixMonths = today < sixMonthMark;

      const ltRes = await client.query(
        `SELECT id, code FROM leave_types WHERE is_active=true AND code IN ('EL','CL','SL','PL','LWP','OD')`
      );
      const ltMap = {};
      for (const lt of ltRes.rows) ltMap[lt.code] = lt.id;

      if (isUnderSixMonths || employee_category === 'provision') {
        // PL = 6 upfront, no EL/CL/SL yet
        if (ltMap['PL']) {
          await client.query(
            `INSERT INTO leave_balances(employee_id,leave_type_id,year,allocated,used,pending,carry_forward)
             VALUES($1,$2,$3,6,0,0,0) ON CONFLICT DO NOTHING`,
            [newEmp.id, ltMap['PL'], yr]
          );
        }
      } else {
        // >= 6 months: full EL/CL/SL
        const allocations = { EL: 18, CL: 6, SL: 6 };
        for (const [code, alloc] of Object.entries(allocations)) {
          if (ltMap[code]) {
            await client.query(
              `INSERT INTO leave_balances(employee_id,leave_type_id,year,allocated,used,pending,carry_forward)
               VALUES($1,$2,$3,$4,0,0,0) ON CONFLICT DO NOTHING`,
              [newEmp.id, ltMap[code], yr, alloc]
            );
          }
        }
      }
    }

    await client.query('COMMIT');

    // Send welcome email to new employee (async, don't block response)
    const emailSvc = require('../config/emailService');
    emailSvc.notifyNewEmployee(newEmp.id, password || finalCode).catch(console.error);

    res.status(201).json({
      success: true,
      message: `${employee_category.charAt(0).toUpperCase()+employee_category.slice(1)} employee created. Code: ${finalCode}`,
      data: { ...newEmp, auto_generated_code: !employee_code }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    if (err.code === '23505')
      return res.status(400).json({ success: false, message: 'Employee code or email already exists' });
    res.status(500).json({ success: false, message: 'Server error' });
  } finally { client.release(); }
};

// Update
exports.update = async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const allowed = [
      'first_name','last_name','email','phone','alternate_phone',
      'gender','date_of_birth','blood_group','marital_status',
      'joining_date','department_id','designation_id','reporting_manager_id','team_leader_id',
      'role','employment_type','employee_category','provision_end_date','confirmed_date',
      'basic_salary','hra','special_allowance','gratuity','conveyance','travel_allowance','ctc',
      'pan_number','aadhar_number','uan_number','pf_number',
      'bank_name','bank_account','bank_ifsc','bank_branch',
      'address_line1','city','state','pincode',
      'probation_end_date','exit_date','notes',
      'is_active','is_wfh_permanent','level','saturday_policy'
    ];

    const sets = [], params = []; let idx = 1;
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        sets.push(`${key}=$${idx++}`);
        params.push(req.body[key] === '' ? null : req.body[key]);
      }
    }

    if (req.body.password) {
      sets.push(`password_hash=$${idx++}`);
      params.push(await bcrypt.hash(req.body.password, 10));
    }

    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to update' });

    sets.push(`updated_at=NOW()`);
    params.push(id);
    await db.query(`UPDATE employees SET ${sets.join(',')} WHERE id=$${idx}`, params);
    res.json({ success: true, message: 'Employee updated' });
  } catch (err) {
    console.error('[update employee error]', err.message, err.detail || '');
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  }
};

// Reset Password
exports.resetPassword = async (req, res) => {
  try {
    const { employee_id, new_password = 'Admin@1234' } = req.body;
    const hash = await bcrypt.hash(new_password, 10);
    await db.query(`UPDATE employees SET password_hash=$1 WHERE id=$2`, [hash, employee_id]);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Preview next auto-generated employee code (for HR UI)
exports.previewNextCode = async (req, res) => {
  try {
    const { employee_category = 'permanent' } = req.query;
    const client = await db.getClient();
    try {
      const code = await generateEmployeeCode(client, employee_category);
      res.json({ success: true, data: { next_code: code, category: employee_category } });
    } finally { client.release(); }
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// Export Employees to Excel
exports.exportExcel = async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const result = await db.query(
      `SELECT
         e.employee_code, e.first_name, e.last_name, e.email, e.phone,
         e.gender, e.date_of_birth, e.joining_date,
         d.name AS department, des.title AS designation,
         e.role, e.employment_type, e.employee_category, e.level,
         e.basic_salary, e.ctc,
         e.pan_number, e.aadhar_number, e.uan_number, e.pf_number,
         e.bank_name, e.bank_account, e.bank_ifsc,
         e.city, e.state,
         CONCAT(m.first_name,' ',m.last_name) AS reporting_manager,
         e.is_active
       FROM employees e
       LEFT JOIN departments  d   ON e.department_id  = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       LEFT JOIN employees    m   ON e.reporting_manager_id = m.id
       WHERE e.is_active = true
       ORDER BY d.name, e.first_name`
    );

    const rows = result.rows.map(r => ({
      'Employee Code':     r.employee_code,
      'First Name':        r.first_name,
      'Last Name':         r.last_name || '',
      'Email':             r.email,
      'Phone':             r.phone || '',
      'Gender':            r.gender || '',
      'Date of Birth':     r.date_of_birth ? toISTDateString(r.date_of_birth) : '',
      'Date of Joining':   r.joining_date  ? toISTDateString(r.joining_date)  : '',
      'Department':        r.department || '',
      'Designation':       r.designation || '',
      'Role':              r.role,
      'Employment Type':   r.employment_type || '',
      'Category':          r.employee_category || '',
      'Level':             r.level || '',
      'Basic Salary':      r.basic_salary || 0,
      'CTC Annual':        r.ctc || 0,
      'PAN Number':        r.pan_number || '',
      'Aadhar Number':     r.aadhar_number || '',
      'UAN Number':        r.uan_number || '',
      'PF Number':         r.pf_number || '',
      'Bank Name':         r.bank_name || '',
      'Bank Account':      r.bank_account || '',
      'Bank IFSC':         r.bank_ifsc || '',
      'City':              r.city || '',
      'State':             r.state || '',
      'Reporting Manager': r.reporting_manager || '',
    }));

    const wb  = XLSX.utils.book_new();
    const ws  = XLSX.utils.json_to_sheet(rows);

    // Column widths
    ws['!cols'] = [
      {wch:14},{wch:16},{wch:16},{wch:28},{wch:14},
      {wch:8}, {wch:14},{wch:14},{wch:16},{wch:24},
      {wch:12},{wch:14},{wch:12},{wch:8}, {wch:13},
      {wch:13},{wch:14},{wch:16},{wch:14},{wch:18},
      {wch:20},{wch:20},{wch:13},{wch:14},{wch:16},{wch:20},
    ];

    XLSX.utils.book_append_sheet(wb, ws, 'Employees');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const today = toISTDateString(new Date()); // FIX: IST instead of UTC
    res.setHeader('Content-Disposition', `attachment; filename="employees_${today}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Export failed' });
  }
};

// Master Excel Export — All employees + their attendance for selected month
exports.exportMasterExcel = async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const { month, year } = req.query;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year)  || new Date().getFullYear();
    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    // ── 1. Employees + salary structure ─────────────────────────────────────
    const empResult = await db.query(`
      SELECT e.id, e.employee_code, e.first_name, e.last_name, e.email, e.phone,
             e.gender, e.date_of_birth, e.joining_date,
             d.name AS department, des.title AS designation,
             e.role, e.employment_type, e.employee_category, e.level,
             e.city, e.state,
             COALESCE(e.saturday_policy, '2nd_4th_off') AS saturday_policy,
             e.pan_number, e.aadhar_number, e.uan_number, e.pf_number,
             e.bank_name, e.bank_account, e.bank_ifsc,
             CONCAT(m.first_name,' ',m.last_name) AS reporting_manager,
             COALESCE(s.basic,e.basic_salary,0)         AS basic,
             COALESCE(s.hra,e.hra,0)                    AS hra,
             COALESCE(s.conveyance,e.conveyance,0)      AS conveyance,
             COALESCE(s.special_allowance,e.special_allowance,0) AS special_allowance,
             COALESCE(s.gratuity,0)                     AS gratuity,
             COALESCE(s.gross_salary,0)                 AS gross_salary,
             COALESCE(s.pf_employee,0)                  AS pf_employee,
             COALESCE(s.pf_employer,0)                  AS pf_employer,
             COALESCE(s.pf_admin,0)                     AS pf_admin,
             COALESCE(s.esi_employee,0)                 AS esi_employee,
             COALESCE(s.esi_employer,0)                 AS esi_employer,
             COALESCE(s.professional_tax,0)             AS professional_tax,
             COALESCE(s.lwf,0)                          AS lwf,
             COALESCE(s.tds,0)                          AS tds,
             COALESCE(s.total_deductions,0)             AS total_deductions,
             COALESCE(s.net_salary,0)                   AS net_salary,
             COALESCE(s.ctc_monthly,0)                  AS ctc_monthly,
             COALESCE(s.ctc_annual,e.ctc,0)             AS ctc_annual
      FROM employees e
      LEFT JOIN departments  d   ON e.department_id  = d.id
      LEFT JOIN designations des ON e.designation_id = des.id
      LEFT JOIN employees    m   ON e.reporting_manager_id = m.id
      LEFT JOIN employee_salary_structure s ON s.employee_id = e.id
      WHERE (
        e.is_active = true
        OR (
          -- Include employees who separated but were active during the export month
          e.separation_date IS NOT NULL
          AND e.separation_date >= MAKE_DATE($1::int, $2::int, 1)
        )
        OR (
          -- Include future-LWD completed separations
          EXISTS (
            SELECT 1 FROM separations sep
            WHERE sep.employee_id = e.id AND sep.status = 'completed'
            AND sep.last_working_date >= MAKE_DATE($1::int, $2::int, 1)
          )
        )
      )
      ORDER BY d.name, e.first_name`, [y, m]);
    const employees = empResult.rows;

    // ── 2. Attendance for the month ─────────────────────────────────────────
    const attResult = await db.query(`
      SELECT employee_id, TO_CHAR(date, 'YYYY-MM-DD') AS date_str, status, working_hours,
             punch_in, punch_out
      FROM attendance
      WHERE EXTRACT(MONTH FROM date) = $1 AND EXTRACT(YEAR FROM date) = $2`,
      [m, y]);

    const attMap = {};
    const punchMap = {}; // For punch-in/out counts per employee
    for (const row of attResult.rows) {
      if (!attMap[row.employee_id]) attMap[row.employee_id] = {};
      attMap[row.employee_id][row.date_str] = row.status;
      if (!punchMap[row.employee_id]) punchMap[row.employee_id] = { punchIn: 0, punchOut: 0, missingPunchOut: 0 };
      if (row.punch_in)  punchMap[row.employee_id].punchIn++;
      if (row.punch_out) punchMap[row.employee_id].punchOut++;
      if (row.punch_in && !row.punch_out) punchMap[row.employee_id].missingPunchOut++;
    }

    const daysInMonth = new Date(y, m, 0).getDate();

    // ── Holidays for this month (both regions) — used in Sheet 1 + Sheet 2 ──
    const holResult = await db.query(`
      SELECT TO_CHAR(date,'YYYY-MM-DD') AS date_str, region
      FROM holidays
      WHERE EXTRACT(MONTH FROM date) = $1 AND EXTRACT(YEAR FROM date) = $2`,
      [m, y]);
    const holidaysByRegion = { all: new Set(), north: new Set(), south_west: new Set() };
    for (const h of holResult.rows) {
      if (h.region === 'all') { holidaysByRegion.all.add(h.date_str); holidaysByRegion.north.add(h.date_str); holidaysByRegion.south_west.add(h.date_str); }
      else if (h.region === 'north') holidaysByRegion.north.add(h.date_str);
      else if (h.region === 'south_west') holidaysByRegion.south_west.add(h.date_str);
    }

    // ── Status → display label & color ──────────────────────────────────────
    const STATUS_STYLE = {
      'present':     { label: 'P',    bg: '00C853', fg: 'FFFFFF' }, // green
      'late':        { label: 'L',    bg: 'FFD600', fg: '000000' }, // yellow
      'absent':      { label: 'A',    bg: 'D50000', fg: 'FFFFFF' }, // red
      'missing_punch_out': { label: 'MPO', bg: 'FF6F00', fg: 'FFFFFF' }, // amber — punched in, no punch out
      'on-leave':    { label: 'EL',   bg: '2962FF', fg: 'FFFFFF' }, // blue
      'lwp':         { label: 'LWP',  bg: 'FF6D00', fg: 'FFFFFF' }, // orange
      'half-day':    { label: 'H',    bg: 'AA00FF', fg: 'FFFFFF' }, // purple
      'h-el':        { label: 'H-EL', bg: '7B1FA2', fg: 'FFFFFF' }, // dark purple
      'h-cl':        { label: 'H-CL', bg: '880E4F', fg: 'FFFFFF' }, // pink-purple
      'h-sl':        { label: 'H-SL', bg: 'AD1457', fg: 'FFFFFF' }, // pink
      'h-lwp':       { label: 'H-LWP',bg: 'BF360C', fg: 'FFFFFF' }, // dark orange
      'h-wfh':       { label: 'H-WFH',bg: '00897B', fg: 'FFFFFF' }, // teal
      'od':          { label: 'OD',   bg: '00BCD4', fg: 'FFFFFF' }, // cyan
      'wfh':         { label: 'WFH',  bg: '80CBC4', fg: '000000' }, // teal
      'regularized': { label: 'R',    bg: '558B2F', fg: 'FFFFFF' }, // dark green
      'holiday':     { label: 'HOL',  bg: 'CFD8DC', fg: '37474F' }, // grey
      'weekend':     { label: 'WO',   bg: 'ECEFF1', fg: '90A4AE' }, // light grey
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'KrishiHR';
    wb.created = new Date();

    // ════════════════════════════════════════════════════════════════════════
    // SHEET 1 — ATTENDANCE REGISTER
    // ════════════════════════════════════════════════════════════════════════
    const ws1 = wb.addWorksheet(`Attendance ${MONTH_NAMES[m-1]} ${y}`, {
      views: [{ state: 'frozen', xSplit: 5, ySplit: 2 }]
    });

    // ── Header row 1: Title ─────────────────────────────────────────────────
    const totalCols = 5 + daysInMonth + 9; // info + days + totals (9 summary cols)
    ws1.mergeCells(1, 1, 1, totalCols);
    const titleCell = ws1.getCell(1, 1);
    titleCell.value = `KrishiHR — Attendance Register | ${MONTH_NAMES[m-1]} ${y}`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws1.getRow(1).height = 28;

    // ── Header row 2: Columns ───────────────────────────────────────────────
    const infoHeaders = ['Emp Code', 'Name', 'Department', 'Designation', 'Category'];
    const headerFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
    const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    const headerAlign = { horizontal: 'center', vertical: 'middle', wrapText: true };

    infoHeaders.forEach((h, i) => {
      const cell = ws1.getCell(2, i + 1);
      cell.value = h;
      cell.font = headerFont;
      cell.fill = headerFill;
      cell.alignment = headerAlign;
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
    });

    // Day headers with day-of-week
    const dayNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    let satCountHdr = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(y, m - 1, d).getDay();
      if (dow === 6) satCountHdr++;
      const isSunday = dow === 0;
      const is2nd4thSat = dow === 6 && (satCountHdr === 2 || satCountHdr === 4);
      const isWeekOff = isSunday || is2nd4thSat;
      const cell = ws1.getCell(2, 5 + d);
      cell.value = `${d}\n${dayNames[dow]}`;
      cell.font = { bold: true, size: 9, color: { argb: isWeekOff ? 'FFFF1744' : 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isWeekOff ? 'FF880E4F' : 'FF2E7D32' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
    }

    // Total headers
    [
      { h: 'Paid Leave',      bg: 'FF2E7D32' },
      { h: 'Unpaid Leave',    bg: 'FFC62828' },
      { h: 'Paid Half Day',   bg: 'FF6A1B9A' },
      { h: 'Unpaid Half Day', bg: 'FFE65100' },
      { h: 'Total Paid',      bg: 'FF1565C0' },
      { h: 'Total Unpaid',    bg: 'FF880E4F' },
      { h: 'Total Absent',    bg: 'FFD50000' },
      { h: 'Late',            bg: 'FFF57F17' },
      { h: 'Total Present',   bg: 'FF00695C' },
    ].forEach(({ h, bg }, i) => {
      const cell = ws1.getCell(2, 5 + daysInMonth + 1 + i);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 8 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    ws1.getRow(2).height = 30;

    // ── Data rows ───────────────────────────────────────────────────────────
    employees.forEach((e, ri) => {
      const row = ri + 3;
      const isAlt = ri % 2 === 1;
      const rowBg = isAlt ? 'FFF1F8E9' : 'FFFFFFFF';

      // Info cells
      [e.employee_code, `${e.first_name} ${e.last_name||''}`.trim(),
       e.department||'', e.designation||'', e.employee_category||''].forEach((v, ci) => {
        const cell = ws1.getCell(row, ci + 1);
        cell.value = v;
        cell.font = { size: 9 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isAlt ? 'FFE8F5E9' : 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle', wrapText: false };
        cell.border = { right: { style: 'hair' }, bottom: { style: 'hair' } };
      });

      // Attendance cells
      let attPaidLeave = 0, attUnpaidLeave = 0, attPaidHalfDay = 0, attUnpaidHalfDay = 0;
      let attLate = 0, attAbsent = 0, attPresent = 0;
      let satCountRow = 0;
      const empIsOffsite = e.saturday_policy === 'all_working';
      // Determine this employee's regional holiday set for correct HOL display
      const empRegForSheet = getEmployeeRegion(e.city || '', e.state || '');
      const empHolSetForSheet = empRegForSheet === 'north' ? holidaysByRegion.north : holidaysByRegion.south_west;
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const dow = new Date(y, m - 1, d).getDay();
        const isSunday = dow === 0;
        if (dow === 6) satCountRow++;
        const is2nd4thSat = !empIsOffsite && dow === 6 && (satCountRow === 2 || satCountRow === 4);
        const isWeekOff = isSunday || is2nd4thSat;

        // FIX: Show HOL for regional holidays if no attendance record overrides it
        let status;
        if (isWeekOff) {
          status = 'weekend';
        } else if (empHolSetForSheet.has(dateStr) && !((attMap[e.id] || {})[dateStr])) {
          status = 'holiday'; // Employee has a regional holiday — show HOL (was showing blank/black before)
        } else {
          status = (attMap[e.id] || {})[dateStr] || '';
        }

        const style = STATUS_STYLE[status] || { label: '', bg: isAlt ? 'F1F8E9' : 'FFFFFF', fg: '000000' };

        const cell = ws1.getCell(row, 5 + d);
        cell.value = style.label;
        cell.font = { bold: true, size: 8, color: { argb: 'FF' + style.fg } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + style.bg } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { right: { style: 'hair' }, bottom: { style: 'hair' } };

        if (!isWeekOff) {
          if (['present','regularized','od','wfh','holiday'].includes(status)) {
            // Fully paid work / holiday
            attPresent++;
          } else if (status === 'late') {
            // Late = present + mark late
            attPresent++; attLate++;
          } else if (status === 'on-leave') {
            // Full paid leave (EL/CL/SL with balance)
            attPaidLeave++; attPresent++;
          } else if (['half-day','h-el','h-cl','h-sl','h-wfh'].includes(status)) {
            // Paid half day — leave balance used for 0.5, worked 0.5
            attPaidHalfDay++; attPresent++;
          } else if (status === 'h-lwp') {
            // Unpaid half day — worked 0.5, LWP 0.5
            attUnpaidHalfDay++;
          } else if (status === 'lwp') {
            // Full unpaid leave / LWP
            attUnpaidLeave++;
          } else if (status === 'absent') {
            attAbsent++;
          }
        }
      }

      const attTotalPaid   = attPresent;   // present + paid leaves + paid half days already counted in attPresent
      const attTotalUnpaid = attUnpaidLeave + attUnpaidHalfDay;

      // Totals — 9 summary columns
      [
        [attPaidLeave,     'FF2E7D32'],
        [attUnpaidLeave,   'FFC62828'],
        [attPaidHalfDay,   'FF6A1B9A'],
        [attUnpaidHalfDay, 'FFE65100'],
        [attTotalPaid,     'FF1565C0'],
        [attTotalUnpaid,   'FF880E4F'],
        [attAbsent,        'FFD50000'],
        [attLate,          'FFF57F17'],
        [attPresent,       'FF00695C'],
      ].forEach(([v, color], i) => {
        const cell = ws1.getCell(row, 5 + daysInMonth + 1 + i);
        cell.value = v;
        cell.font = { bold: true, size: 9, color: { argb: color } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isAlt ? 'FFE3F2FD' : 'FFFFFFFF' } };
        cell.border = { right: { style: 'thin' }, bottom: { style: 'hair' } };
      });

      ws1.getRow(row).height = 18;
    });

    // Column widths — attendance sheet
    ws1.getColumn(1).width = 10;
    ws1.getColumn(2).width = 20;
    ws1.getColumn(3).width = 14;
    ws1.getColumn(4).width = 20;
    ws1.getColumn(5).width = 12;
    for (let d = 1; d <= daysInMonth; d++) ws1.getColumn(5 + d).width = 5;
    for (let i = 1; i <= 9; i++) ws1.getColumn(5 + daysInMonth + i).width = 10;

    // ── Legend row ──────────────────────────────────────────────────────────
    const legendRow = employees.length + 4;
    ws1.mergeCells(legendRow, 1, legendRow, totalCols);
    const legendCell = ws1.getCell(legendRow, 1);
    legendCell.value = 'LEGEND:  P=Present  A=Absent  L=Late  EL=Paid Leave (CL/SL/EL) — counts as Present for salary  LWP=Unpaid Leave  H=Half Day  H-EL=Half EL  H-CL=Half CL  H-SL=Half SL  H-LWP=Half LWP (Unpaid)  H-WFH=Half WFH  OD=On Duty  WFH=Work From Home  R=Regularized  WO=Week Off  HOL=Holiday';
    legendCell.font = { italic: true, size: 8, color: { argb: 'FF37474F' } };
    legendCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECEFF1' } };
    legendCell.alignment = { horizontal: 'left', vertical: 'middle' };
    ws1.getRow(legendRow).height = 16;

    // ════════════════════════════════════════════════════════════════════════
    // SHEET 2 — SALARY BREAKUP
    // ════════════════════════════════════════════════════════════════════════
    const ws2 = wb.addWorksheet('Salary Breakup', {
      views: [{ state: 'frozen', xSplit: 4, ySplit: 2 }]
    });

    // Title
    const salCols = 32;
    ws2.mergeCells(1, 1, 1, salCols);
    const salTitle = ws2.getCell(1, 1);
    salTitle.value = `KrishiHR — Salary Breakup | ${MONTH_NAMES[m-1]} ${y}`;
    salTitle.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    salTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D47A1' } };
    salTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    ws2.getRow(1).height = 28;

    // Group headers
    const groups = [
      { label: 'EMPLOYEE INFO',          cols: 4,  color: 'FF1565C0' },
      { label: 'EARNINGS',               cols: 6,  color: 'FF2E7D32' },
      { label: 'EMPLOYEE DEDUCTIONS',    cols: 6,  color: 'FFC62828' },
      { label: 'EMPLOYER CONTRIBUTIONS', cols: 4,  color: 'FF6A1B9A' },
      { label: 'ATTENDANCE & TOTALS',    cols: 14, color: 'FF37474F' },
    ];
    let colOffset = 1;
    groups.forEach(g => {
      ws2.mergeCells(2, colOffset, 2, colOffset + g.cols - 1);
      const cell = ws2.getCell(2, colOffset);
      cell.value = g.label;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: g.color } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
      colOffset += g.cols;
    });
    ws2.getRow(2).height = 22;

    // salHeaders column headers (holidaysByRegion already fetched above for Sheet 1)

    // Fetch active advance EMIs for this month
    const advResult = await db.query(`
      SELECT employee_id, SUM(monthly_emi) AS total_emi
      FROM advance_salary
      WHERE status IN ('approved')
        AND auto_deduct = TRUE
        AND (
          (emi_start_year < $2) OR
          (emi_start_year = $2 AND emi_start_month <= $1)
        )
        AND (
          (emi_end_year > $2) OR
          (emi_end_year = $2 AND emi_end_month >= $1) OR
          (emi_end_year IS NULL)
        )
        AND balance_remaining > 0
      GROUP BY employee_id`,
      [m, y]);

    const emiMap = {};
    for (const row of advResult.rows) {
      emiMap[row.employee_id] = parseFloat(row.total_emi) || 0;
    }

    const salHeaders = [
      // EMPLOYEE INFO (4)
      'Emp Code','Name','Department','Designation',
      // EARNINGS (6)
      'Basic','HRA','Conveyance','Special Allow','Gratuity','Gross Salary',
      // EMPLOYEE DEDUCTIONS (6): PF, ESI, PT, TDS, Advance EMI, Total
      'PF (Emp)','ESI (Emp)','Prof Tax','TDS','Advance EMI','Total Deductions',
      // EMPLOYER CONTRIBUTIONS (4)
      'PF (Employer)','ESI (Employer)','PF Admin','Total Employer Cost',
      // ATTENDANCE & TOTALS (14)
      'Paid Leave','Unpaid Leave','Paid Half Day','Unpaid Half Day',
      'Present Days','Working Days','LOP Days',
      'Punch-In Count','Punch-Out Count','Missed Punch-Out',
      'Earned Gross','Earned Net','Advance EMI','Net Payable'
    ];
    const subHeaderColors = [
      'FF1565C0','FF1565C0','FF1565C0','FF1565C0',
      'FF388E3C','FF388E3C','FF388E3C','FF388E3C','FF388E3C','FF1B5E20',
      'FFE53935','FFE53935','FFE53935','FFE53935','FFB71C1C','FF7F0000',
      'FF8E24AA','FF8E24AA','FF8E24AA','FF4A148C',
      'FF2E7D32','FFC62828','FF6A1B9A','FFE65100',
      'FF00695C','FF004D40','FFB71C1C',
      'FF01579B','FF006064','FFB71C1C',  // Punch-In, Punch-Out, Missed Punch-Out
      'FF006064','FF004D40','FFE65100','FF1B5E20'
    ];
    salHeaders.forEach((h, i) => {
      const cell = ws2.getCell(3, i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: subHeaderColors[i] } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
    });
    ws2.getRow(3).height = 32;

    // Salary data rows
    employees.forEach((e, ri) => {
      const row = ri + 4;
      const isAlt = ri % 2 === 1;
      const bgColor = isAlt ? 'FFE8EAF6' : 'FFFFFFFF';

      // Count present/absent/half days for salary calculation
      // Rules:
      //   present/late/od/wfh/regularized/holiday/on-leave → fully paid, presentDays++
      //   half-day / h-el / h-cl / h-sl / h-wfh            → PAID half day (leave balance used): 0.5 present paid, 0.5 day leave paid → full day paid (presentDays += 0.5 only, lopDays += 0)
      //   h-lwp                                             → UNPAID half day: 0.5 day present + 0.5 day LOP (presentDays += 0.5, lopDays += 0.5)
      //   lwp                                               → full day LOP
      //   absent (weekday)                                  → full day LOP
      let presentDays = 0, lopDays = 0;
      let salPaidLeave = 0, salUnpaidLeave = 0, salPaidHalfDay = 0, salUnpaidHalfDay = 0;
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const dow = new Date(y, m - 1, d).getDay();
        const status = (attMap[e.id] || {})[dateStr] || '';
        if (['present','late','regularized','od','wfh'].includes(status)) {
          // Fully paid work statuses
          presentDays++;
        } else if (status === 'holiday') {
          // Public holiday — paid day off
          presentDays++;
        } else if (status === 'on-leave') {
          // Full paid leave (EL/CL/SL with balance) — fully paid
          presentDays++;
          salPaidLeave++;
        } else if (['half-day','h-el','h-cl','h-sl','h-wfh'].includes(status)) {
          // Paid half day — employee worked 0.5, leave covers 0.5 → full day paid
          presentDays += 0.5;
          salPaidHalfDay++;
        } else if (status === 'h-lwp') {
          // Unpaid half day — employee worked 0.5, other 0.5 is LOP
          presentDays += 0.5;
          lopDays += 0.5;
          salUnpaidHalfDay++;
        } else if (status === 'lwp') {
          // Full unpaid leave — full LOP
          lopDays += 1;
          salUnpaidLeave++;
        } else if ((status === 'absent' || status === 'missing_punch_out') && dow !== 0 && dow !== 6) {
          // Absent / missed punch-out on a weekday — full LOP
          lopDays++;
        }
      }

      // Working days — always full month (salary is calculated for full month)
      // Subtract regional holidays (national + region-specific)
      const empRegion = getEmployeeRegion(e.city || '', e.state || '');
      const empHolidays = empRegion === 'north' ? holidaysByRegion.north : holidaysByRegion.south_west;

      let workingDays = 0, satCount = 0;
      const isOffsite = e.saturday_policy === 'all_working';
      for (let d = 1; d <= daysInMonth; d++) {
        const dow = new Date(y, m - 1, d).getDay();
        if (dow === 6) satCount++;
        const is2nd4thSat = !isOffsite && dow === 6 && (satCount === 2 || satCount === 4);
        const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const isHoliday = empHolidays.has(dateStr);
        if (dow !== 0 && !is2nd4thSat && !isHoliday) workingDays++;
      }

      // Salary figures — USE EXACTLY WHAT HR DEFINED IN DB, NO RECALCULATION
      const basic      = parseFloat(e.basic)             || 0;
      const hra        = parseFloat(e.hra)               || 0;
      const conveyance = parseFloat(e.conveyance)        || 0;
      const special    = parseFloat(e.special_allowance) || 0;
      const gratuity   = parseFloat(e.gratuity)          || 0;
      const gross      = parseFloat(e.gross_salary)      || 0;
      const pfEmp      = parseFloat(e.pf_employee)       || 0;
      const esiEmp     = parseFloat(e.esi_employee)      || 0;
      const pt         = parseFloat(e.professional_tax)  || 0;
      const lwf        = parseFloat(e.lwf)               || 0;
      const tds        = parseFloat(e.tds)               || 0;
      const pfEmr      = parseFloat(e.pf_employer)       || 0;
      const esiEmr     = parseFloat(e.esi_employer)      || 0;
      const pfAdm      = parseFloat(e.pf_admin)          || 0;
      // Remove LWF from total deductions (LWF column removed per HR instruction)
      const totalDed   = Math.max(0, (parseFloat(e.total_deductions) || 0) - lwf);
      // netFull = gross - deductions without LWF
      const netFull    = gross - totalDed;

      // EMI for this employee this month
      const emiDeduction = emiMap[e.id] || 0;

      // earnedGross = proportional gross based on attendance
      // earnedNet   = proportional net (after statutory deductions from DB)
      // netPayable  = earnedNet - EMI (EMI deducted only once here)
      const earnedGross = workingDays > 0 ? Math.round((gross    * presentDays) / workingDays) : 0;
      const earnedNet   = workingDays > 0 ? Math.round((netFull  * presentDays) / workingDays) : 0;
      const netPayable  = Math.max(0, earnedNet - emiDeduction);

      const empPunch = punchMap[e.id] || { punchIn: 0, punchOut: 0, missingPunchOut: 0 };

      const values = [
        e.employee_code, `${e.first_name} ${e.last_name||''}`.trim(),
        e.department||'', e.designation||'',
        basic, hra, conveyance, special, gratuity, gross,
        // Deductions — statutory only (from DB), then EMI separately, then total
        pfEmp, esiEmp, pt, tds, emiDeduction, totalDed,
        pfEmr, esiEmr, pfAdm, pfEmr + esiEmr + pfAdm,
        salPaidLeave, salUnpaidLeave, salPaidHalfDay, salUnpaidHalfDay,
        presentDays, workingDays, lopDays,
        empPunch.punchIn, empPunch.punchOut, empPunch.missingPunchOut,
        earnedGross, earnedNet, emiDeduction, netPayable
      ];

      values.forEach((v, ci) => {
        const cell = ws2.getCell(row, ci + 1);
        cell.value = v;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgColor } };
        cell.border = { right: { style: 'hair' }, bottom: { style: 'hair' } };
        cell.font = { size: 9 };
        if (ci >= 4) {
          cell.numFmt = (ci >= 20 && ci <= 23) ? '0' : (ci >= 24 && ci <= 29) ? '0.0' : '₹#,##0.00';
          cell.alignment = { horizontal: 'right', vertical: 'middle' };
          // Net Payable (col index 33) — bold green
          if (ci === 33) {
            cell.font = { bold: true, size: 10, color: { argb: 'FF1B5E20' } };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isAlt ? 'FFC8E6C9' : 'FFE8F5E9' } };
          }
          // Missed Punch-Out (col index 29) — red if > 0
          if (ci === 29 && v > 0) {
            cell.font = { bold: true, size: 9, color: { argb: 'FFD50000' } };
          }
          // Advance EMI cols (index 14 = deduction col, index 32 = totals col) — orange if > 0
          if ((ci === 14 || ci === 32) && v > 0) {
            cell.font = { bold: true, size: 9, color: { argb: 'FFE65100' } };
          }
        } else {
          cell.alignment = { vertical: 'middle' };
        }
      });
      ws2.getRow(row).height = 16;
    });

    // Column widths — 34 columns (added Punch-In Count, Punch-Out Count, Missed Punch-Out)
    [10,22,14,22, 12,10,12,14,10,13, 10,10,9,10,12,15, 13,13,10,16, 10,10,10,10, 10,11,9, 11,12,13, 13,13,11,14].forEach((w, i) => {
      ws2.getColumn(i + 1).width = w;
    });

    // ════════════════════════════════════════════════════════════════════════
    // SHEET 3 — EMPLOYEE DIRECTORY
    // ════════════════════════════════════════════════════════════════════════
    const ws3 = wb.addWorksheet('Employee Directory', {
      views: [{ state: 'frozen', xSplit: 3, ySplit: 2 }]
    });

    ws3.mergeCells(1, 1, 1, 20);
    const dirTitle = ws3.getCell(1, 1);
    dirTitle.value = `KrishiHR — Employee Directory | Generated ${new Date().toLocaleDateString('en-IN')}`;
    dirTitle.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    dirTitle.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4E342E' } };
    dirTitle.alignment = { horizontal: 'center', vertical: 'middle' };
    ws3.getRow(1).height = 26;

    const dirHeaders = ['Emp Code','Name','Email','Phone','Gender','DOB','Joining Date',
      'Department','Designation','Role','Category','Level','City','State',
      'PAN','Aadhar','UAN','PF No','Bank','Account','IFSC','Manager'];
    dirHeaders.forEach((h, i) => {
      const cell = ws3.getCell(2, i + 1);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF6D4C41' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    ws3.getRow(2).height = 22;

    employees.forEach((e, ri) => {
      const row = ri + 3;
      const isAlt = ri % 2 === 1;
      const vals = [
        e.employee_code, `${e.first_name} ${e.last_name||''}`.trim(), e.email, e.phone||'',
        e.gender||'',
        e.date_of_birth ? toISTDateString(new Date(e.date_of_birth)) : '',
        e.joining_date  ? toISTDateString(new Date(e.joining_date))  : '',
        e.department||'', e.designation||'', e.role, e.employee_category||'', e.level||'',
        e.city||'', e.state||'',
        e.pan_number||'', e.aadhar_number||'', e.uan_number||'', e.pf_number||'',
        e.bank_name||'', e.bank_account||'', e.bank_ifsc||'', e.reporting_manager||''
      ];
      vals.forEach((v, ci) => {
        const cell = ws3.getCell(row, ci + 1);
        cell.value = v;
        cell.font = { size: 9 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isAlt ? 'FFFBE9E7' : 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle' };
        cell.border = { right: { style: 'hair' }, bottom: { style: 'hair' } };
      });
      ws3.getRow(row).height = 16;
    });

    [10,22,28,13,8,12,12,16,22,10,12,7,14,14,14,16,14,18,20,20,13,22].forEach((w, i) => {
      ws3.getColumn(i + 1).width = w;
    });

    // ── Send response ────────────────────────────────────────────────────────
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', `attachment; filename="KrishiHR_Master_${MONTH_NAMES[m-1]}${y}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);

  } catch (err) {
    console.error('[exportMasterExcel]', err.message, err.stack);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ════════════════════════════════════════════════════════════════════════════
// ATTENDANCE REGISTER ONLY — called from Attendance page "Download Attendance"
// Generates ONLY Sheet 1 (Attendance Register) — no salary or directory data
// ════════════════════════════════════════════════════════════════════════════
exports.exportAttendanceRegister = async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const { month, year } = req.query;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year)  || new Date().getFullYear();
    const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    // ── Employees (basic info only — no salary data needed) ─────────────────
    const empResult = await db.query(`
      SELECT e.id, e.employee_code, e.first_name, e.last_name,
             d.name AS department, des.title AS designation,
             e.employee_category,
             COALESCE(e.saturday_policy, '2nd_4th_off') AS saturday_policy,
             e.city, e.state
      FROM employees e
      LEFT JOIN departments  d   ON e.department_id  = d.id
      LEFT JOIN designations des ON e.designation_id = des.id
      WHERE (
        e.is_active = true
        OR (
          e.separation_date IS NOT NULL
          AND e.separation_date >= MAKE_DATE($1::int, $2::int, 1)
        )
        OR (
          EXISTS (
            SELECT 1 FROM separations sep
            WHERE sep.employee_id = e.id AND sep.status = 'completed'
            AND sep.last_working_date >= MAKE_DATE($1::int, $2::int, 1)
          )
        )
      )
      ORDER BY d.name, e.first_name`, [y, m]);
    const employees = empResult.rows;

    // ── Attendance for the month ─────────────────────────────────────────────
    const attResult = await db.query(`
      SELECT employee_id, TO_CHAR(date, 'YYYY-MM-DD') AS date_str, status
      FROM attendance
      WHERE EXTRACT(MONTH FROM date) = $1 AND EXTRACT(YEAR FROM date) = $2`,
      [m, y]);
    const attMap = {};
    for (const row of attResult.rows) {
      if (!attMap[row.employee_id]) attMap[row.employee_id] = {};
      attMap[row.employee_id][row.date_str] = row.status;
    }

    const daysInMonth = new Date(y, m, 0).getDate();

    // ── Holidays ─────────────────────────────────────────────────────────────
    const holResult = await db.query(`
      SELECT TO_CHAR(date,'YYYY-MM-DD') AS date_str, region
      FROM holidays
      WHERE EXTRACT(MONTH FROM date) = $1 AND EXTRACT(YEAR FROM date) = $2`,
      [m, y]);
    const holidaysByRegion = { all: new Set(), north: new Set(), south_west: new Set() };
    for (const h of holResult.rows) {
      if (h.region === 'all') { holidaysByRegion.all.add(h.date_str); holidaysByRegion.north.add(h.date_str); holidaysByRegion.south_west.add(h.date_str); }
      else if (h.region === 'north') holidaysByRegion.north.add(h.date_str);
      else if (h.region === 'south_west') holidaysByRegion.south_west.add(h.date_str);
    }

    const STATUS_STYLE = {
      'present':     { label: 'P',    bg: '00C853', fg: 'FFFFFF' },
      'late':        { label: 'L',    bg: 'FFD600', fg: '000000' },
      'absent':      { label: 'A',    bg: 'D50000', fg: 'FFFFFF' },
      'missing_punch_out': { label: 'MPO', bg: 'FF6F00', fg: 'FFFFFF' },
      'on-leave':    { label: 'EL',   bg: '2962FF', fg: 'FFFFFF' },
      'lwp':         { label: 'LWP',  bg: 'FF6D00', fg: 'FFFFFF' },
      'half-day':    { label: 'H',    bg: 'AA00FF', fg: 'FFFFFF' },
      'h-el':        { label: 'H-EL', bg: '7B1FA2', fg: 'FFFFFF' },
      'h-cl':        { label: 'H-CL', bg: '880E4F', fg: 'FFFFFF' },
      'h-sl':        { label: 'H-SL', bg: 'AD1457', fg: 'FFFFFF' },
      'h-lwp':       { label: 'H-LWP',bg: 'BF360C', fg: 'FFFFFF' },
      'h-wfh':       { label: 'H-WFH',bg: '00897B', fg: 'FFFFFF' },
      'od':          { label: 'OD',   bg: '00BCD4', fg: 'FFFFFF' },
      'wfh':         { label: 'WFH',  bg: '80CBC4', fg: '000000' },
      'regularized': { label: 'R',    bg: '558B2F', fg: 'FFFFFF' },
      'holiday':     { label: 'HOL',  bg: 'CFD8DC', fg: '37474F' },
      'weekend':     { label: 'WO',   bg: 'ECEFF1', fg: '90A4AE' },
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'KrishiHR';
    wb.created = new Date();

    // ── Sheet 1 — Attendance Register (identical to exportMasterExcel Sheet 1) ─
    const ws1 = wb.addWorksheet(`Attendance ${MONTH_NAMES[m-1]} ${y}`, {
      views: [{ state: 'frozen', xSplit: 5, ySplit: 2 }]
    });

    const totalCols = 5 + daysInMonth + 9;
    ws1.mergeCells(1, 1, 1, totalCols);
    const titleCell = ws1.getCell(1, 1);
    titleCell.value = `KrishiHR — Attendance Register | ${MONTH_NAMES[m-1]} ${y}`;
    titleCell.font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    ws1.getRow(1).height = 28;

    const infoHeaders = ['Emp Code', 'Name', 'Department', 'Designation', 'Category'];
    const headerFill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E7D32' } };
    const headerFont  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    const headerAlign = { horizontal: 'center', vertical: 'middle', wrapText: true };

    infoHeaders.forEach((h, i) => {
      const cell = ws1.getCell(2, i + 1);
      cell.value = h; cell.font = headerFont; cell.fill = headerFill;
      cell.alignment = headerAlign;
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
    });

    const dayNames = ['Su','Mo','Tu','We','Th','Fr','Sa'];
    let satCountHdr = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const dow = new Date(y, m - 1, d).getDay();
      if (dow === 6) satCountHdr++;
      const isWeekOff = dow === 0 || (dow === 6 && (satCountHdr === 2 || satCountHdr === 4));
      const cell = ws1.getCell(2, 5 + d);
      cell.value = `${d}\n${dayNames[dow]}`;
      cell.font = { bold: true, size: 9, color: { argb: isWeekOff ? 'FFFF1744' : 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isWeekOff ? 'FF880E4F' : 'FF2E7D32' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFFFFFFF' } } };
    }

    [
      { h: 'Paid Leave',      bg: 'FF2E7D32' },
      { h: 'Unpaid Leave',    bg: 'FFC62828' },
      { h: 'Paid Half Day',   bg: 'FF6A1B9A' },
      { h: 'Unpaid Half Day', bg: 'FFE65100' },
      { h: 'Total Paid',      bg: 'FF1565C0' },
      { h: 'Total Unpaid',    bg: 'FF880E4F' },
      { h: 'Total Absent',    bg: 'FFD50000' },
      { h: 'Late',            bg: 'FFF57F17' },
      { h: 'Total Present',   bg: 'FF00695C' },
    ].forEach(({ h, bg }, i) => {
      const cell = ws1.getCell(2, 5 + daysInMonth + 1 + i);
      cell.value = h;
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 8 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    ws1.getRow(2).height = 30;

    employees.forEach((e, ri) => {
      const row   = ri + 3;
      const isAlt = ri % 2 === 1;

      [e.employee_code, `${e.first_name} ${e.last_name||''}`.trim(),
       e.department||'', e.designation||'', e.employee_category||''].forEach((v, ci) => {
        const cell = ws1.getCell(row, ci + 1);
        cell.value = v; cell.font = { size: 9 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isAlt ? 'FFE8F5E9' : 'FFFFFFFF' } };
        cell.alignment = { vertical: 'middle' };
        cell.border = { right: { style: 'hair' }, bottom: { style: 'hair' } };
      });

      let attPaidLeave = 0, attUnpaidLeave = 0, attPaidHalfDay = 0, attUnpaidHalfDay = 0;
      let attLate = 0, attAbsent = 0, attPresent = 0;
      let satCountRow = 0;
      const empIsOffsite = e.saturday_policy === 'all_working';
      const empReg = getEmployeeRegion(e.city || '', e.state || '');
      const empHolSet = empReg === 'north' ? holidaysByRegion.north : holidaysByRegion.south_west;

      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const dow = new Date(y, m - 1, d).getDay();
        if (dow === 6) satCountRow++;
        const is2nd4thSat = !empIsOffsite && dow === 6 && (satCountRow === 2 || satCountRow === 4);
        const isWeekOff   = dow === 0 || is2nd4thSat;

        let status;
        if (isWeekOff) {
          status = 'weekend';
        } else if (empHolSet.has(dateStr) && !((attMap[e.id] || {})[dateStr])) {
          status = 'holiday';
        } else {
          status = (attMap[e.id] || {})[dateStr] || '';
        }

        const style = STATUS_STYLE[status] || { label: '', bg: isAlt ? 'F1F8E9' : 'FFFFFF', fg: '000000' };
        const cell  = ws1.getCell(row, 5 + d);
        cell.value = style.label;
        cell.font  = { bold: true, size: 8, color: { argb: 'FF' + style.fg } };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + style.bg } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = { right: { style: 'hair' }, bottom: { style: 'hair' } };

        if (!isWeekOff) {
          if (['present','regularized','od','wfh','holiday'].includes(status)) attPresent++;
          else if (status === 'late')     { attPresent++; attLate++; }
          else if (status === 'on-leave') { attPaidLeave++;  attPresent++; }
          else if (['half-day','h-el','h-cl','h-sl','h-wfh'].includes(status)) { attPaidHalfDay++;   attPresent++; }
          else if (status === 'h-lwp')   attUnpaidHalfDay++;
          else if (status === 'lwp')     attUnpaidLeave++;
          else if (status === 'absent')  attAbsent++;
        }
      }

      const attTotalPaid   = attPresent;
      const attTotalUnpaid = attUnpaidLeave + attUnpaidHalfDay;

      [
        [attPaidLeave,     'FF2E7D32'],
        [attUnpaidLeave,   'FFC62828'],
        [attPaidHalfDay,   'FF6A1B9A'],
        [attUnpaidHalfDay, 'FFE65100'],
        [attTotalPaid,     'FF1565C0'],
        [attTotalUnpaid,   'FF880E4F'],
        [attAbsent,        'FFD50000'],
        [attLate,          'FFF57F17'],
        [attPresent,       'FF00695C'],
      ].forEach(([v, color], i) => {
        const cell = ws1.getCell(row, 5 + daysInMonth + 1 + i);
        cell.value = v;
        cell.font  = { bold: true, size: 9, color: { argb: color } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: isAlt ? 'FFE3F2FD' : 'FFFFFFFF' } };
        cell.border = { right: { style: 'thin' }, bottom: { style: 'hair' } };
      });

      ws1.getRow(row).height = 18;
    });

    ws1.getColumn(1).width = 10; ws1.getColumn(2).width = 20;
    ws1.getColumn(3).width = 14; ws1.getColumn(4).width = 20; ws1.getColumn(5).width = 12;
    for (let d = 1; d <= daysInMonth; d++) ws1.getColumn(5 + d).width = 5;
    for (let i = 1; i <= 9; i++) ws1.getColumn(5 + daysInMonth + i).width = 10;

    const legendRow = employees.length + 4;
    ws1.mergeCells(legendRow, 1, legendRow, totalCols);
    const legendCell = ws1.getCell(legendRow, 1);
    legendCell.value = 'LEGEND:  P=Present  A=Absent  L=Late  EL=Paid Leave  LWP=Unpaid Leave  H=Half Day  H-EL=Half EL  H-CL=Half CL  H-SL=Half SL  H-LWP=Half LWP (Unpaid)  H-WFH=Half WFH  OD=On Duty  WFH=Work From Home  R=Regularized  WO=Week Off  HOL=Holiday';
    legendCell.font  = { italic: true, size: 8, color: { argb: 'FF37474F' } };
    legendCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFECEFF1' } };
    legendCell.alignment = { horizontal: 'left', vertical: 'middle' };
    ws1.getRow(legendRow).height = 16;

    // ── Send ─────────────────────────────────────────────────────────────────
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', `attachment; filename="KrishiHR_Attendance_${MONTH_NAMES[m-1]}${y}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);

  } catch (err) {
    console.error('[exportAttendanceRegister]', err.message, err.stack);
    res.status(500).json({ success: false, message: err.message });
  }
};
