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

  // ordinal joining date  e.g. 17<sup>th</sup> May 2026
  function joiningDateHTML(d) {
    if (!d) return '';
    const dt = new Date(d);
    const day = dt.getDate();
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    const sup = [,'st','nd','rd'][day] || 'th';
    return `${day}<sup>${sup}</sup> ${months[dt.getMonth()]} ${dt.getFullYear()}`;
  }

  const probWords  = {3:'three',6:'six',12:'twelve'};
  const noticeWords= {1:'one',2:'two',3:'three',6:'six'};
  const probStr    = probWords[ol.probation_months]    || `${ol.probation_months||6}`;
  const noticeStr  = noticeWords[ol.notice_period_months] || `${ol.notice_period_months||3}`;

  const LOGO_B64 = `data:image/png;base64,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`;

  // ── Shared header block ──────────────────────────────────────────────────
  const hdrHTML = `
  <div class="accent-bar"></div>
  <div class="doc-header">
    <table class="hdr-tbl" cellpadding="0" cellspacing="0">
      <tr>
        <td class="hdr-logo" rowspan="3"><img src="${LOGO_B64}" class="logo-img" alt="Krishi Care Logo"></td>
        <td class="hdr-name">Krishi Care &amp; Management Services Private Limited</td>
      </tr>
      <tr><td class="hdr-addr"><strong>Regd. &amp; Head Office:</strong> 617, 6th Floor, Hubtown Viva, Western Express Highway, Shankarwadi, Jogeshwari (East), Mumbai - 400060.</td></tr>
      <tr><td class="hdr-contact">Email: ${COMPANY.email}&nbsp;&nbsp;|&nbsp;&nbsp;Website: http://www.krishicare.com&nbsp;&nbsp;|&nbsp;&nbsp;Tel: ${COMPANY.tel}</td></tr>
    </table>
    <div class="hdr-rule"></div>
  </div>`;

  // ── Shared footer block ────────────────────────────────────────────────────
  const ftrHTML = `
  <div class="doc-footer">
    <div class="ftr-rule"></div>
    <p class="ftr-corp"><strong>Corporate Office:</strong> ${COMPANY.corpAddr}&nbsp;&nbsp;|&nbsp;&nbsp;Tel: 011-41039506.</p>
    <p class="ftr-cin"><strong>CIN: ${COMPANY.cin}</strong></p>
  </div>
  <div class="bottom-bar"></div>`;

  // ── MAIN LETTER ───────────────────────────────────────────────────────────
  const mainLetter = `
<div class="doc-wrap">
  ${hdrHTML}

  <div class="doc-body">
    <p class="date-line"><strong>${formatDate(ol.offer_date || new Date())}</strong></p>

    <div class="cand-panel">
      <p class="cand-name">${ol.candidate_name}</p>
      ${ol.candidate_address ? `<p class="cand-addr">${ol.candidate_address.replace(/\n/g,'<br>')}</p>` : ''}
    </div>

    <div class="cand-meta">
      ${ol.employee_code ? `<div class="cand-meta-row"><span class="cand-meta-label">Employee Code</span><span class="cand-meta-value">${ol.employee_code}</span></div>` : ''}
      ${ol.candidate_mobile ? `<div class="cand-meta-row"><span class="cand-meta-label">Mobile</span><span class="cand-meta-value">${ol.candidate_mobile}</span></div>` : ''}
      ${ol.candidate_email  ? `<div class="cand-meta-row"><span class="cand-meta-label">Email</span><span class="cand-meta-value"><span class="elink">${ol.candidate_email}</span></span></div>` : ''}
    </div>

    <p class="salut">Dear ${ol.candidate_name.split(' ').filter(w=>!['Mr.','Ms.','Mrs.','Dr.'].includes(w))[0] || ol.candidate_name},</p>

    <p class="subj-line"><strong><u>Sub: Letter of offer/Appointment for the position of &ldquo;${ol.designation}&rdquo;</u></strong></p>

    <p class="para">In reference to our discussions, we are pleased to offer you the position of <strong>&ldquo;${ol.designation}&rdquo;</strong> in Krishi Care &amp; Management Services Private Limited to be based at our <strong>${ol.location||'Mumbai'} Office</strong>${ol.joining_date ? ` as from <strong>${joiningDateHTML(ol.joining_date)}</strong>` : ''}.</p>

    <p class="para">The offer letter is valid for <strong>${ol.offer_valid_days||7} days</strong> by which time we must be informed of your decision; the said offer letter shall stand cancelled after the above-mentioned date.</p>

    <p class="para">We are pleased to issue this letter of offer on the following terms &amp; conditions:</p>

    <p class="sec-hd">1.&ensp;EMOLUMENTS</p>
    <p class="para">Your compensation on a cost to company basis will be <strong>Rs. ${Number(ctcAnnual).toLocaleString('en-IN')}/- PA (Rupees ${numberToWords(Math.round(ctcAnnual))} Only)</strong>. The remuneration has taken into consideration the status and responsibility of the appointment, and it is inclusive of all taxable and non-taxable emoluments, allowances and statutory contributions.</p>

    <p class="sec-hd">2.&ensp;RESPONSIBILITIES</p>
    <p class="para">You will work as <strong>&ldquo;<u>${ol.designation}</u>&rdquo;</strong> of the Company and will be responsible for carrying out the operations of the Company as directed to you by the management. A detailed responsibility statement will be provided to you upon your joining.</p>

    <p class="sec-hd">3.&ensp;PROBATION PERIOD</p>
    <p class="para">You will be on a probationary period of <strong>${probStr} months</strong> during which the services can be terminated from employer without giving any reason and any time for notice of termination of services. The company may regularize your services subject to satisfactory completion of probationary period.</p>

    <p class="sec-hd">4.&ensp;SEPARATION OF SERVICES</p>
    <p class="para">Severance of relationship can be done by giving <strong>${noticeStr} month</strong> written notice. If you are unable to complete this notice period you will be liable to compensate the company ${noticeStr} months of salary or for the period not served.</p>

    ${ol.custom_clauses ? `<p class="sec-hd">5.&ensp;ADDITIONAL TERMS</p><p class="para">${ol.custom_clauses}</p>` : ''}

    <p class="sec-hd">${ol.custom_clauses ? '6' : '5'}.&ensp;OTHER RULES &amp; REGULATIONS</p>
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

    <p class="para accept-bold">If you are willing to accept this offer for the said position, we request you to submit 3 copies of your latest coloured Passport Size photograph, Self-attested Copy of your academic qualification, Self-attested copy of your PAN Card, Self-attested copy of your Aadhar Card, Self-attested Copy of Address Proof, and last 3 month Pay Slip / Form 16 from your previous employer. In addition, upon joining, you will have to submit a copy of your relieving letter from your previous employer.</p>

    <p class="para">As a token of your acceptance and in confirmation of the terms and conditions of this offer, please sign the duplicate copy of this letter and return to us at the earliest duly intimating when you are going to join.</p>

    <div class="sig-section">
      <p class="sig-from">Yours truly,</p>
      <p class="sig-from">From <strong>Krishi Care &amp; Management Services Private Limited,</strong></p>
      <div class="sig-row">
        <div class="sig-col">
          ${ol.sig1_image ? `<img src="${ol.sig1_image}" class="sig-img" alt="">` : '<div class="sig-blank"></div>'}
          <div class="sig-line"></div>
          <p class="sig-lbl">Authorized Signatory</p>
        </div>
        <div class="sig-col">
          ${ol.sig2_image ? `<img src="${ol.sig2_image}" class="sig-img" alt="">` : '<div class="sig-blank"></div>'}
          <div class="sig-line"></div>
          <p class="sig-lbl">Authorized Signatory<br>Human Resource</p>
        </div>
      </div>
    </div>
  </div><!-- /doc-body -->

  ${ftrHTML}
</div><!-- /doc-wrap -->`;

  // ── ANNEXURE I ────────────────────────────────────────────────────────────
  const annexure = `
<div class="doc-wrap page-break">
  ${hdrHTML}

  <div class="doc-body">
    <p class="ann-title">Annexure I &mdash; Annual Cost to Company &amp; Other Benefits</p>

    <div class="ann-meta-grid">
      <table class="ann-meta-table" cellpadding="0" cellspacing="0">
        <tr>
          <td class="ann-meta-lbl">Name</td>
          <td class="ann-meta-val">${ol.candidate_name}</td>
        </tr>
        <tr>
          <td class="ann-meta-lbl">Designation</td>
          <td class="ann-meta-val">${ol.designation}</td>
        </tr>
        <tr>
          <td class="ann-meta-lbl">Location</td>
          <td class="ann-meta-val">${ol.location||'Mumbai'}</td>
        </tr>
        <tr>
          <td class="ann-meta-lbl last">Annual CTC</td>
          <td class="ann-meta-val last">Rs.${Number(ctcAnnual).toLocaleString('en-IN')} &nbsp;(Rupees ${numberToWords(Math.round(ctcAnnual))} Only)</td>
        </tr>
      </table>
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
        ${conv>0?`<tr><td class="c-sr">2a</td><td>Conveyance Allowances</td><td class="c-num">${fmtV(conv)}</td><td class="c-num">${fmtV(conv*12)}</td></tr>`:''}
        <tr><td class="c-sr">3</td><td>Other Allowances</td><td class="c-num">${fmtV(other)}</td><td class="c-num">${fmtV(other*12)}</td></tr>
        <tr><td class="c-sr">4</td><td>Gratuity</td><td class="c-num">${fmtV(gratuity)}</td><td class="c-num">${fmtV(gratuity*12)}</td></tr>
        <tr class="r-sub"><td class="c-sr"><strong>5</strong></td><td><strong>Gross Pay</strong></td><td class="c-num"><strong>${fmtV(gross)}</strong></td><td class="c-num"><strong>${fmtV(gross*12)}</strong></td></tr>
        <tr><td class="c-sr">6</td><td>Provident Fund (Employee)</td><td class="c-num">${pfEmp>0?fmtV(pfEmp):'&ndash;'}</td><td class="c-num">${pfEmp>0?fmtV(pfEmp*12):'&ndash;'}</td></tr>
        <tr><td class="c-sr">7</td><td>Professional Tax</td><td class="c-num">${pt>0?fmtV(pt):'&ndash;'}</td><td class="c-num">${pt>0?fmtV(pt*12):'&ndash;'}</td></tr>
        <tr class="r-sub"><td class="c-sr"><strong>8</strong></td><td><strong>Total Deductions</strong></td><td class="c-num"><strong>${totalDed>0?fmtV(totalDed):'&ndash;'}</strong></td><td class="c-num"><strong>${totalDed>0?fmtV(totalDed*12):'&ndash;'}</strong></td></tr>
        <tr class="r-net"><td class="c-sr"><strong>9</strong></td><td><strong>Net Salary (Gross &minus; Total Deductions)</strong></td><td class="c-num"><strong>${fmtV(netSalary)}</strong></td><td class="c-num"><strong>${fmtV(netSalary*12)}</strong></td></tr>
        <tr><td class="c-sr">10</td><td>Employer PF Contribution</td><td class="c-num">${pfEmpr>0?fmtV(pfEmpr):'&ndash;'}</td><td class="c-num">${pfEmpr>0?fmtV(pfEmpr*12):'&ndash;'}</td></tr>
        <tr><td class="c-sr">11</td><td>Employer PF Contribution Admin Charges</td><td class="c-num">${pfAdmin>0?fmtV(pfAdmin):'&ndash;'}</td><td class="c-num">${pfAdmin>0?fmtV(pfAdmin*12):'&ndash;'}</td></tr>
        <tr class="r-ctc"><td class="c-sr"><strong>12</strong></td><td><strong>Total Compensation Package (CTC)</strong></td><td class="c-num"><strong>${fmtV(ctcMonthly)}</strong></td><td class="c-num"><strong>${fmtV(ctcAnnual)}</strong></td></tr>
      </tbody>
    </table>

    <div class="ack-box">
      <p class="ack-title">Acknowledgement &amp; Acceptance</p>
      <p class="ack-para">I have read, understood, and agree to the above terms and conditions, and hereby sign my acceptance of the same.</p>
      <table class="ack-tbl" cellpadding="0" cellspacing="0">
        <tr>
          <td class="ack-lbl">Signature:</td>
          <td class="ack-line"></td>
          <td class="ack-lbl ack-gap">Date:</td>
          <td class="ack-line"></td>
        </tr>
        <tr>
          <td class="ack-lbl" style="padding-top:20px;">Name:</td>
          <td class="ack-line" style="padding-top:20px;"></td>
          <td class="ack-lbl ack-gap" style="padding-top:20px;">Location:</td>
          <td class="ack-line" style="padding-top:20px;"></td>
        </tr>
      </table>
    </div>
  </div><!-- /doc-body -->

  ${ftrHTML}
</div><!-- /doc-wrap annexure -->`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 11pt;
    color: #1a1a1a;
    background: #e8e8e8;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  body::before {
    content: 'CONFIDENTIAL';
    position: fixed;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%) rotate(-45deg);
    font-size: 72pt;
    font-family: Arial, sans-serif;
    font-weight: 900;
    color: rgba(28, 53, 94, 0.042);
    white-space: nowrap;
    pointer-events: none;
    z-index: 0;
    letter-spacing: 0.15em;
  }

  .doc-wrap {
    width: 210mm;
    min-height: 297mm;
    margin: 10mm auto;
    background: #fff;
    display: flex;
    flex-direction: column;
    position: relative;
    box-shadow: 0 4px 32px rgba(0,0,0,0.18);
  }

  .page-break { page-break-before: always; margin-top: 0; }

  .accent-bar {
    height: 6px;
    background: linear-gradient(90deg, #1C355E 0%, #2a5298 60%, #1C355E 100%);
    flex-shrink: 0;
  }

  .doc-header { padding: 16px 28px 0; flex-shrink: 0; }

  .hdr-tbl { width: 100%; border-collapse: collapse; }
  .hdr-logo { width: 80px; padding-right: 14px; vertical-align: middle; }
  .logo-img { width: 68px; height: 68px; object-fit: contain; display: block; }
  .hdr-name {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 14.5pt; font-weight: 800; color: #1C355E;
    vertical-align: bottom; padding-bottom: 3px; letter-spacing: 0.01em;
  }
  .hdr-addr {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8pt; color: #444; line-height: 1.6; text-align: center; padding-top: 3px;
  }
  .hdr-contact {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 7.5pt; color: #555; text-align: center; padding-top: 2px;
  }
  .hdr-rule {
    margin: 10px 28px 0; height: 2px;
    background: linear-gradient(90deg, #1C355E 0%, #c8a84b 50%, #1C355E 100%);
  }

  .doc-body { padding: 16px 32px 12px; flex: 1; position: relative; z-index: 1; }

  .doc-footer { padding: 6px 32px 12px; margin-top: 6px; flex-shrink: 0; }
  .ftr-rule {
    height: 1.5px;
    background: linear-gradient(90deg, #1C355E 0%, #c8a84b 50%, #1C355E 100%);
    margin-bottom: 6px;
  }
  .ftr-corp {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 7.5pt; text-align: center; color: #444; line-height: 1.65;
  }
  .ftr-cin {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 7.5pt; text-align: center; color: #555; margin-top: 1px; letter-spacing: 0.04em;
  }
  .bottom-bar {
    height: 4px;
    background: linear-gradient(90deg, #1C355E 0%, #2a5298 60%, #1C355E 100%);
    flex-shrink: 0;
  }

  .date-line {
    font-family: 'Courier New', Courier, monospace;
    font-size: 10pt; text-align: right; color: #1C355E;
    margin-bottom: 16px; font-weight: 600;
  }

  .cand-panel {
    background: #f7f9fc; border-left: 4px solid #1C355E;
    border-radius: 0 4px 4px 0; padding: 10px 16px;
    margin-bottom: 14px; display: inline-block; min-width: 55%;
  }
  .cand-name {
    font-family: 'Courier New', Courier, monospace;
    font-size: 11.5pt; font-weight: 700; color: #1C355E;
    line-height: 1.5; letter-spacing: 0.02em;
  }
  .cand-addr {
    font-family: 'Times New Roman', Times, serif;
    font-size: 10pt; line-height: 1.6; color: #333; margin-top: 2px;
  }

  .cand-meta { margin: 6px 0 14px; }
  .cand-meta-row { display: flex; align-items: baseline; gap: 6px; margin-bottom: 3px; font-size: 10pt; line-height: 1.6; }
  .cand-meta-label {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8.5pt; font-weight: 700; color: #1C355E;
    text-transform: uppercase; letter-spacing: 0.06em;
    white-space: nowrap; min-width: 110px;
  }
  .cand-meta-value {
    font-family: 'Courier New', Courier, monospace;
    font-size: 10pt; color: #1a1a1a; font-weight: 600;
  }
  .elink { color: #1C355E; text-decoration: underline; }

  .salut { font-size: 10.5pt; margin-bottom: 10px; line-height: 1.7; }
  .subj-line { font-size: 10.5pt; text-align: center; margin: 12px 0 14px; line-height: 1.6; }

  .para { font-size: 10.5pt; line-height: 1.8; text-align: justify; margin-bottom: 9px; color: #1a1a1a; }
  .accept-bold { font-weight: bold; }

  .sec-hd {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9pt; font-weight: 800; color: #1C355E;
    text-transform: uppercase; letter-spacing: 0.1em;
    margin: 16px 0 7px; padding: 5px 10px 5px 12px;
    border-left: 3px solid #c8a84b; background: #f7f9fc;
    page-break-after: avoid;
  }

  .dyn { font-family: 'Courier New', Courier, monospace; font-weight: 700; color: #1a1a1a; }

  ul.rules { margin: 6px 0 12px 20px; padding: 0; }
  ul.rules li { font-size: 10.5pt; line-height: 1.8; margin-bottom: 8px; text-align: justify; color: #1a1a1a; }

  .sig-section { margin-top: 22px; page-break-inside: avoid; }
  .sig-from { font-size: 10.5pt; margin-bottom: 4px; line-height: 1.7; }
  .sig-row { display: flex; justify-content: space-between; margin-top: 6px; gap: 20px; }
  .sig-col { width: 44%; }
  .sig-img { height: 44px; max-width: 180px; object-fit: contain; display: block; margin-bottom: 2px; }
  .sig-blank { height: 44px; }
  .sig-line { border-top: 1px solid #555; margin-top: 2px; margin-bottom: 4px; }
  .sig-lbl { font-family: Arial, Helvetica, sans-serif; font-size: 8.5pt; color: #333; line-height: 1.6; }

  .ann-title {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 11pt; font-weight: 800; text-align: center; color: #1C355E;
    margin: 14px 0; letter-spacing: 0.03em; text-transform: uppercase;
  }

  .ann-meta-grid {
    width: 100%; margin-bottom: 16px;
    background: #f7f9fc; border: 1px solid #dde3ed;
    border-radius: 4px; border-top: 3px solid #1C355E;
    overflow: hidden;
  }
  .ann-meta-table { width: 100%; border-collapse: collapse; }
  .ann-meta-lbl {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8.5pt; font-weight: 700; color: #1C355E;
    text-transform: uppercase; letter-spacing: 0.06em;
    padding: 7px 14px; border-bottom: 1px solid #dde3ed;
    white-space: nowrap; width: 36%; background: #eef1f7;
    vertical-align: top;
  }
  .ann-meta-val {
    font-family: 'Courier New', Courier, monospace;
    font-size: 10pt; font-weight: 600; color: #1a1a1a;
    padding: 7px 14px; border-bottom: 1px solid #dde3ed; vertical-align: top;
  }
  .ann-meta-lbl.last, .ann-meta-val.last { border-bottom: none; }

  .ann-tbl { width: 76%; margin: 0 auto 20px; border-collapse: collapse; font-size: 10pt; }
  .ann-tbl thead tr { background: #1C355E; color: #fff; }
  .ann-tbl th {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 8.5pt; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.06em; padding: 8px 11px; text-align: left; border: 1px solid #1C355E;
  }
  .ann-tbl td { border: 1px solid #c8cfd8; padding: 5px 11px; font-size: 10pt; color: #1a1a1a; }
  .ann-tbl tbody tr:nth-child(even) { background: #f7f9fc; }
  .ann-tbl tbody tr:nth-child(odd)  { background: #fff; }
  .c-sr  { text-align: center; width: 46px; color: #555; }
  .c-num { text-align: right; width: 90px; font-family: 'Courier New', Courier, monospace; font-size: 9.5pt; }
  .r-sub td { background: #eaf0f7 !important; font-weight: 700; font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; border-top: 1.5px solid #1C355E; }
  .r-net td { background: #1C355E !important; color: #fff !important; font-weight: 700; font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; border-color: #1C355E; }
  .r-ctc td { background: #c8a84b !important; color: #fff !important; font-weight: 700; font-family: Arial, Helvetica, sans-serif; font-size: 9.5pt; border-color: #b8983b; }

  .ack-box {
    margin-top: 22px; page-break-inside: avoid;
    border: 1px solid #dde3ed; border-top: 3px solid #1C355E;
    border-radius: 0 0 4px 4px; padding: 14px 16px; background: #f7f9fc;
  }
  .ack-title {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9.5pt; font-weight: 800; color: #1C355E;
    text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 8px;
  }
  .ack-para { font-size: 10.5pt; line-height: 1.75; margin-bottom: 16px; color: #333; }
  .ack-tbl  { width: 100%; border-collapse: collapse; }
  .ack-lbl  {
    font-family: Arial, Helvetica, sans-serif;
    font-size: 9pt; font-weight: 700; color: #1C355E;
    white-space: nowrap; padding-right: 8px; width: 90px; vertical-align: bottom;
  }
  .ack-line { border-bottom: 1.5px solid #555; width: auto; vertical-align: bottom; }
  .ack-gap  { padding-left: 30px; }

  @media print {
    body { margin: 0; background: #fff; }
    .doc-wrap { width: 100%; margin: 0; box-shadow: none; min-height: 0; }
    .page-break { page-break-before: always; }
    .sec-hd     { page-break-after: avoid; }
    ul.rules li  { page-break-inside: avoid; }
    .sig-section { page-break-inside: avoid; }
    .ann-tbl     { page-break-inside: avoid; }
    .ack-box     { page-break-inside: avoid; }
    .ann-meta-grid { page-break-inside: avoid; }
  }
</style>
</head>
<body>
${mainLetter}
${annexure}
</body>
</html>`;}


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

    // ── Build the offer letter HTML (for preview/fallback) ─────────────────
    const offerHTML = buildOfferLetterHTML(ol);

    // ── Try to generate real letterhead DOCX ────────────────────────────────
    // Uses Letterhead_New.docx as template so header/footer are pixel-perfect
    let offerDocxBuffer = null;
    try {
      const { generateOfferLetterDocx } = require('../utils/generateOfferLetterDocx');
      offerDocxBuffer = await generateOfferLetterDocx(ol);
    } catch (docxErr) {
      console.warn('[offerLetter.sendEmail] DOCX generation failed, falling back to PDF:', docxErr.message);
    }

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
            &#128196; Offer Letter (DOCX — with official letterhead)<br>
            &#128203; Joining Form (DOCX &amp; PDF) — Please fill and submit on joining day
          </p>
        </div>
      </div>`;

    // ── Build attachments array ──────────────────────────────────────────────
    const attachments = [];

    // 1. Offer Letter — prefer DOCX (real letterhead), fall back to PDF/HTML
    if (offerDocxBuffer) {
      // ✅ PRIMARY: Real letterhead DOCX
      attachments.push({
        name:    `Offer_Letter_${ol.candidate_name.replace(/\s+/g,'_')}.docx`,
        content: offerDocxBuffer.toString('base64'),
      });
    } else {
      // Fallback: try wkhtmltopdf PDF, then HTML
      try {
        const tmpDir  = os.tmpdir();
        const tmpHtml = path.join(tmpDir, `offer_${ol.id}_${Date.now()}.html`);
        const tmpPdf  = path.join(tmpDir, `offer_${ol.id}_${Date.now()}.pdf`);
        fs.writeFileSync(tmpHtml, offerHTML);
        await new Promise((resolve, reject) => {
          execFile('wkhtmltopdf', [
            '--quiet', '--page-size', 'A4',
            '--margin-top', '10mm', '--margin-bottom', '10mm',
            '--margin-left', '10mm', '--margin-right', '10mm',
            '--print-media-type', '--enable-local-file-access',
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
        console.error('PDF fallback failed, using HTML:', pdfErr.message);
        attachments.push({
          name:    `Offer_Letter_${ol.candidate_name.replace(/\s+/g,'_')}.html`,
          content: Buffer.from(offerHTML).toString('base64'),
        });
      }
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
