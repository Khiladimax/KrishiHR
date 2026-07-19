// src/controllers/templatesController.js
// One download that bundles ALL import templates (employee, offer letter, main
// payroll, client payroll) as a single ZIP — always current, with 2 examples each.
const ExcelJS  = require('exceljs');
const archiver = require('archiver');

// Build one styled xlsx buffer: title, header row, hint row (optional), example rows.
async function sheetBuffer(sheetName, title, headers, hints, rows, salaryRange) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  ws.mergeCells(1, 1, 1, headers.length);
  const t = ws.getCell(1, 1); t.value = title;
  t.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' } };
  t.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } };
  t.alignment = { horizontal: 'center', vertical: 'middle' }; ws.getRow(1).height = 24;
  headers.forEach((h, i) => {
    const c = ws.getCell(2, i + 1); c.value = h;
    c.font = { bold: true, size: 9.5, color: { argb: 'FFFFFFFF' } };
    const sal = salaryRange && i >= salaryRange[0] && i <= salaryRange[1];
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: sal ? 'FF00695C' : 'FF2E7D32' } };
    c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    ws.getColumn(i + 1).width = Math.max(11, Math.min(22, String(h).length + 2));
  });
  ws.getRow(2).height = 30;
  let r = 3;
  if (hints) {
    hints.forEach((v, i) => {
      const c = ws.getCell(r, i + 1); c.value = v;
      c.font = { italic: true, size: 8, color: { argb: 'FF607D8B' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F8E9' } };
      c.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    });
    ws.getRow(r).height = 24; r++;
  }
  rows.forEach((row, ri) => {
    row.forEach((v, ci) => {
      const c = ws.getCell(r, ci + 1); c.value = v; c.font = { size: 9 };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ri % 2 ? 'FFF3F6FB' : 'FFFFFFFF' } };
      c.alignment = { vertical: 'middle', horizontal: typeof v === 'number' ? 'right' : 'left' };
    });
    r++;
  });
  ws.views = [{ state: 'frozen', ySplit: hints ? 3 : 2, xSplit: 2 }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ── EMPLOYEE IMPORT (45 cols, salary block 22-33) ─────────────────────────────
const EMP_H = ['Client Name','Employee Code','Password','First Name','Last Name','Email','Phone','Alternate Phone','Gender','Date of Birth','Blood Group','Marital Status','Joining Date','Employment Type','Role','Department','Designation','Reporting Manager Code','Team Leader Code','Probation End Date','Office Location','Shift','Basic Salary','HRA','Other Allowance','Travel Allowance','Gratuity Monthly','PF Employee','PF Employer','PF Admin','ESIC Employee','ESIC Employer','Professional Tax','CTC','PAN Number','Aadhar Number','UAN Number','Bank Name','Bank Account No','Bank IFSC','Bank Branch','Address','City','State','Pincode'];
const EMP_HINT = ['Blank=main / Client name=deployed','Unique e.g. KC001','Min 6 chars','Required','Optional','Required, unique','10 digits','Optional','Male/Female/Other','YYYY-MM-DD','A+/B+/O+','Single/Married','YYYY-MM-DD','Full-Time/Part-Time/Contract','employee/tl/manager/hr/accounts/admin','Name or ID','Name or ID','Manager emp code','TL emp code','YYYY-MM-DD','Office name','Day/Night/Rotational','Monthly Rs','Monthly Rs','Monthly Rs','Monthly Rs (=Conveyance)','Monthly Rs','Monthly Rs','Monthly Rs','Monthly Rs','Monthly Rs','Monthly Rs','Monthly Rs','Annual Rs','ABCDE1234F','12 digits','optional','Bank name','Account no','SBIN0001234','Branch','Street address','City','State','6-digit PIN'];
const empMain = ['','KC9001','Krishi@123','Anita','Sharma','anita.sharma@krishicare.in','9876500001','','Female','1995-03-12','B+','Married','2024-04-01','Full-Time','hr','HR','HR Executive','','','2024-10-01','Head Office','Day',15000,6000,2000,1600,722,1800,1950,150,180,780,200,360000,'ABCDE1234F','123456789012','100200300400','State Bank of India','30012345678','SBIN0001234','Bengaluru MG Road','12 MG Road','Bengaluru','Karnataka','560001'];
const empCli = ['IFFCO Tokio','KC9101','Krishi@123','Suresh','Gowda','suresh.gowda@gmail.com','9876500101','','Male','1990-01-15','A+','Married','2024-05-01','Full-Time','employee','Field','Sales Executive','','','2024-11-01','Chikmagalur','Day',12000,4000,0,1000,577,1800,1950,150,144,624,200,240000,'CDEFG3456H','323456789012','','State Bank of India','33326768763','SBIN0011260','Tarikere','Dornalu','Tarikere','Karnataka','577228'];

// ── OFFER LETTER (matches in-app offer-letter.html bulk template) ──────────────
const OL_H = ['Candidate Name','Email','Mobile','Address','Designation','Location','Joining Date','Offer Valid Days','Probation Months','Notice Period Months','Employee Code','Employment Type','Contract Months','CTC','Basic Salary','HRA','Travel Allowance','Other Allowance','Gratuity Monthly','PF Employee','PF Employer','PF Admin','ESIC Employee','ESIC Employer','Professional Tax','Custom Clauses','CC','BCC'];
const olMain = ['Mr. Kiran Rao','kiran.rao@example.com','9800000001','12 MG Road, Bengaluru','Field Officer','Bengaluru','2026-08-01',7,6,3,'','permanent',0,360000,15000,6000,1600,2000,722,1800,1950,150,180,780,200,'','hr@krishicare.in',''];
const olCli = ['Ms. Lakshmi Bai','lakshmi.bai@example.com','9800000102','Sankalpura, Sringeri','Field Officer','Sringeri','2026-08-10',7,3,1,'','contract',12,240000,12000,4000,1000,0,577,1800,1950,150,144,624,200,'Deployed at IFFCO Tokio','hr@krishicare.in',''];

// ── MAIN PAYROLL (30 cols) ────────────────────────────────────────────────────
const MP_H = ['Emp Code','Full Name','Department','Designation','Category','Working Days','Present Days','LOP Days','Paid Days','Basic','HRA','Conveyance','Other Allowance','Gratuity','Gross Salary','PF (Employee)','ESI (Employee)','Prof Tax','LWF','TDS','Loan/EMI Deduction (Active EMI)','EMI Progress','Total Deductions','Net Pay','PF (Employer)','ESI (Employer)','PF Admin','CTC (Monthly)','Payment Status','Remarks'];
const mp1 = ['KC9001','Anita Sharma','HR','HR Executive','permanent',26,26,0,26,15000,6000,1600,2000,722,25322,1800,190,200,0,0,0,'',2190,23132,1950,823,150,28245,'Paid',''];
const mp2 = ['KC9002','Rahul Verma','Operations','Field Officer','permanent',26,24,2,24,14000,5000,1000,1500,674,22174,1800,166,200,0,0,0,'',2166,20008,1950,721,150,24995,'Paid','2 LOP days'];

// ── CLIENT PAYROLL (28 cols) ──────────────────────────────────────────────────
const CP_H = ['Emp Code','Name','Client','Department','Working Days','Present Days','LOP Days','Paid Days','Basic + VDA','HRA','Conveyance','Other Allowance','Gratuity','Gross Salary','PF (Employee)','ESI (Employee)','Prof Tax','TDS','LWF','Loan/EMI','Total Deductions','Net Salary','PF (Employer)','ESI (Employer)','PF Admin','CTC (Monthly)','Payment Status','Remarks'];
const cp1 = ['KC9101','Suresh Gowda','IFFCO Tokio','Field',26,26,0,26,12000,4000,1000,0,577,17000,1800,128,200,0,0,0,2128,14872,1950,553,150,19653,'Paid',''];
const cp2 = ['KC9102','Manju Nayak','IFFCO Tokio','Field',26,25,1,25,12000,4000,1000,0,577,17000,1800,128,200,0,0,0,2128,14872,1950,553,150,19653,'Paid','1 LOP day'];

// ── GET /templates/all — ZIP of every import template ─────────────────────────
exports.downloadAll = async (_req, res) => {
  try {
    const files = [
      ['1_Main_Employee_Import.xlsx',    await sheetBuffer('Employee Import','KrishiHR - Main Employee Import (own KCMS staff)', EMP_H, EMP_HINT, [empMain], [22,33])],
      ['2_Client_Employee_Import.xlsx',  await sheetBuffer('Employee Import','KrishiHR - Client Employee Import (deployed staff)', EMP_H, EMP_HINT, [empCli], [22,33])],
      ['3_Offer_Letter_Import.xlsx',     await sheetBuffer('Offer Letters','KrishiHR - Offer Letter Bulk Import (with ESIC)', OL_H, null, [olMain, olCli], [13,24])],
      ['4_Main_Payroll_Import.xlsx',     await sheetBuffer('Payroll','KrishiHR - Main Payroll Import (imported = final)', MP_H, null, [mp1, mp2], [9,27])],
      ['5_Client_Payroll_Import.xlsx',   await sheetBuffer('Client Payroll','KrishiHR - Client Payroll Import (imported = final)', CP_H, null, [cp1, cp2], [8,25])],
    ];

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="KrishiHR_All_Templates.zip"');
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', err => { throw err; });
    archive.pipe(res);
    for (const [name, buf] of files) archive.append(buf, { name: `KrishiHR_Templates/${name}` });
    archive.finalize();
  } catch (err) {
    console.error('[templates/downloadAll]', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
};
