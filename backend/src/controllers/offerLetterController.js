// src/controllers/offerLetterController.js
// Generate, preview, and email offer letters

const db         = require('../config/db');
const emailSvc   = require('../config/emailService');
const { execFile } = require('child_process');
const fs           = require('fs');
const path         = require('path');
const os           = require('os');

// ── Company details — override any of these via environment variables ──────────
const COMPANY = {
  name:       process.env.COMPANY_NAME       || 'Krishi Care & Management Services Private Limited',
  cin:        process.env.COMPANY_CIN        || 'U01403MH2015PTC261465',
  officeAddr: process.env.COMPANY_OFFICE_ADDR|| '617, 6th Floor, Hubtown Viva, Western Express Highway, Shankarwadi Jogeshwari (East), Mumbai - 400060',
  corpAddr:   process.env.COMPANY_CORP_ADDR  || 'H-12, Green Park Extension, New Delhi - 110016',
  email:      process.env.COMPANY_EMAIL      || 'hr@krishicare.in',
  website:    process.env.COMPANY_WEBSITE    || 'www.krishicare.in',
  tel:        process.env.COMPANY_TEL        || '+912268284109',
};

// ── DB Init ────────────────────────────────────────────────────────────────────
exports.initTables = async () => {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS offer_letters (
        id                SERIAL PRIMARY KEY,
        employee_id       INTEGER REFERENCES employees(id) ON DELETE SET NULL,
        -- Candidate info (may not be employee yet)
        candidate_name    VARCHAR(200) NOT NULL,
        candidate_email   VARCHAR(200),
        candidate_address TEXT,
        candidate_mobile  VARCHAR(20),
        -- Position
        designation       VARCHAR(200) NOT NULL,
        location          VARCHAR(200) DEFAULT 'Mumbai',
        joining_date      DATE,
        offer_date        DATE DEFAULT CURRENT_DATE,
        offer_valid_days  INT DEFAULT 7,
        -- Salary
        ctc_annual        NUMERIC(14,2) DEFAULT 0,
        basic_monthly     NUMERIC(12,2) DEFAULT 0,
        hra_monthly       NUMERIC(12,2) DEFAULT 0,
        conveyance_monthly NUMERIC(12,2) DEFAULT 0,
        other_allowance_monthly NUMERIC(12,2) DEFAULT 0,
        gratuity_monthly  NUMERIC(12,2) DEFAULT 0,
        pf_employee_monthly NUMERIC(12,2) DEFAULT 0,
        pf_employer_monthly NUMERIC(12,2) DEFAULT 0,
        pf_admin_monthly  NUMERIC(12,2) DEFAULT 0,
        -- Custom fields (extra notes/clauses)
        probation_months  INT DEFAULT 6,
        notice_period_months INT DEFAULT 3,
        custom_clauses    TEXT,
        -- Status
        status            VARCHAR(20) DEFAULT 'draft', -- draft/sent/accepted/rejected
        sig1_image        TEXT,   -- base64 authorized signatory signature
        sig2_image        TEXT,   -- base64 HR signatory signature
        sent_at           TIMESTAMP,
        created_by        INTEGER REFERENCES employees(id),
        created_at        TIMESTAMP DEFAULT NOW(),
        updated_at        TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Offer letter table ready');

    // Migration: add signature columns if not exist
    await db.query(`ALTER TABLE offer_letters ADD COLUMN IF NOT EXISTS sig1_image TEXT`);
    await db.query(`ALTER TABLE offer_letters ADD COLUMN IF NOT EXISTS sig2_image TEXT`);
    await db.query(`ALTER TABLE offer_letters ADD COLUMN IF NOT EXISTS professional_tax_monthly NUMERIC(12,2) DEFAULT 0`);
    await db.query(`ALTER TABLE offer_letters ADD COLUMN IF NOT EXISTS employee_code VARCHAR(50)`);
    console.log('✅ Offer letter signature columns ready');
  } catch (err) {
    console.error('❌ Offer letter table init error:', err.message);
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function indianNumber(n) {
  if (!n) return '0';
  return Number(n).toLocaleString('en-IN');
}

function numberToWords(num) {
  const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
    'Seventeen', 'Eighteen', 'Nineteen'];
  const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  if (num === 0) return 'Zero';
  if (num < 0) return 'Minus ' + numberToWords(-num);

  let words = '';
  if (Math.floor(num / 10000000) > 0) {
    words += numberToWords(Math.floor(num / 10000000)) + ' Crore ';
    num %= 10000000;
  }
  if (Math.floor(num / 100000) > 0) {
    words += numberToWords(Math.floor(num / 100000)) + ' Lakh ';
    num %= 100000;
  }
  if (Math.floor(num / 1000) > 0) {
    words += numberToWords(Math.floor(num / 1000)) + ' Thousand ';
    num %= 1000;
  }
  if (Math.floor(num / 100) > 0) {
    words += numberToWords(Math.floor(num / 100)) + ' Hundred ';
    num %= 100;
  }
  if (num > 0) {
    if (num < 20) { words += ones[num] + ' '; }
    else { words += tens[Math.floor(num / 10)] + ' ' + ones[num % 10] + ' '; }
  }
  return words.trim();
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  const day = dt.getDate();
  const months = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];
  const suffix = day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th';
  return `${day}${suffix} ${months[dt.getMonth()]}, ${dt.getFullYear()}`;
}

function buildOfferLetterHTML(ol) {
  const basic    = parseFloat(ol.basic_monthly||0);
  const hra      = parseFloat(ol.hra_monthly||0);
  const conv     = parseFloat(ol.conveyance_monthly||0);
  const other    = parseFloat(ol.other_allowance_monthly||0);
  const gratuity = parseFloat(ol.gratuity_monthly||0);
  const pfEmp    = parseFloat(ol.pf_employee_monthly||0);
  const pfEmpr   = parseFloat(ol.pf_employer_monthly||0);
  const pfAdmin  = parseFloat(ol.pf_admin_monthly||0);
  const pt       = parseFloat(ol.professional_tax_monthly||0);

  const gross      = basic + hra + conv + other + gratuity;
  const totalDed   = pfEmp + pt;
  const netSalary  = gross - totalDed;
  const ctcMonthly = gross + pfEmpr + pfAdmin;
  const ctcAnnual  = parseFloat(ol.ctc_annual || (ctcMonthly * 12));
  const fmtV = v => '\u20b9\u00a0' + Number(Math.round(v)).toLocaleString('en-IN');

  function joiningDateHTML(d) {
    if (!d) return '';
    const dt = new Date(d);
    const day = dt.getDate();
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const sup = [,'st','nd','rd'][day] || 'th';
    return `${day}<sup>${sup}</sup>&nbsp;${months[dt.getMonth()]}&nbsp;${dt.getFullYear()}`;
  }

  const probWords   = {3:'three',6:'six',12:'twelve'};
  const noticeWords = {1:'one',2:'two',3:'three',6:'six'};
  const probStr     = probWords[ol.probation_months]       || `${ol.probation_months||6}`;
  const noticeStr   = noticeWords[ol.notice_period_months] || `${ol.notice_period_months||3}`;
  const LOGO = `data:image/png;base64,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`;

  const css = `
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: 'Inter', 'Calibri', 'Segoe UI', Arial, sans-serif;
  font-size: 10.5pt;
  color: #1a1a2e;
  background: #fff;
  line-height: 1.6;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* ── PAGE WRAPPER ── */
.page {
  width: 210mm;
  margin: 0 auto;
  background: #fff;
  position: relative;
}

/* ── FIXED HEADER (print) ── */
@media print {
  .page-header { position: running(header); }
  .page-footer { position: running(footer); }
  @page {
    size: A4;
    margin: 28mm 18mm 22mm 18mm;
    @top-center { content: element(header); }
    @bottom-center { content: element(footer); }
  }
  .page { width: 100%; }
  .page-break { page-break-before: always; }
  .no-break { page-break-inside: avoid; }
  .sec-hd { page-break-after: avoid; }
}

/* ── SCREEN: simulate pages ── */
@media screen {
  body { background: #e8e8e8; padding: 20px 0; }
  .page {
    box-shadow: 0 4px 24px rgba(0,0,0,0.15);
    margin: 0 auto 30px;
    padding: 0;
  }
  .page-header { border-bottom: none; }
  .page-break { margin-top: 0; }
}

/* ══════════════════════════════════════
   HEADER
══════════════════════════════════════ */
.page-header {
  padding: 18px 28px 0;
  background: #fff;
}
.hdr-inner {
  display: flex;
  align-items: center;
  gap: 18px;
  padding-bottom: 12px;
}
.hdr-logo {
  width: 76px;
  height: 76px;
  object-fit: contain;
  flex-shrink: 0;
}
.hdr-text { flex: 1; }
.hdr-company {
  font-size: 17pt;
  font-weight: 700;
  color: #1a3a2a;
  letter-spacing: -0.3px;
  line-height: 1.2;
  margin-bottom: 5px;
}
.hdr-details {
  font-size: 8.5pt;
  color: #444;
  line-height: 1.7;
}
.hdr-details span { margin-right: 14px; }
.hdr-badge {
  flex-shrink: 0;
  border: 1.5px solid #2d6a4f;
  border-radius: 6px;
  padding: 8px 12px;
  text-align: center;
  font-size: 7pt;
  font-weight: 700;
  color: #2d6a4f;
  letter-spacing: 1.5px;
  line-height: 2;
  text-transform: uppercase;
}
.hdr-stripe {
  height: 3px;
  background: linear-gradient(90deg, #2d6a4f 0%, #74c69d 50%, #2d6a4f 100%);
  margin: 0 28px;
}
.hdr-rule {
  height: 1px;
  background: #ddd;
  margin: 0 28px 0;
}

/* ══════════════════════════════════════
   FOOTER
══════════════════════════════════════ */
.page-footer {
  padding: 0 28px 14px;
  background: #fff;
}
.ftr-rule {
  height: 1px;
  background: #2d6a4f;
  margin-bottom: 6px;
  opacity: 0.4;
}
.ftr-inner {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  font-size: 7.5pt;
  color: #666;
}
.ftr-left { line-height: 1.6; }
.ftr-cin { font-weight: 600; color: #2d6a4f; margin-top: 2px; }

/* ══════════════════════════════════════
   BODY
══════════════════════════════════════ */
.page-body { padding: 20px 28px 16px; }

/* Date */
.date-line {
  text-align: right;
  font-size: 10.5pt;
  font-weight: 600;
  color: #333;
  margin-bottom: 20px;
}

/* Candidate card */
.cand-card {
  background: #f7faf8;
  border-left: 4px solid #2d6a4f;
  border-radius: 0 8px 8px 0;
  padding: 14px 18px;
  margin-bottom: 18px;
}
.cand-name {
  font-size: 13pt;
  font-weight: 700;
  color: #1a3a2a;
  margin-bottom: 6px;
}
.cand-row {
  display: flex;
  gap: 24px;
  flex-wrap: wrap;
  font-size: 10pt;
  color: #333;
  line-height: 1.8;
}
.cand-item { display: flex; gap: 6px; }
.cand-label { font-weight: 600; color: #2d6a4f; }

/* Salutation */
.salut { font-size: 10.5pt; margin-bottom: 12px; }

/* Subject */
.subj-wrap {
  background: linear-gradient(135deg, #f0f9f4, #e8f5ee);
  border: 1px solid #b7e4c7;
  border-radius: 8px;
  padding: 12px 18px;
  margin: 14px 0 18px;
  text-align: center;
}
.subj-label {
  font-size: 8pt;
  font-weight: 600;
  color: #2d6a4f;
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 4px;
}
.subj-text {
  font-size: 11pt;
  font-weight: 700;
  color: #1a3a2a;
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* Body paragraphs */
.para {
  font-size: 10.5pt;
  line-height: 1.7;
  text-align: justify;
  color: #222;
  margin-bottom: 12px;
}

/* Section headings */
.sec-hd {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11pt;
  font-weight: 700;
  color: #1a3a2a;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 20px 0 8px;
  padding-bottom: 5px;
  border-bottom: 2px solid #2d6a4f;
}
.sec-hd::before {
  content: '';
  display: inline-block;
  width: 4px;
  height: 16px;
  background: #2d6a4f;
  border-radius: 2px;
  flex-shrink: 0;
}

/* Rules list */
ul.rules {
  margin: 6px 0 10px 6px;
  padding-left: 18px;
}
ul.rules li {
  font-size: 10.5pt;
  line-height: 1.7;
  color: #222;
  margin-bottom: 8px;
  text-align: justify;
}
ul.rules li::marker { color: #2d6a4f; }

/* Signature section */
.sig-intro { font-size: 10.5pt; margin: 18px 0 12px; }
.sig-table { width: 100%; border-collapse: collapse; margin-top: 36px; }
.sig-td { width: 50%; vertical-align: top; padding: 0 10px 0 0; }
.sig-img { height: 50px; max-width: 170px; object-fit: contain; display: block; margin-bottom: 6px; }
.sig-blank { height: 52px; border-bottom: 1.5px solid #aaa; width: 160px; margin-bottom: 6px; }
.sig-name { font-size: 10.5pt; font-weight: 700; color: #1a3a2a; }
.sig-role { font-size: 9.5pt; color: #555; margin-top: 2px; }

/* ══════════════════════════════════════
   ANNEXURE
══════════════════════════════════════ */
.ann-title {
  font-size: 14pt;
  font-weight: 700;
  color: #1a3a2a;
  text-align: center;
  margin: 16px 0 4px;
}
.ann-sub {
  font-size: 10pt;
  color: #555;
  text-align: center;
  margin-bottom: 18px;
}

/* Summary box */
.summary-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: #2d6a4f;
  border: 1.5px solid #2d6a4f;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 22px;
}
.summary-cell {
  background: #fff;
  padding: 10px 16px;
}
.summary-cell:nth-child(odd) { background: #f7faf8; }
.summary-key {
  font-size: 8pt;
  font-weight: 700;
  color: #2d6a4f;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 3px;
}
.summary-val {
  font-size: 11pt;
  font-weight: 600;
  color: #1a3a2a;
}
.summary-ctc {
  grid-column: 1 / -1;
  background: #1a3a2a !important;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 18px;
}
.summary-ctc .summary-key { color: #74c69d; margin: 0; }
.summary-ctc .summary-val { color: #fff; font-size: 13pt; }

/* Salary table */
.sal-tbl {
  width: 100%;
  border-collapse: collapse;
  font-size: 10pt;
  margin-bottom: 20px;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid #d4e6da;
}
.sal-tbl thead tr {
  background: #2d6a4f;
  color: #fff;
}
.sal-tbl thead th {
  padding: 10px 14px;
  text-align: left;
  font-weight: 700;
  font-size: 10pt;
  letter-spacing: 0.3px;
  border: none;
}
.sal-tbl thead th.c-num { text-align: right; }
.sal-tbl tbody tr:nth-child(even) { background: #f7faf8; }
.sal-tbl tbody tr:nth-child(odd) { background: #fff; }
.sal-tbl tbody td {
  padding: 8px 14px;
  border-bottom: 1px solid #e8f0eb;
  font-size: 10pt;
  color: #333;
}
.sal-tbl tbody td.c-num { text-align: right; font-variant-numeric: tabular-nums; }
.sal-tbl tbody .c-sr { text-align: center; width: 44px; color: #777; font-size: 9pt; }

/* Highlight rows */
.r-gross td { background: #e8f5ee !important; font-weight: 700; color: #1a3a2a; border-top: 1.5px solid #2d6a4f; border-bottom: 1.5px solid #2d6a4f; }
.r-ded td   { background: #fff8f0 !important; font-weight: 700; color: #c0392b; border-top: 1px solid #f0c8a0; }
.r-net td   { background: #e8f0ff !important; font-weight: 700; color: #1a237e; border-top: 1.5px solid #5c6bc0; border-bottom: 1.5px solid #5c6bc0; }
.r-ctc td   { background: #1a3a2a !important; font-weight: 700; color: #fff !important; font-size: 11pt; }

/* Ack box */
.ack-box {
  background: #f7faf8;
  border: 1.5px solid #b7e4c7;
  border-radius: 10px;
  padding: 18px 22px 14px;
  margin-top: 16px;
}
.ack-title {
  font-size: 11pt;
  font-weight: 700;
  color: #1a3a2a;
  border-bottom: 2px solid #2d6a4f;
  padding-bottom: 6px;
  margin-bottom: 10px;
}
.ack-para { font-size: 10pt; color: #444; line-height: 1.6; margin-bottom: 20px; }
.ack-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 20px 30px;
}
.ack-field label {
  display: block;
  font-size: 8pt;
  font-weight: 700;
  color: #2d6a4f;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  margin-bottom: 4px;
}
.ack-line {
  border-bottom: 1.5px solid #555;
  height: 28px;
  display: block;
}
`;

  const header = `
<div class="page-header">
  <div class="hdr-inner">
    <img src="${LOGO}" class="hdr-logo" alt="KCMS Logo">
    <div class="hdr-text">
      <div class="hdr-company">Krishi Care &amp; Management Services Private Limited</div>
      <div class="hdr-details">
        <span>&#127968; 617, 6th Floor, Hubtown Viva, Western Express Highway, Shankarwadi, Jogeshwari (East), Mumbai - 400060</span><br>
        <span>&#9993; hr@krishicare.in</span>
        <span>&#127760; www.krishicare.in</span>
        <span>&#9742; +91 22 6828 4109</span>
      </div>
    </div>
    <div class="hdr-badge">Official<br>Document</div>
  </div>
  <div class="hdr-stripe"></div>
  <div class="hdr-rule"></div>
</div>`;

  const footer = `
<div class="page-footer">
  <div class="ftr-rule"></div>
  <div class="ftr-inner">
    <div class="ftr-left">
      <div><strong>Corporate Office:</strong> H-12, Green Park Extension, New Delhi - 110016 &nbsp;|&nbsp; Tel: 011-41039506</div>
      <div class="ftr-cin">CIN: ${COMPANY.cin} &nbsp;|&nbsp; www.krishicare.in</div>
    </div>
  </div>
</div>`;

  const mainLetter = `
<div class="page">
  ${header}
  <div class="page-body">

    <p class="date-line">${formatDate(ol.offer_date || new Date())}</p>

    <div class="cand-card no-break">
      <p class="cand-name">${ol.candidate_name}</p>
      <div class="cand-row">
        ${ol.candidate_address ? `<div class="cand-item"><span class="cand-label">Address:</span><span>${ol.candidate_address.replace(/\\n/g,', ')}</span></div>` : ''}
        ${ol.employee_code    ? `<div class="cand-item"><span class="cand-label">Emp Code:</span><span>${ol.employee_code}</span></div>` : ''}
        ${ol.candidate_mobile ? `<div class="cand-item"><span class="cand-label">Mobile:</span><span>${ol.candidate_mobile}</span></div>` : ''}
        ${ol.candidate_email  ? `<div class="cand-item"><span class="cand-label">Email:</span><span>${ol.candidate_email}</span></div>` : ''}
      </div>
    </div>

    <p class="salut">Dear <strong>${ol.candidate_name}</strong>,</p>

    <div class="subj-wrap no-break">
      <div class="subj-label">Subject</div>
      <div class="subj-text">Letter of Offer / Appointment for the position of &ldquo;${ol.designation}&rdquo;</div>
    </div>

    <p class="para">In reference to our discussions, we are pleased to offer you the position of <strong>&ldquo;${ol.designation}&rdquo;</strong> in Krishi Care &amp; Management Services Private Limited to be based at our <strong>${ol.location||'Mumbai'} Office</strong>${ol.joining_date ? `, effective <strong>${joiningDateHTML(ol.joining_date)}</strong>` : ''}.</p>

    <p class="para">This offer letter is valid for <strong>${ol.offer_valid_days||7} days</strong> from the date of issue. Kindly revert with your decision within the stipulated period; failing which the offer shall stand withdrawn.</p>

    <p class="para">We are pleased to extend this offer on the following terms &amp; conditions:</p>

    <div class="sec-hd">Emoluments</div>
    <p class="para">Your compensation on a Cost to Company (CTC) basis will be <strong>Rs.&nbsp;${Number(ctcAnnual).toLocaleString('en-IN')}/- per annum (Rupees ${numberToWords(Math.round(ctcAnnual))} Only)</strong>. The remuneration is inclusive of all taxable and non-taxable emoluments, allowances, and statutory contributions.</p>

    <div class="sec-hd">Responsibilities</div>
    <p class="para">You will be designated as <strong>&ldquo;${ol.designation}&rdquo;</strong> and shall be responsible for carrying out operations as directed by the management. A detailed job description will be provided upon joining.</p>

    <div class="sec-hd">Probation Period</div>
    <p class="para">You will be on probation for a period of <strong>${probStr} (${ol.probation_months||6}) months</strong>. During this period, employment may be terminated without notice or reason. Regularisation is subject to satisfactory performance assessment.</p>

    <div class="sec-hd">Separation of Services</div>
    <p class="para">Either party may terminate this employment by serving a written notice of <strong>${noticeStr} (${ol.notice_period_months||3}) month(s)</strong>. In the event of inability to serve the notice period, the equivalent salary shall be payable as compensation.</p>

    ${ol.custom_clauses ? `<div class="sec-hd">Additional Terms</div><p class="para">${ol.custom_clauses}</p>` : ''}

    <div class="sec-hd">General Rules &amp; Regulations</div>
    <p class="para">You are expected to maintain the highest standards of professionalism, initiative, and integrity in your role. The following conditions shall govern your employment:</p>
    <ul class="rules">
      <li>You shall, in all respects, be governed by the Company&rsquo;s rules and regulations as amended from time to time.</li>
      <li>You shall devote your full time and attention exclusively to the Company and shall not undertake any direct or indirect outside employment or business without prior written consent of the Management.</li>
      <li>You shall comply with all applicable Leave Rules of the Company.</li>
      <li>Your appointment is based on the accuracy of information furnished. Any misrepresentation or concealment of facts may result in immediate termination without notice.</li>
      <li>You shall not, during the period of employment or thereafter, disclose, divulge, or communicate any confidential or strategic information of the Company or its clients to any third party.</li>
      <li>All records, documents, correspondence, data, and other materials related to Company business that come into your possession shall remain the exclusive property of the Company and shall be returned upon separation.</li>
      <li>You shall be responsible for the safekeeping of all Company assets in your custody. Any loss or damage shall be recoverable from your dues.</li>
      <li>You shall promptly inform the Company of any change in your residential address. Failure to do so may be treated as wilful withholding of information.</li>
    </ul>

    <p class="para"><strong>Documentation Required:</strong> Upon acceptance, please submit: (a) 3 passport-size photographs, (b) self-attested copies of academic qualifications, PAN Card, Aadhaar Card, and Address Proof, (c) last 3 months&rsquo; salary slips or Form&nbsp;16, and (d) relieving letter from previous employer at the time of joining.</p>

    <p class="para">As a token of acceptance, please sign the duplicate copy of this letter and return it at the earliest, along with your expected date of joining.</p>

    <p class="sig-intro">Yours sincerely,<br><strong>For Krishi Care &amp; Management Services Private Limited</strong></p>

    <table class="sig-table no-break">
      <tr>
        <td class="sig-td">
          ${ol.sig1_image ? `<img src="${ol.sig1_image}" class="sig-img" alt="">` : '<div class="sig-blank"></div>'}
          <div class="sig-name">Authorized Signatory</div>
          <div class="sig-role">Krishi Care &amp; Management Services Pvt. Ltd.</div>
        </td>
        <td class="sig-td">
          ${ol.sig2_image ? `<img src="${ol.sig2_image}" class="sig-img" alt="">` : '<div class="sig-blank"></div>'}
          <div class="sig-name">Authorized Signatory</div>
          <div class="sig-role">Human Resources</div>
        </td>
      </tr>
    </table>

  </div>
  ${footer}
</div>`;

  const annexure = `
<div class="page page-break">
  ${header}
  <div class="page-body">

    <p class="ann-title">Annexure I &mdash; Compensation Structure</p>
    <p class="ann-sub">Annual Cost to Company and Other Benefits</p>

    <div class="summary-grid no-break">
      <div class="summary-cell">
        <div class="summary-key">Candidate Name</div>
        <div class="summary-val">${ol.candidate_name}</div>
      </div>
      <div class="summary-cell">
        <div class="summary-key">Designation</div>
        <div class="summary-val">${ol.designation}</div>
      </div>
      <div class="summary-cell">
        <div class="summary-key">Location</div>
        <div class="summary-val">${ol.location||'Mumbai'}</div>
      </div>
      <div class="summary-cell">
        <div class="summary-key">Effective Date</div>
        <div class="summary-val">${ol.joining_date ? formatDate(ol.joining_date) : formatDate(ol.offer_date||new Date())}</div>
      </div>
      <div class="summary-cell summary-ctc">
        <div class="summary-key">Annual Cost to Company (CTC)</div>
        <div class="summary-val">Rs. ${Number(ctcAnnual).toLocaleString('en-IN')}/- &nbsp;<span style="font-size:9pt;font-weight:400;color:#a8d5b8">(Rupees ${numberToWords(Math.round(ctcAnnual))} Only)</span></div>
      </div>
    </div>

    <table class="sal-tbl no-break">
      <thead>
        <tr>
          <th class="c-sr">Sr.</th>
          <th>Component</th>
          <th class="c-num">Monthly (&#8377;)</th>
          <th class="c-num">Annual (&#8377;)</th>
        </tr>
      </thead>
      <tbody>
        <tr><td class="c-sr">1</td><td>Fixed Basic Salary</td><td class="c-num">${fmtV(basic)}</td><td class="c-num">${fmtV(basic*12)}</td></tr>
        <tr><td class="c-sr">2</td><td>House Rent Allowance (HRA)</td><td class="c-num">${fmtV(hra)}</td><td class="c-num">${fmtV(hra*12)}</td></tr>
        ${conv>0?`<tr><td class="c-sr">3</td><td>Conveyance Allowance</td><td class="c-num">${fmtV(conv)}</td><td class="c-num">${fmtV(conv*12)}</td></tr>`:''}
        <tr><td class="c-sr">${conv>0?4:3}</td><td>Other Allowances (Balance)</td><td class="c-num">${fmtV(other)}</td><td class="c-num">${fmtV(other*12)}</td></tr>
        <tr><td class="c-sr">${conv>0?5:4}</td><td>Gratuity</td><td class="c-num">${fmtV(gratuity)}</td><td class="c-num">${fmtV(gratuity*12)}</td></tr>
        <tr class="r-gross">
          <td class="c-sr">A</td><td>&#9654; Total Gross Salary</td>
          <td class="c-num">${fmtV(gross)}</td><td class="c-num">${fmtV(gross*12)}</td>
        </tr>
        <tr><td class="c-sr">B1</td><td>PF Contribution — Employee (on Basic)</td><td class="c-num">${pfEmp>0?fmtV(pfEmp):'&mdash;'}</td><td class="c-num">${pfEmp>0?fmtV(pfEmp*12):'&mdash;'}</td></tr>
        <tr><td class="c-sr">B2</td><td>Professional Tax</td><td class="c-num">${pt>0?fmtV(pt):'&mdash;'}</td><td class="c-num">${pt>0?fmtV(pt*12):'&mdash;'}</td></tr>
        <tr class="r-ded">
          <td class="c-sr">B</td><td>&#9654; Total Deductions (B1 + B2)</td>
          <td class="c-num">${totalDed>0?fmtV(totalDed):'&mdash;'}</td><td class="c-num">${totalDed>0?fmtV(totalDed*12):'&mdash;'}</td>
        </tr>
        <tr class="r-net">
          <td class="c-sr">C</td><td>&#9654; Net Take-Home Salary (A &minus; B)</td>
          <td class="c-num">${fmtV(netSalary)}</td><td class="c-num">${fmtV(netSalary*12)}</td>
        </tr>
        <tr><td class="c-sr">D1</td><td>PF Contribution — Employer</td><td class="c-num">${pfEmpr>0?fmtV(pfEmpr):'&mdash;'}</td><td class="c-num">${pfEmpr>0?fmtV(pfEmpr*12):'&mdash;'}</td></tr>
        <tr><td class="c-sr">D2</td><td>PF Admin Charges — Employer</td><td class="c-num">${pfAdmin>0?fmtV(pfAdmin):'&mdash;'}</td><td class="c-num">${pfAdmin>0?fmtV(pfAdmin*12):'&mdash;'}</td></tr>
        <tr class="r-ctc">
          <td class="c-sr">D</td><td>&#9654; Total CTC (A + D1 + D2)</td>
          <td class="c-num">${fmtV(ctcMonthly)}</td><td class="c-num">${fmtV(ctcAnnual)}</td>
        </tr>
      </tbody>
    </table>

    <div class="ack-box no-break">
      <div class="ack-title">Acknowledgement &amp; Acceptance</div>
      <p class="ack-para">I, the undersigned, hereby confirm that I have read, understood, and agree to all the terms and conditions mentioned in this Offer Letter and its Annexure, and I accept the same unconditionally.</p>
      <div class="ack-grid">
        <div class="ack-field">
          <label>Signature</label>
          <span class="ack-line"></span>
        </div>
        <div class="ack-field">
          <label>Date</label>
          <span class="ack-line"></span>
        </div>
        <div class="ack-field">
          <label>Full Name</label>
          <span class="ack-line"></span>
        </div>
        <div class="ack-field">
          <label>Location</label>
          <span class="ack-line"></span>
        </div>
      </div>
    </div>

  </div>
  ${footer}
</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offer Letter &mdash; ${ol.candidate_name}</title>
<style>${css}</style>
</head>
<body>
${mainLetter}
${annexure}
</body>
</html>`;
}












// ── GET /offer-letters — list all ─────────────────────────────────────────────
exports.getAll = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT ol.*, CONCAT(e.first_name,' ',e.last_name) AS created_by_name
      FROM offer_letters ol
      LEFT JOIN employees e ON ol.created_by = e.id
      ORDER BY ol.created_at DESC
    `);
    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error('[offerLetter.getAll]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── GET /offer-letters/:id — get one ─────────────────────────────────────────
exports.getOne = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM offer_letters WHERE id=$1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    res.json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── POST /offer-letters — create ─────────────────────────────────────────────
exports.create = async (req, res) => {
  try {
    const {
      candidate_name, candidate_email, candidate_address, candidate_mobile,
      designation, location = 'Mumbai', joining_date, offer_date, offer_valid_days = 7,
      ctc_annual, basic_monthly, hra_monthly, conveyance_monthly = 0,
      other_allowance_monthly, gratuity_monthly = 0,
      pf_employee_monthly = 0, pf_employer_monthly = 0, pf_admin_monthly = 0,
      professional_tax_monthly = 0,
      probation_months = 6, notice_period_months = 3, custom_clauses, employee_id,
      employee_code,
      sig1_image, sig2_image
    } = req.body;

    if (!candidate_name || !designation)
      return res.status(400).json({ success: false, message: 'candidate_name and designation required' });

    const result = await db.query(`
      INSERT INTO offer_letters (
        employee_id, candidate_name, candidate_email, candidate_address, candidate_mobile,
        designation, location, joining_date, offer_date, offer_valid_days,
        ctc_annual, basic_monthly, hra_monthly, conveyance_monthly, other_allowance_monthly,
        gratuity_monthly, pf_employee_monthly, pf_employer_monthly, pf_admin_monthly,
        professional_tax_monthly, employee_code,
        probation_months, notice_period_months, custom_clauses, sig1_image, sig2_image,
        created_by, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,NOW())
      RETURNING *`,
      [employee_id||null, candidate_name, candidate_email||null, candidate_address||null, candidate_mobile||null,
       designation, location, joining_date||null, offer_date||null, offer_valid_days,
       ctc_annual||0, basic_monthly||0, hra_monthly||0, conveyance_monthly, other_allowance_monthly||0,
       gratuity_monthly, pf_employee_monthly, pf_employer_monthly, pf_admin_monthly,
       professional_tax_monthly||0, employee_code||null,
       probation_months, notice_period_months, custom_clauses||null, sig1_image||null, sig2_image||null,
       req.user.id]
    );
    res.json({ success: true, data: result.rows[0], message: 'Offer letter created!' });
  } catch (err) {
    console.error('[offerLetter.create]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── PUT /offer-letters/:id — update ──────────────────────────────────────────
exports.update = async (req, res) => {
  try {
    const fields = ['candidate_name','candidate_email','candidate_address','candidate_mobile',
      'designation','location','joining_date','offer_date','offer_valid_days',
      'ctc_annual','basic_monthly','hra_monthly','conveyance_monthly','other_allowance_monthly',
      'gratuity_monthly','pf_employee_monthly','pf_employer_monthly','pf_admin_monthly',
      'professional_tax_monthly','employee_code',
      'probation_months','notice_period_months','custom_clauses','sig1_image','sig2_image'];
    const sets = [], params = [];
    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        sets.push(`${f}=$${params.length+1}`);
        params.push(req.body[f]);
      }
    });
    if (!sets.length) return res.json({ success: true, message: 'Nothing to update' });
    sets.push(`updated_at=NOW()`);
    params.push(req.params.id);
    await db.query(`UPDATE offer_letters SET ${sets.join(',')} WHERE id=$${params.length}`, params);
    res.json({ success: true, message: 'Updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── GET /offer-letters/:id/preview — HTML preview ───────────────────────────
exports.preview = async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM offer_letters WHERE id=$1', [req.params.id]);
    if (!result.rows.length) return res.status(404).send('Not found');
    const ol = result.rows[0];
    let html = buildOfferLetterHTML(ol);
    // Inject auto-print script before </body> so user can save as PDF
    const printScript = `
<style>
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
<div id="pdf-bar" style="position:fixed;top:0;left:0;right:0;background:#1B5E20;color:white;padding:10px 20px;display:flex;align-items:center;justify-content:space-between;z-index:9999;font-family:sans-serif;font-size:14px;box-shadow:0 2px 8px rgba(0,0,0,.3);">
  <span>📄 Offer Letter Preview</span>
  <div style="display:flex;gap:10px;">
    <button onclick="window.print()" style="background:#fff;color:#1B5E20;border:none;padding:8px 18px;border-radius:6px;font-weight:700;cursor:pointer;font-size:14px;">⬇️ Download / Save as PDF</button>
    <button onclick="document.getElementById('pdf-bar').style.display='none'" style="background:transparent;color:#fff;border:1px solid rgba(255,255,255,.4);padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;">✕ Hide Bar</button>
  </div>
</div>
<div style="height:52px;"></div>
<script>
  // Auto-show print dialog after a short delay
  window.addEventListener('load', () => {
    document.title = 'Offer_Letter_${ol.candidate_name.replace(/'/g,"\'")}';
  });
<\/script>`;
    html = html.replace('</body>', printScript + '</body>');
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send('Server error');
  }
};

// ── POST /offer-letters/:id/send — email offer letter ───────────────────────
exports.sendEmail = async (req, res) => {
  try {
    const { cc = [], bcc = [], email_message = '' } = req.body;
    const result = await db.query('SELECT * FROM offer_letters WHERE id=$1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

    const ol = result.rows[0];
    if (!ol.candidate_email) return res.status(400).json({ success: false, message: 'No email on this offer letter' });

    // ── Build the offer letter HTML ─────────────────────────────────────────
    const offerHTML = buildOfferLetterHTML(ol);

    // ── Cover email body ────────────────────────────────────────────────────
    const defaultMsg = `Dear ${ol.candidate_name.split(' ')[0] || ol.candidate_name},\n\nPlease find attached your offer letter for the position of "${ol.designation}" at Krishi Care & Management Services Private Limited.\n\nKindly review the letter and revert back with your acceptance within ${ol.offer_valid_days || 7} days.\n\nPlease also find attached the Joining Form. Kindly fill it and submit upon joining.\n\nFor any queries, feel free to reach out to us.\n\nWarm regards,\nHuman Resource Team\nKrishi Care & Management Services Pvt. Ltd.`;

    const coverText = (email_message || defaultMsg).replace(/\n/g, '<br>');

    const coverHtml = `
      <div style="font-family:Arial,sans-serif;font-size:13px;color:#222;line-height:1.7;max-width:600px;">
        <div style="background:#1B5E20;padding:16px 24px;border-radius:8px 8px 0 0;">
          <span style="color:#fff;font-size:16px;font-weight:700;">KrishiHR</span>
          <span style="color:#A5D6A7;font-size:12px;margin-left:8px;">Krishi Care &amp; Management Services</span>
        </div>
        <div style="border:1px solid #e0e0e0;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
          <p>${coverText}</p>
          <hr style="border:none;border-top:1px solid #eee;margin:20px 0;">
          <p style="font-size:11px;color:#999;"><strong>Attachments:</strong><br>
            &#128196; Offer Letter (PDF)<br>
            &#128203; Joining Form (DOCX &amp; PDF) — Please fill and submit on joining day
          </p>
          <p style="font-size:11px;color:#999;">To save the offer letter as PDF: open in browser &rarr; Ctrl+P &rarr; Save as PDF.</p>
        </div>
      </div>`;

    // ── Build attachments array ──────────────────────────────────────────────
    const attachments = [];

    // 1. Offer Letter as PDF (via wkhtmltopdf) or fallback to HTML
    try {
      const tmpDir  = os.tmpdir();
      const tmpHtml = path.join(tmpDir, `offer_${ol.id}_${Date.now()}.html`);
      const tmpPdf  = path.join(tmpDir, `offer_${ol.id}_${Date.now()}.pdf`);
      fs.writeFileSync(tmpHtml, offerHTML);

      await new Promise((resolve, reject) => {
        execFile('wkhtmltopdf', [
          '--quiet',
          '--page-size', 'A4',
          '--margin-top', '10mm',
          '--margin-bottom', '10mm',
          '--margin-left', '10mm',
          '--margin-right', '10mm',
          '--print-media-type',
          '--enable-local-file-access',
          tmpHtml, tmpPdf
        ], (err) => { if (err) return reject(err); resolve(); });
      });

      const pdfBuffer = fs.readFileSync(tmpPdf);
      try { fs.unlinkSync(tmpHtml); fs.unlinkSync(tmpPdf); } catch(_) {}
      attachments.push({
        name:    `Offer_Letter_${ol.candidate_name.replace(/\s+/g,'_')}.pdf`,
        content: pdfBuffer.toString('base64'),
      });
    } catch (pdfErr) {
      console.error('Offer letter PDF generation failed, falling back to HTML:', pdfErr.message);
      attachments.push({
        name:    `Offer_Letter_${ol.candidate_name.replace(/\s+/g,'_')}.html`,
        content: Buffer.from(offerHTML).toString('base64'),
      });
    }

    // 2. Joining Form DOCX — always attach if file exists
    const joiningFormPath = path.join(__dirname, '..', 'assets', 'Joining_form_Krishi_Care.docx');
    if (fs.existsSync(joiningFormPath)) {
      const docxBuffer = fs.readFileSync(joiningFormPath);
      attachments.push({
        name:    'Joining_Form_Krishi_Care.docx',
        content: docxBuffer.toString('base64'),
      });

      // 3. Joining Form as PDF — best-effort via LibreOffice
      try {
        const tmpDocx = path.join(os.tmpdir(), `joining_form_${Date.now()}.docx`);
        fs.writeFileSync(tmpDocx, docxBuffer);

        await new Promise((resolve, reject) => {
          execFile('libreoffice', [
            '--headless', '--convert-to', 'pdf',
            '--outdir', os.tmpdir(),
            tmpDocx
          ], (err) => { if (err) return reject(err); resolve(); });
        });

        const libreOutPdf = tmpDocx.replace(/\.docx$/, '.pdf');
        if (fs.existsSync(libreOutPdf)) {
          const pdfJoiningBuffer = fs.readFileSync(libreOutPdf);
          try { fs.unlinkSync(tmpDocx); fs.unlinkSync(libreOutPdf); } catch(_) {}
          attachments.push({
            name:    'Joining_Form_Krishi_Care.pdf',
            content: pdfJoiningBuffer.toString('base64'),
          });
          console.log('[offerLetter.sendEmail] Joining form PDF attached successfully');
        } else {
          try { fs.unlinkSync(tmpDocx); } catch(_) {}
        }
      } catch (joiningPdfErr) {
        console.warn('[offerLetter.sendEmail] Joining form PDF skipped (LibreOffice not available):', joiningPdfErr.message);
        // DOCX is already attached — PDF is best-effort only
      }
    } else {
      console.warn('[offerLetter.sendEmail] Joining form not found at:', joiningFormPath);
    }

    // ── Brevo payload with all attachments ───────────────────────────────────
    const payload = {
      sender:      { name: process.env.EMAIL_FROM_NAME || 'KrishiHR', email: process.env.EMAIL_FROM || 'anonymous.agritech@gmail.com' },
      to:          [{ email: ol.candidate_email, name: ol.candidate_name }],
      subject:     `Offer Letter — ${ol.designation} | Krishi Care & Management Services`,
      htmlContent: coverHtml,
      attachment:  attachments,
    };

    const cleanCc  = (Array.isArray(cc)  ? cc  : []).map(e => (e||'').trim()).filter(e => e && e.includes('@'));
    const cleanBcc = (Array.isArray(bcc) ? bcc : []).map(e => (e||'').trim()).filter(e => e && e.includes('@'));
    if (cleanCc.length)  payload.cc  = cleanCc.map(e => ({ email: e }));
    if (cleanBcc.length) payload.bcc = cleanBcc.map(e => ({ email: e }));

    const BREVO_KEY = process.env.BREVO_API_KEY;
    if (!BREVO_KEY || process.env.EMAIL_ENABLED !== 'true') {
      await db.query(`UPDATE offer_letters SET status='sent', sent_at=NOW() WHERE id=$1`, [ol.id]);
      return res.json({
        success: true,
        message: `[Simulated] Offer letter sent to ${ol.candidate_email} with ${attachments.length} attachment(s): ${attachments.map(a => a.name).join(', ')}`
      });
    }

    const resp = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': BREVO_KEY },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const err = await resp.text();
      return res.status(500).json({ success: false, message: `Email failed: ${err}` });
    }

    await db.query(`UPDATE offer_letters SET status='sent', sent_at=NOW() WHERE id=$1`, [ol.id]);
    res.json({ success: true, message: `Offer letter sent to ${ol.candidate_email} with ${attachments.length} attachment(s)` });
  } catch (err) {
    console.error('[offerLetter.sendEmail]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── DELETE /offer-letters/:id ─────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    await db.query('DELETE FROM offer_letters WHERE id=$1', [req.params.id]);
    res.json({ success: true, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
