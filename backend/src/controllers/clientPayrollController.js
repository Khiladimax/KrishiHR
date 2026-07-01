// src/controllers/clientPayrollController.js
// Client Payroll Cycles — import from Excel/CSV, download template, list & edit
const db     = require('../config/db');
const XLSX   = require('xlsx');
const multer = require('multer');

// ── Upload middleware ─────────────────────────────────────────────────────────
exports.uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(xlsx|xls|csv)$/.test(file.originalname.toLowerCase())) cb(null, true);
    else cb(new Error('Only Excel (.xlsx/.xls) or CSV files allowed'));
  }
}).single('file');

// ── GET /api/client-payroll/template — download blank import template ─────────
exports.downloadTemplate = async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const { month, year } = req.query;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year)  || new Date().getFullYear();
    const MONTH_NAMES = ['January','February','March','April','May','June',
      'July','August','September','October','November','December'];

    // Cycle label: e.g. cycle_month=4 → "Mar-Apr 2026" (work period 25 Mar → 24 Apr, paid in April)
    const prevM = m === 1 ? 12 : m - 1;
    const prevY = m === 1 ? y - 1 : y;
    const cycleLabel = `${MONTH_NAMES[prevM-1].slice(0,3)}-${MONTH_NAMES[m-1].slice(0,3)} ${y}`;

    // Fetch all active client employees
    const empRes = await db.query(`
      SELECT e.employee_code, e.first_name, e.last_name,
             d.name AS department, des.title AS designation,
             cl.name AS client_name,
             COALESCE(cp.gross_salary, 0) AS prev_gross
      FROM employees e
      LEFT JOIN departments  d   ON e.department_id  = d.id
      LEFT JOIN designations des ON e.designation_id = des.id
      LEFT JOIN clients      cl  ON e.client_id      = cl.id
      LEFT JOIN client_payroll_cycles cp
             ON cp.employee_id = e.id
            AND cp.cycle_month = $1 AND cp.cycle_year = $2
      WHERE e.client_id IS NOT NULL AND e.is_active = true
      ORDER BY COALESCE(cl.name,''), e.first_name`, [m === 1 ? 12 : m - 1, m === 1 ? y - 1 : y]);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Client Payroll');

    // Title
    ws.mergeCells('A1:F1');
    const title = ws.getCell('A1');
    title.value = `KrishiHR — Client Payroll Import | ${cycleLabel} | cycle_month=${m}, cycle_year=${y}`;
    title.font  = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    title.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D47A1' } };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 26;

    // Instructions
    ws.mergeCells('A2:F2');
    const note = ws.getCell('A2');
    note.value = `INSTRUCTIONS: Fill "Gross Salary" column only. TDS (1%) and Amount Payable are calculated automatically. Do NOT change Emp Code or headers.`;
    note.font  = { italic: true, size: 9, color: { argb: 'FF37474F' } };
    note.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0B2' } };
    ws.getRow(2).height = 18;

    // Headers
    const headers = ['Emp Code', 'Name', 'Client', 'Department', 'Gross Salary', 'TDS @1% (auto)', 'Amount Payable (auto)'];
    headers.forEach((h, i) => {
      const cell = ws.getCell(3, i + 1);
      cell.value = h;
      cell.font  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1565C0' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    ws.getRow(3).height = 24;

    // Data rows
    empRes.rows.forEach((e, i) => {
      const row = i + 4;
      const isAlt = i % 2 === 1;
      const bg = isAlt ? 'FFE3F2FD' : 'FFFFFFFF';
      const prev = parseFloat(e.prev_gross) || 0;

      // Emp Code (locked — don't change)
      const codeCell = ws.getCell(row, 1);
      codeCell.value = e.employee_code;
      codeCell.font  = { bold: true, size: 9, color: { argb: 'FF0D47A1' } };
      codeCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      codeCell.alignment = { vertical: 'middle' };

      // Name
      ws.getCell(row, 2).value = `${e.first_name} ${e.last_name || ''}`.trim();
      ws.getCell(row, 3).value = e.client_name || '';
      ws.getCell(row, 4).value = e.department  || '';
      [2,3,4].forEach(c => {
        ws.getCell(row, c).font = { size: 9 };
        ws.getCell(row, c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        ws.getCell(row, c).alignment = { vertical: 'middle' };
      });

      // Gross Salary — editable, pre-fill with last cycle's value
      const grossCell = ws.getCell(row, 5);
      grossCell.value = prev > 0 ? prev : null;
      grossCell.font  = { bold: true, size: 10, color: { argb: 'FF1B5E20' } };
      grossCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F8E9' } };
      grossCell.numFmt = '₹#,##0.00';
      grossCell.alignment = { horizontal: 'right', vertical: 'middle' };

      // TDS @1% — formula
      const tdsCell = ws.getCell(row, 6);
      tdsCell.value = { formula: `=IF(E${row}="","",ROUND(E${row}*0.01,0))` };
      tdsCell.font  = { size: 9, color: { argb: 'FF6D1A1A' } };
      tdsCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF3E0' } };
      tdsCell.numFmt = '₹#,##0.00';
      tdsCell.alignment = { horizontal: 'right', vertical: 'middle' };

      // Amount Payable — formula
      const amtCell = ws.getCell(row, 7);
      amtCell.value = { formula: `=IF(E${row}="","",E${row}-F${row})` };
      amtCell.font  = { bold: true, size: 10, color: { argb: 'FF0D47A1' } };
      amtCell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8EAF6' } };
      amtCell.numFmt = '₹#,##0.00';
      amtCell.alignment = { horizontal: 'right', vertical: 'middle' };

      [1,2,3,4,5,6,7].forEach(c => {
        ws.getCell(row, c).border = { right: { style: 'hair' }, bottom: { style: 'hair' } };
      });
      ws.getRow(row).height = 18;
    });

    // Column widths
    [12, 24, 20, 18, 16, 16, 18].forEach((w, i) => ws.getColumn(i + 1).width = w);

    // Protect cols A-D and F-G (only col E editable) — data validation note
    ws.getCell(empRes.rows.length + 5, 1).value =
      '⚠ Only edit the GREEN "Gross Salary" column. TDS and Amount Payable are auto-calculated.';

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Disposition',
      `attachment; filename="ClientPayroll_Template_${MONTH_NAMES[m-1]}${y}.xlsx"`);
    res.setHeader('Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);

  } catch (err) {
    console.error('[clientPayroll/template]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /api/client-payroll/import — process uploaded Excel/CSV ──────────────
exports.importPayroll = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    if (!req.file)
      return res.status(400).json({ success: false, message: 'File required' });

    const { month, year, overwrite = 'false' } = req.body;
    if (!month || !year)
      return res.status(400).json({ success: false, message: 'month and year are required' });

    const m = parseInt(month), y = parseInt(year);

    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Find header row (has "Emp Code")
    let headerRow = -1;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      if (String(rows[i][0]).toLowerCase().includes('emp')) { headerRow = i; break; }
    }
    if (headerRow === -1)
      return res.status(400).json({ success: false, message: 'Could not find header row. Ensure column A has "Emp Code".' });

    let imported = 0, skipped = 0, updated = 0;
    const errors = [], results = [];

    for (let ri = headerRow + 1; ri < rows.length; ri++) {
      const row     = rows[ri];
      const empCode = String(row[0] || '').trim().toUpperCase();
      if (!empCode || !empCode.match(/^KC\d+/i)) continue;

      const grossRaw = parseFloat(String(row[4] || '').replace(/[₹,\s]/g, ''));
      if (isNaN(grossRaw) || grossRaw <= 0) {
        errors.push(`Row ${ri + 1}: ${empCode} — Gross Salary missing or invalid`);
        skipped++;
        continue;
      }

      // Lookup employee
      const empRes = await client.query(
        `SELECT e.id, e.first_name, e.last_name, cl.name AS client_name
         FROM employees e
         LEFT JOIN clients cl ON e.client_id = cl.id
         WHERE UPPER(e.employee_code) = $1 AND e.client_id IS NOT NULL AND e.is_active = true`,
        [empCode]
      );
      if (!empRes.rows.length) {
        errors.push(`Row ${ri + 1}: ${empCode} — not found as active client employee`);
        skipped++;
        continue;
      }
      const emp = empRes.rows[0];

      const gross  = Math.round(grossRaw * 100) / 100;
      const tds    = Math.round(gross * 0.01);
      const payable = Math.round((gross - tds) * 100) / 100;

      // Check if already exists
      const existing = await client.query(
        `SELECT id FROM client_payroll_cycles
         WHERE employee_id=$1 AND cycle_month=$2 AND cycle_year=$3`,
        [emp.id, m, y]
      );

      if (existing.rows.length > 0) {
        if (overwrite === 'true') {
          await client.query(
            `UPDATE client_payroll_cycles
             SET gross_salary=$1, tds_amount=$2, amount_payable=$3, updated_at=NOW()
             WHERE employee_id=$4 AND cycle_month=$5 AND cycle_year=$6`,
            [gross, tds, payable, emp.id, m, y]
          );
          updated++;
          results.push({ emp_code: empCode, name: `${emp.first_name} ${emp.last_name||''}`.trim(), client: emp.client_name, gross, tds, payable, action: 'updated' });
        } else {
          errors.push(`Row ${ri + 1}: ${empCode} — record already exists (enable Overwrite to update)`);
          skipped++;
        }
      } else {
        await client.query(
          `INSERT INTO client_payroll_cycles
             (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [emp.id, m, y, gross, tds, payable]
        );
        imported++;
        results.push({ emp_code: empCode, name: `${emp.first_name} ${emp.last_name||''}`.trim(), client: emp.client_name, gross, tds, payable, action: 'imported' });
      }
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      summary: { imported, updated, skipped, errors: errors.length },
      results,
      errors,
      message: `${imported} imported, ${updated} updated, ${skipped} skipped`
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[clientPayroll/import]', err.message, err.stack);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// ── GET /api/client-payroll — list records for a month ────────────────────────
exports.listPayroll = async (req, res) => {
  try {
    const { month, year, employee_id } = req.query;

    // Single employee lookup — returns last 6 cycles
    if (employee_id) {
      const result = await db.query(`
        SELECT cp.id, cp.cycle_month, cp.cycle_year,
               cp.gross_salary, cp.tds_amount, cp.amount_payable,
               e.employee_code, cl.name AS client_name
        FROM client_payroll_cycles cp
        JOIN employees e ON e.id = cp.employee_id
        LEFT JOIN clients cl ON e.client_id = cl.id
        WHERE cp.employee_id = $1
        ORDER BY cp.cycle_year DESC, cp.cycle_month DESC LIMIT 6`,
        [parseInt(employee_id)]);
      return res.json({ success: true, data: result.rows, count: result.rows.length });
    }

    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year)  || new Date().getFullYear();

    const isClientAdmin = req.user.role === 'client_admin';
    const clientFilter  = isClientAdmin && req.user.client_id
      ? `AND e.client_id = ${parseInt(req.user.client_id)}` : '';

    const result = await db.query(`
      SELECT cp.id, cp.cycle_month, cp.cycle_year,
             cp.gross_salary, cp.tds_amount, cp.amount_payable,
             e.employee_code, e.first_name, e.last_name,
             d.name AS department, des.title AS designation,
             cl.name AS client_name
      FROM client_payroll_cycles cp
      JOIN employees e   ON e.id = cp.employee_id
      LEFT JOIN departments  d   ON e.department_id  = d.id
      LEFT JOIN designations des ON e.designation_id = des.id
      LEFT JOIN clients      cl  ON e.client_id      = cl.id
      WHERE cp.cycle_month=$1 AND cp.cycle_year=$2
        AND e.client_id IS NOT NULL ${clientFilter}
      ORDER BY COALESCE(cl.name,''), e.first_name`, [m, y]);

    res.json({ success: true, data: result.rows, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
