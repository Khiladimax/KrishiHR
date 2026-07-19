const fcm = require('../services/fcmService');
// src/controllers/payrollController.js — COMPLETE FIX WITH DEBUGGING
// The issue: Frontend not sending file + month/year data correctly

const db       = require('../config/db');
const emailSvc = require('../config/emailService');
const XLSX     = require('xlsx');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

// ── Multer setup (memory storage — parse in-memory) ───────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls'].includes(ext)) cb(null, true);
    else cb(new Error('Only Excel files allowed'));
  }
});
exports.uploadMiddleware = upload.single('file');

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

// ── Get Salary Structure ──────────────────────────────────────────────────────
exports.getSalaryStructure = async (req, res) => {
  try {
    const empId = req.params.employee_id || req.query.employee_id || req.user.id;
    const role  = req.user.role;

    // Only admin/hr/accounts or the employee themselves
    if (!['super_admin','accounts','hr'].includes(role) && parseInt(empId) !== req.user.id)
      return res.status(403).json({ success: false, message: 'Access denied' });

    const result = await db.query(
      `SELECT ess.*, e.first_name, e.last_name, e.employee_code,
              d.name AS department_name, des.title AS designation_title
       FROM employee_salary_structure ess
       JOIN employees e ON ess.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       WHERE ess.employee_id=$1`, [empId]
    );
    if (!result.rows.length)
      return res.status(404).json({ success: false, message: 'Salary structure not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Upsert Salary Structure (HR/Admin) ───────────────────────────────────────
exports.upsertSalaryStructure = async (req, res) => {
  try {
    const {
      employee_id, basic = 0, hra = 0, conveyance = 0, special_allowance = 0,
      gratuity = 0, other_allowance = 0,
      pf_applicable = true, esi_applicable = true,
      pt_applicable = true, lwf_applicable = true, tds_applicable = false,
      // HR-defined manual amounts
      pf_employee: pf_emp_in, pf_employer: pf_emr_in, pf_admin: pf_admin_in,
      esi_employee: esi_emp_in, esi_employer: esi_emr_in,
      pt_amount, lwf_amount, tds_monthly, loan_emi_recovery = 0,
      notes
    } = req.body;

    if (!employee_id)
      return res.status(400).json({ success: false, message: 'employee_id required' });

    // Use HR-provided amounts (fall back to 0 if not provided)
    const gross        = parseFloat(basic) + parseFloat(hra) + parseFloat(conveyance)
                       + parseFloat(special_allowance) + parseFloat(gratuity) + parseFloat(other_allowance || 0);
    const pf_employee  = pf_applicable  ? parseFloat(pf_emp_in  || 0) : 0;
    const pf_employer  = pf_applicable  ? parseFloat(pf_emr_in  || 0) : 0;
    const pf_admin     = pf_applicable  ? parseFloat(pf_admin_in || 150) : 0;
    const esi_employee = esi_applicable ? parseFloat(esi_emp_in || 0) : 0;
    const esi_employer = esi_applicable ? parseFloat(esi_emr_in || 0) : 0;
    const pt           = pt_applicable  ? parseFloat(pt_amount  || 0) : 0;
    const lwf          = lwf_applicable ? parseFloat(lwf_amount || 0) : 0;
    const tds          = tds_applicable ? parseFloat(tds_monthly|| 0) : 0;
    const emi          = parseFloat(loan_emi_recovery || 0);

    const total_ded   = pf_employee + esi_employee + pt + lwf + tds + emi;
    const net         = gross - total_ded;
    const ctc         = gross + pf_employer + esi_employer + pf_admin;
    const ctc_monthly = ctc;
    const ctc_annual  = ctc * 12;
    const total_employer_cost = pf_employer + esi_employer + pf_admin;

    // Check if other_allowance column exists; add via ALTER if needed
    await db.query(`ALTER TABLE employee_salary_structure ADD COLUMN IF NOT EXISTS other_allowance NUMERIC(12,2) DEFAULT 0`);
    await db.query(`ALTER TABLE employee_salary_structure ADD COLUMN IF NOT EXISTS loan_emi_recovery NUMERIC(12,2) DEFAULT 0`);
    await db.query(`ALTER TABLE employee_salary_structure ADD COLUMN IF NOT EXISTS tds NUMERIC(12,2) DEFAULT 0`);

    await db.query(
      `INSERT INTO employee_salary_structure
         (employee_id, basic, hra, conveyance, special_allowance, gratuity, other_allowance, gross_salary,
          pf_applicable, esi_applicable, pt_applicable, lwf_applicable, tds_applicable,
          pf_employee, pf_employer, pf_admin, esi_employee, esi_employer,
          professional_tax, lwf, tds, loan_emi_recovery, total_employer_cost,
          total_deductions, net_salary, ctc_monthly, ctc_annual, notes, updated_by, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,NOW())
       ON CONFLICT(employee_id) DO UPDATE SET
         basic=$2, hra=$3, conveyance=$4, special_allowance=$5, gratuity=$6, other_allowance=$7, gross_salary=$8,
         pf_applicable=$9, esi_applicable=$10, pt_applicable=$11, lwf_applicable=$12, tds_applicable=$13,
         pf_employee=$14, pf_employer=$15, pf_admin=$16, esi_employee=$17, esi_employer=$18,
         professional_tax=$19, lwf=$20, tds=$21, loan_emi_recovery=$22, total_employer_cost=$23,
         total_deductions=$24, net_salary=$25, ctc_monthly=$26, ctc_annual=$27, notes=$28,
         updated_by=$29, updated_at=NOW()`,
      [employee_id, basic, hra, conveyance, special_allowance, gratuity, other_allowance||0, gross,
       pf_applicable, esi_applicable, pt_applicable, lwf_applicable, tds_applicable,
       pf_employee, pf_employer, pf_admin, esi_employee, esi_employer,
       pt, lwf, tds, emi, total_employer_cost,
       total_ded, net, ctc_monthly, ctc_annual, notes || null, req.user.id]
    );

    res.json({ success: true, message: 'Salary structure saved', data: { gross, net, ctc: ctc_monthly } });
  } catch (err) {
    console.error("[upsertSalaryStructure error]", err.message, err.detail || "");
    res.status(500).json({ success: false, message: err.message || "Server error" });
  }
};

// ── Upload Payroll Excel (Accounts/HR) ──────────────────────────────────────
exports.uploadPayroll = async (req, res) => {
  const client = await db.getClient();
  try {
    // ✅ DEBUG: Log what we received
    console.log('[uploadPayroll] Request received:');
    console.log('  File:', req.file ? `${req.file.originalname} (${req.file.size} bytes)` : 'NO FILE');
    console.log('  Body:', JSON.stringify(req.body));
    console.log('  User:', `${req.user.id} (${req.user.role})`);

    await client.query('BEGIN');

    // ✅ Validate file
    if (!req.file) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        message: 'Excel file required. Make sure file input is included in form.' 
      });
    }

    // ✅ Validate month/year
    const { month, year } = req.body;
    if (!month || !year) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        message: 'month and year required in form data' 
      });
    }

    const monthNum = parseInt(month);
    const yearNum  = parseInt(year);
    const monthName = MONTH_NAMES[monthNum - 1];

    // Validate month/year ranges
    if (monthNum < 1 || monthNum > 12 || yearNum < 2020 || yearNum > 2100) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid month (1-12) or year (2020-2100)' 
      });
    }

    // Check duplicate
    const dup = await client.query(
      `SELECT id FROM payroll_uploads WHERE month=$1 AND year=$2 AND status='processed'`,
      [monthNum, yearNum]
    );
    if (dup.rows.length) {
      await client.query('ROLLBACK');
      return res.status(409).json({ 
        success: false, 
        message: `${monthName} ${yearNum} payroll already processed` 
      });
    }

    // Parse Excel
    let wb, ws, rows;
    try {
      wb   = XLSX.read(req.file.buffer, { type: 'buffer' });
      ws   = wb.Sheets[wb.SheetNames[0]];
      rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null });
      console.log(`[uploadPayroll] Excel parsed: ${rows.length} rows, sheet: "${wb.SheetNames[0]}"`);
    } catch (parseErr) {
      return res.status(400).json({ 
        success: false, 
        message: `Failed to parse Excel: ${parseErr.message}` 
      });
    }

    // Find header row (contains 'Emp Code')
    let headerIdx = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      if (rows[i] && rows[i].some(c => String(c || '').toLowerCase().includes('emp code'))) {
        headerIdx = i;
        break;
      }
    }
    if (headerIdx === -1) {
      return res.status(400).json({ 
        success: false, 
        message: 'Could not find header row with "Emp Code" — check Excel format' 
      });
    }
    console.log(`[uploadPayroll] Header found at row ${headerIdx}`);

    // ✅ Clean headers: remove newlines and extra spaces
    const headers = rows[headerIdx].map(h => 
      String(h || '')
        .toLowerCase()
        .replace(/\n/g, ' ')  // Remove newlines
        .replace(/\s+/g, ' ') // Collapse multiple spaces
        .trim()
    );
    const col = (name) => headers.findIndex(h => h.includes(name));

    // Column indices mapped exactly from Excel template headers
    // Col 0: Emp Code, Col 1: Full Name, Col 2: Present Days
    // Col 3: Basic, Col 4: HRA, Col 5: Conveyance, Col 6: Gratuity, Col 7: Other Allowance
    // Col 8: PF Employee, Col 9: ESI Employee, Col 10: PT, Col 11: TDS, Col 12: LWF
    // Col 13: EMI Recovery, Col 14: Total Deductions
    // Col 15: PF Employer, Col 16: ESI Employer, Col 17: PF Admin
    // Col 18: Gross, Col 19: Net, Col 20: CTC/Month, Col 21: CTC/Annual
    // Col 22: Payment Status, Col 23: Remarks
    const iEmpCode    = col('emp code') !== -1 ? col('emp code') : col('full name') !== -1 ? col('full name') : col('name');
    const iPresentDays= col('present');
    const iWorkDays   = col('working');
    const iLOP        = col('lop');
    const iPaidDays   = -1; // not in template
    const iBasic      = col('basic');
    const iHRA        = col('hra');
    const iConveyance = col('conveyance') !== -1 ? col('conveyance') : col('travel');
    const iGratuity   = col('gratuity');
    const iOtherAllow = col('other');
    const iPFEmp      = col('pf employee') !== -1 ? col('pf employee') : col('pf emp');
    const iESIEmp     = col('esi employee') !== -1 ? col('esi employee') : col('esi');
    const iPT         = col('professional') !== -1 ? col('professional') : col('prof');
    const iTDS        = col('tds') !== -1 ? col('tds') : col('income tax') !== -1 ? col('income tax') : col('income_tax');
    const iLWF        = col('lwf');
    const iLoanEMI    = col('emi recovery') !== -1 ? col('emi recovery') : col('loan') !== -1 ? col('loan') : col('emi');
    const iTotalDed   = col('total emp') !== -1 ? col('total emp') : col('total');
    const iPFEr       = col('pf employer') !== -1 ? col('pf employer') : col('pf er');
    const iESIEr      = col('esi employer') !== -1 ? col('esi employer') : col('esi er');
    const iPFAdmin    = col('pf admin');
    const iGross      = col('gross');
    const iNetPay     = col('net');
    const iCTCMonth   = col('ctc') !== -1 ? col('ctc') : col('ctc / month') !== -1 ? col('ctc / month') : -1;
    const iCTCAnnual  = col('annual') !== -1 ? col('annual') : -1;
    const iStatus     = col('payment');
    const iRemarks    = col('remarks');

    if (iEmpCode === -1 || iNetPay === -1) {
      console.warn('[uploadPayroll] Column mapping failed:');
      console.warn('  iEmpCode:', iEmpCode, '→', iEmpCode !== -1 ? `"${headers[iEmpCode]}"` : 'NOT FOUND');
      console.warn('  iNetPay:', iNetPay, '→', iNetPay !== -1 ? `"${headers[iNetPay]}"` : 'NOT FOUND');
      console.warn('  Available headers:', headers);
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid Excel format — missing required columns (Emp Code, Net Pay)' 
      });
    }

    // Create upload record
    const uploadRec = await client.query(
      `INSERT INTO payroll_uploads(uploaded_by, filename, month, year, row_count, status)
       VALUES($1,$2,$3,$4,0,'pending') RETURNING id`,
      [req.user.id, req.file.originalname, monthNum, yearNum]
    );
    const uploadId = uploadRec.rows[0].id;
    console.log(`[uploadPayroll] Upload record created: id=${uploadId}`);

    let processed = 0, skipped = 0, errors = [];

    // Process data rows
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[iEmpCode]) continue;

      const empCodeOrName = String(row[iEmpCode] || '').trim();
      if (!empCodeOrName) continue;
      // Skip formula hint / instruction rows (start with emoji or non-letter/digit)
      if (!/^[a-zA-Z0-9]/i.test(empCodeOrName)) continue;

      // Find employee — try emp code first, then full name
      let emp;
      if (empCodeOrName.startsWith('KC')) {
        emp = await client.query(
          `SELECT id FROM employees WHERE employee_code=$1 AND is_active=true`, 
          [empCodeOrName]
        );
      } else {
        // Name-based lookup
        const parts = empCodeOrName.split(/\s+/);
        const firstName = parts[0];
        const lastName  = parts.slice(1).join(' ');
        emp = await client.query(
          `SELECT id FROM employees
           WHERE is_active=true
             AND (LOWER(CONCAT(first_name,' ',last_name)) = LOWER($1)
               OR (LOWER(first_name)=LOWER($2) AND LOWER(last_name)=LOWER($3)))`,
          [empCodeOrName, firstName, lastName]
        );
      }

      if (!emp.rows.length) {
        skipped++;
        errors.push(`Row ${i}: "${empCodeOrName}" → employee not found`);
        console.warn(`[uploadPayroll] Employee not found: "${empCodeOrName}" at row ${i}`);
        continue;
      }

      const empId = emp.rows[0].id;

      const n = (v) => parseFloat(v) || 0;
      const workDays    = n(row[iWorkDays])   || 26;
      const presentDays = n(row[iPresentDays]);
      const lopDays     = n(row[iLOP]);
      const paidDays    = n(row[iPaidDays])   || presentDays;
      const basic       = n(row[iBasic]);
      const hra         = n(row[iHRA]);
      const conveyance  = n(row[iConveyance]);
      const otherAllow  = n(row[iOtherAllow]);
      const gratuity    = n(row[iGratuity]);
      const gross       = n(row[iGross]);
      // Read ALL values directly from Excel — zero auto-calculation
      const pfEmp       = iPFEmp    >= 0 ? n(row[iPFEmp])    : 0;
      const esiEmp      = iESIEmp   >= 0 ? n(row[iESIEmp])   : 0;
      const pt          = iPT       >= 0 ? n(row[iPT])       : 0;
      const tds         = iTDS      >= 0 ? n(row[iTDS])      : 0;
      const lwf         = iLWF      >= 0 ? n(row[iLWF])      : 0;
      const loanEmi     = iLoanEMI  >= 0 ? n(row[iLoanEMI])  : 0;
      const totalDed    = iTotalDed >= 0 ? n(row[iTotalDed]) : 0;
      const pfEr        = iPFEr     >= 0 ? n(row[iPFEr])     : 0;
      const esiEr       = iESIEr    >= 0 ? n(row[iESIEr])    : 0;
      const pfAdmin     = iPFAdmin  >= 0 ? n(row[iPFAdmin])  : 0;
      const netPay      = n(row[iNetPay]);
      const ctcMonth    = iCTCMonth >= 0 ? n(row[iCTCMonth]) : 0;
      const ctcAnnual   = iCTCAnnual>= 0 ? n(row[iCTCAnnual]): 0;
      const statusRaw   = String(row[iStatus] || 'paid').toLowerCase().trim();
      const status      = statusRaw === 'paid' ? 'paid' : 'pending';

      // Upsert payroll record
      await client.query(
        `INSERT INTO payroll
           (employee_id, month, year, working_days, present_days, lop_days, paid_days,
            basic, hra, conveyance, special_allowance, gratuity, gross_salary,
            pf_employee, pf_employer, pf_admin, esi_employee, esi_employer, professional_tax, lwf, loan_emi_recovery, tds,
            total_deductions, net_salary, ctc_monthly, status, payment_date, upload_id)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
         ON CONFLICT(employee_id, month, year) DO UPDATE SET
           working_days=$4, present_days=$5, lop_days=$6, paid_days=$7,
           basic=$8, hra=$9, conveyance=$10, special_allowance=$11, gratuity=$12, gross_salary=$13,
           pf_employee=$14, pf_employer=$15, pf_admin=$16, esi_employee=$17, esi_employer=$18,
           professional_tax=$19, lwf=$20, loan_emi_recovery=$21, tds=$22,
           total_deductions=$23, net_salary=$24, ctc_monthly=$25, status=$26, payment_date=$27, upload_id=$28`,
        [empId, monthNum, yearNum, workDays, presentDays, lopDays, paidDays,
         basic, hra, conveyance, otherAllow, gratuity, gross,
         pfEmp, pfEr, pfAdmin, esiEmp, esiEr, pt, lwf, loanEmi, tds,
         totalDed, netPay, ctcMonth, status,
         status === 'paid' ? `${yearNum}-${String(monthNum).padStart(2,'0')}-28` : null,
         uploadId]
      );

      // ── Auto-update EMI based on payroll month vs EMI start month ──
      // installments_paid = months elapsed from emi_start to payroll month (no double increment on re-upload)
      try {
        const loanRes = await client.query(
          `SELECT id, monthly_emi, total_installments, emi_start_month, emi_start_year, amount
           FROM advance_salary
           WHERE employee_id=$1 AND status='disbursed' AND total_installments > 0
           ORDER BY approved_at ASC LIMIT 1`,
          [empId]
        );
        if (loanRes.rows.length) {
          const loan        = loanRes.rows[0];
          const startMonth  = parseInt(loan.emi_start_month);
          const startYear   = parseInt(loan.emi_start_year);
          const rawPaid     = ((yearNum - startYear) * 12 + (monthNum - startMonth)) + 1;
          const finalPaid   = Math.min(Math.max(rawPaid, 0), parseInt(loan.total_installments));
          const balanceRem  = Math.max(0, parseFloat(loan.amount) - (finalPaid * parseFloat(loan.monthly_emi)));
          const isCleared   = finalPaid >= parseInt(loan.total_installments);
          await client.query(
            `UPDATE advance_salary
             SET installments_paid=$1, balance_remaining=$2,
                 status=CASE WHEN $3 THEN 'cleared' ELSE 'disbursed' END,
                 updated_at=NOW()
             WHERE id=$4`,
            [finalPaid, balanceRem, isCleared, loan.id]
          );
        }
      } catch(emiErr) { console.error('[EMI update]', emiErr.message); }

      // ── Auto-record salary in project_expenditures for assigned employees ──
      try {
        const projCtrl = require('./projectController');
        // Get the payroll row id we just upserted
        const payRow = await client.query(
          `SELECT id FROM payroll WHERE employee_id=$1 AND month=$2 AND year=$3`,
          [empId, monthNum, yearNum]
        );
        if (payRow.rows.length) {
          await projCtrl.hookPayrollExpenditure(empId, netPay, monthNum, yearNum, payRow.rows[0].id);
        }
      } catch(hookErr) { console.error('[payroll.hook]', hookErr.message); }

      // EMI amount is read directly from Excel (loanEmi) — no auto installment tracking

      processed++;
    }

    // Mark upload as processed
    await client.query(
      `UPDATE payroll_uploads
       SET status='processed', row_count=$1, processed_by=$2, processed_at=NOW()
       WHERE id=$3`,
      [processed, req.user.id, uploadId]
    );

    await client.query('COMMIT');
    console.log(`[uploadPayroll] Complete: processed=${processed}, skipped=${skipped}, upload_id=${uploadId}`);

    // Send payslip notifications to all processed employees (async)
    const processedEmps = await db.query(
      `SELECT employee_id FROM payroll WHERE month=$1 AND year=$2 AND upload_id=$3`,
      [monthNum, yearNum, uploadId]
    );
    for (const row of processedEmps.rows) {
      emailSvc.notifyPayslipReleased(row.employee_id, monthName, yearNum).catch(console.error);
      fcm.sendToEmployee(db, row.employee_id,
        '💰 Payslip Released',
        `Your payslip for ${monthName} ${yearNum} is ready. Tap to view.`,
        { screen: 'payroll', channel: 'krishihr_general' }
      ).catch(() => {});
    }

    res.json({
      success: true,
      message: `${monthName} ${yearNum} payroll uploaded. ${processed} processed, ${skipped} skipped.`,
      data: { upload_id: uploadId, processed, skipped, month: monthNum, year: yearNum, errors: errors.slice(0, 10) }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[uploadPayroll] Error:', err.message);
    res.status(500).json({ success: false, message: err.message || 'Server error' });
  } finally { 
    client.release(); 
  }
};

// ── Get Payroll List ──────────────────────────────────────────────────────────
exports.getPayroll = async (req, res) => {
  try {
    const { month, year, employee_id, status } = req.query;
    const userId   = req.user.id;
    const userRole = req.user.role;

    let conds = [], params = [], idx = 1;

    if (!['super_admin','accounts','hr','client_admin'].includes(userRole)) {
      conds.push(`p.employee_id=$${idx++}`);
      params.push(userId);
    } else if (userRole === 'client_admin') {
      // Client admin sees only their client's payroll
      conds.push(`e.client_id=$${idx++}`);
      params.push(req.user.client_id);
      if (employee_id) {
        conds.push(`p.employee_id=$${idx++}`);
        params.push(employee_id);
      }
    } else if (employee_id) {
      conds.push(`p.employee_id=$${idx++}`);
      params.push(employee_id);
    }

    if (month)  { conds.push(`p.month=$${idx++}`);  params.push(parseInt(month)); }
    if (year)   { conds.push(`p.year=$${idx++}`);   params.push(parseInt(year)); }
    if (status) { conds.push(`p.status=$${idx++}`); params.push(status); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const result = await db.query(
      `SELECT p.*,
              CONCAT(e.first_name,' ',e.last_name) AS employee_name,
              e.employee_code, d.name AS department_name,
              des.title AS designation_title
       FROM payroll p
       JOIN employees e ON p.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       ${where}
       ORDER BY p.year DESC, p.month DESC, e.first_name`, params
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Get Payslip (single employee, single month) ───────────────────────────────
exports.getPayslip = async (req, res) => {
  try {
    const { employee_id, month, year } = req.query;
    const userId   = req.user.id;
    const userRole = req.user.role;
    console.log(`[getPayslip] userId=${userId} role=${userRole} employee_id=${employee_id} month=${month} year=${year}`);

    const empId = employee_id || userId;
    if (!['super_admin','accounts','hr'].includes(userRole) && parseInt(empId) !== userId)
      return res.status(403).json({ success: false, message: 'Access denied' });

    const result = await db.query(
      `SELECT p.*,
              e.first_name, e.last_name,
              CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
              e.employee_code, e.email,
              e.pan_number, e.uan_number, e.pf_number, e.bank_name, e.bank_account,
              e.bank_ifsc, e.date_of_birth, e.joining_date,
              e.city, e.aadhar_number, e.employment_type,
              d.name AS department_name, des.title AS designation_title,
              CONCAT(m.first_name,' ',m.last_name) AS manager_name
       FROM payroll p
       JOIN employees e ON p.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       LEFT JOIN employees m ON e.reporting_manager_id = m.id
       WHERE p.employee_id=$1 AND p.month=$2 AND p.year=$3`,
      [empId, parseInt(month), parseInt(year)]
    );

    if (!result.rows.length) {
      console.error(`[getPayslip] No row found for employee_id=${empId} month=${month} year=${year}`);
      return res.status(404).json({ success: false, message: 'Payslip not found' });
    }

    const ps = result.rows[0];
    ps.month_name = MONTH_NAMES[ps.month - 1];

    // Derive pf_employer, pf_admin if not stored in DB
    const pfEmp = parseFloat(ps.pf_employee || 0);
    if (pfEmp > 0) {
      if (!parseFloat(ps.pf_employer)) ps.pf_employer = pfEmp;
      if (!parseFloat(ps.pf_admin))    ps.pf_admin    = Math.round(pfEmp * 0.005 / 0.12);
    }
    const gross = parseFloat(ps.gross_salary || 0);
    if (!parseFloat(ps.professional_tax) && gross >= 10000) ps.professional_tax = 200;
    if (gross > 21000) { ps.esi_employee = 0; ps.esi_employer = 0; }

    // Recompute totals for display
    const empDed =
      parseFloat(ps.pf_employee      || 0) +
      parseFloat(ps.esi_employee     || 0) +
      parseFloat(ps.professional_tax || 0) +
      parseFloat(ps.lwf              || 0) +
      parseFloat(ps.tds              || 0) +
      parseFloat(ps.loan_emi_recovery|| 0);
    const emprContrib =
      parseFloat(ps.pf_employer      || 0) +
      parseFloat(ps.pf_admin         || 0) +
      parseFloat(ps.esi_employer     || 0);
    ps.total_deductions_display = empDed + emprContrib;
    ps.net_salary_display = gross - empDed;

    const paidDays    = parseFloat(ps.paid_days    || 0);
    const presentDays = parseFloat(ps.present_days || 0);
    ps.paid_leave = Math.max(0, paidDays - presentDays);

    // Fetch leave balance
    const leaveCount = await db.query(
      `SELECT COALESCE(SUM(
         CASE WHEN status='approved' THEN
           (to_date - from_date + 1)
         ELSE 0 END
       ), 0) AS leave_days
       FROM leave_requests
       WHERE employee_id=$1
         AND EXTRACT(MONTH FROM from_date)=$2
         AND EXTRACT(YEAR FROM from_date)=$3
         AND status='approved'`,
      [empId, parseInt(month), parseInt(year)]
    );
    ps.paid_leave = parseFloat(leaveCount.rows[0]?.leave_days || ps.paid_leave);

    res.json({ success: true, data: ps });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Get Upload History ────────────────────────────────────────────────────────
exports.getUploads = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT pu.*,
              CONCAT(u.first_name,' ',u.last_name) AS uploaded_by_name,
              CONCAT(p.first_name,' ',p.last_name) AS processed_by_name
       FROM payroll_uploads pu
       JOIN employees u ON pu.uploaded_by = u.id
       LEFT JOIN employees p ON pu.processed_by = p.id
       ORDER BY pu.created_at DESC LIMIT 50`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Get All Salary Structures (HR/Admin/Client Admin) ────────────────────────
exports.getAllSalaryStructures = async (req, res) => {
  try {
    const clientFilter = req.user.role === 'client_admin' && req.user.client_id
      ? `AND e.client_id = ${parseInt(req.user.client_id)}` : '';
    const result = await db.query(
      `SELECT ess.*,
              CONCAT(e.first_name,' ',e.last_name) AS employee_name,
              e.employee_code, d.name AS department_name
       FROM employee_salary_structure ess
       JOIN employees e ON ess.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       WHERE e.is_active=true ${clientFilter}
       ORDER BY d.name, e.first_name`
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Form 16 — Generate Part A + Part B ───────────────────────────────────────
// Financial Year: April to March (e.g. FY 2024-25 = Apr 2024 to Mar 2025)
exports.getForm16 = async (req, res) => {
  try {
    const reqUser = req.user;
    const empId   = req.query.employee_id ? parseInt(req.query.employee_id) : reqUser.id;
    const fy      = req.query.fy; // e.g. "2024-25"

    // Only admin/hr/accounts can view others; employees can only view their own
    if (!['super_admin','admin','hr','accounts'].includes(reqUser.role) && empId !== reqUser.id)
      return res.status(403).json({ success: false, message: 'Access denied' });

    if (!fy || !/^\d{4}-\d{2}$/.test(fy))
      return res.status(400).json({ success: false, message: 'fy required (e.g. 2024-25)' });

    const startYear = parseInt(fy.split('-')[0]);
    const endYear   = startYear + 1;

    // Months: Apr(4)–Dec(12) of startYear, Jan(1)–Mar(3) of endYear
    const payrollRows = await db.query(
      `SELECT p.*,
              e.first_name, e.last_name, e.employee_code, e.pan_number, e.uan_number,
              e.pf_number, e.date_of_birth, e.joining_date, e.city, e.aadhar_number,
              d.name AS department_name, des.title AS designation_title
       FROM payroll p
       JOIN employees e ON p.employee_id = e.id
       LEFT JOIN departments d  ON e.department_id  = d.id
       LEFT JOIN designations des ON e.designation_id = des.id
       WHERE p.employee_id = $1
         AND p.status IN ('processed','paid','pending')
         AND (
           (p.year = $2 AND p.month >= 4) OR
           (p.year = $3 AND p.month <= 3)
         )
       ORDER BY p.year, p.month`,
      [empId, startYear, endYear]
    );

    if (!payrollRows.rows.length)
      return res.status(404).json({ success: false, message: `No payroll data found for FY ${fy}` });

    // Aggregate annual figures
    let grossTotal = 0, basicTotal = 0, hraTotal = 0, convTotal = 0,
        specialTotal = 0, pfEmpTotal = 0, pfEmprTotal = 0, esiEmpTotal = 0,
        ptTotal = 0, lwfTotal = 0, tdsTotal = 0, loanTotal = 0, netTotal = 0;

    const monthlyBreakdown = payrollRows.rows.map(p => {
      const gross   = parseFloat(p.gross_salary       || 0);
      const basic   = parseFloat(p.basic              || 0);
      const hra     = parseFloat(p.hra                || 0);
      const conv    = parseFloat(p.conveyance         || 0);
      const special = parseFloat(p.special_allowance  || 0);
      const pfEmp   = parseFloat(p.pf_employee        || 0);
      const pfEmpr  = parseFloat(p.pf_employer        || 0);
      const esiEmp  = parseFloat(p.esi_employee       || 0);
      const pt      = parseFloat(p.professional_tax   || 0);
      const lwf     = parseFloat(p.lwf                || 0);
      const tds     = parseFloat(p.tds                || 0);
      const loan    = parseFloat(p.loan_emi_recovery  || 0);
      const net     = parseFloat(p.net_salary         || 0);

      grossTotal   += gross;  basicTotal  += basic;   hraTotal    += hra;
      convTotal    += conv;   specialTotal+= special; pfEmpTotal  += pfEmp;
      pfEmprTotal  += pfEmpr; esiEmpTotal += esiEmp;  ptTotal     += pt;
      lwfTotal     += lwf;    tdsTotal    += tds;     loanTotal   += loan;
      netTotal     += net;

      return {
        month: MONTH_NAMES[p.month - 1], year: p.year,
        gross, basic, hra, conv, special,
        pf_employee: pfEmp, pf_employer: pfEmpr, esi_employee: esiEmp,
        professional_tax: pt, lwf, tds, loan_emi_recovery: loan, net_salary: net
      };
    });

    const emp = payrollRows.rows[0];

    // ── Part A — TDS details ───────────────────────────────────────────────
    const partA = {
      employer_name:    'Krishi Care And Management Services Pvt Ltd',
      employer_tan:     process.env.EMPLOYER_TAN || 'MUMK24593C',
      employer_address: process.env.EMPLOYER_ADDRESS || 'Office No. 617, 6th Floor, Hubtown Viva, Western Express Highway, Shankarwadi, Jogeshwari (East), Mumbai, Maharashtra — 400060',
      employee_name:    `${emp.first_name} ${emp.last_name}`,
      employee_pan:     emp.pan_number   || 'NOT PROVIDED',
      employee_code:    emp.employee_code,
      financial_year:   fy,
      assessment_year:  `${endYear}-${String(endYear + 1).slice(2)}`,
      total_tds_deducted:   Math.round(tdsTotal),
      total_tds_deposited:  Math.round(tdsTotal),
      quarter_summary: [
        { quarter: 'Q1 (Apr–Jun)', months: ['April','May','June'] },
        { quarter: 'Q2 (Jul–Sep)', months: ['July','August','September'] },
        { quarter: 'Q3 (Oct–Dec)', months: ['October','November','December'] },
        { quarter: 'Q4 (Jan–Mar)', months: ['January','February','March'] }
      ].map(q => {
        const qRows = monthlyBreakdown.filter(m => q.months.includes(m.month));
        return {
          quarter: q.quarter,
          tds_deducted:  Math.round(qRows.reduce((s, r) => s + r.tds, 0)),
          tds_deposited: Math.round(qRows.reduce((s, r) => s + r.tds, 0))
        };
      })
    };

    // ── Part B — Salary & deduction details ───────────────────────────────
    // Standard deduction u/s 16 = ₹50,000 (FY 2023-24 onwards)
    const stdDeduction    = 50000;
    const grossIncome     = Math.round(grossTotal);
    const taxableIncome   = Math.max(0, grossIncome - stdDeduction);

    // 80C: PF employee contribution (capped at ₹1.5L)
    const sec80C          = Math.min(Math.round(pfEmpTotal), 150000);
    const totalExemptions = sec80C;
    const netTaxableIncome= Math.max(0, taxableIncome - totalExemptions);

    const partB = {
      financial_year: fy,
      assessment_year: `${endYear}-${String(endYear + 1).slice(2)}`,
      // Gross salary breakdown
      basic:             Math.round(basicTotal),
      hra:               Math.round(hraTotal),
      conveyance:        Math.round(convTotal),
      special_allowance: Math.round(specialTotal),
      gross_salary:      grossIncome,
      // Deductions
      standard_deduction: stdDeduction,
      income_chargeable:  taxableIncome,
      // Chapter VI-A
      sec_80c_pf:         sec80C,
      total_deductions_vi_a: totalExemptions,
      net_taxable_income: netTaxableIncome,
      // Tax
      total_tds:          Math.round(tdsTotal),
      // Statutory deductions (not tax deductions, but shown for reference)
      pf_employee_total:  Math.round(pfEmpTotal),
      pf_employer_total:  Math.round(pfEmprTotal),
      esi_employee_total: Math.round(esiEmpTotal),
      professional_tax_total: Math.round(ptTotal),
      lwf_total:          Math.round(lwfTotal),
      net_salary_total:   Math.round(netTotal)
    };

    res.json({
      success: true,
      data: {
        employee: {
          name:        `${emp.first_name} ${emp.last_name}`,
          code:        emp.employee_code,
          pan:         emp.pan_number   || 'NOT PROVIDED',
          uan:         emp.uan_number   || '',
          pf_number:   emp.pf_number    || '',
          department:  emp.department_name   || '',
          designation: emp.designation_title || '',
          dob:         emp.date_of_birth     || ''
        },
        financial_year:     fy,
        assessment_year:    partA.assessment_year,
        part_a:             partA,
        part_b:             partB,
        monthly_breakdown:  monthlyBreakdown
      }
    });
  } catch (err) {
    console.error('[getForm16 Error]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Form 16 — List available financial years for an employee ────────────────
exports.getForm16Years = async (req, res) => {
  try {
    const reqUser = req.user;
    const empId   = req.query.employee_id ? parseInt(req.query.employee_id) : reqUser.id;

    if (!['super_admin','admin','hr','accounts'].includes(reqUser.role) && empId !== reqUser.id)
      return res.status(403).json({ success: false, message: 'Access denied' });

    const rows = await db.query(
      `SELECT DISTINCT year, month FROM payroll
       WHERE employee_id=$1 AND status IN ('processed','paid','pending')
       ORDER BY year, month`,
      [empId]
    );

    // Build financial years
    const fySet = new Set();
    rows.rows.forEach(r => {
      const fy = r.month >= 4
        ? `${r.year}-${String(r.year + 1).slice(2)}`
        : `${r.year - 1}-${String(r.year).slice(2)}`;
      fySet.add(fy);
    });

    // Only include FYs where we have at least some payroll data
    const fys = Array.from(fySet).sort().reverse();
    res.json({ success: true, data: fys });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Download Payroll Template Excel ──────────────────────────────────────────
// GET /api/payroll/template?month=5&year=2026
// Pre-fills all active employees with their salary structure so accounts just
// fills in Working Days, Present Days, LOP and any adjustments
exports.downloadPayrollTemplate = async (req, res) => {
  try {
    const XLSX = require('xlsx');
    const { month, year } = req.query;
    const m = parseInt(month) || new Date().getMonth() + 1;
    const y = parseInt(year)  || new Date().getFullYear();
    const monthName = MONTH_NAMES[m - 1];
    const daysInMonth = new Date(y, m, 0).getDate();

    // ── Fetch all active employees with salary structure ──────────────────
    const empResult = await db.query(`
      SELECT e.id, e.employee_code,
             CONCAT(e.first_name,' ',e.last_name) AS full_name,
             d.name AS department, des.title AS designation,
             e.employee_category, e.employment_type,
             COALESCE(s.basic,           e.basic_salary,       0) AS basic,
             COALESCE(s.hra,             e.hra,                0) AS hra,
             COALESCE(s.conveyance,      e.conveyance,         0) AS conveyance,
             COALESCE(s.special_allowance,e.special_allowance, 0) AS special_allowance,
             COALESCE(s.gratuity,                              0) AS gratuity,
             COALESCE(s.gross_salary,                          0) AS gross_salary,
             COALESCE(s.pf_employee,                           0) AS pf_employee,
             COALESCE(s.esi_employee,                          0) AS esi_employee,
             COALESCE(s.professional_tax,                      0) AS professional_tax,
             COALESCE(s.lwf,                                   0) AS lwf,
             COALESCE(s.tds,                                   0) AS tds,
             COALESCE(s.pf_employer,                           0) AS pf_employer,
             COALESCE(s.esi_employer,                          0) AS esi_employer,
             COALESCE(s.pf_admin,                              0) AS pf_admin,
             COALESCE(s.total_deductions,                      0) AS total_deductions,
             COALESCE(s.net_salary,                            0) AS net_salary,
             COALESCE(s.ctc_monthly,                           0) AS ctc_monthly
      FROM employees e
      LEFT JOIN departments  d   ON e.department_id  = d.id
      LEFT JOIN designations des ON e.designation_id = des.id
      LEFT JOIN employee_salary_structure s ON s.employee_id = e.id
      WHERE e.is_active = true
      ORDER BY d.name, e.first_name`);

    const employees = empResult.rows;

    // ── Build Excel ───────────────────────────────────────────────────────
    const wb = XLSX.utils.book_new();

    // ── Sheet 1: Payroll Input Template ───────────────────────────────────
    const HEADERS = [
      'Emp Code', 'Full Name', 'Department', 'Designation', 'Category',
      'Working Days', 'Present Days', 'LOP Days', 'Paid Days',
      'Basic', 'HRA', 'Conveyance', 'Other Allowance', 'Gratuity', 'Gross Salary',
      'PF (Employee)', 'ESI (Employee)', 'Prof Tax', 'LWF', 'TDS',
      'Loan/EMI Deduction (Active EMI)', 'EMI Progress', 'Total Deductions',
      'Net Pay',
      'PF (Employer)', 'ESI (Employer)', 'PF Admin', 'CTC (Monthly)',
      'Payment Status', 'Remarks'
    ];

    const rows = [
      // Row 0: Title
      [`KrishiHR — Payroll Input Template | ${monthName} ${y} | Total Working Days: ${daysInMonth}`],
      // Row 1: Instructions
      [`⚠️  FILL ONLY: Working Days, Present Days, LOP Days, Loan/EMI Deduction, Remarks. Salary figures are pre-filled from salary structures. Net Pay = auto-calculated. Payment Status: Paid / Hold / Pending`],
      // Row 2: Empty spacer
      [],
      // Row 3: Headers
      HEADERS,
      // Data rows
      ...await Promise.all(employees.map(async e => {
        const gross   = parseFloat(e.gross_salary)   || 0;
        // Fetch active EMI for this employee
        const emiRes  = await db.query(
          `SELECT monthly_emi, installments_paid, total_installments
           FROM advance_salary
           WHERE employee_id=$1 AND status='disbursed' AND installments_paid < total_installments
           ORDER BY approved_at ASC LIMIT 1`, [e.id]);
        const activeEMI = emiRes.rows[0] || null;
        const pf      = parseFloat(e.pf_employee)    || 0;
        const esi     = parseFloat(e.esi_employee)   || 0;
        const pt      = parseFloat(e.professional_tax) || 0;
        const lwf     = parseFloat(e.lwf)            || 0;
        const tds     = parseFloat(e.tds)            || 0;
        const totalDed= parseFloat(e.total_deductions) || (pf + esi + pt + lwf + tds);
        const net     = parseFloat(e.net_salary)     || Math.max(0, gross - totalDed);
        return [
          e.employee_code,
          e.full_name,
          e.department  || '',
          e.designation || '',
          e.employee_category || '',
          daysInMonth,       // Working Days — pre-filled, accounts can adjust
          '',                // Present Days — FILL THIS
          '',                // LOP Days — FILL THIS
          '',                // Paid Days — calculated by system on upload
          parseFloat(e.basic)             || 0,
          parseFloat(e.hra)               || 0,
          parseFloat(e.conveyance)        || 0,
          parseFloat(e.special_allowance) || 0,
          parseFloat(e.gratuity)          || 0,
          gross,
          pf,
          esi,
          pt,
          lwf,
          tds,
          parseFloat(activeEMI ? activeEMI.monthly_emi : 0),
          activeEMI
            ? (parseInt(activeEMI.installments_paid||0)+1) + '/' + activeEMI.total_installments
            : '',
          totalDed,
          net,
          parseFloat(e.pf_employer)  || 0,
          parseFloat(e.esi_employer) || 0,
          parseFloat(e.pf_admin)     || 0,
          parseFloat(e.ctc_monthly)  || 0,
          'Paid',    // Payment Status default
          '',        // Remarks
        ];
      })),
    ];

    const ws1 = XLSX.utils.aoa_to_sheet(rows);

    // Column widths
    ws1['!cols'] = [
      {wch:10},{wch:24},{wch:16},{wch:22},{wch:12},
      {wch:11},{wch:11},{wch:9},{wch:9},
      {wch:10},{wch:8},{wch:10},{wch:14},{wch:9},{wch:12},
      {wch:12},{wch:12},{wch:9},{wch:6},{wch:8},
      {wch:16},{wch:12},{wch:14},
      {wch:10},
      {wch:12},{wch:12},{wch:9},{wch:14},
      {wch:14},{wch:20}
    ];

    // Freeze top 4 rows and first 2 cols
    ws1['!freeze'] = { xSplit: 2, ySplit: 4 };

    // Merge title row across all cols
    ws1['!merges'] = [
      { s:{r:0,c:0}, e:{r:0,c:HEADERS.length-1} },
      { s:{r:1,c:0}, e:{r:1,c:HEADERS.length-1} },
    ];

    XLSX.utils.book_append_sheet(wb, ws1, `Payroll ${monthName} ${y}`);

    // ── Sheet 2: Instructions ─────────────────────────────────────────────
    const instrRows = [
      ['KrishiHR Payroll Template — How to Fill'],
      [''],
      ['COLUMNS TO FILL (highlighted in template):'],
      ['Column', 'What to Enter'],
      ['Working Days',      `Total working days in ${monthName} ${y} (pre-filled as ${daysInMonth})`],
      ['Present Days',      'Actual days employee was present (from attendance register)'],
      ['LOP Days',          'Loss of Pay days (absent without approved leave)'],
      ['Loan/EMI Deduction','Monthly loan EMI deduction if any (else leave 0)'],
      ['Payment Status',    'Paid / Hold / Pending'],
      ['Remarks',           'Any note e.g. "Full & Final", "Bonus included", etc.'],
      [''],
      ['COLUMNS PRE-FILLED (do not change unless needed):'],
      ['Column', 'Source'],
      ['Basic, HRA, Conveyance, etc.', 'From employee salary structure in system'],
      ['Gross Salary',      'Sum of all earnings'],
      ['PF, ESI, PT, TDS',  'From salary structure'],
      ['Total Deductions',  'Sum of all deductions'],
      ['Net Pay',           'Gross - Total Deductions (system recalculates on upload)'],
      [''],
      ['UPLOAD RULES:'],
      ['• Emp Code must match exactly (e.g. KC7708)'],
      ['• Do not add/remove columns'],
      ['• Do not change sheet name'],
      ['• Save as .xlsx before uploading'],
      ['• Upload via Payroll → Upload Payroll Excel tab'],
    ];
    const ws2 = XLSX.utils.aoa_to_sheet(instrRows);
    ws2['!cols'] = [{wch:28},{wch:60}];
    XLSX.utils.book_append_sheet(wb, ws2, 'Instructions');

    // ── Send ──────────────────────────────────────────────────────────────
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    res.setHeader('Content-Disposition', `attachment; filename="KrishiHR_Payroll_Template_${monthName}_${y}.xlsx"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);

  } catch (err) {
    console.error('[downloadPayrollTemplate]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};
