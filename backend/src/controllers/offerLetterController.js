// src/controllers/offerLetterController.js
// Generate, preview, and email offer letters

const db       = require('../config/db');
const emailSvc = require('../config/emailService');

const COMPANY = {
  name:       'Krishi Care & Management Services Private Limited',
  cin:        'U01403MH2015PTC261465',
  officeAddr: '617, 6th Floor, Hubtown Viva, Western Express Highway, Shankarwadi Jogeshwari (East), Mumbai - 400060',
  corpAddr:   'H-12, Green Park Extension, New Delhi - 110016',
  email:      'dipti.wadhaval@krishicare.in',
  website:    'www.krishicare.in',
  tel:        '+912268284109',
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
        sent_at           TIMESTAMP,
        created_by        INTEGER REFERENCES employees(id),
        created_at        TIMESTAMP DEFAULT NOW(),
        updated_at        TIMESTAMP DEFAULT NOW()
      );
    `);
    console.log('✅ Offer letter table ready');
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

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  body { font-family: Arial, sans-serif; font-size: 12pt; color: #222; margin: 0; padding: 0; }
  .page { max-width: 800px; margin: 0 auto; padding: 30px 40px; }
  .header { border-bottom: 2px solid #1B5E20; padding-bottom: 12px; margin-bottom: 20px; display: flex; align-items: center; justify-content: space-between; }
  .company-name { font-size: 18pt; font-weight: bold; color: #1B5E20; }
  .address { font-size: 9pt; color: #555; line-height: 1.5; }
  .date-line { text-align: right; margin: 16px 0; font-size: 11pt; }
  .candidate-block { margin: 16px 0; }
  .subject { font-weight: bold; text-decoration: underline; margin: 20px 0; font-size: 11pt; }
  .salutation { margin: 12px 0; }
  .body-text { line-height: 1.8; margin: 10px 0; text-align: justify; }
  .section-title { font-weight: bold; text-transform: uppercase; margin: 20px 0 8px; border-bottom: 1px solid #ccc; padding-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; }
  table td, table th { padding: 6px 10px; border: 1px solid #ddd; font-size: 10pt; }
  table th { background: #E8F5E9; font-weight: bold; }
  table .total-row td { font-weight: bold; background: #f1f8e9; }
  table .deduction-row td { color: #c62828; }
  table .net-row td { font-weight: bold; background: #E3F2FD; color: #1565C0; }
  table .ctc-row td { font-weight: bold; background: #FFF8E1; color: #E65100; font-size: 11pt; }
  .bullet-list { margin: 8px 0 8px 20px; }
  .bullet-list li { margin: 6px 0; line-height: 1.6; }
  .signature { margin-top: 40px; display: flex; justify-content: space-between; }
  .sig-block { width: 40%; }
  .sig-line { border-top: 1px solid #333; margin-top: 40px; padding-top: 4px; font-size: 10pt; }
  .footer { border-top: 1px solid #ccc; margin-top: 30px; padding-top: 10px; font-size: 9pt; color: #666; text-align: center; }
  .highlight { font-weight: bold; }
  @media print { body { margin: 0; } .page { padding: 20px; } }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div>
      <div class="company-name">Krishi Care &amp; Management Services Private Limited</div>
      <div class="address">
        Office: ${COMPANY.officeAddr}<br>
        Email: ${COMPANY.email} &nbsp;|&nbsp; Website: ${COMPANY.website} &nbsp;|&nbsp; Tel: ${COMPANY.tel}<br>
        Corporate: ${COMPANY.corpAddr}<br>
        CIN: ${COMPANY.cin}
      </div>
    </div>
  </div>

  <!-- Date -->
  <div class="date-line">${formatDate(ol.offer_date || new Date())}</div>

  <!-- Candidate -->
  <div class="candidate-block">
    <strong>${ol.candidate_name}</strong><br>
    ${ol.candidate_address || ''}<br>
    ${ol.candidate_mobile ? 'Mob – ' + ol.candidate_mobile : ''}${ol.candidate_email ? '<br>Email – ' + ol.candidate_email : ''}
  </div>

  <!-- Subject -->
  <div class="subject">
    Sub: Letter of offer/Appointment for the position of "${ol.designation}"
  </div>

  <div class="salutation">Dear ${ol.candidate_name.split(' ')[0] || 'Candidate'},</div>

  <div class="body-text">
    In reference to our discussions, we are pleased to offer you the position of <span class="highlight">"${ol.designation}"</span>
    in Krishi Care &amp; Management Services Private Limited to be based at our <span class="highlight">${ol.location} Office</span>
    ${ol.joining_date ? 'as from <span class="highlight">' + formatDate(ol.joining_date) + '</span>.' : '.'}
  </div>

  <div class="body-text">
    The offer letter is valid for <strong>${ol.offer_valid_days || 7} days</strong> by which time we must be informed of your decision;
    the said offer letter shall stand cancelled after the above-mentioned date.
  </div>

  <div class="body-text">We are pleased to issue this letter of offer on the following terms &amp; conditions:</div>

  <!-- Emoluments -->
  <div class="section-title">EMOLUMENTS:</div>
  <div class="body-text">
    Your compensation on a cost to company basis will be
    <strong>Rs. ${indianNumber(ctcAnnual)} /- PA (Rupees ${numberToWords(Math.round(ctcAnnual))} Only)</strong>.
    The remuneration has taken into consideration the status and responsibility of the appointment,
    and it is inclusive of all taxable and non-taxable emoluments, allowances and statutory contributions.
  </div>

  <!-- Salary Table -->
  <table>
    <thead>
      <tr><th>Components In Salary</th><th>Per Month (₹)</th><th>Per Annum (₹)</th></tr>
    </thead>
    <tbody>
      <tr><td>Basic Salary</td><td>${indianNumber(ol.basic_monthly)}</td><td>${indianNumber((ol.basic_monthly||0)*12)}</td></tr>
      <tr><td>HRA (calculated on basic wage)</td><td>${indianNumber(ol.hra_monthly)}</td><td>${indianNumber((ol.hra_monthly||0)*12)}</td></tr>
      <tr><td>Conveyance Allowances (Fixed)</td><td>${ol.conveyance_monthly > 0 ? indianNumber(ol.conveyance_monthly) : '–'}</td><td>${ol.conveyance_monthly > 0 ? indianNumber((ol.conveyance_monthly||0)*12) : '0'}</td></tr>
      <tr><td>Other Allowances (Balance amount)</td><td>${indianNumber(ol.other_allowance_monthly)}</td><td>${indianNumber((ol.other_allowance_monthly||0)*12)}</td></tr>
      <tr><td>Gratuity</td><td>${indianNumber(ol.gratuity_monthly)}</td><td>${indianNumber((ol.gratuity_monthly||0)*12)}</td></tr>
      <tr class="total-row"><td><strong>Total Gross Salary</strong></td><td><strong>${indianNumber(gross)}</strong></td><td><strong>${indianNumber(gross*12)}</strong></td></tr>
      <tr class="deduction-row"><td>PF Contribution by Employee (on basic)</td><td>${indianNumber(ol.pf_employee_monthly)}</td><td>${indianNumber((ol.pf_employee_monthly||0)*12)}</td></tr>
      <tr class="total-row"><td><strong>Total Deductions (PF+ESI+PT)</strong></td><td><strong>${indianNumber(totalDed)}</strong></td><td><strong>${indianNumber(totalDed*12)}</strong></td></tr>
      <tr class="net-row"><td><strong>Net Salary (Gross – Total Deductions)</strong></td><td><strong>${indianNumber(netSalary)}</strong></td><td><strong>${indianNumber(netSalary*12)}</strong></td></tr>
      <tr><td colspan="3" style="background:#f9f9f9;font-weight:bold;font-size:10pt;">CTC Calculation</td></tr>
      <tr><td>Employer PF Contribution</td><td>${indianNumber(ol.pf_employer_monthly)}</td><td>${indianNumber((ol.pf_employer_monthly||0)*12)}</td></tr>
      <tr><td>Employer PF Admin Charges</td><td>${indianNumber(ol.pf_admin_monthly)}</td><td>${indianNumber((ol.pf_admin_monthly||0)*12)}</td></tr>
      <tr class="ctc-row"><td><strong>CTC = Gross + (Employer PF + ESI)</strong></td><td><strong>${indianNumber(ctcMonthly)}</strong></td><td><strong>${indianNumber(ctcAnnual)}</strong></td></tr>
    </tbody>
  </table>

  <!-- Responsibilities -->
  <div class="section-title">RESPONSIBILITIES:</div>
  <div class="body-text">
    You will work as <strong>"${ol.designation}"</strong> of the Company and will be responsible for carrying out the
    operations of the Company as directed to you by the management. A detailed responsibility statement will be
    provided to you upon your joining.
  </div>

  <!-- Probation -->
  <div class="section-title">PROBATION PERIOD:</div>
  <div class="body-text">
    You will be on a probationary period of <strong>${ol.probation_months || 6} months</strong> during which the services can be terminated
    from employer without giving any reason and any time for notice of termination of services. The company may
    regularize your services subject to satisfactory completion of probationary period.
  </div>

  <!-- Separation -->
  <div class="section-title">SEPARATION OF SERVICES:</div>
  <div class="body-text">
    Severance of relationship can be done by giving <strong>${ol.notice_period_months || 3} month</strong> written notice. If you are unable to
    complete this notice period you will be liable to compensate the company ${ol.notice_period_months || 3} months of salary or for the
    period not served.
  </div>

  ${ol.custom_clauses ? `<div class="section-title">ADDITIONAL TERMS:</div><div class="body-text">${ol.custom_clauses}</div>` : ''}

  <!-- Other Rules -->
  <div class="section-title">OTHER RULES AND REGULATION:</div>
  <div class="body-text">The company will expect you to work in the Section / Department in which you are placed with a high standard of initiative, morality and economy.</div>
  <ul class="bullet-list">
    <li>You will, in all respects, be governed by the company's rules and regulations.</li>
    <li>You will devote full time to the work of the Company and will not undertake any direct/indirect outside business or work, honorary or remunerative except with the prior written consent of the Management.</li>
    <li>You will abide by Leave Rules of company.</li>
    <li>All correspondence and documents relating to the company's business which come into your possession shall be the absolute property of the company.</li>
    <li>You will keep us informed of your residential address. Any change should be notified in writing within one week.</li>
  </ul>

  <!-- Acceptance -->
  <div class="body-text">
    If you are willing to accept this offer for the said position, we request you to submit 3 copies of your latest
    colored Passport Size photograph, Self-attested Copy of your academic qualification, Self-attested copy of your
    PAN Card, Self-attested copy of your Aadhar Card, Self-attested Copy of Address Proof, and last 3 month Pay Slip /
    Form 16 from your previous employer. In addition, upon joining, you will have to submit a copy of your relieving
    letter from your previous employer.
  </div>
  <div class="body-text">
    As a token of your acceptance and in confirmation of the terms and conditions of this offer, please sign the
    duplicate copy of this letter and return to us at the earliest duly intimating when you are going to join.
  </div>

  <div class="body-text">Yours truly,</div>
  <div class="body-text">From <strong>Krishi Care &amp; Management Services Private Limited,</strong></div>

  <div class="signature">
    <div class="sig-block">
      <div class="sig-line">Authorized Signatory</div>
    </div>
    <div class="sig-block">
      <div class="sig-line">Human Resource (Authorized Signatory)</div>
    </div>
  </div>

  <div class="footer">
    <strong>Corporate Office:</strong> ${COMPANY.corpAddr} | CIN: ${COMPANY.cin}
  </div>

</div>
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
      probation_months = 6, notice_period_months = 3, custom_clauses, employee_id
    } = req.body;

    if (!candidate_name || !designation)
      return res.status(400).json({ success: false, message: 'candidate_name and designation required' });

    const result = await db.query(`
      INSERT INTO offer_letters (
        employee_id, candidate_name, candidate_email, candidate_address, candidate_mobile,
        designation, location, joining_date, offer_date, offer_valid_days,
        ctc_annual, basic_monthly, hra_monthly, conveyance_monthly, other_allowance_monthly,
        gratuity_monthly, pf_employee_monthly, pf_employer_monthly, pf_admin_monthly,
        probation_months, notice_period_months, custom_clauses, created_by, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,NOW())
      RETURNING *`,
      [employee_id||null, candidate_name, candidate_email||null, candidate_address||null, candidate_mobile||null,
       designation, location, joining_date||null, offer_date||null, offer_valid_days,
       ctc_annual||0, basic_monthly||0, hra_monthly||0, conveyance_monthly, other_allowance_monthly||0,
       gratuity_monthly, pf_employee_monthly, pf_employer_monthly, pf_admin_monthly,
       probation_months, notice_period_months, custom_clauses||null, req.user.id]
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
      'probation_months','notice_period_months','custom_clauses'];
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
    res.setHeader('Content-Type', 'text/html');
    res.send(buildOfferLetterHTML(result.rows[0]));
  } catch (err) {
    res.status(500).send('Server error');
  }
};

// ── POST /offer-letters/:id/send — email offer letter ───────────────────────
exports.sendEmail = async (req, res) => {
  try {
    const { cc = [], bcc = [] } = req.body;
    const result = await db.query('SELECT * FROM offer_letters WHERE id=$1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ success: false, message: 'Not found' });

    const ol = result.rows[0];
    if (!ol.candidate_email) return res.status(400).json({ success: false, message: 'No email on this offer letter' });

    const html = buildOfferLetterHTML(ol);

    // Build email payload
    const payload = {
      sender:   { name: 'KrishiHR', email: process.env.EMAIL_FROM || 'anonymous.agritech@gmail.com' },
      to:       [{ email: ol.candidate_email, name: ol.candidate_name }],
      subject:  `Offer Letter — ${ol.designation} | Krishi Care & Management Services`,
      htmlContent: html,
    };

    if (cc.length)  payload.cc  = cc.map(e  => ({ email: e }));
    if (bcc.length) payload.bcc = bcc.map(e => ({ email: e }));

    const BREVO_KEY = process.env.BREVO_API_KEY;
    if (!BREVO_KEY || process.env.EMAIL_ENABLED !== 'true') {
      await db.query(`UPDATE offer_letters SET status='sent', sent_at=NOW() WHERE id=$1`, [ol.id]);
      return res.json({ success: true, message: `[Simulated] Offer letter sent to ${ol.candidate_email}` });
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
    res.json({ success: true, message: `Offer letter sent to ${ol.candidate_email}` });
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
