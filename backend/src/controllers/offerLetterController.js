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
  const gross = parseFloat(ol.basic_monthly||0) + parseFloat(ol.hra_monthly||0) +
    parseFloat(ol.conveyance_monthly||0) + parseFloat(ol.other_allowance_monthly||0) +
    parseFloat(ol.gratuity_monthly||0);
  const totalDed = parseFloat(ol.pf_employee_monthly||0);
  const netSalary = gross - totalDed;
  const ctcMonthly = gross + parseFloat(ol.pf_employer_monthly||0) + parseFloat(ol.pf_admin_monthly||0);
  const ctcAnnual = parseFloat(ol.ctc_annual || (ctcMonthly * 12));

  // KCMS logo (same base64 as used in app.js sidebar)
  const LOGO_B64 = `data:image/png;base64,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`;

  const fmt = v => v > 0 ? Number(v).toLocaleString('en-IN') : '–';
  const fmtAnn = v => v > 0 ? Number(v * 12).toLocaleString('en-IN') : '0';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #111; background: #fff; }
  .page { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 0; }

  /* ── TOP HEADER BAR ── */
  .hdr-top {
    border-bottom: 2.5px solid #1B5E20;
    padding: 14px 30px 12px;
    display: flex;
    align-items: center;
    gap: 16px;
  }
  .hdr-logo {
    width: 68px; height: 68px;
    flex-shrink: 0;
  }
  .hdr-logo img { width: 100%; height: 100%; object-fit: contain; }
  .hdr-text { flex: 1; }
  .hdr-company { font-size: 17pt; font-weight: 900; color: #1B5E20; letter-spacing: -0.3px; }
  .hdr-addr { font-size: 8.5pt; color: #444; line-height: 1.55; margin-top: 3px; }
  .hdr-addr strong { color: #1B5E20; }
  .hdr-tagline {
    font-size: 7.5pt; font-weight: 700; color: #fff;
    background: #1B5E20;
    padding: 2px 8px; border-radius: 3px;
    margin-top: 5px; display: inline-block;
    text-transform: uppercase; letter-spacing: .05em;
  }

  /* ── BODY ── */
  .body { padding: 20px 30px 24px; }
  .date-right { text-align: right; font-size: 10.5pt; margin-bottom: 18px; }
  .candidate { margin-bottom: 18px; line-height: 1.65; font-size: 10.5pt; }
  .candidate strong { font-size: 11pt; }
  .subject-line {
    font-weight: bold; text-decoration: underline;
    font-size: 10.5pt; margin: 18px 0 14px; text-align: center;
  }
  .salutation { margin-bottom: 10px; font-size: 10.5pt; }
  .para { font-size: 10.5pt; line-height: 1.75; text-align: justify; margin-bottom: 10px; }

  /* ── SECTION TITLES ── */
  .sec-title {
    font-weight: bold; text-decoration: underline;
    font-size: 10.5pt; margin: 18px 0 8px;
  }

  /* ── SALARY TABLE ── */
  table { width: 100%; border-collapse: collapse; margin: 8px 0 14px; font-size: 9.5pt; }
  table th {
    background: #d4edda; color: #1B5E20; font-weight: 700;
    padding: 7px 10px; border: 1px solid #aaa; text-align: center;
  }
  table td { padding: 6px 10px; border: 1px solid #ccc; }
  table td:last-child, table td:nth-child(2) { text-align: right; }
  .row-total td { font-weight: bold; background: #f1f8e9; }
  .row-ded td { color: #b71c1c; }
  .row-net td { font-weight: bold; background: #e3f2fd; color: #0d47a1; }
  .row-ctc-head td { font-weight: bold; background: #f5f5f5; font-size: 9.5pt; }
  .row-ctc td { font-weight: bold; background: #fff8e1; color: #e65100; font-size: 10pt; }

  /* ── BULLET LIST ── */
  ul.rules { margin: 6px 0 12px 22px; }
  ul.rules li { font-size: 10pt; line-height: 1.7; margin-bottom: 4px; text-align: justify; }

  /* ── ACCEPTANCE BLOCK ── */
  .acceptance { font-size: 10pt; line-height: 1.75; text-align: justify; margin: 12px 0 8px; }
  .acceptance strong { font-weight: bold; }

  /* ── SIGNATURE ── */
  .sig-section { margin-top: 36px; display: flex; justify-content: space-between; }
  .sig-col { width: 44%; }
  .sig-line { border-top: 1px solid #333; padding-top: 5px; font-size: 9.5pt; margin-top: 44px; }

  /* ── FOOTER BAR ── */
  .hdr-footer {
    border-top: 2px solid #1B5E20;
    padding: 8px 30px;
    text-align: center;
    font-size: 8pt;
    color: #444;
    margin-top: 30px;
  }
  .hdr-footer strong { color: #1B5E20; }

  @media print {
    body { margin: 0; }
    .page { width: 100%; }
  }
</style>
</head>
<body>
<div class="page">

  <!-- ═══ HEADER ═══ -->
  <div class="hdr-top">
    <div class="hdr-logo">
      <img src="${LOGO_B64}" alt="KCMS Logo" style="width:68px;height:68px;object-fit:contain;">
    </div>
    <div class="hdr-text">
      <div class="hdr-company">Krishi Care &amp; Management Services Private Limited</div>
      <div class="hdr-addr">
        <strong>Office Address:</strong> ${COMPANY.officeAddr}<br>
        <strong>Email:</strong> ${COMPANY.email} &nbsp;&nbsp;
        <strong>Website:</strong> ${COMPANY.website} &nbsp;&nbsp;
        <strong>Tel:</strong> ${COMPANY.tel}
      </div>
      <div class="hdr-tagline">Bringing Krishi and Vigyan Together</div>
    </div>
  </div>

  <!-- ═══ BODY ═══ -->
  <div class="body">

    <!-- Date -->
    <div class="date-right">${formatDate(ol.offer_date || new Date())}</div>

    <!-- Candidate Info -->
    <div class="candidate">
      <strong>${ol.candidate_name}</strong><br>
      ${ol.candidate_address || ''}<br>
      ${ol.candidate_mobile ? `<br>Mob – ${ol.candidate_mobile}` : ''}
      ${ol.candidate_email ? `<br>Email – ${ol.candidate_email}` : ''}
    </div>

    <!-- Subject -->
    <div class="subject-line">
      Sub: Letter of offer/Appointment for the position of &ldquo;${ol.designation}&rdquo;
    </div>

    <div class="salutation">Dear ${ol.candidate_name.split(' ').slice(-1)[0] || ol.candidate_name},</div>

    <div class="para">
      In reference to our discussions, we are pleased to offer you the position of <strong>&ldquo;${ol.designation}&rdquo;</strong>
      in Krishi Care &amp; Management Services Private Limited to be based at our <strong>${ol.location || 'Mumbai'} Office</strong>
      ${ol.joining_date ? `as from <strong>${formatDate(ol.joining_date)}</strong>.` : '.'}
    </div>

    <div class="para">
      The offer letter is valid for <strong>${ol.offer_valid_days || 7} days</strong> by which time we must be informed of your decision;
      the said offer letter shall stand cancelled after the above-mentioned date.
    </div>

    <div class="para">We are pleased to issue this letter of offer on the following terms &amp; conditions:</div>

    <!-- EMOLUMENTS -->
    <div class="sec-title">EMOLUMENTS:</div>
    <div class="para">
      Your compensation on a cost to company basis will be
      <strong>Rs. ${Number(ctcAnnual).toLocaleString('en-IN')} /- PA
      (Rupees ${numberToWords(Math.round(ctcAnnual))} Only)</strong>.
      The remuneration has taken into consideration the status and responsibility of the appointment,
      and it is inclusive of all taxable and non-taxable emoluments, allowances and statutory contributions.
    </div>

    <!-- Salary Table -->
    <table>
      <thead>
        <tr>
          <th style="text-align:left;">Components In Salary</th>
          <th>Per Month (₹)</th>
          <th>Per Annum (₹)</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>Basic Salary</td><td>${fmt(ol.basic_monthly)}</td><td>${fmtAnn(ol.basic_monthly)}</td></tr>
        <tr><td>HRA (calculated on basic wage)</td><td>${fmt(ol.hra_monthly)}</td><td>${fmtAnn(ol.hra_monthly)}</td></tr>
        <tr><td>Conveyance Allowances (Fixed)</td><td>${fmt(ol.conveyance_monthly)}</td><td>${parseFloat(ol.conveyance_monthly||0) > 0 ? fmtAnn(ol.conveyance_monthly) : '0'}</td></tr>
        <tr><td>Other Allowances (Balance amount)</td><td>${fmt(ol.other_allowance_monthly)}</td><td>${fmtAnn(ol.other_allowance_monthly)}</td></tr>
        <tr><td>Gratuity</td><td>${fmt(ol.gratuity_monthly)}</td><td>${fmtAnn(ol.gratuity_monthly)}</td></tr>
        <tr class="row-total"><td><strong>Total Gross Salary</strong></td><td><strong>${Number(gross).toLocaleString('en-IN')}</strong></td><td><strong>${Number(gross*12).toLocaleString('en-IN')}</strong></td></tr>
        <tr class="row-ded"><td>PF Contribution by Employee (on basic)</td><td>${fmt(ol.pf_employee_monthly)}</td><td>${fmtAnn(ol.pf_employee_monthly)}</td></tr>
        <tr class="row-ded"><td>ESI Contribution by Employee (on gross)</td><td>–</td><td>0</td></tr>
        <tr class="row-ded"><td>Professional Tax (PT)</td><td>–</td><td>–</td></tr>
        <tr class="row-total"><td><strong>Total Deductions (PF+ESI+PT)</strong></td><td><strong>${Number(totalDed).toLocaleString('en-IN')}</strong></td><td><strong>${Number(totalDed*12).toLocaleString('en-IN')}</strong></td></tr>
        <tr class="row-net"><td><strong>Net Salary (Gross – Total Deductions)</strong></td><td><strong>${Number(netSalary).toLocaleString('en-IN')}</strong></td><td><strong>${Number(netSalary*12).toLocaleString('en-IN')}</strong></td></tr>
        <tr class="row-ctc-head"><td colspan="3"><strong>CTC Calculation</strong></td></tr>
        <tr><td>Employer PF Contribution</td><td>${fmt(ol.pf_employer_monthly)}</td><td>${fmtAnn(ol.pf_employer_monthly)}</td></tr>
        <tr><td>Employer PF Contribution Admin Charges</td><td>${fmt(ol.pf_admin_monthly)}</td><td>${fmtAnn(ol.pf_admin_monthly)}</td></tr>
        <tr><td>Employer ESI Contribution</td><td>–</td><td>0</td></tr>
        <tr class="row-ctc"><td><strong>CTC = Gross Salary + (Employer PF + ESI)</strong></td><td><strong>${Number(ctcMonthly).toLocaleString('en-IN')}</strong></td><td><strong>${Number(ctcAnnual).toLocaleString('en-IN')}</strong></td></tr>
      </tbody>
    </table>

    <!-- RESPONSIBILITIES -->
    <div class="sec-title">RESPONSIBILITIES:</div>
    <div class="para">
      You will work as <strong>&ldquo;${ol.designation}&rdquo;</strong> of the Company and will be responsible for
      carrying out the operations of the Company as directed to you by the management. A detailed responsibility
      statement will be provided to you upon your joining.
    </div>

    <!-- PROBATION -->
    <div class="sec-title">PROBATION PERIOD:</div>
    <div class="para">
      You will be on a probationary period of <strong>${ol.probation_months || 6} months</strong> during which the services
      can be terminated from employer without giving any reason and any time for notice of termination of services.
      The company may regularize your services subject to satisfactory completion of probationary period.
    </div>

    <!-- SEPARATION -->
    <div class="sec-title">SEPARATION OF SERVICES:</div>
    <div class="para">
      Severance of relationship can be done by giving <strong>${ol.notice_period_months || 3} month</strong> written notice.
      If you are unable to complete this notice period you will be liable to compensate the company
      ${ol.notice_period_months || 3} months of salary or for the period not served.
    </div>

    ${ol.custom_clauses ? `<div class="sec-title">ADDITIONAL TERMS:</div><div class="para">${ol.custom_clauses}</div>` : ''}

    <!-- OTHER RULES -->
    <div class="sec-title">OTHER RULES AND REGULATION:</div>
    <div class="para">
      The company will expect you to work in the Section / Department in which you are placed with a high
      standard of initiative, morality and economy.
    </div>
    <ul class="rules">
      <li>You will, in all respects, be governed by the company's rules and regulations.</li>
      <li>You will devote full time to the work of the Company and will not undertake any direct / indirect outside business or work, honorary or remunerative except with the prior written consent of the Management.</li>
      <li>You will abide by Leave Rules of company.</li>
      <li>You have been engaged on the presumption that the particulars furnished by you in your application are correct. In case the said particulars are found to be incorrect or that you have concealed or withheld information, the services can be terminated without notice.</li>
      <li>You will not, either during the period of your services or thereafter, disclose, divulge or communicate to any other person or group or company any strategic information of the organization or its clients.</li>
      <li>All correspondence, documents and papers relating to the company's business which come into your possession shall be the absolute property of the company.</li>
      <li>You will be responsible for the safe keeping and returning in good condition all company property in your use, custody, care or charge.</li>
      <li>You will keep us informed of your residential (mailing &amp; permanent) address. Any change should be notified in writing within one week.</li>
    </ul>

    <!-- ACCEPTANCE -->
    <div class="acceptance">
      <strong>If you are willing to accept this offer</strong> for the said position, we request you to submit
      3 copies of your latest colored Passport Size photograph, Self-attested Copy of your academic qualification,
      Self-attested copy of your PAN Card, Self-attested copy of your Aadhar Card, Self-attested Copy of Address
      Proof, and last 3 month Pay Slip / Form 16 from your previous employer. In addition, upon joining, you will
      have to submit a copy of your relieving letter from your previous employer.
    </div>
    <div class="para">
      As a token of your acceptance and in confirmation of the terms and conditions of this offer, please sign
      the duplicate copy of this letter and return to us at the earliest duly intimating when you are going to join.
    </div>

    <div class="para" style="margin-top:20px;">Yours truly,</div>
    <div class="para">From <strong>Krishi Care &amp; Management Services Private Limited,</strong></div>

    <!-- SIGNATURES -->
    <div class="sig-section">
      <div class="sig-col">
        ${ol.sig1_image ? `<img src="${ol.sig1_image}" style="height:48px;max-width:180px;object-fit:contain;display:block;margin-bottom:4px;">` : '<div style="height:48px;"></div>'}
        <div class="sig-line">Authorized Signatory</div>
      </div>
      <div class="sig-col">
        ${ol.sig2_image ? `<img src="${ol.sig2_image}" style="height:48px;max-width:180px;object-fit:contain;display:block;margin-bottom:4px;">` : '<div style="height:48px;"></div>'}
        <div class="sig-line">Human Resource<br>(Authorized Signatory)</div>
      </div>
    </div>

  </div><!-- /body -->

  <!-- ═══ FOOTER ═══ -->
  <div class="hdr-footer">
    <strong>Corporate Office:</strong> ${COMPANY.corpAddr} &nbsp;|&nbsp;
    <strong>Tel:</strong> 011-41039506 &nbsp;|&nbsp;
    <strong>CIN:</strong> ${COMPANY.cin}
  </div>

</div><!-- /page -->
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
      probation_months = 6, notice_period_months = 3, custom_clauses, employee_id,
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
        probation_months, notice_period_months, custom_clauses, sig1_image, sig2_image,
        created_by, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,NOW())
      RETURNING *`,
      [employee_id||null, candidate_name, candidate_email||null, candidate_address||null, candidate_mobile||null,
       designation, location, joining_date||null, offer_date||null, offer_valid_days,
       ctc_annual||0, basic_monthly||0, hra_monthly||0, conveyance_monthly, other_allowance_monthly||0,
       gratuity_monthly, pf_employee_monthly, pf_employer_monthly, pf_admin_monthly,
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

    if (cc.length)  payload.cc  = cc.map(e => ({ email: e }));
    if (bcc.length) payload.bcc = bcc.map(e => ({ email: e }));

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
