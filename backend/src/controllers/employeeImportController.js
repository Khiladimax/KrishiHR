// src/controllers/employeeImportController.js
// Bulk import new employees from the Excel template
const db     = require('../config/db');
const bcrypt = require('bcryptjs');
const XLSX   = require('xlsx');
const multer = require('multer');

exports.uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(xlsx|xls)$/.test(file.originalname.toLowerCase())) cb(null, true);
    else cb(new Error('Only Excel files allowed'));
  }
}).single('file');

// Columns are matched BY HEADER NAME (not by fixed position) — so the template
// can be re-ordered freely and a shuffled/renamed sheet can't silently scramble
// fields (which is exactly the bug that shifted City←IFSC, Bank←PAN earlier).
// Each field lists header substrings to look for, in priority order.
const FIELD_ALIASES = {
  client_name:        ['client name', 'client'],
  employee_code:      ['employee code', 'emp code'],
  password:           ['password'],
  first_name:         ['first name'],
  last_name:          ['last name'],
  email:              ['email'],
  phone:              ['alternate']            ,  // placeholder replaced below
  alternate_phone:    ['alternate phone', 'alternate'],
  gender:             ['gender'],
  date_of_birth:      ['date of birth', 'dob'],
  blood_group:        ['blood'],
  marital_status:     ['marital'],
  joining_date:       ['joining'],
  employment_type:    ['employment type', 'employment'],
  role:               ['role'],
  department_id:      ['department'],
  designation_id:     ['designation'],
  reporting_manager_id: ['reporting manager', 'manager code'],
  team_leader_id:     ['team leader', 'tl code'],
  probation_end_date: ['probation'],
  office_location:    ['office'],
  shift:              ['shift'],
  basic_salary:       ['basic'],
  hra:                ['hra'],
  special_allowance:  ['other allow', 'special allow'],
  travel_allowance:   ['travel allow', 'conveyance'],
  st_gratuity:        ['gratuity'],
  st_pf_employee:     ['pf employee', 'pf (employee)'],
  st_pf_employer:     ['pf employer', 'pf (employer)'],
  st_pf_admin:        ['pf admin'],
  st_esi_employee:    ['esic employee', 'esi employee', 'esi (employee)'],
  st_esi_employer:    ['esic employer', 'esi employer', 'esi (employer)'],
  st_professional_tax:['professional tax', 'prof tax'],
  ctc:                ['ctc'],
  pan_number:         ['pan'],
  aadhar_number:      ['aadhaar', 'aadhar'],
  uan_number:         ['uan'],
  bank_name:          ['bank name'],
  bank_account:       ['bank account', 'account no'],
  bank_ifsc:          ['ifsc'],
  bank_branch:        ['branch'],
  address_line1:      ['address'],
  city:               ['city'],
  state:              ['state'],
  pincode:            ['pincode', 'pin'],
};

// Build a field→columnIndex map from the actual header row. "Phone" is resolved
// specially so it doesn't collide with "Alternate Phone".
function buildColMap(headerRow) {
  const H = (headerRow || []).map(h => String(h || '').toLowerCase().replace(/\s+/g, ' ').trim());
  const find = (aliases) => {
    for (const a of aliases) { const i = H.findIndex(h => h.includes(a)); if (i !== -1) return i; }
    return -1;
  };
  const COL = {};
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) COL[field] = find(aliases);
  // Phone = the "phone" header that is NOT "alternate phone"
  COL.phone = H.findIndex(h => h.includes('phone') && !h.includes('alternate'));
  return { COL, H };
}

const { findOrCreateClient } = require('./clientController');

function clean(val) {
  return val !== null && val !== undefined && val !== '' ? String(val).trim() : null;
}

function toDate(val) {
  if (!val) return null;
  const s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Handle Excel serial date numbers
  if (!isNaN(val)) {
    const d = new Date(Math.round((parseInt(val) - 25569) * 86400 * 1000));
    return d.toISOString().split('T')[0];
  }
  // Try parsing other formats
  const d = new Date(s);
  if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  return null;
}

function toNum(val) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

// ── GET /employees/import-template — always-current 45-column template ────────
exports.downloadTemplate = async (_req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const H = [
      ['Client Name','Blank=main / Client name=deployed'],['Employee Code','Unique e.g. KC001'],['Password','Min 6 chars'],
      ['First Name','Required'],['Last Name','Optional'],['Email','Required, unique'],['Phone','10 digits'],['Alternate Phone','Optional'],
      ['Gender','Male/Female/Other'],['Date of Birth','YYYY-MM-DD'],['Blood Group','A+/B+/O+'],['Marital Status','Single/Married'],
      ['Joining Date','YYYY-MM-DD'],['Employment Type','Full-Time/Part-Time/Contract'],['Role','employee/tl/manager/hr/accounts/admin'],
      ['Department','Name or ID'],['Designation','Name or ID'],['Reporting Manager Code','Manager emp code'],['Team Leader Code','TL emp code'],
      ['Probation End Date','YYYY-MM-DD'],['Office Location','Office name'],['Shift','Day/Night/Rotational'],
      ['Basic Salary','Monthly Rs'],['HRA','Monthly Rs'],['Other Allowance','Monthly Rs'],['Travel Allowance','Monthly Rs (=Conveyance)'],
      ['Gratuity Monthly','Monthly Rs'],['PF Employee','Monthly Rs'],['PF Employer','Monthly Rs'],['PF Admin','Monthly Rs'],
      ['ESIC Employee','Monthly Rs'],['ESIC Employer','Monthly Rs'],['Professional Tax','Monthly Rs'],['CTC','Annual Rs'],
      ['PAN Number','ABCDE1234F'],['Aadhar Number','12 digits'],['UAN Number','optional'],['Bank Name','Bank name'],
      ['Bank Account No','Account no'],['Bank IFSC','SBIN0001234'],['Bank Branch','Branch'],['Address','Street address'],
      ['City','City'],['State','State'],['Pincode','6-digit PIN'],
    ];
    const ex1 = ['','KC9001','Krishi@123','Anita','Sharma','anita.sharma@krishicare.in','9876500001','','Female','1995-03-12','B+','Married','2024-04-01','Full-Time','hr','HR','HR Executive','','','2024-10-01','Head Office','Day',15000,6000,2000,1600,722,1800,1950,150,180,780,200,360000,'ABCDE1234F','123456789012','100200300400','State Bank of India','30012345678','SBIN0001234','Bengaluru MG Road','12 MG Road','Bengaluru','Karnataka','560001'];
    const ex2 = ['IFFCO Tokio','KC9101','Krishi@123','Suresh','Gowda','suresh.gowda@gmail.com','9876500101','','Male','1990-01-15','A+','Married','2024-05-01','Full-Time','employee','Field','Sales Executive','','','2024-11-01','Chikmagalur','Day',12000,4000,0,1000,577,1800,1950,150,144,624,200,240000,'CDEFG3456H','323456789012','','State Bank of India','33326768763','SBIN0011260','Tarikere','Dornalu','Tarikere','Karnataka','577228'];

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Employee Import');
    ws.mergeCells(1, 1, 1, H.length);
    const t = ws.getCell(1, 1);
    t.value = 'KrishiHR — Employee Import Template (Client Deployment & Salary Structure incl. ESIC)';
    t.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
    t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } };
    t.alignment = { horizontal: 'center', vertical: 'middle' }; ws.getRow(1).height = 24;
    H.forEach(([h], i) => {
      const c = ws.getCell(2, i + 1); c.value = h;
      c.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
      const salary = i >= 22 && i <= 33;
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: salary ? 'FF00695C' : 'FF2E7D32' } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      ws.getColumn(i + 1).width = Math.max(11, Math.min(22, h.length + 2));
    });
    ws.getRow(2).height = 30;
    H.forEach(([, hint], i) => {
      const c = ws.getCell(3, i + 1); c.value = hint;
      c.font = { italic: true, size: 8, color: { argb: 'FF607D8B' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F8E9' } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    ws.getRow(3).height = 24;
    [ex1, ex2].forEach((row, ri) => {
      row.forEach((v, ci) => {
        const c = ws.getCell(4 + ri, ci + 1); c.value = v; c.font = { size: 9 };
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ri % 2 ? 'FFF3F6FB' : 'FFFFFFFF' } };
        c.alignment = { vertical: 'middle', horizontal: typeof v === 'number' ? 'right' : 'left' };
      });
    });
    ws.views = [{ state: 'frozen', ySplit: 3, xSplit: 2 }];

    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', 'attachment; filename="KrishiHR_Employee_Import_Template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(Buffer.from(buf));
  } catch (err) {
    console.error('[downloadTemplate]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

exports.importEmployees = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    if (!req.file)
      return res.status(400).json({ success: false, message: 'Excel file required' });

    const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
    const ws = wb.Sheets['Employee Import'] || wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

    // Locate the header row (the one containing "Employee Code") and resolve every
    // column BY NAME — so the sheet's column order no longer matters.
    let headerIdx = rows.findIndex(r =>
      Array.isArray(r) && r.some(c => String(c || '').toLowerCase().replace(/\s+/g, ' ').includes('employee code')));
    if (headerIdx === -1) headerIdx = 1;   // fallback to the classic layout
    const { COL, H } = buildColMap(rows[headerIdx]);
    console.log(`[Import] Total rows: ${rows.length}, header at row ${headerIdx}`);
    if (COL.employee_code === -1 || COL.email === -1)
      return res.status(400).json({ success: false, message: 'Could not find "Employee Code"/"Email" columns in the sheet header.' });

    // A real employee row needs a code AND an email that looks like an email —
    // this drops the banner/header/hint rows regardless of position.
    const dataRows = rows.slice(headerIdx + 1).filter(r => {
      const code  = clean(r[COL.employee_code]);
      const email = clean(r[COL.email]);
      return code && email && email.includes('@');
    });
    console.log(`[Import] Data rows found: ${dataRows.length}`);

    if (!dataRows.length)
      return res.status(400).json({ success: false, message: 'No data rows found (delete sample rows first)' });

    const results = { imported: [], skipped: [], errors: [] };

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rowNum = headerIdx + 2 + i; // approx Excel row for reporting

      const employee_code = clean(row[COL.employee_code])?.toUpperCase();
      const first_name    = clean(row[COL.first_name]);
      const email         = clean(row[COL.email])?.toLowerCase();
      const password      = clean(row[COL.password]) || 'KrishiCare@123';
      console.log(`[Import] Row ${rowNum}: code=${employee_code} name=${first_name} email=${email}`);

      // Required field validation
      if (!employee_code) { results.errors.push(`Row ${rowNum}: employee_code is required`); continue; }
      if (!first_name)    { results.errors.push(`Row ${rowNum}: first_name is required`); continue; }
      if (!email)         { results.errors.push(`Row ${rowNum}: email is required`); continue; }
      if (password.length < 8) { results.errors.push(`Row ${rowNum}: password must be at least 8 characters`); continue; }

      // Check duplicates
      const dupCheck = await client.query(
        `SELECT id FROM employees WHERE UPPER(employee_code)=$1 OR LOWER(email)=$2`,
        [employee_code, email]
      );
      if (dupCheck.rows.length) {
        results.skipped.push(`Row ${rowNum}: ${employee_code} / ${email} already exists`);
        continue;
      }

      const hash = await bcrypt.hash(password, 10);
      const role_val = clean(row[COL.role]) || 'employee';
      const valid_roles = ['employee','tl','manager','hr','accounts','admin','client_admin','super_admin_client'];
      const role = valid_roles.includes(role_val) ? role_val : 'employee';

      // ── Client deployment: resolve client_name → client_id ────────────────
      const clientName = clean(row[COL.client_name]);
      let client_id = null;
      if (clientName) {
        try {
          client_id = await findOrCreateClient(clientName, client);
        } catch (clientErr) {
          results.errors.push(`Row ${rowNum}: failed to resolve client "${clientName}": ${clientErr.message}`);
          await client.query(`ROLLBACK TO SAVEPOINT row_save`).catch(() => {});
          continue;
        }
      }

      try {
        await client.query(`SAVEPOINT row_save`);
        const result = await client.query(
          `INSERT INTO employees (
             employee_code, first_name, last_name, email, phone, alternate_phone,
             gender, date_of_birth, blood_group, marital_status, joining_date,
             employment_type, role, password_hash,
             department_id, designation_id, reporting_manager_id, team_leader_id,
             basic_salary, hra, special_allowance, travel_allowance, ctc,
             pan_number, aadhar_number, uan_number,
             bank_name, bank_account, bank_ifsc, bank_branch,
             address_line1, city, state, pincode,
             probation_end_date, is_active, client_id
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,true,$36
           ) RETURNING id, employee_code, first_name, last_name, email`,
          [
            employee_code,
            first_name,
            clean(row[COL.last_name]) || '',
            email,
            clean(row[COL.phone]),
            clean(row[COL.alternate_phone]),
            clean(row[COL.gender]),
            toDate(row[COL.date_of_birth]),
            clean(row[COL.blood_group]),
            clean(row[COL.marital_status]),
            toDate(row[COL.joining_date]) || new Date().toISOString().split('T')[0],
            clean(row[COL.employment_type]) || 'Full-Time',
            role,
            hash,
            parseInt(row[COL.department_id]) || null,
            parseInt(row[COL.designation_id]) || null,
            parseInt(row[COL.reporting_manager_id]) || null,
            parseInt(row[COL.team_leader_id]) || null,
            toNum(row[COL.basic_salary]),
            toNum(row[COL.hra]),
            toNum(row[COL.special_allowance]),
            toNum(row[COL.travel_allowance]),
            toNum(row[COL.ctc]),
            clean(row[COL.pan_number])?.toUpperCase(),
            clean(row[COL.aadhar_number]),
            clean(row[COL.uan_number]),
            clean(row[COL.bank_name]),
            clean(row[COL.bank_account]),
            clean(row[COL.bank_ifsc])?.toUpperCase(),
            clean(row[COL.bank_branch]),
            clean(row[COL.address_line1]),
            clean(row[COL.city]),
            clean(row[COL.state]),
            clean(row[COL.pincode]),
            toDate(row[COL.probation_end_date]),
            client_id,
          ]
        );

        const newEmp = result.rows[0];
        results.imported.push({
          employee_code: newEmp.employee_code,
          name: `${newEmp.first_name} ${newEmp.last_name}`,
          email: newEmp.email
        });

        // Auto-seed leave balances based on joining date
        // Rule: < 6 months from today → PL=6 only
        //       >= 6 months → EL=18, CL=6, SL=6
        {
          const currentYear = new Date().getFullYear();
          const today = new Date();
          const empJoiningDate = new Date(toDate(row[COL.joining_date]) || new Date());
          const sixMonthMark = new Date(empJoiningDate);
          sixMonthMark.setMonth(sixMonthMark.getMonth() + 6);
          const isUnderSixMonths = today < sixMonthMark;

          const ltRes = await client.query(
            `SELECT id, code FROM leave_types WHERE is_active=true AND code IN ('EL','CL','SL','PL')`
          );
          const ltMap = {};
          for (const lt of ltRes.rows) ltMap[lt.code] = lt.id;

          if (isUnderSixMonths) {
            // Under 6 months: PL = 6 upfront
            if (ltMap['PL']) {
              await client.query(
                `INSERT INTO leave_balances(employee_id,leave_type_id,year,allocated,used,pending,carry_forward)
                 VALUES($1,$2,$3,6,0,0,0) ON CONFLICT DO NOTHING`,
                [newEmp.id, ltMap['PL'], currentYear]
              );
            }
          } else {
            // 6+ months: full EL/CL/SL — EL=18, CL=6, SL=6
            const allocations = { EL: 18, CL: 6, SL: 6 };
            for (const [code, alloc] of Object.entries(allocations)) {
              if (ltMap[code]) {
                await client.query(
                  `INSERT INTO leave_balances(employee_id,leave_type_id,year,allocated,used,pending,carry_forward)
                   VALUES($1,$2,$3,$4,0,0,0) ON CONFLICT DO NOTHING`,
                  [newEmp.id, ltMap[code], currentYear, alloc]
                );
              }
            }
          }
        }

        // ── Define pay at import → employee_salary_structure (single source of
        //    truth that payroll pre-fills from). Every figure is taken as given;
        //    Accounts can edit it later on the Salary Structure page. ──────────
        {
          const basic       = toNum(row[COL.basic_salary]);
          const hra         = toNum(row[COL.hra]);
          const conveyance  = toNum(row[COL.travel_allowance]);   // Travel Allowance ≈ Conveyance
          const special     = toNum(row[COL.special_allowance]);
          const gratuity    = toNum(row[COL.st_gratuity]);
          const pfEmp       = toNum(row[COL.st_pf_employee]);
          const pfEr        = toNum(row[COL.st_pf_employer]);
          const pfAdmin     = toNum(row[COL.st_pf_admin]);
          const esiEmp      = toNum(row[COL.st_esi_employee]);
          const esiEr       = toNum(row[COL.st_esi_employer]);
          const pt          = toNum(row[COL.st_professional_tax]);

          // Only create a structure if there is any pay data at all
          if (basic || hra || conveyance || special || gratuity || toNum(row[COL.ctc])) {
            const gross    = basic + hra + conveyance + special;   // gratuity = employer cost, not gross
            const totalDed = pfEmp + esiEmp + pt;
            const net      = gross - totalDed;
            const ctc      = gross + gratuity + pfEr + esiEr + pfAdmin;
            const totalEmployerCost = pfEr + esiEr + pfAdmin + gratuity;

            await client.query(`ALTER TABLE employee_salary_structure ADD COLUMN IF NOT EXISTS other_allowance NUMERIC(12,2) DEFAULT 0`).catch(() => {});
            await client.query(`ALTER TABLE employee_salary_structure ADD COLUMN IF NOT EXISTS loan_emi_recovery NUMERIC(12,2) DEFAULT 0`).catch(() => {});
            await client.query(`ALTER TABLE employee_salary_structure ADD COLUMN IF NOT EXISTS tds NUMERIC(12,2) DEFAULT 0`).catch(() => {});

            await client.query(
              `INSERT INTO employee_salary_structure
                 (employee_id, basic, hra, conveyance, special_allowance, gratuity, other_allowance, gross_salary,
                  pf_applicable, esi_applicable, pt_applicable, lwf_applicable, tds_applicable,
                  pf_employee, pf_employer, pf_admin, esi_employee, esi_employer,
                  professional_tax, lwf, tds, loan_emi_recovery, total_employer_cost,
                  total_deductions, net_salary, ctc_monthly, ctc_annual, updated_by, updated_at)
               VALUES($1,$2,$3,$4,$5,$6,0,$7,$8,$9,true,false,false,$10,$11,$12,$13,$14,$15,0,0,0,$16,$17,$18,$19,$20,$21,NOW())
               ON CONFLICT(employee_id) DO NOTHING`,
              [newEmp.id, basic, hra, conveyance, special, gratuity, gross,
               pfEmp > 0 || pfEr > 0, esiEmp > 0 || esiEr > 0,
               pfEmp, pfEr, pfAdmin, esiEmp, esiEr, pt, totalEmployerCost,
               totalDed, net, ctc, ctc * 12, req.user.id]
            );
          }
        }

      } catch (rowErr) {
        await client.query(`ROLLBACK TO SAVEPOINT row_save`).catch(() => {});
        console.error(`[Import] Row ${rowNum} error:`, rowErr.message);
        // Log all values to find which is too long
        if (rowErr.message.includes('too long')) {
          row.forEach((v,ci) => { if (String(v).length > 0) console.log(`  col${ci} (${H[ci]||'?'})=${String(v)}`); });
        }
        results.errors.push(`Row ${rowNum} (${employee_code}): ${rowErr.message}`);
      }
    }

    await client.query('COMMIT');
    console.log(`[Import] Done: ${results.imported.length} imported, ${results.skipped.length} skipped, ${results.errors.length} errors`);
    if (results.errors.length) console.log('[Import] Errors:', results.errors);
    res.json({
      success: true,
      message: `Import complete: ${results.imported.length} imported, ${results.skipped.length} skipped, ${results.errors.length} errors`,
      data: {
        imported: results.imported,
        skipped:  results.skipped,
        errors:   results.errors.slice(0, 50),
        summary: {
          total_rows: dataRows.length,
          imported: results.imported.length,
          skipped:  results.skipped.length,
          errors:   results.errors.length
        }
      }
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error: ' + err.message });
  } finally { client.release(); }
};
