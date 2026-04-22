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
  // Professional Tax — stored in DB or default 0
  const pt       = parseFloat(ol.professional_tax_monthly||0);

  const gross      = basic + hra + conv + other + gratuity;
  const totalDed   = pfEmp + pt;
  const netSalary  = gross - totalDed;
  const ctcMonthly = gross + pfEmpr + pfAdmin;
  const ctcAnnual  = parseFloat(ol.ctc_annual || (ctcMonthly * 12));

  const fmt    = v => v > 0 ? Number(v).toLocaleString('en-IN') : '–';
  const fmtAnn = v => v > 0 ? Number(Math.round(v * 12)).toLocaleString('en-IN') : '–';
  const fmtV   = v => Number(v).toLocaleString('en-IN');

  // ── Shared header/footer HTML (used on every page) ────────────────────────
  const LOGO_B64 = `data:image/png;base64,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`;

  const pageHeader = `
    <div class="page-hdr">
      <table class="hdr-table" cellpadding="0" cellspacing="0">
        <tr>
          <td class="hdr-logo-cell" rowspan="3">
            <img src="${LOGO_B64}" alt="KCMS Logo" class="logo-img">
          </td>
          <td class="hdr-company-name">Krishi Care &amp; Management Services Private Limited</td>
        </tr>
        <tr>
          <td class="hdr-addr-line">
            <strong>Regd. &amp; Head Office:</strong> 617, 6th Floor, Hubtown Viva, Western Express Highway, Shankarwadi,<br>
            Jogeshwari (East), Mumbai - 400060.
          </td>
        </tr>
        <tr>
          <td class="hdr-contact-line">
            Email: ${COMPANY.email}, Website: http://www.krishicare.com, Tel. - ${COMPANY.tel}
          </td>
        </tr>
      </table>
      <div class="hdr-divider"></div>
    </div>`;

  const pageFooter = `
    <div class="page-ftr">
      <div class="ftr-divider"></div>
      <p class="ftr-line"><strong>Corporate Office:</strong> ${COMPANY.corpAddr}. Tel: 011-41039506.</p>
      <p class="ftr-line"><strong>CIN: ${COMPANY.cin}</strong></p>
    </div>`;

  // ── Format joining date with ordinal superscript ──────────────────────────
  function joiningDateFormatted(d) {
    if (!d) return '';
    const dt = new Date(d);
    const day = dt.getDate();
    const months = ['January','February','March','April','May','June',
      'July','August','September','October','November','December'];
    const sup = day === 1 ? 'st' : day === 2 ? 'nd' : day === 3 ? 'rd' : 'th';
    return `${day}<sup>${sup}</sup> ${months[dt.getMonth()]} ${dt.getFullYear()}`;
  }

  const probationWords   = { 3:'three', 6:'six', 12:'twelve' };
  const noticeWords      = { 1:'one', 2:'two', 3:'three', 6:'six' };
  const probStr  = probationWords[ol.probation_months]    || `${ol.probation_months}`;
  const noticeStr= noticeWords[ol.notice_period_months]   || `${ol.notice_period_months}`;

  // ── PAGE 1 & 2: Main offer letter ─────────────────────────────────────────
  const mainLetter = `
  <div class="page" id="page1">
    ${pageHeader}
    <div class="body">

      <p class="date-right"><strong>${formatDate(ol.offer_date || new Date())}</strong></p>

      <div class="candidate-block">
        <p class="candidate-name"><strong>${ol.candidate_name}</strong></p>
        ${ol.candidate_address ? `<p class="candidate-addr">${ol.candidate_address.replace(/\n/g,'<br>')}</p>` : ''}
      </div>

      ${ol.employee_code ? `
      <div class="emp-meta">
        <p><strong>Employee Code &ndash; ${ol.employee_code}</strong></p>
        ${ol.candidate_mobile ? `<p><strong>Mob &ndash; ${ol.candidate_mobile}</strong></p>` : ''}
        ${ol.candidate_email  ? `<p><strong>Email &ndash; <span class="email-link">${ol.candidate_email}</span></strong></p>` : ''}
      </div>` : `
      <div class="emp-meta">
        ${ol.candidate_mobile ? `<p><strong>Mob &ndash; ${ol.candidate_mobile}</strong></p>` : ''}
        ${ol.candidate_email  ? `<p><strong>Email &ndash; <span class="email-link">${ol.candidate_email}</span></strong></p>` : ''}
      </div>`}

      <p class="salutation">Dear ${ol.candidate_name.split(' ').filter(w => !['Mr.','Ms.','Mrs.','Dr.'].includes(w))[0] || ol.candidate_name},</p>

      <p class="subject-line"><strong><u>Sub: Letter of offer/Appointment for the position of &ldquo;${ol.designation}&rdquo;</u></strong></p>

      <p class="para">In reference to our discussions, we are pleased to offer you the position of <strong>&ldquo;${ol.designation}&rdquo;</strong> in Krishi Care &amp; Management Services Private Limited to be based at our <strong>${ol.location || 'Mumbai'} Office</strong>${ol.joining_date ? ` as from <strong>${joiningDateFormatted(ol.joining_date)}</strong>` : ''}.</p>

      <p class="para">The offer letter is valid for <strong>${ol.offer_valid_days || 7} days</strong> by which time we must be informed of your decision; the said offer letter shall stand cancelled after the above-mentioned date.</p>

      <p class="para">We are pleased to issue this letter of offer on the following terms &amp; conditions:</p>

      <p class="sec-title"><strong><u>EMOLUMENTS:</u></strong></p>
      <p class="para">Your compensation on a cost to company basis will be <strong>Rs. ${Number(ctcAnnual).toLocaleString('en-IN')}/- PA (Rupees ${numberToWords(Math.round(ctcAnnual))} Only)</strong>. The remuneration has taken into consideration the status and responsibility of the appointment, and it is inclusive of all taxable and non-taxable emoluments, allowances and statutory contributions.</p>

      <p class="sec-title"><strong><u>RESPONSIBILITIES:</u></strong></p>
      <p class="para">You will work as <strong>&ldquo;<u>${ol.designation}</u>&rdquo;</strong> of the Company and will be responsible for carrying out the operations of the Company as directed to you by the management. A detailed responsibility statement will be provided to you upon your joining.</p>

      <p class="sec-title"><strong><u>PROBATION PERIOD:</u></strong></p>
      <p class="para">You will be on a probationary period of <strong>${probStr} months</strong> during which the services can be terminated from employer without giving any reason and any time for notice of termination of services. The company may regularize your services subject to satisfactory completion of probationary period.</p>

      <p class="sec-title"><strong><u>SEPERATION OF SERVICES:</u></strong></p>
      <p class="para">Severance of relationship can be done by giving <strong>${noticeStr} month</strong> written notice. If you are unable to complete this notice period you will be liable to compensate the company ${noticeStr} months of salary or for the period not served.</p>

      ${ol.custom_clauses ? `<p class="sec-title"><strong><u>ADDITIONAL TERMS:</u></strong></p><p class="para">${ol.custom_clauses}</p>` : ''}

      <p class="sec-title"><strong><u>OTHER RULES AND REGULATION:</u></strong></p>
      <p class="para">The company will expect you to work in the Section / Department in which you are placed with a high standard of initiative, morality and economy.</p>
      <ul class="rules">
        <li>You will, in all respects, be governed by the company&rsquo;s rules and regulations</li>
        <li>You will devote full time to the work of the Company and will not undertake any direct / indirect outside business or work, honorary or remunerative except with the prior written consent of the Management.</li>
        <li>You will abide by Leave Rules of company.</li>
        <li>You have been engaged on the presumption that the particulars furnished by you in your application are correct. In case the said particular are found to be incorrect or that you have concealed or withheld information or the relevant facts, the services can be terminated from the company without giving any reason and any time for notice of termination of services. The company may regularize your services subject to satisfactory completion of period.</li>
        <li>You will not, either during the period of your services of thereafter, disclose divulge or communicate to any other person or group or company any strategic information of the organization or its clients.</li>
        <li>All correspondence addressed to you by the company including press and other copies of such correspondence and all vouchers, books, records, including all note books containing notes or records of business or prices or other market data, samples and/or other papers belonging to the company, circulars and all other relevant papers and documents of any nature whatsoever relating to the company&rsquo;s business, which shall come into your possession in the course of your employment shall be the absolute property of the company and you shall, at any time during your employment or upon termination there for any reason whatsoever, deliver the same to the company and without claiming any lien thereon.</li>
        <li>You will be responsible for the safe keeping and for returning in good condition and order, all on your own the company&rsquo;s property which may be in your use, custody, care or charge. The company shall have the right to deduct the monetary value of all such things from any amounts payable to you and to take such actions as may be deemed proper in the event of your failure to account for such property to the satisfaction of the management.</li>
        <li>You will keep us informed of your residential (mailing &amp; permanent) address. Any change in the same should be notified in writing within one week. Failure to do so will be treated as willful withholding of information and appropriate action as deemed fit by management would be taken against you.</li>
      </ul>

      <p class="para accept-bold"><strong>If you are willing to accept this offer for the said position, we request you to submit 3 copies of your latest coloured Passport Size photograph, Self-attested Copy of your academic qualification, Self-attested copy of your PAN Card, Self-attested copy of your Aadhar Card, Self-attested Copy of Address Proof, and last 3 month Pay Slip / Form 16 from your previous employer. In addition, upon joining, you will have to submit a copy of your relieving letter from your previous employer.</strong></p>

      <p class="para">As a token of your acceptance and in confirmation of the terms and conditions of this offer, please sign the duplicate copy of this letter and return to us at the earliest duly intimating when you are going to join.</p>

      <p class="para" style="margin-top:22px;">Yours truly,</p>
      <p class="para">From <strong>Krishi Care &amp; Management Services Private Limited,</strong></p>

      <div class="sig-section">
        <div class="sig-col">
          ${ol.sig1_image ? `<img src="${ol.sig1_image}" class="sig-img">` : '<div class="sig-space"></div>'}
          <p class="sig-label"><strong>Authorized Signatory</strong></p>
        </div>
        <div class="sig-col sig-right">
          ${ol.sig2_image ? `<img src="${ol.sig2_image}" class="sig-img">` : '<div class="sig-space"></div>'}
          <p class="sig-label"><strong>( Authorized Signatory)</strong><br><strong>Human Resource</strong></p>
        </div>
      </div>

    </div><!-- /body -->
    ${pageFooter}
  </div><!-- /page1 -->`;

  // ── PAGE 3: Annexure I ────────────────────────────────────────────────────
  const annexure = `
  <div class="page page-break" id="page-annexure">
    ${pageHeader}
    <div class="body">

      <p class="annexure-title"><strong>Annexure I (Annual Cost to Company and Other Benefits)</strong></p>

      <div class="annexure-meta">
        <p><strong>Name:</strong> ${ol.candidate_name}</p>
        <p><strong>Designation:</strong> ${ol.designation}</p>
        <p><strong>Location:</strong> ${ol.location || 'Mumbai'}</p>
        <p><strong>Annual Cost to Company &ndash; Rs.${Number(ctcAnnual).toLocaleString('en-IN')} (Rupees ${numberToWords(Math.round(ctcAnnual))} Only)</strong></p>
      </div>

      <table class="annexure-table">
        <thead>
          <tr>
            <th class="col-sr">Sr. No.</th>
            <th class="col-part">Particulars</th>
            <th class="col-num">Monthly</th>
            <th class="col-num">Yearly</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td class="col-sr">1</td>
            <td>Fixed Basic</td>
            <td class="col-num">${fmtV(basic)}</td>
            <td class="col-num">${fmtV(Math.round(basic*12))}</td>
          </tr>
          <tr>
            <td class="col-sr">2</td>
            <td>HRA</td>
            <td class="col-num">${fmtV(hra)}</td>
            <td class="col-num">${fmtV(Math.round(hra*12))}</td>
          </tr>
          ${conv > 0 ? `<tr>
            <td class="col-sr">2a</td>
            <td>Conveyance Allowances</td>
            <td class="col-num">${fmtV(conv)}</td>
            <td class="col-num">${fmtV(Math.round(conv*12))}</td>
          </tr>` : ''}
          <tr>
            <td class="col-sr">${conv > 0 ? 3 : 3}</td>
            <td>Other Allowances</td>
            <td class="col-num">${fmtV(other)}</td>
            <td class="col-num">${fmtV(Math.round(other*12))}</td>
          </tr>
          <tr>
            <td class="col-sr">${conv > 0 ? 4 : 4}</td>
            <td>Gratuity</td>
            <td class="col-num">${fmtV(gratuity)}</td>
            <td class="col-num">${fmtV(Math.round(gratuity*12))}</td>
          </tr>
          <tr class="row-subtotal">
            <td class="col-sr"><strong>5</strong></td>
            <td><strong>Gross Pay</strong></td>
            <td class="col-num"><strong>${fmtV(Math.round(gross))}</strong></td>
            <td class="col-num"><strong>${fmtV(Math.round(gross*12))}</strong></td>
          </tr>
          <tr>
            <td class="col-sr">6</td>
            <td>Provident Fund</td>
            <td class="col-num">${fmtV(pfEmp)}</td>
            <td class="col-num">${fmtV(Math.round(pfEmp*12))}</td>
          </tr>
          <tr>
            <td class="col-sr">7</td>
            <td>Professional Tax</td>
            <td class="col-num">${pt > 0 ? fmtV(pt) : '–'}</td>
            <td class="col-num">${pt > 0 ? fmtV(Math.round(pt*12)) : '–'}</td>
          </tr>
          <tr class="row-subtotal">
            <td class="col-sr"><strong>8</strong></td>
            <td><strong>Total Deduction</strong></td>
            <td class="col-num"><strong>${fmtV(Math.round(totalDed))}</strong></td>
            <td class="col-num"><strong>${fmtV(Math.round(totalDed*12))}</strong></td>
          </tr>
          <tr class="row-net">
            <td class="col-sr"><strong>9</strong></td>
            <td><strong>Net Salary (Gross - Total Deduction)</strong></td>
            <td class="col-num"><strong>${fmtV(Math.round(netSalary))}</strong></td>
            <td class="col-num"><strong>${fmtV(Math.round(netSalary*12))}</strong></td>
          </tr>
          <tr>
            <td class="col-sr">10</td>
            <td>Employer PF contribution</td>
            <td class="col-num">${fmtV(pfEmpr)}</td>
            <td class="col-num">${fmtV(Math.round(pfEmpr*12))}</td>
          </tr>
          <tr>
            <td class="col-sr">11</td>
            <td>Employer PF contribution Admin charges</td>
            <td class="col-num">${fmtV(pfAdmin)}</td>
            <td class="col-num">${fmtV(Math.round(pfAdmin*12))}</td>
          </tr>
          <tr class="row-ctc">
            <td class="col-sr"><strong>12</strong></td>
            <td><strong>Total Compensation Package</strong></td>
            <td class="col-num"><strong>${fmtV(Math.round(ctcMonthly))}</strong></td>
            <td class="col-num"><strong>${fmtV(Math.round(ctcAnnual))}</strong></td>
          </tr>
        </tbody>
      </table>

      <div class="ack-section">
        <p class="ack-title"><strong><u>Acknowledgement &amp; Acceptance</u></strong></p>
        <p class="ack-para">I have read understood, agree to the above terms and conditions, and hereby sign my acceptance of the same.</p>
        <div class="ack-fields">
          <div class="ack-field-row">
            <span class="ack-label">Signature:</span>
            <span class="ack-line"></span>
            <span class="ack-label">Date:</span>
            <span class="ack-line"></span>
          </div>
          <div class="ack-field-row" style="margin-top:24px;">
            <span class="ack-label">Name:</span>
            <span class="ack-line"></span>
            <span class="ack-label">Location:</span>
            <span class="ack-line"></span>
          </div>
        </div>
      </div>

    </div><!-- /body -->
    ${pageFooter}
  </div><!-- /page-annexure -->`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; color: #111; background: #fff; }

  /* ── PAGE ── */
  .page { width: 210mm; min-height: 297mm; margin: 0 auto 0; padding: 0; background:#fff; }
  .page-break { page-break-before: always; }

  /* ── HEADER ── */
  .page-hdr { padding: 14px 28px 0; }
  .hdr-table { width: 100%; border-collapse: collapse; }
  .hdr-logo-cell { width: 78px; vertical-align: middle; padding-right: 12px; }
  .logo-img { width: 72px; height: 72px; object-fit: contain; display: block; }
  .hdr-company-name { font-size: 18pt; font-weight: 900; color: #1B5E20; vertical-align: bottom; padding-bottom: 2px; }
  .hdr-addr-line { font-size: 9pt; color: #222; line-height: 1.5; padding-top: 2px; text-align: center; }
  .hdr-contact-line { font-size: 8.5pt; color: #222; padding-top: 3px; text-align: center; }
  .hdr-divider { border-bottom: 2px solid #1B5E20; margin: 8px 0 0; }

  /* ── FOOTER ── */
  .page-ftr { padding: 0 28px 12px; margin-top: 20px; }
  .ftr-divider { border-top: 1.5px solid #1B5E20; margin-bottom: 4px; }
  .ftr-line { font-size: 8.5pt; text-align: center; color: #111; line-height: 1.6; }

  /* ── BODY ── */
  .body { padding: 16px 28px 10px; }
  .date-right { text-align: right; font-size: 10.5pt; margin-bottom: 16px; }
  .candidate-block { margin-bottom: 6px; }
  .candidate-name { font-size: 11pt; line-height: 1.7; }
  .candidate-addr { font-size: 10.5pt; line-height: 1.65; }
  .emp-meta { margin: 10px 0 12px; line-height: 1.75; font-size: 10.5pt; }
  .email-link { color: #1565C0; text-decoration: underline; }
  .salutation { font-size: 10.5pt; margin-bottom: 14px; }
  .subject-line { font-size: 10.5pt; text-align: center; margin: 12px 0 14px; }
  .para { font-size: 10.5pt; line-height: 1.75; text-align: justify; margin-bottom: 10px; }
  .accept-bold { font-weight: normal; }
  .sec-title { font-size: 10.5pt; margin: 14px 0 6px; }

  /* ── BULLET LIST ── */
  ul.rules { margin: 6px 0 12px 24px; }
  ul.rules li { font-size: 10.5pt; line-height: 1.75; margin-bottom: 8px; text-align: justify; }

  /* ── SIGNATURES ── */
  .sig-section { margin-top: 30px; display: flex; justify-content: space-between; align-items: flex-end; }
  .sig-col { width: 42%; }
  .sig-right { text-align: left; }
  .sig-img { height: 44px; max-width: 180px; object-fit: contain; display: block; margin-bottom: 2px; }
  .sig-space { height: 52px; }
  .sig-label { font-size: 10pt; line-height: 1.6; }

  /* ── ANNEXURE ── */
  .annexure-title { text-align: center; font-size: 11pt; margin: 14px 0 14px; }
  .annexure-meta { margin-bottom: 14px; font-size: 10.5pt; line-height: 1.75; }
  .annexure-table { width: 75%; margin: 0 auto 20px; border-collapse: collapse; font-size: 10pt; }
  .annexure-table th { background: #fff; border: 1px solid #444; padding: 6px 10px; text-align: left; font-weight: bold; }
  .annexure-table td { border: 1px solid #555; padding: 5px 10px; }
  .col-sr { text-align: center; width: 60px; }
  .col-num { text-align: right; width: 90px; }
  .row-subtotal td { font-weight: bold; }
  .row-net td { font-weight: bold; }
  .row-ctc td { font-weight: bold; }

  /* ── ACKNOWLEDGEMENT ── */
  .ack-section { margin-top: 24px; }
  .ack-title { font-size: 10.5pt; margin-bottom: 10px; }
  .ack-para { font-size: 10.5pt; line-height: 1.75; margin-bottom: 20px; }
  .ack-fields { font-size: 10.5pt; }
  .ack-field-row { display: flex; align-items: baseline; gap: 8px; }
  .ack-label { white-space: nowrap; font-size: 10.5pt; }
  .ack-line { flex: 1; border-bottom: 1px solid #555; min-width: 100px; }

  @media print {
    body { margin: 0; }
    .page { width: 100%; margin: 0; }
    .page-break { page-break-before: always; }
  }
</style>
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
