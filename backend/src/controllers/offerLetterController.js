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
  const fmtV = v => Number(Math.round(v)).toLocaleString('en-IN');

  function joiningDateHTML(d) {
    if (!d) return '';
    const dt = new Date(d);
    const day = dt.getDate();
    const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const sup = [,'st','nd','rd'][day] || 'th';
    return `${day}<sup>${sup}</sup> ${months[dt.getMonth()]} ${dt.getFullYear()}`;
  }

  const probWords   = {3:'three',6:'six',12:'twelve'};
  const noticeWords = {1:'one',2:'two',3:'three',6:'six'};
  const probStr     = probWords[ol.probation_months]       || `${ol.probation_months||6}`;
  const noticeStr   = noticeWords[ol.notice_period_months] || `${ol.notice_period_months||3}`;

  // ── Shared header (green band style) ─────────────────────────────────────
  const header = `
<div class="page-header">
  <div class="header-band">
    <div class="header-left">
      <div class="company-logo-box">
        <span class="logo-leaf">🌿</span>
        <span class="logo-text">Krishi<span class="logo-accent">HR</span></span>
      </div>
    </div>
    <div class="header-center">
      <div class="company-name">Krishi Care &amp; Management Services Private Limited</div>
      <div class="company-sub">Regd. &amp; Head Office: 617, 6th Floor, Hubtown Viva, Western Express Highway,<br>Shankarwadi, Jogeshwari (East), Mumbai - 400060</div>
      <div class="company-contact">✉ hr@krishicare.in &nbsp;|&nbsp; 🌐 www.krishicare.com &nbsp;|&nbsp; ☎ +91 22 6828 4109</div>
    </div>
    <div class="header-right">
      <div class="header-badge">OFFICIAL<br>DOCUMENT</div>
    </div>
  </div>
  <div class="header-stripe"></div>
</div>`;

  // ── Shared footer ─────────────────────────────────────────────────────────
  const footer = `
<div class="page-footer">
  <div class="footer-stripe"></div>
  <div class="footer-content">
    <span>Corporate Office: H-12, Green Park Extension, New Delhi - 110016 &nbsp;|&nbsp; Tel: 011-41039506</span>
    <span class="footer-cin">CIN: ${COMPANY.cin}</span>
  </div>
</div>`;

  // ── CSS ───────────────────────────────────────────────────────────────────
  const css = `
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Arial', Helvetica, sans-serif;
  font-size: 10.5pt;
  color: #1a1a1a;
  background: #fff;
  line-height: 1.6;
}
.doc-page {
  width: 210mm;
  min-height: 297mm;
  margin: 0 auto;
  background: #fff;
  display: flex;
  flex-direction: column;
  position: relative;
}
.page-break { page-break-before: always; }

/* ── HEADER ── */
.page-header { width: 100%; }
.header-band {
  background: linear-gradient(135deg, #1B5E20 0%, #2E7D32 60%, #388E3C 100%);
  padding: 16px 28px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.header-left { flex: 0 0 auto; }
.company-logo-box {
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(255,255,255,0.15);
  border-radius: 10px;
  padding: 8px 14px;
  border: 1px solid rgba(255,255,255,0.3);
}
.logo-leaf { font-size: 22px; }
.logo-text { font-size: 20px; font-weight: 900; color: #fff; letter-spacing: 1px; }
.logo-accent { color: #A5D6A7; }
.header-center { flex: 1; text-align: center; }
.company-name {
  font-size: 14pt;
  font-weight: 900;
  color: #fff;
  letter-spacing: 0.3px;
  text-shadow: 0 1px 3px rgba(0,0,0,0.3);
  margin-bottom: 4px;
}
.company-sub { font-size: 8pt; color: #C8E6C9; line-height: 1.5; margin-bottom: 4px; }
.company-contact { font-size: 8pt; color: #A5D6A7; }
.header-right { flex: 0 0 auto; }
.header-badge {
  border: 1.5px solid rgba(255,255,255,0.5);
  border-radius: 8px;
  padding: 8px 12px;
  text-align: center;
  font-size: 7.5pt;
  font-weight: 700;
  color: rgba(255,255,255,0.85);
  letter-spacing: 1.5px;
  line-height: 1.8;
}
.header-stripe {
  height: 5px;
  background: linear-gradient(90deg, #A5D6A7, #FFD54F, #A5D6A7);
}

/* ── FOOTER ── */
.page-footer { width: 100%; margin-top: auto; }
.footer-stripe {
  height: 4px;
  background: linear-gradient(90deg, #1B5E20, #A5D6A7, #1B5E20);
  margin-bottom: 6px;
}
.footer-content {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 28px 12px;
  font-size: 7.5pt;
  color: #555;
}
.footer-cin { color: #1B5E20; font-weight: 700; }

/* ── BODY ── */
.doc-body { padding: 18px 32px 14px; flex: 1; }

/* ── LETTER TITLE BAR ── */
.letter-title-bar {
  background: #F1F8E9;
  border-left: 5px solid #2E7D32;
  border-radius: 0 8px 8px 0;
  padding: 10px 18px;
  margin: 16px 0 18px;
  text-align: center;
}
.letter-title-bar p {
  font-size: 11pt;
  font-weight: 700;
  color: #1B5E20;
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* ── META ── */
.date-line { text-align: right; color: #333; font-size: 10pt; margin-bottom: 14px; }
.cand-block { margin-bottom: 14px; padding: 12px 16px; background: #FAFAFA; border-radius: 8px; border: 1px solid #E8E8E8; }
.cand-name { font-size: 11.5pt; font-weight: 700; color: #1B5E20; margin-bottom: 3px; }
.cand-meta-line { font-size: 10pt; color: #444; line-height: 1.7; }
.elink { color: #1565C0; text-decoration: underline; }

/* ── BODY TEXT ── */
.salut { font-size: 10.5pt; margin: 14px 0 10px; }
.para { font-size: 10.5pt; line-height: 1.75; text-align: justify; margin-bottom: 9px; color: #222; }

/* ── SECTION HEADINGS ── */
.sec-hd {
  font-size: 10.5pt;
  font-weight: 700;
  color: #1B5E20;
  margin: 14px 0 5px;
  padding-left: 8px;
  border-left: 3px solid #A5D6A7;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

/* ── RULES LIST ── */
ul.rules { margin: 5px 0 10px 22px; }
ul.rules li { font-size: 10.5pt; line-height: 1.75; margin-bottom: 7px; text-align: justify; color: #333; }

/* ── SIGNATURES ── */
.sig-section { margin-top: 22px; }
.sig-intro { font-size: 10.5pt; margin-bottom: 18px; }
.sig-row { display: flex; justify-content: space-between; margin-top: 10px; }
.sig-col { width: 44%; }
.sig-img { height: 50px; max-width: 180px; object-fit: contain; display: block; margin-bottom: 6px; }
.sig-blank { height: 56px; border-bottom: 1px dashed #aaa; width: 160px; margin-bottom: 6px; }
.sig-lbl { font-size: 10pt; color: #333; line-height: 1.6; }
.sig-lbl strong { color: #1B5E20; }

/* ── ANNEXURE ── */
.ann-header-box {
  text-align: center;
  background: linear-gradient(135deg, #E8F5E9, #F9FBE7);
  border: 1px solid #C8E6C9;
  border-radius: 10px;
  padding: 14px 20px;
  margin: 16px 0 18px;
}
.ann-header-box h2 { font-size: 13pt; color: #1B5E20; font-weight: 900; margin-bottom: 6px; }
.ann-header-box p { font-size: 10pt; color: #444; }
.ann-meta { margin-bottom: 16px; }
.ann-meta-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px 24px;
  background: #F9FBE7;
  border: 1px solid #DCEDC8;
  border-radius: 8px;
  padding: 12px 18px;
  font-size: 10pt;
}
.ann-meta-grid p { margin: 0; line-height: 1.7; }
.ann-meta-grid strong { color: #1B5E20; }
.ann-ctc {
  grid-column: 1 / -1;
  font-size: 11pt;
  font-weight: 700;
  color: #1B5E20;
  border-top: 1px solid #C8E6C9;
  padding-top: 8px;
  margin-top: 4px;
}
.ann-tbl { width: 76%; margin: 0 auto 18px; border-collapse: collapse; font-size: 10pt; }
.ann-tbl thead tr { background: #1B5E20; }
.ann-tbl thead th { color: #fff; padding: 8px 12px; text-align: left; font-weight: 700; border: 1px solid #1B5E20; }
.ann-tbl td { border: 1px solid #C8E6C9; padding: 6px 12px; }
.ann-tbl tbody tr:nth-child(even) { background: #F9FBE7; }
.c-sr { text-align: center; width: 52px; }
.c-num { text-align: right; width: 90px; }
.r-sub td, .r-net td { font-weight: 700; background: #E8F5E9 !important; color: #1B5E20; }
.r-ctc td { font-weight: 700; background: #1B5E20 !important; color: #fff !important; }

/* ── ACK BOX ── */
.ack-box {
  margin-top: 24px;
  border: 1.5px solid #C8E6C9;
  border-radius: 10px;
  padding: 18px 22px;
  background: #F9FBE7;
}
.ack-title { font-size: 11pt; font-weight: 700; color: #1B5E20; margin-bottom: 10px; text-decoration: underline; }
.ack-para { font-size: 10.5pt; line-height: 1.75; margin-bottom: 18px; }
.ack-tbl { width: 100%; border-collapse: collapse; }
.ack-lbl { font-size: 10.5pt; white-space: nowrap; padding-right: 8px; width: 90px; color: #333; font-weight: 600; }
.ack-line { border-bottom: 1.5px solid #555; }
.ack-gap { padding-left: 28px; }

/* ── PRINT ── */
@media print {
  body { margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .doc-page { width: 100%; min-height: auto; }
  .page-break { page-break-before: always; }
  .sec-hd { page-break-after: avoid; }
  ul.rules li { page-break-inside: avoid; }
  .sig-row { page-break-inside: avoid; }
  .ann-tbl { page-break-inside: avoid; }
  .header-band { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
}`;

  // ── MAIN LETTER ───────────────────────────────────────────────────────────
  const mainLetter = `
<div class="doc-page">
  ${header}

  <div class="doc-body">
    <p class="date-line"><strong>${formatDate(ol.offer_date || new Date())}</strong></p>

    <div class="cand-block">
      <p class="cand-name">${ol.candidate_name}</p>
      ${ol.candidate_address ? `<p class="cand-meta-line">${ol.candidate_address.replace(/\n/g,'<br>')}</p>` : ''}
      ${ol.employee_code ? `<p class="cand-meta-line"><strong>Employee Code:</strong> ${ol.employee_code}</p>` : ''}
      ${ol.candidate_mobile ? `<p class="cand-meta-line"><strong>Mob:</strong> ${ol.candidate_mobile}</p>` : ''}
      ${ol.candidate_email  ? `<p class="cand-meta-line"><strong>Email:</strong> <span class="elink">${ol.candidate_email}</span></p>` : ''}
    </div>

    <p class="salut">Dear ${ol.candidate_name.split(' ').filter(w=>!['Mr.','Ms.','Mrs.','Dr.'].includes(w))[0] || ol.candidate_name},</p>

    <div class="letter-title-bar">
      <p>Sub: Letter of Offer / Appointment for the position of &ldquo;${ol.designation}&rdquo;</p>
    </div>

    <p class="para">In reference to our discussions, we are pleased to offer you the position of <strong>&ldquo;${ol.designation}&rdquo;</strong> in Krishi Care &amp; Management Services Private Limited to be based at our <strong>${ol.location||'Mumbai'} Office</strong>${ol.joining_date ? ` as from <strong>${joiningDateHTML(ol.joining_date)}</strong>` : ''}.</p>

    <p class="para">The offer letter is valid for <strong>${ol.offer_valid_days||7} days</strong> by which time we must be informed of your decision; the said offer letter shall stand cancelled after the above-mentioned date.</p>

    <p class="para">We are pleased to issue this letter of offer on the following terms &amp; conditions:</p>

    <p class="sec-hd">Emoluments</p>
    <p class="para">Your compensation on a cost to company basis will be <strong>Rs. ${Number(ctcAnnual).toLocaleString('en-IN')}/- PA (Rupees ${numberToWords(Math.round(ctcAnnual))} Only)</strong>. The remuneration has taken into consideration the status and responsibility of the appointment, and it is inclusive of all taxable and non-taxable emoluments, allowances and statutory contributions.</p>

    <p class="sec-hd">Responsibilities</p>
    <p class="para">You will work as <strong>&ldquo;${ol.designation}&rdquo;</strong> of the Company and will be responsible for carrying out the operations of the Company as directed to you by the management. A detailed responsibility statement will be provided to you upon your joining.</p>

    <p class="sec-hd">Probation Period</p>
    <p class="para">You will be on a probationary period of <strong>${probStr} months</strong> during which the services can be terminated from employer without giving any reason and any time for notice of termination of services. The company may regularize your services subject to satisfactory completion of probationary period.</p>

    <p class="sec-hd">Separation of Services</p>
    <p class="para">Severance of relationship can be done by giving <strong>${noticeStr} month</strong> written notice. If you are unable to complete this notice period you will be liable to compensate the company ${noticeStr} months of salary or for the period not served.</p>

    ${ol.custom_clauses ? `<p class="sec-hd">Additional Terms</p><p class="para">${ol.custom_clauses}</p>` : ''}

    <p class="sec-hd">Other Rules &amp; Regulations</p>
    <p class="para">The company will expect you to work in the Section / Department in which you are placed with a high standard of initiative, morality and economy.</p>
    <ul class="rules">
      <li>You will, in all respects, be governed by the company&rsquo;s rules and regulations.</li>
      <li>You will devote full time to the work of the Company and will not undertake any direct / indirect outside business or work, honorary or remunerative except with the prior written consent of the Management.</li>
      <li>You will abide by Leave Rules of company.</li>
      <li>You have been engaged on the presumption that the particulars furnished by you in your application are correct. In case the said particulars are found to be incorrect or that you have concealed or withheld information or the relevant facts, the services can be terminated from the company without giving any reason and any time for notice of termination.</li>
      <li>You will not, either during the period of your services or thereafter, disclose, divulge or communicate to any other person or group or company any strategic information of the organization or its clients.</li>
      <li>All correspondence, records, documents and papers relating to the company&rsquo;s business which come into your possession shall be the absolute property of the company and shall be returned upon termination of employment.</li>
      <li>You will be responsible for the safe keeping and return of all company property in your custody. The company shall have the right to deduct the monetary value of any loss from amounts payable to you.</li>
      <li>You will keep us informed of your residential address. Any change should be notified in writing within one week.</li>
    </ul>

    <p class="para"><strong>If you are willing to accept this offer</strong> for the said position, we request you to submit 3 copies of your latest coloured Passport Size photograph, Self-attested copies of your academic qualifications, PAN Card, Aadhar Card, Address Proof, and last 3 months Pay Slip / Form 16 from your previous employer. In addition, upon joining, you will have to submit a copy of your relieving letter from your previous employer.</p>

    <p class="para">As a token of your acceptance and in confirmation of the terms and conditions of this offer, please sign the duplicate copy of this letter and return to us at the earliest duly intimating when you are going to join.</p>

    <div class="sig-section">
      <p class="sig-intro">Yours truly,<br><strong>From Krishi Care &amp; Management Services Private Limited,</strong></p>
      <div class="sig-row">
        <div class="sig-col">
          ${ol.sig1_image ? `<img src="${ol.sig1_image}" class="sig-img" alt="">` : '<div class="sig-blank"></div>'}
          <p class="sig-lbl"><strong>Authorized Signatory</strong></p>
        </div>
        <div class="sig-col">
          ${ol.sig2_image ? `<img src="${ol.sig2_image}" class="sig-img" alt="">` : '<div class="sig-blank"></div>'}
          <p class="sig-lbl"><strong>Authorized Signatory</strong><br>Human Resource</p>
        </div>
      </div>
    </div>
  </div>

  ${footer}
</div>`;

  // ── ANNEXURE ──────────────────────────────────────────────────────────────
  const annexure = `
<div class="doc-page page-break">
  ${header}

  <div class="doc-body">
    <div class="ann-header-box">
      <h2>Annexure I</h2>
      <p>Annual Cost to Company and Other Benefits</p>
    </div>

    <div class="ann-meta">
      <div class="ann-meta-grid">
        <p><strong>Name:</strong> ${ol.candidate_name}</p>
        <p><strong>Designation:</strong> ${ol.designation}</p>
        <p><strong>Location:</strong> ${ol.location||'Mumbai'}</p>
        <p><strong>Date:</strong> ${formatDate(ol.offer_date || new Date())}</p>
        <p class="ann-ctc">Annual Cost to Company: Rs. ${Number(ctcAnnual).toLocaleString('en-IN')}/- (Rupees ${numberToWords(Math.round(ctcAnnual))} Only)</p>
      </div>
    </div>

    <table class="ann-tbl">
      <thead>
        <tr>
          <th class="c-sr">Sr. No.</th>
          <th>Particulars</th>
          <th class="c-num">Monthly (₹)</th>
          <th class="c-num">Yearly (₹)</th>
        </tr>
      </thead>
      <tbody>
        <tr><td class="c-sr">1</td><td>Fixed Basic</td><td class="c-num">${fmtV(basic)}</td><td class="c-num">${fmtV(basic*12)}</td></tr>
        <tr><td class="c-sr">2</td><td>HRA</td><td class="c-num">${fmtV(hra)}</td><td class="c-num">${fmtV(hra*12)}</td></tr>
        ${conv>0?`<tr><td class="c-sr">2a</td><td>Conveyance Allowance</td><td class="c-num">${fmtV(conv)}</td><td class="c-num">${fmtV(conv*12)}</td></tr>`:''}
        <tr><td class="c-sr">3</td><td>Other Allowances</td><td class="c-num">${fmtV(other)}</td><td class="c-num">${fmtV(other*12)}</td></tr>
        <tr><td class="c-sr">4</td><td>Gratuity</td><td class="c-num">${fmtV(gratuity)}</td><td class="c-num">${fmtV(gratuity*12)}</td></tr>
        <tr class="r-sub"><td class="c-sr">5</td><td>Gross Pay</td><td class="c-num">${fmtV(gross)}</td><td class="c-num">${fmtV(gross*12)}</td></tr>
        <tr><td class="c-sr">6</td><td>Provident Fund (Employee)</td><td class="c-num">${pfEmp>0?fmtV(pfEmp):'&ndash;'}</td><td class="c-num">${pfEmp>0?fmtV(pfEmp*12):'&ndash;'}</td></tr>
        <tr><td class="c-sr">7</td><td>Professional Tax</td><td class="c-num">${pt>0?fmtV(pt):'&ndash;'}</td><td class="c-num">${pt>0?fmtV(pt*12):'&ndash;'}</td></tr>
        <tr class="r-sub"><td class="c-sr">8</td><td>Total Deduction</td><td class="c-num">${totalDed>0?fmtV(totalDed):'&ndash;'}</td><td class="c-num">${totalDed>0?fmtV(totalDed*12):'&ndash;'}</td></tr>
        <tr class="r-net"><td class="c-sr">9</td><td>Net Salary (Gross &minus; Deductions)</td><td class="c-num">${fmtV(netSalary)}</td><td class="c-num">${fmtV(netSalary*12)}</td></tr>
        <tr><td class="c-sr">10</td><td>Employer PF Contribution</td><td class="c-num">${pfEmpr>0?fmtV(pfEmpr):'&ndash;'}</td><td class="c-num">${pfEmpr>0?fmtV(pfEmpr*12):'&ndash;'}</td></tr>
        <tr><td class="c-sr">11</td><td>Employer PF Admin Charges</td><td class="c-num">${pfAdmin>0?fmtV(pfAdmin):'&ndash;'}</td><td class="c-num">${pfAdmin>0?fmtV(pfAdmin*12):'&ndash;'}</td></tr>
        <tr class="r-ctc"><td class="c-sr">12</td><td>Total Compensation Package</td><td class="c-num">${fmtV(ctcMonthly)}</td><td class="c-num">${fmtV(ctcAnnual)}</td></tr>
      </tbody>
    </table>

    <div class="ack-box">
      <p class="ack-title">Acknowledgement &amp; Acceptance</p>
      <p class="ack-para">I have read, understood and agree to the above terms and conditions, and hereby sign my acceptance of the same.</p>
      <table class="ack-tbl" cellpadding="0" cellspacing="0">
        <tr>
          <td class="ack-lbl">Signature:</td>
          <td class="ack-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td>
          <td class="ack-lbl ack-gap">Date:</td>
          <td class="ack-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</td>
        </tr>
        <tr>
          <td class="ack-lbl" style="padding-top:20px;">Name:</td>
          <td class="ack-line" style="padding-top:20px;"></td>
          <td class="ack-lbl ack-gap" style="padding-top:20px;">Location:</td>
          <td class="ack-line" style="padding-top:20px;"></td>
        </tr>
      </table>
    </div>
  </div>

  ${footer}
</div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
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
