// src/controllers/clientPayrollController.js
// Client Payroll Cycles — full salary breakup (incl. ESIC), imported-as-final.
// Template pre-fills earnings/deductions from each employee's salary structure;
// Accounts adjusts Present/LOP + any figure and uploads. Whatever is uploaded is
// stored exactly (no auto-calculation).
const db     = require('../config/db');
const XLSX   = require('xlsx');
const multer = require('multer');

const MONTH_NAMES = ['January','February','March','April','May','June',
  'July','August','September','October','November','December'];

// ── Upload middleware ─────────────────────────────────────────────────────────
exports.uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(xlsx|xls|csv)$/.test(file.originalname.toLowerCase())) cb(null, true);
    else cb(new Error('Only Excel (.xlsx/.xls) or CSV files allowed'));
  }
}).single('file');

// ── Lazy schema: add the full-breakup columns to client_payroll_cycles ────────
let cpSchemaReady = false;
async function ensureSchema() {
  if (cpSchemaReady) return;
  const cols = [
    ['basic','NUMERIC(12,2) DEFAULT 0'], ['hra','NUMERIC(12,2) DEFAULT 0'],
    ['conveyance','NUMERIC(12,2) DEFAULT 0'], ['other_allowance','NUMERIC(12,2) DEFAULT 0'],
    ['gratuity','NUMERIC(12,2) DEFAULT 0'],
    ['pf_employee','NUMERIC(12,2) DEFAULT 0'], ['pf_employer','NUMERIC(12,2) DEFAULT 0'],
    ['pf_admin','NUMERIC(12,2) DEFAULT 0'],
    ['esi_employee','NUMERIC(12,2) DEFAULT 0'], ['esi_employer','NUMERIC(12,2) DEFAULT 0'],
    ['professional_tax','NUMERIC(12,2) DEFAULT 0'], ['lwf','NUMERIC(12,2) DEFAULT 0'],
    ['loan_emi_recovery','NUMERIC(12,2) DEFAULT 0'],
    ['total_deductions','NUMERIC(12,2) DEFAULT 0'], ['net_salary','NUMERIC(12,2) DEFAULT 0'],
    ['ctc_monthly','NUMERIC(12,2) DEFAULT 0'],
    ['working_days','NUMERIC(5,1) DEFAULT 0'], ['present_days','NUMERIC(5,1) DEFAULT 0'],
    ['lop_days','NUMERIC(5,1) DEFAULT 0'], ['paid_days','NUMERIC(5,1) DEFAULT 0'],
    ['status',"VARCHAR(20) DEFAULT 'paid'"], ['remarks','TEXT'],
  ];
  for (const [c, def] of cols) {
    await db.query(`ALTER TABLE client_payroll_cycles ADD COLUMN IF NOT EXISTS ${c} ${def}`).catch(() => {});
  }
  cpSchemaReady = true;
}

// Cycle label helpers — cycle_month m → work period 25 (m-1) → 24 m, paid in m.
function labels(m, y) {
  const prevM = m === 1 ? 12 : m - 1;
  const prevY = m === 1 ? y - 1 : y;
  return {
    cycleLabel:  `${MONTH_NAMES[prevM-1].slice(0,3)}-${MONTH_NAMES[m-1].slice(0,3)} ${y}`,
    periodLabel: `25 ${MONTH_NAMES[prevM-1].slice(0,3)} ${prevY} → 24 ${MONTH_NAMES[m-1].slice(0,3)} ${y}`,
    prevM, prevY,
  };
}

// Canonical monthly columns (same order used by template / import / export).
const HEADERS = [
  'Emp Code', 'Name', 'Client', 'Department',
  'Working Days', 'Present Days', 'LOP Days', 'Paid Days',
  'Basic + VDA', 'HRA', 'Conveyance', 'Other Allowance', 'Gratuity', 'Gross Salary',
  'PF (Employee)', 'ESI (Employee)', 'Prof Tax', 'TDS', 'LWF', 'Loan/EMI', 'Total Deductions',
  'Net Salary',
  'PF (Employer)', 'ESI (Employer)', 'PF Admin', 'CTC (Monthly)',
  'Payment Status', 'Remarks',
];

// ── GET /api/client-payroll/template — pre-filled from salary structures ──────
exports.downloadTemplate = async (req, res) => {
  try {
    await ensureSchema();
    const ExcelJS = require('exceljs');
    const m = parseInt(req.query.month) || new Date().getMonth() + 1;
    const y = parseInt(req.query.year)  || new Date().getFullYear();
    const { cycleLabel } = labels(m, y);

    const empRes = await db.query(`
      SELECT e.employee_code,
             TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS name,
             cl.name AS client_name, d.name AS department,
             COALESCE(s.basic,           e.basic_salary,       0) AS basic,
             COALESCE(s.hra,             e.hra,                0) AS hra,
             COALESCE(s.conveyance,                            0) AS conveyance,
             COALESCE(s.special_allowance, e.special_allowance, 0) AS other_allowance,
             COALESCE(s.gratuity,                              0) AS gratuity,
             COALESCE(s.gross_salary,                          0) AS gross_salary,
             COALESCE(s.pf_employee,                           0) AS pf_employee,
             COALESCE(s.esi_employee,                          0) AS esi_employee,
             COALESCE(s.professional_tax,                      0) AS professional_tax,
             COALESCE(s.tds,                                   0) AS tds,
             COALESCE(s.lwf,                                   0) AS lwf,
             COALESCE(s.total_deductions,                      0) AS total_deductions,
             COALESCE(s.net_salary,                            0) AS net_salary,
             COALESCE(s.pf_employer,                           0) AS pf_employer,
             COALESCE(s.esi_employer,                          0) AS esi_employer,
             COALESCE(s.pf_admin,                              0) AS pf_admin,
             COALESCE(s.ctc_monthly,                           0) AS ctc_monthly
      FROM employees e
      LEFT JOIN clients cl ON e.client_id = cl.id
      LEFT JOIN departments d ON e.department_id = d.id
      LEFT JOIN employee_salary_structure s ON s.employee_id = e.id
      WHERE e.client_id IS NOT NULL AND e.is_active = true
      ORDER BY COALESCE(cl.name,''), e.first_name`);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Client Payroll');

    ws.mergeCells(1, 1, 1, HEADERS.length);
    const title = ws.getCell(1, 1);
    title.value = `KrishiHR — Client Payroll Import | ${cycleLabel} | cycle_month=${m}, cycle_year=${y}`;
    title.font  = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    title.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0D47A1' } };
    title.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 26;

    ws.mergeCells(2, 1, 2, HEADERS.length);
    const note = ws.getCell(2, 1);
    note.value = `Figures are pre-filled from each employee's salary structure. Fill Present/LOP days and adjust any amount — WHAT YOU UPLOAD IS FINAL (no auto-calculation). Do NOT change Emp Code or headers.`;
    note.font  = { italic: true, size: 9, color: { argb: 'FF37474F' } };
    note.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFE0B2' } };
    ws.getRow(2).height = 24;

    // Header row (row 3) — colour earnings green, deductions amber, employer blue
    HEADERS.forEach((h, i) => {
      const cell = ws.getCell(3, i + 1);
      cell.value = h;
      let bg = 'FF1565C0';
      if (i >= 8 && i <= 13) bg = 'FF2E7D32';        // earnings
      else if (i >= 14 && i <= 21) bg = 'FFC62828';  // deductions + net
      else if (i >= 22 && i <= 25) bg = 'FF00695C';  // employer cost
      cell.font  = { bold: true, color: { argb: 'FFFFFFFF' }, size: 9.5 };
      cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    ws.getRow(3).height = 30;

    empRes.rows.forEach((e, i) => {
      const row = i + 4;
      const bg  = i % 2 === 1 ? 'FFF3F6FB' : 'FFFFFFFF';
      const vals = [
        e.employee_code, e.name, e.client_name || '', e.department || '',
        26, '', '', '',                                   // Working/Present/LOP/Paid
        num(e.basic), num(e.hra), num(e.conveyance), num(e.other_allowance), num(e.gratuity), num(e.gross_salary),
        num(e.pf_employee), num(e.esi_employee), num(e.professional_tax), num(e.tds), num(e.lwf), 0, num(e.total_deductions),
        num(e.net_salary),
        num(e.pf_employer), num(e.esi_employer), num(e.pf_admin), num(e.ctc_monthly),
        'Paid', '',
      ];
      vals.forEach((v, ci) => {
        const cell = ws.getCell(row, ci + 1);
        cell.value = v;
        cell.font  = { size: 9, color: ci === 0 ? { argb: 'FF0D47A1' } : undefined, bold: ci === 0 };
        cell.fill  = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.alignment = { vertical: 'middle', horizontal: ci >= 4 ? 'right' : 'left' };
        cell.border = { right: { style: 'hair' }, bottom: { style: 'hair' } };
        if (ci >= 8) cell.numFmt = '#,##0';
      });
      ws.getRow(row).height = 17;
    });

    HEADERS.forEach((h, i) => { ws.getColumn(i + 1).width = Math.max(9, Math.min(20, h.length + 2)); });
    ws.views = [{ state: 'frozen', xSplit: 2, ySplit: 3 }];

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', `attachment; filename="ClientPayroll_Template_${MONTH_NAMES[m-1]}${y}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error('[clientPayroll/template]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

function num(v) { const n = parseFloat(String(v ?? '').replace(/[₹,\s]/g, '')); return isNaN(n) ? 0 : n; }

// ── POST /api/client-payroll/import — imported = final, full breakup ─────────
exports.importPayroll = async (req, res) => {
  const client = await db.getClient();
  try {
    await ensureSchema();
    await client.query('BEGIN');
    if (!req.file) return res.status(400).json({ success: false, message: 'File required' });

    const { month, year, overwrite = 'false' } = req.body;
    if (!month || !year) return res.status(400).json({ success: false, message: 'month and year are required' });
    const m = parseInt(month), y = parseInt(year);

    const wb   = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Find the header row (has "Emp Code" in column A) and map columns by NAME.
    let headerRow = -1;
    for (let i = 0; i < Math.min(rows.length, 6); i++) {
      if (String(rows[i][0]).toLowerCase().includes('emp')) { headerRow = i; break; }
    }
    if (headerRow === -1)
      return res.status(400).json({ success: false, message: 'Could not find header row. Ensure column A has "Emp Code".' });

    const norm = h => String(h || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const H = rows[headerRow].map(norm);
    const col = (...names) => { for (const n of names) { const i = H.findIndex(h => h.includes(n)); if (i !== -1) return i; } return -1; };
    const iCode   = 0;
    const iWork   = col('working'),  iPresent = col('present'), iLOP = col('lop'), iPaid = col('paid days');
    const iBasic  = col('basic'),    iHRA = col('hra'), iConv = col('conveyance'), iOther = col('special allow','other allow'), iGrat = col('gratuity'), iGross = col('gross');
    const iPFEmp  = col('pf (employee)','pf employee'), iESIEmp = col('esi (employee)','esi employee'), iPT = col('prof tax','professional tax','pt'), iTDS = col('tds'), iLWF = col('lwf'), iEMI = col('loan','emi'), iTotDed = col('total deduction');
    const iNet    = col('net'),      iPFEr = col('pf (employer)','pf employer'), iESIEr = col('esi (employer)','esi employer'), iPFAdmin = col('pf admin'), iCTC = col('ctc');
    const iStatus = col('payment status','status'), iRemarks = col('remarks');
    const g = (row, idx) => idx >= 0 ? num(row[idx]) : 0;

    let imported = 0, updated = 0, skipped = 0;
    const errors = [], results = [];

    for (let ri = headerRow + 1; ri < rows.length; ri++) {
      const row = rows[ri];
      const empCode = String(row[iCode] || '').trim().toUpperCase();
      if (!empCode || !/^KC\d+/i.test(empCode)) continue;

      const empRes = await client.query(
        `SELECT e.id, e.first_name, e.last_name, cl.name AS client_name
           FROM employees e LEFT JOIN clients cl ON e.client_id = cl.id
          WHERE UPPER(e.employee_code) = $1 AND e.client_id IS NOT NULL AND e.is_active = true`, [empCode]);
      if (!empRes.rows.length) { errors.push(`Row ${ri+1}: ${empCode} — not an active client employee`); skipped++; continue; }
      const emp = empRes.rows[0];

      // Every figure taken exactly as in the sheet (imported = final).
      const basic = g(row,iBasic), hra = g(row,iHRA), conv = g(row,iConv), other = g(row,iOther), grat = g(row,iGrat);
      const pfEmp = g(row,iPFEmp), esiEmp = g(row,iESIEmp), pt = g(row,iPT), tds = g(row,iTDS), lwf = g(row,iLWF), emi = g(row,iEMI);
      const pfEr = g(row,iPFEr), esiEr = g(row,iESIEr), pfAdmin = g(row,iPFAdmin);
      const work = g(row,iWork), present = g(row,iPresent), lop = g(row,iLOP), paid = g(row,iPaid);
      const gross    = iGross  >= 0 ? g(row,iGross)  : (basic + hra + conv + other + grat);
      const totalDed = iTotDed >= 0 ? g(row,iTotDed) : (pfEmp + esiEmp + pt + tds + lwf + emi);
      const net      = iNet    >= 0 ? g(row,iNet)    : (gross - totalDed);
      const ctc      = iCTC    >= 0 ? g(row,iCTC)    : (gross + pfEr + esiEr + pfAdmin);
      const status   = String(iStatus >= 0 ? row[iStatus] : 'paid').toLowerCase().includes('paid') ? 'paid' : 'pending';
      const remarks  = iRemarks >= 0 ? String(row[iRemarks] || '').trim() : '';

      if (gross <= 0 && net <= 0) { errors.push(`Row ${ri+1}: ${empCode} — no salary figures`); skipped++; continue; }

      const existing = await client.query(
        `SELECT id FROM client_payroll_cycles WHERE employee_id=$1 AND cycle_month=$2 AND cycle_year=$3`, [emp.id, m, y]);

      const params = [
        emp.id, m, y, gross, tds, net,                                  // 1-6 (net → amount_payable)
        basic, hra, conv, other, grat,                                  // 7-11
        pfEmp, esiEmp, pt, lwf, emi, totalDed, net,                     // 12-18 (net → net_salary)
        pfEr, esiEr, pfAdmin, ctc,                                      // 19-22
        work, present, lop, paid, status, remarks,                      // 23-28
      ];

      if (existing.rows.length) {
        if (overwrite !== 'true') { errors.push(`Row ${ri+1}: ${empCode} — already exists (enable Overwrite)`); skipped++; continue; }
        await client.query(
          `UPDATE client_payroll_cycles SET
             gross_salary=$4, tds_amount=$5, amount_payable=$6,
             basic=$7, hra=$8, conveyance=$9, other_allowance=$10, gratuity=$11,
             pf_employee=$12, esi_employee=$13, professional_tax=$14, lwf=$15, loan_emi_recovery=$16,
             total_deductions=$17, net_salary=$18, pf_employer=$19, esi_employer=$20, pf_admin=$21, ctc_monthly=$22,
             working_days=$23, present_days=$24, lop_days=$25, paid_days=$26, status=$27, remarks=$28, updated_at=NOW()
           WHERE employee_id=$1 AND cycle_month=$2 AND cycle_year=$3`, params);
        updated++;
        results.push({ emp_code: empCode, name: `${emp.first_name} ${emp.last_name||''}`.trim(), client: emp.client_name, gross, net, action: 'updated' });
      } else {
        await client.query(
          `INSERT INTO client_payroll_cycles
             (employee_id, cycle_month, cycle_year, gross_salary, tds_amount, amount_payable,
              basic, hra, conveyance, other_allowance, gratuity,
              pf_employee, esi_employee, professional_tax, lwf, loan_emi_recovery, total_deductions, net_salary,
              pf_employer, esi_employer, pf_admin, ctc_monthly,
              working_days, present_days, lop_days, paid_days, status, remarks)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)`, params);
        imported++;
        results.push({ emp_code: empCode, name: `${emp.first_name} ${emp.last_name||''}`.trim(), client: emp.client_name, gross, net, action: 'imported' });
      }
    }

    await client.query('COMMIT');
    res.json({ success: true, summary: { imported, updated, skipped, errors: errors.length }, results, errors,
      message: `${imported} imported, ${updated} updated, ${skipped} skipped` });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[clientPayroll/import]', err.message, err.stack);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// ── GET /api/client-payroll/export — full-breakup Excel for a month ──────────
exports.exportPayroll = async (req, res) => {
  try {
    await ensureSchema();
    const ExcelJS = require('exceljs');
    const m = parseInt(req.query.month) || new Date().getMonth() + 1;
    const y = parseInt(req.query.year)  || new Date().getFullYear();
    const { cycleLabel, periodLabel } = labels(m, y);

    const isClientAdmin = req.user.role === 'client_admin';
    const clientFilter  = isClientAdmin && req.user.client_id ? `AND e.client_id = ${parseInt(req.user.client_id)}` : '';

    const result = await db.query(`
      SELECT cp.*, e.employee_code,
             TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS name,
             d.name AS department, des.title AS designation, e.employee_category,
             e.bank_name, e.bank_account, e.bank_ifsc, cl.name AS client_name
      FROM client_payroll_cycles cp
      JOIN employees e   ON e.id = cp.employee_id
      LEFT JOIN departments  d   ON e.department_id  = d.id
      LEFT JOIN designations des ON e.designation_id = des.id
      LEFT JOIN clients      cl  ON e.client_id      = cl.id
      WHERE cp.cycle_month=$1 AND cp.cycle_year=$2 AND e.client_id IS NOT NULL ${clientFilter}
      ORDER BY COALESCE(cl.name,''), d.name, e.first_name`, [m, y]);
    const rows = result.rows;

    const COLS = [
      'Emp Code','Name','Client','Department',
      'Work Days','Present','LOP','Paid Days',
      'Basic + VDA','HRA','Conveyance','Other Allow','Gratuity','Gross',
      'PF (Emp)','ESI (Emp)','Prof Tax','TDS','LWF','Loan/EMI','Total Ded',
      'Net Salary','PF (Employer)','ESI (Employer)','PF Admin','CTC',
      'Bank','Account No.','IFSC','Status',
    ];
    const NC = COLS.length;

    const wb = new ExcelJS.Workbook(); wb.creator = 'KrishiHR';
    const ws = wb.addWorksheet(`Client Payroll ${MONTH_NAMES[m-1]} ${y}`, { views: [{ state: 'frozen', xSplit: 2, ySplit: 3 }] });

    ws.mergeCells(1, 1, 1, NC);
    const t = ws.getCell(1, 1);
    t.value = `KrishiHR — Client Salary Statement | ${cycleLabel} | Work Period: ${periodLabel}`;
    t.font = { bold: true, size: 13, color: { argb: 'FFFFFFFF' } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } };
    t.alignment = { horizontal: 'center', vertical: 'middle' };
    ws.getRow(1).height = 26;

    const tGross = rows.reduce((a,r)=>a+num(r.gross_salary),0);
    const tNet   = rows.reduce((a,r)=>a+num(r.net_salary || r.amount_payable),0);
    const tCtc   = rows.reduce((a,r)=>a+num(r.ctc_monthly),0);
    ws.mergeCells(2, 1, 2, NC);
    const s2 = ws.getCell(2, 1);
    s2.value = `Payment Month: ${MONTH_NAMES[m-1]} ${y}  |  Employees: ${rows.length}  |  Total Gross: ₹${tGross.toLocaleString('en-IN')}  |  Total Net: ₹${tNet.toLocaleString('en-IN')}  |  Total CTC: ₹${tCtc.toLocaleString('en-IN')}`;
    s2.font = { size: 10, italic: true, color: { argb: 'FF37474F' } };
    s2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8F5E9' } };
    s2.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    ws.getRow(2).height = 18;

    COLS.forEach((h, i) => {
      const c = ws.getCell(3, i + 1);
      c.value = h;
      let bg = 'FF37474F';
      if (i >= 8 && i <= 13) bg = 'FF2E7D32';
      else if (i >= 14 && i <= 21) bg = 'FFC62828';
      else if (i >= 22 && i <= 25) bg = 'FF00695C';
      c.font = { bold: true, size: 9, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      ws.getColumn(i + 1).width = Math.max(9, Math.min(20, h.length + 3));
    });
    ws.getRow(3).height = 28;

    let lastClient = '__X__', rowIdx = 4;
    rows.forEach((r, i) => {
      const clientName = r.client_name || 'CLIENT';
      if (clientName !== lastClient) {
        ws.mergeCells(rowIdx, 1, rowIdx, NC);
        const cc = ws.getCell(rowIdx, 1);
        cc.value = `🏢 ${clientName.toUpperCase()}`;
        cc.font = { bold: true, size: 11, color: { argb: 'FFFFFFFF' } };
        cc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF388E3C' } };
        cc.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
        ws.getRow(rowIdx).height = 20; rowIdx++; lastClient = clientName;
      }
      const bg = i % 2 === 1 ? 'FFF1F8E9' : 'FFFFFFFF';
      const net = num(r.net_salary || r.amount_payable);
      const vals = [
        r.employee_code, r.name, r.client_name || '', r.department || '',
        num(r.working_days) || '', num(r.present_days) || '', num(r.lop_days) || '', num(r.paid_days) || '',
        num(r.basic), num(r.hra), num(r.conveyance), num(r.other_allowance), num(r.gratuity), num(r.gross_salary),
        num(r.pf_employee), num(r.esi_employee), num(r.professional_tax), num(r.tds_amount), num(r.lwf), num(r.loan_emi_recovery), num(r.total_deductions),
        net, num(r.pf_employer), num(r.esi_employer), num(r.pf_admin), num(r.ctc_monthly),
        r.bank_name || '', r.bank_account || '', r.bank_ifsc || '', (r.status || 'paid'),
      ];
      vals.forEach((v, ci) => {
        const cell = ws.getCell(rowIdx, ci + 1);
        cell.value = v;
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
        cell.border = { right: { style: 'hair' }, bottom: { style: 'hair' } };
        cell.font = { size: 9 };
        if (ci >= 8 && ci <= 25) { cell.numFmt = '#,##0'; cell.alignment = { horizontal: 'right', vertical: 'middle' };
          if (ci === 21) { cell.font = { bold: true, size: 10, color: { argb: 'FF1B5E20' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: i%2 ? 'FFC8E6C9':'FFE8F5E9' } }; }
        } else cell.alignment = { vertical: 'middle' };
      });
      ws.getRow(rowIdx).height = 17; rowIdx++;
    });

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', `attachment; filename="KrishiHR_ClientSalary_${MONTH_NAMES[m-1]}${y}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) {
    console.error('[clientPayroll/export]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /api/client-payroll — list records for a month (full breakup) ────────
exports.listPayroll = async (req, res) => {
  try {
    await ensureSchema();
    const { month, year, employee_id } = req.query;

    if (employee_id) {
      const result = await db.query(`
        SELECT cp.*, e.employee_code, cl.name AS client_name
        FROM client_payroll_cycles cp
        JOIN employees e ON e.id = cp.employee_id
        LEFT JOIN clients cl ON e.client_id = cl.id
        WHERE cp.employee_id = $1
        ORDER BY cp.cycle_year DESC, cp.cycle_month DESC LIMIT 6`, [parseInt(employee_id)]);
      return res.json({ success: true, data: result.rows, count: result.rows.length });
    }

    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year)  || new Date().getFullYear();
    const isClientAdmin = req.user.role === 'client_admin';
    const clientFilter  = isClientAdmin && req.user.client_id ? `AND e.client_id = ${parseInt(req.user.client_id)}` : '';

    const result = await db.query(`
      SELECT cp.*, e.employee_code,
             TRIM(CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS name,
             d.name AS department, des.title AS designation, cl.name AS client_name
      FROM client_payroll_cycles cp
      JOIN employees e   ON e.id = cp.employee_id
      LEFT JOIN departments  d   ON e.department_id  = d.id
      LEFT JOIN designations des ON e.designation_id = des.id
      LEFT JOIN clients      cl  ON e.client_id      = cl.id
      WHERE cp.cycle_month=$1 AND cp.cycle_year=$2 AND e.client_id IS NOT NULL ${clientFilter}
      ORDER BY COALESCE(cl.name,''), e.first_name`, [m, y]);

    res.json({ success: true, data: result.rows, count: result.rows.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
