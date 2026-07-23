// src/controllers/offerLetterController.js
// Generate, preview, and email offer letters

const db         = require('../config/db');
const emailSvc   = require('../config/emailService');
const { execFile } = require('child_process');
const puppeteerCore = require('puppeteer-core');
const chromium = require('@sparticuz/chromium').default;
const fs           = require('fs');
const path         = require('path');
const os           = require('os');
const archiver     = require('archiver');

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

// Strict-enough email check — Brevo rejects the whole send if any cc/bcc is
// malformed (e.g. "name@gmail" or "a@ b.com"), so we drop invalid addresses.
const isValidEmail = (e) => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/.test(String(e || '').trim());

// ── Default signature + company stamp images (from backend/src/assets) ─────────
// Sign.jpeg = authorized-signatory signature (shows on every offer letter; a
// per-offer uploaded sig1_image overrides it). stamp.jpeg = company round seal.
// Both are JPEGs on a white background — rendered with mix-blend-mode:multiply so
// the white blends into the page.
// Tries each candidate filename and returns the first that exists (base64).
function loadAssetB64(...files) {
  for (const file of files) {
    try { return 'data:image/jpeg;base64,' + fs.readFileSync(path.join(__dirname, '../assets/' + file)).toString('base64'); }
    catch (_) { /* try next */ }
  }
  return '';
}
const DEFAULT_SIGNATURE_B64    = loadAssetB64('Authorized Signatory.jpeg', 'Sign.jpeg');  // left — authorized signatory
const DEFAULT_HR_SIGNATURE_B64 = loadAssetB64('HR_Sign.jpg', 'HR_Sign.jpeg');             // right — Human Resource
const STAMP_IMG_B64            = loadAssetB64('stamp.jpg', 'stamp.jpeg');
console.log(`✅ Offer letter assets — sig:${DEFAULT_SIGNATURE_B64?'ok':'missing'} hrSig:${DEFAULT_HR_SIGNATURE_B64?'ok':'missing'} stamp:${STAMP_IMG_B64?'ok':'missing'}`);

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
    await db.query(`ALTER TABLE offer_letters ADD COLUMN IF NOT EXISTS esi_employee_monthly NUMERIC(12,2) DEFAULT 0`);
    await db.query(`ALTER TABLE offer_letters ADD COLUMN IF NOT EXISTS esi_employer_monthly NUMERIC(12,2) DEFAULT 0`);
    await db.query(`ALTER TABLE offer_letters ADD COLUMN IF NOT EXISTS client_name VARCHAR(200)`);
    await db.query(`ALTER TABLE offer_letters ADD COLUMN IF NOT EXISTS employment_type VARCHAR(20) DEFAULT 'permanent'`);
    await db.query(`ALTER TABLE offer_letters ADD COLUMN IF NOT EXISTS contract_months INT DEFAULT 0`);
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


// Letterhead PNG (from assets/letterhead.png) — embedded as base64
// ── Convert HTML string to PDF buffer using Puppeteer + @sparticuz/chromium ──
// Works on Render.com / serverless / container environments
// If `browser` is passed, reuses it (caller must close). Otherwise launches+closes its own.
async function launchBrowser() {
  const execPath = await chromium.executablePath();
  return puppeteerCore.launch({
    args: chromium.args,
    executablePath: execPath,
    headless: true,
  });
}

async function htmlToPdf(htmlString, browser) {
  const ownBrowser = !browser;
  if (ownBrowser) browser = await launchBrowser();
  try {
    const page = await browser.newPage();
    // The HTML is fully self-contained (logo/signatures/stamp are inline data URIs),
    // so wait for 'load' (fast) rather than 'networkidle0', which can hang on the
    // serverless Chromium and time out. Give it a generous ceiling too.
    page.setDefaultNavigationTimeout(90000);
    await page.setContent(htmlString, { waitUntil: 'load', timeout: 90000 });
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: 0, right: 0, bottom: 0, left: 0 }
    });
    await page.close();
    return Buffer.from(pdfBuffer);
  } finally {
    if (ownBrowser) await browser.close();
  }
}


function buildOfferLetterHTML(ol) {
  // ── Calculations ──────────────────────────────────────────────────────────
  const basic    = parseFloat(ol.basic_monthly||0);
  const hra      = parseFloat(ol.hra_monthly||0);
  const conv     = parseFloat(ol.conveyance_monthly||0);
  const other    = parseFloat(ol.other_allowance_monthly||0);
  const gratuity = parseFloat(ol.gratuity_monthly||0);
  const pfEmp    = parseFloat(ol.pf_employee_monthly||0);
  const pfEmpr   = parseFloat(ol.pf_employer_monthly||0);
  const pfAdmin  = parseFloat(ol.pf_admin_monthly||0);
  const esiEmp   = parseFloat(ol.esi_employee_monthly||0);
  const esiEmpr  = parseFloat(ol.esi_employer_monthly||0);
  const pt       = parseFloat(ol.professional_tax_monthly||0);

  // Gratuity is an employer retiral cost — part of CTC, NOT of gross earnings and
  // NOT a take-home deduction. So it's excluded from gross and added into CTC.
  const gross      = basic + hra + conv + other;
  const totalDed   = pfEmp + esiEmp + pt;
  const netSalary  = gross - totalDed;
  const ctcMonthly = gross + gratuity + pfEmpr + esiEmpr + pfAdmin;
  const ctcAnnual  = parseFloat(ol.ctc_annual || (ctcMonthly * 12));

  const fmtV = v => Number(Math.round(v)).toLocaleString('en-IN');

  const probWords   = {3:'three',6:'six',12:'twelve'};
  const noticeWords = {1:'one',2:'two',3:'three',6:'six'};
  const probStr     = probWords[ol.probation_months]     || `${ol.probation_months||6}`;
  const noticeStr   = noticeWords[ol.notice_period_months] || `${ol.notice_period_months||3}`;

  // ── Employment type label ─────────────────────────────────────────────────
  // Match by substring so "Contractual"/"Contract"/"Provisional" all work, and
  // always state the basis (incl. Permanent) so it's explicit on the letter.
  const empTypeRaw     = (ol.employment_type || 'permanent').toLowerCase();
  const isContract     = empTypeRaw.includes('contract');
  const isProvision    = empTypeRaw.includes('provision');
  const contractMonths = parseInt(ol.contract_months) || 0;
  let empTypeLabel;
  if (isContract && contractMonths > 0) empTypeLabel = ' on a <strong>Contract basis for ' + contractMonths + ' months</strong>';
  else if (isContract)                  empTypeLabel = ' on a <strong>Contract basis</strong>';
  else if (isProvision)                 empTypeLabel = ' on a <strong>Provisional basis</strong>';
  else                                  empTypeLabel = ' on a <strong>Permanent basis</strong>';
  const empType = isContract ? 'contract' : (isProvision ? 'provision' : 'permanent');

  // ── Client deployment clause (shown only for deployed staff) ──────────────
  const clientName = String(ol.client_name || '').trim();
  const clientClause = clientName
    ? `<p>You will be deployed by the Company to render services on its behalf to our client, <strong>${clientName}</strong>. While you will discharge your duties at / for the said client, you will at all times remain on the rolls of and be an employee of <strong>Krishi Care &amp; Management Services Private Limited</strong>, and shall be governed by its terms, conditions, policies and directions. This deployment may be changed at the sole discretion of the Company.</p>`
    : '';

  function joiningDateHTML(d) {
    if (!d) return '';
    const dt = new Date(d);
    const day = dt.getDate();
    const sup = [,'st','nd','rd'][day] || 'th';
    const months = ['January','February','March','April','May','June',
                    'July','August','September','October','November','December'];
    return day + '<sup>' + sup + '</sup> ' + months[dt.getMonth()] + ' ' + dt.getFullYear();
  }

  const LOGO_PATH = path.join(__dirname, '../../../frontend/Logo_kcms.png');
let LOGO_B64 = '';
try {
  const logoBuf = fs.readFileSync(LOGO_PATH);
  LOGO_B64 = 'data:image/png;base64,' + logoBuf.toString('base64');
} catch (e) {
  console.error('Logo file not found at', LOGO_PATH, e.message);
}
  // ── Company round seal (rubber-stamp) — always shown on the letter ────────
  const STAMP_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 200 200">
<defs><path id="stpT" d="M 22 112 A 78 78 0 0 1 178 112"/><path id="stpB" d="M 30 106 A 70 70 0 0 0 170 106"/></defs>
<g fill="none" stroke="#4b3f8f" stroke-width="2.4"><circle cx="100" cy="100" r="94"/><circle cx="100" cy="100" r="80"/></g>
<text font-family="Georgia,serif" font-size="11.5" font-weight="bold" fill="#4b3f8f" letter-spacing="0.2"><textPath href="#stpT" startOffset="50%" text-anchor="middle">KRISHI CARE &amp; MANAGEMENT SERVICES</textPath></text>
<text font-family="Georgia,serif" font-size="13" font-weight="bold" fill="#4b3f8f" letter-spacing="2"><textPath href="#stpB" startOffset="50%" text-anchor="middle">PVT. LTD.</textPath></text>
<text x="100" y="84" font-family="Georgia,serif" font-size="11" fill="#4b3f8f" text-anchor="middle">★  ★  ★</text>
<text x="100" y="110" font-family="Georgia,serif" font-size="20" font-weight="bold" fill="#4b3f8f" text-anchor="middle" letter-spacing="1">MUMBAI</text>
<text x="100" y="128" font-family="Georgia,serif" font-size="11" fill="#4b3f8f" text-anchor="middle">★  ★  ★</text>
</svg>`;

  // Real company stamp (JPEG) if available, else the drawn SVG seal fallback.
  const stampHTML = STAMP_IMG_B64
    ? '<img src="' + STAMP_IMG_B64 + '" style="width:96px;height:auto;mix-blend-mode:multiply;" alt="">'
    : STAMP_SVG;

  // ── Signature images (uploaded per-offer, or the saved default) ───────────
  const sigImg = ol.sig1_image || DEFAULT_SIGNATURE_B64 || '';
  const sig1HTML = sigImg
    ? '<img src="' + sigImg + '" style="height:52px;display:block;margin-bottom:2px;mix-blend-mode:multiply;" alt="">'
    : '<div style="height:46px;"></div>';
  const hrSig = ol.sig2_image || DEFAULT_HR_SIGNATURE_B64 || '';
  const sig2HTML = hrSig
    ? '<img src="' + hrSig + '" style="height:52px;display:block;margin-left:auto;margin-bottom:2px;mix-blend-mode:multiply;" alt="">'
    : '<div style="height:46px;"></div>';

  // ── Shared header HTML (logo + company name) ──────────────────────────────
  const hdr = `
    <table class="header-table">
      <tr>
        <td style="width:110px;vertical-align:middle;">
          <img src="${LOGO_B64}" style="width:100px;height:auto;display:block;position:relative;top:-10px;">
        </td>
        <td style="text-align:center;vertical-align:middle;">
          <div style="position:relative;top:-10px;">
            <div style="font-family:Arial,sans-serif;font-size:20px;font-weight:bold;color:#000;margin-bottom:4px;">Krishi Care &amp; Management Services Private Limited</div>
            <div style="font-family:Arial,sans-serif;font-size:11px;color:#444;"><strong>Regd. &amp; Head Office:</strong> 617, 6th Floor, Hubtown Viva, Western Express Highway,<br>Shankarwadi, Jogeshwari (East), Mumbai - 400060.</div>
            <div style="font-family:Arial,sans-serif;font-size:11px;color:#444;margin-top:2px;">Email: administrator@krishicare.in, Website: http://www.krishicare.com, Tel. +91 22 68284109</div>
          </div>
        </td>
      </tr>
    </table>`;

  // ── Shared footer HTML ────────────────────────────────────────────────────
  const ftr = `
    <div class="footer">
      Corporate Office: H-12, Green Park Extension, New Delhi -110016. Tel: 011-41039506.<br>
      CIN: U01403MH2015PTC261465
    </div>`;

  // ── Conveyance row (optional) ─────────────────────────────────────────────
  const convRow = conv > 0 ? `<tr>
    <td class="col-sr">2a</td>
    <td class="col-part">Conveyance Allowances</td>
    <td class="col-num">${fmtV(conv)}</td>
    <td class="col-num">${fmtV(conv*12)}</td>
  </tr>` : '';

  // ── Additional terms (optional) ───────────────────────────────────────────
  const additionalTerms = ol.custom_clauses ? `
    <p><u><strong>ADDITIONAL TERMS:</strong></u><br>${ol.custom_clauses}</p>` : '';

  // ─────────────────────────────────────────────────────────────────────────
  // FULL HTML — 3 pages matching the provided template exactly
  // Header/footer rendered inside each .page div
  // Puppeteer prints with 0 margins — padding is handled by .page CSS
  // ─────────────────────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; }
  body {
    font-family: 'Georgia','Times New Roman',Times,serif;
    color: #000; line-height: 1.4; margin: 0;
    background-color: #525659; padding: 20px 0;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .page {
    width: 210mm; height: 297mm; position: relative;
    margin: 0 auto 20px auto; background: #fff;
    box-shadow: 0 0 10px rgba(0,0,0,.5);
    padding: 15mm 15mm 30mm 15mm;
    page-break-after: always; overflow: hidden;
  }
  .header-table {
    width: 100%; border-bottom: 2px solid #000;
    padding-bottom: 10px; margin-bottom: 20px;
    border-collapse: collapse;
  }
  .footer {
    position: absolute; bottom: 10mm; left: 15mm; right: 15mm;
    text-align: center; font-size: 10px; color: #000;
    border-top: 1px solid #000; padding-top: 5px;
    font-family: 'Arial',sans-serif; font-weight: bold;
    background: #fff; z-index: 5;
  }
  .date-row { text-align: right; font-weight: bold; font-size: 13.5px; margin-top: 32px; margin-bottom: 12px; }
  .candidate-info { margin-bottom: 12px; font-size: 14px; line-height: 1.3; }
  .subject-line { text-align: center; font-weight: bold; text-decoration: underline; margin: 12px 0; font-size: 14.5px; }
  p { margin: 6px 0; text-align: justify; font-size: 13px; }
  ul { margin-top: 0; padding-left: 25px; }
  li { margin-bottom: 3px; text-align: justify; font-size: 13px; }
  .data-table { width: 100%; border-collapse: collapse; margin-top: 10px; font-family: 'Arial',sans-serif; border: 1px solid #000; }
  .data-table th, .data-table td { border: 1px solid #000; padding: 3px 8px; font-size: 11px; }
  .data-table th { background-color: #1a4d2e; color: #fff; font-weight: bold; text-transform: uppercase; }
  .col-sr { width: 8%; text-align: center; }
  .col-part { width: 48%; text-align: left; }
  .col-num { width: 22%; text-align: right; }
  .data-table tr.highlight td { font-weight: bold; background-color: #f2f2f2; }
  .data-table tr.section td { font-weight: bold; font-size: 10.5px; text-transform: uppercase; background-color: #dfe7e2; color: #1a4d2e; letter-spacing: .03em; padding: 3px 8px; }
  .main-signature-block { margin-top: 20px; font-size: 14px; }
  .dual-signature { display: flex; justify-content: space-between; align-items: flex-end; margin-top: 30px; }
  .company-stamp { position: absolute; left: 8px; bottom: 6px; opacity: 0.9; transform: rotate(-8deg); pointer-events: none; }
  .sig-left { text-align: left; }
  .sig-right { text-align: right; }
  @media print {
    body { background-color: #fff; padding: 0; margin: 0; }
    .page { box-shadow: none; margin: 0; border: none; width: 210mm; height: 296mm; page-break-inside: avoid; }
    .page:last-child { page-break-after: auto; }
    @page { size: A4; margin: 0; }
  }
</style>
</head>
<body>

<!-- PAGE 1 -->
<div class="page">
  ${hdr}
  <div class="date-row">${joiningDateHTML(ol.offer_date||new Date())}</div>
  <div class="candidate-info">
    <strong>${ol.candidate_name||''}</strong><br>
    ${ol.candidate_address||''}<br><br>
    <strong>Mob &ndash; ${ol.candidate_mobile||''}</strong><br>
    <strong>Email &ndash; ${ol.candidate_email||''}</strong>
  </div>
  <p>Dear ${(ol.candidate_name||'').split(' ')[0]},</p>
  <div class="subject-line">Sub: Letter of offer/Appointment for the position of &ldquo;${ol.designation||''}&rdquo;</div>
  <p>In reference to our discussions, we are pleased to offer you the position of <strong>&ldquo;${ol.designation||''}&rdquo;</strong> in Krishi Care &amp; Management Services Private Limited${empTypeLabel}, to be based at our <strong>${ol.location||'Mumbai'} Office${ol.joining_date ? ' as from <strong>' + joiningDateHTML(ol.joining_date) + '</strong>' : ''}.</strong></p>
  ${clientClause}
  <p>The offer letter is valid for <strong>${ol.offer_valid_days||7} days</strong> by which time we must be informed of your decision; the said offer letter shall stand cancelled after the above-mentioned date.</p>
  <p>We are pleased to issue this letter of offer on the following terms &amp; conditions:</p>
  <p><u><strong>EMOLUMENTS:</strong></u><br>
  Your compensation on a cost to company basis will be <strong>Rs. ${Number(ctcAnnual).toLocaleString('en-IN')}/- PA (Rupees ${numberToWords(Math.round(ctcAnnual))} Only)</strong>. The remuneration has taken into consideration the status and responsibility of the appointment, and it is inclusive of all taxable and non-taxable emoluments, allowances and statutory contributions.</p>
  <p><u><strong>RESPONSIBILITIES:</strong></u><br>
  You will work as &ldquo;${ol.designation||''}&rdquo; of the Company and will be responsible for carrying out the operations of the Company as directed to you by the management. A detailed responsibility statement will be provided to you upon your joining.</p>
  ${empType !== 'contract' ? '<p><u><strong>PROBATION PERIOD:</strong></u><br>You will be on a probationary period of <strong>' + probStr + ' months</strong> during which the services can be terminated from employer without giving any reason and any time for notice of termination of services. The company may regularize your services subject to satisfactory completion of probationary period.</p>' : ''}
  <p><u><strong>SEPERATION OF SERVICES:</strong></u><br>
  Severance of relationship can be done by giving <strong>${noticeStr} month</strong> written notice. If you are unable to complete this notice period you will be liable to compensate the company <strong>${noticeStr} month${parseInt(ol.notice_period_months||3) > 1 ? "s" : ""}</strong> of salary or for the period not served.</p>
  <p><u><strong>OTHER RULES AND REGULATION:</strong></u></p>
  <ul>
    <li>The company will expect you to work in the Section / Department in which you are placed with a high standard of initiative, morality and economy.</li>
    <li>You will, in all respects, be governed by the company&rsquo;s rules and regulations.</li>
    <li>You will devote full time to the work of the Company and will not undertake any direct/ indirect outside business or work, honorary or remunerative except with the prior written consent of the Management.</li>
    <li>You will abide by Leave Rules of company.</li>
  </ul>
  ${ftr}
</div>

<!-- PAGE 2 -->
<div class="page">
  ${hdr}
  <ul style="margin-top:40px;">
    <li>You have been engaged on the presumption that the particulars furnished by you in your application are correct. In case the said particular are found to be incorrect or that you have concealed or withheld information or the relevant facts, the services can be terminated from the company without giving any reason and any time for notice of termination of services. The company may regularize your services subject to satisfactory completion of period.</li>
    <li>You will not, either during the period of your services of thereafter, disclose divulge or communicate to any other person or group or company any strategic information of the organization or its clients.</li>
    <li>All correspondence addressed to you by the company including press and other copies of such correspondence and all vouchers, books, records, including all note books containing notes or records of business or prices or other market data, samples and/or other papers belonging to the company, circulars and all other relevant papers and documents of any nature whatsoever relating to the company&rsquo;s business, which shall come into your possession in the course of your employment shall be the absolute property of the company and you shall, at any time during your employment or upon termination there for any reason whatsoever, deliver the same to the company and without claiming any lien thereon.</li>
    <li>You will be responsible for the safe keeping and for returning in good condition and order, all on your own the company&rsquo;s property which may be in your use, custody, care or charge. The company shall have the right to deduct the monetary value of all such things from any amounts payable to you and to take such actions as may be deemed proper in the event of your failure to account for such property to the satisfaction of the management.</li>
    <li>You will keep us informed of your residential (mailing &amp; permanent) address. Any change in the same should be notified in writing within one week. Failure to do so will be treated as willful withholding of information and appropriate action as deemed fit by management would be taken against you.</li>
  </ul>
  ${additionalTerms}
  <p><strong>If you are willing to accept this offer for the said position, we request you to submit 3 copies of your latest coloured Passport Size photograph, Self-attested Copy of your academic qualification, Self-attested copy of your PAN Card, Self-attested copy of your Aadhar Card, Self-attested Copy of Address Proof, and last 3 month Pay Slip / Form 16 from your previous employer. In addition, upon joining, you will have to submit a copy of your relieving letter from your previous employer.</strong></p>
  <p>As a token of your acceptance and in confirmation of the terms and conditions of this offer, please sign the duplicate copy of this letter and return to us at the earliest duly intimating when you are going to join.</p>
  <div class="main-signature-block">
    <p>Yours truly,<br>From <strong>Krishi Care &amp; Management Services Private Limited,</strong></p>
    <div class="dual-signature">
      <div class="sig-left" style="position:relative;height:112px;width:280px;">
        ${sigImg ? `<img src="${sigImg}" style="position:absolute;top:0;left:4px;height:54px;mix-blend-mode:multiply;" alt="">` : ''}
        <div style="position:absolute;top:34px;left:96px;transform:rotate(-6deg);">${stampHTML}</div>
        <div style="position:absolute;bottom:0;left:0;">Authorized Signatory</div>
      </div>
      <div class="sig-right">${sig2HTML}(Authorized Signatory)<br><br>Human Resource</div>
    </div>
  </div>
  ${ftr}
</div>

<!-- PAGE 3: ANNEXURE -->
<div class="page">
  ${hdr}
  <h3 style="text-align:center;text-decoration:underline;margin-top:35px;font-size:16px;">Annexure I (Annual Cost to Company and Other Benefits)</h3>
  <p style="margin-top:10px;font-size:13px;">
    <strong>Name:</strong> ${ol.candidate_name||''}<br>
    <strong>Designation:</strong> ${ol.designation||''}<br>
    <strong>Location:</strong> ${ol.location||'Mumbai'}<br>
    <strong>Annual Cost to Company:</strong> Rs.${Number(ctcAnnual).toLocaleString('en-IN')} (Rupees ${numberToWords(Math.round(ctcAnnual))} Only)
  </p>
  <table class="data-table">
    <thead>
      <tr>
        <th class="col-sr">SR. NO.</th>
        <th class="col-part">PARTICULARS</th>
        <th class="col-num">MONTHLY</th>
        <th class="col-num">YEARLY</th>
      </tr>
    </thead>
    <tbody>
      <tr class="section"><td colspan="4">A. EARNINGS</td></tr>
      <tr><td class="col-sr">1</td><td class="col-part">Fixed Basic</td><td class="col-num">${fmtV(basic)}</td><td class="col-num">${fmtV(basic*12)}</td></tr>
      <tr><td class="col-sr">2</td><td class="col-part">HRA</td><td class="col-num">${fmtV(hra)}</td><td class="col-num">${fmtV(hra*12)}</td></tr>
      ${convRow}
      <tr><td class="col-sr">3</td><td class="col-part">Other Allowances</td><td class="col-num">${fmtV(other)}</td><td class="col-num">${fmtV(other*12)}</td></tr>
      <tr class="highlight"><td class="col-sr"></td><td class="col-part">Gross Pay (A)</td><td class="col-num">${fmtV(gross)}</td><td class="col-num">${fmtV(gross*12)}</td></tr>
      <tr class="section"><td colspan="4">B. DEDUCTIONS (Employee Contribution)</td></tr>
      <tr><td class="col-sr">4</td><td class="col-part">Provident Fund (Employee)</td><td class="col-num">${pfEmp>0?fmtV(pfEmp):''}</td><td class="col-num">${pfEmp>0?fmtV(pfEmp*12):''}</td></tr>
      <tr><td class="col-sr">5</td><td class="col-part">ESIC (Employee)</td><td class="col-num">${esiEmp>0?fmtV(esiEmp):''}</td><td class="col-num">${esiEmp>0?fmtV(esiEmp*12):''}</td></tr>
      <tr><td class="col-sr">6</td><td class="col-part">Professional Tax</td><td class="col-num">${pt>0?fmtV(pt):''}</td><td class="col-num">${pt>0?fmtV(pt*12):''}</td></tr>
      <tr class="highlight"><td class="col-sr"></td><td class="col-part">Total Deduction (B)</td><td class="col-num">${totalDed>0?fmtV(totalDed):''}</td><td class="col-num">${totalDed>0?fmtV(totalDed*12):''}</td></tr>
      <tr class="highlight"><td class="col-sr"></td><td class="col-part">Net Salary in Hand (A - B)</td><td class="col-num">${fmtV(netSalary)}</td><td class="col-num">${fmtV(netSalary*12)}</td></tr>
      <tr class="section"><td colspan="4">C. EMPLOYER CONTRIBUTIONS (Cost to Company)</td></tr>
      <tr><td class="col-sr">7</td><td class="col-part">Provident Fund (Employer)</td><td class="col-num">${pfEmpr>0?fmtV(pfEmpr):''}</td><td class="col-num">${pfEmpr>0?fmtV(pfEmpr*12):''}</td></tr>
      <tr><td class="col-sr">8</td><td class="col-part">ESIC (Employer)</td><td class="col-num">${esiEmpr>0?fmtV(esiEmpr):''}</td><td class="col-num">${esiEmpr>0?fmtV(esiEmpr*12):''}</td></tr>
      <tr><td class="col-sr">9</td><td class="col-part">PF Admin Charges (Employer)</td><td class="col-num">${pfAdmin>0?fmtV(pfAdmin):''}</td><td class="col-num">${pfAdmin>0?fmtV(pfAdmin*12):''}</td></tr>
      <tr><td class="col-sr">10</td><td class="col-part">Gratuity (Employer)</td><td class="col-num">${gratuity>0?fmtV(gratuity):''}</td><td class="col-num">${gratuity>0?fmtV(gratuity*12):''}</td></tr>
      <tr class="highlight"><td class="col-sr"></td><td class="col-part">Total Compensation Package (CTC = A + C)</td><td class="col-num">${fmtV(ctcMonthly)}</td><td class="col-num">${fmtV(ctcAnnual)}</td></tr>
    </tbody>
  </table>
  <div style="margin-top:10px;">
    <h4 style="margin-bottom:4px;font-size:14px;text-decoration:underline;">Acknowledgement &amp; Acceptance</h4>
    <p style="margin-top:0;font-size:13px;">I have read understood, agree to the above terms and conditions, and hereby sign my acceptance of the same.</p>
    <div style="margin-top:10px;font-size:14px;line-height:1.7;font-weight:bold;">
      Signature: _____________________________________________________<br>
      Name: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;_____________________________________________________<br>
      Date: &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;_____________________________________________________<br>
      Location: &nbsp;&nbsp;&nbsp;&nbsp;_____________________________________________________
    </div>
  </div>
  ${ftr}
</div>

</body>
</html>`;
}


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
// ── Push an offer letter's pay into employee_salary_structure ────────────────
// Resolves the employee from employee_id → employee_code → candidate_email.
// overwrite=false seeds a structure only if none exists (never clobbers an
// Accounts-edited one); overwrite=true force-applies the offer's numbers.
// Returns true if a structure was written.
async function applyOfferToStructure(offer, userId, overwrite = false) {
  try {
    let empId = offer.employee_id || null;
    if (!empId && offer.employee_code) {
      const r = await db.query('SELECT id FROM employees WHERE UPPER(employee_code)=UPPER($1)', [offer.employee_code]);
      if (r.rows[0]) empId = r.rows[0].id;
    }
    if (!empId && offer.candidate_email) {
      const r = await db.query('SELECT id FROM employees WHERE LOWER(email)=LOWER($1)', [offer.candidate_email]);
      if (r.rows[0]) empId = r.rows[0].id;
    }
    if (!empId) return false;   // candidate isn't an employee yet

    const num = v => parseFloat(v) || 0;
    const basic       = num(offer.basic_monthly);
    const hra         = num(offer.hra_monthly);
    const conveyance  = num(offer.conveyance_monthly);
    const other       = num(offer.other_allowance_monthly);
    const gratuity    = num(offer.gratuity_monthly);
    const pfEmp       = num(offer.pf_employee_monthly);
    const pfEr        = num(offer.pf_employer_monthly);
    const pfAdmin     = num(offer.pf_admin_monthly);
    const esiEmp      = num(offer.esi_employee_monthly);
    const esiEr       = num(offer.esi_employer_monthly);
    const pt          = num(offer.professional_tax_monthly);
    const gross    = basic + hra + conveyance + other;   // gratuity = employer cost, not gross
    const totalDed = pfEmp + esiEmp + pt;
    const net      = gross - totalDed;
    const ctc      = gross + gratuity + pfEr + esiEr + pfAdmin;
    const ctcAnnual = num(offer.ctc_annual) || ctc * 12;
    const totalEmployerCost = pfEr + esiEr + pfAdmin + gratuity;

    await db.query(`ALTER TABLE employee_salary_structure ADD COLUMN IF NOT EXISTS other_allowance NUMERIC(12,2) DEFAULT 0`).catch(() => {});
    await db.query(`ALTER TABLE employee_salary_structure ADD COLUMN IF NOT EXISTS loan_emi_recovery NUMERIC(12,2) DEFAULT 0`).catch(() => {});
    await db.query(`ALTER TABLE employee_salary_structure ADD COLUMN IF NOT EXISTS tds NUMERIC(12,2) DEFAULT 0`).catch(() => {});

    // Extra allowance goes into special_allowance so it matches the employee
    // import (which also uses special_allowance). other_allowance stays 0.
    const conflict = overwrite
      ? `ON CONFLICT(employee_id) DO UPDATE SET
           basic=$2, hra=$3, conveyance=$4, special_allowance=$6, gratuity=$5, other_allowance=0, gross_salary=$7,
           pf_applicable=$8, esi_applicable=$21, pt_applicable=true, lwf_applicable=false, tds_applicable=false,
           pf_employee=$9, pf_employer=$10, pf_admin=$11, esi_employee=$19, esi_employer=$20, professional_tax=$12,
           total_employer_cost=$13, total_deductions=$14, net_salary=$15, ctc_monthly=$16, ctc_annual=$17,
           updated_by=$18, updated_at=NOW()`
      : `ON CONFLICT(employee_id) DO NOTHING`;

    await db.query(
      `INSERT INTO employee_salary_structure
         (employee_id, basic, hra, conveyance, special_allowance, gratuity, other_allowance, gross_salary,
          pf_applicable, esi_applicable, pt_applicable, lwf_applicable, tds_applicable,
          pf_employee, pf_employer, pf_admin, esi_employee, esi_employer,
          professional_tax, lwf, tds, loan_emi_recovery, total_employer_cost,
          total_deductions, net_salary, ctc_monthly, ctc_annual, updated_by, updated_at)
       VALUES($1,$2,$3,$4,$6,$5,0,$7,$8,$21,true,false,false,$9,$10,$11,$19,$20,$12,0,0,0,$13,$14,$15,$16,$17,$18,NOW())
       ${conflict}`,
      [empId, basic, hra, conveyance, gratuity, other, gross,
       (pfEmp > 0 || pfEr > 0), pfEmp, pfEr, pfAdmin, pt,
       totalEmployerCost, totalDed, net, ctc, ctcAnnual, userId,
       esiEmp, esiEr, (esiEmp > 0 || esiEr > 0)]);
    return true;
  } catch (err) {
    console.error('[applyOfferToStructure]', err.message);
    return false;
  }
}

exports.create = async (req, res) => {
  try {
    const {
      candidate_name, candidate_email, candidate_address, candidate_mobile,
      designation, location = 'Mumbai', joining_date, offer_date, offer_valid_days = 7,
      ctc_annual, basic_monthly, hra_monthly, conveyance_monthly = 0,
      other_allowance_monthly, gratuity_monthly = 0,
      pf_employee_monthly = 0, pf_employer_monthly = 0, pf_admin_monthly = 0,
      esi_employee_monthly = 0, esi_employer_monthly = 0,
      professional_tax_monthly = 0,
      probation_months = 6, notice_period_months = 3, custom_clauses, employee_id, employment_type = 'permanent', contract_months = 0,
      employee_code, client_name,
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
        probation_months, notice_period_months, custom_clauses, sig1_image, sig2_image, employment_type, contract_months,
        esi_employee_monthly, esi_employer_monthly, client_name,
        created_by, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,NOW())
      RETURNING *`,
      [employee_id||null, candidate_name, candidate_email||null, candidate_address||null, candidate_mobile||null,
       designation, location, joining_date||null, offer_date||null, offer_valid_days,
       ctc_annual||0, basic_monthly||0, hra_monthly||0, conveyance_monthly, other_allowance_monthly||0,
       gratuity_monthly, pf_employee_monthly, pf_employer_monthly, pf_admin_monthly,
       professional_tax_monthly||0, employee_code||null,
       probation_months, notice_period_months, custom_clauses||null, sig1_image||null, sig2_image||null, employment_type||'permanent', contract_months||0,
       esi_employee_monthly||0, esi_employer_monthly||0, client_name||null,
       req.user.id]
    );
    // If this offer already links to an existing employee, seed their salary
    // structure from it (won't overwrite an existing/edited one).
    const seeded = await applyOfferToStructure(result.rows[0], req.user.id, false);
    res.json({ success: true, data: result.rows[0], seeded_structure: seeded, message: 'Offer letter created!' });
  } catch (err) {
    console.error('[offerLetter.create]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── POST /offer-letters/:id/apply-structure — force-apply offer pay → structure
// Explicit action for HR/Accounts to push this offer's numbers into the linked
// employee's salary structure (overwrites what's there).
exports.applyToStructure = async (req, res) => {
  try {
    const r = await db.query('SELECT * FROM offer_letters WHERE id=$1', [req.params.id]);
    if (!r.rows.length) return res.status(404).json({ success: false, message: 'Offer letter not found' });
    const ok = await applyOfferToStructure(r.rows[0], req.user.id, true);
    if (!ok) return res.status(400).json({ success: false, message: 'No matching employee (set Employee Code, or create the employee first).' });
    res.json({ success: true, message: 'Salary structure updated from this offer letter.' });
  } catch (err) {
    console.error('[offerLetter.applyToStructure]', err.message);
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
      'esi_employee_monthly','esi_employer_monthly','client_name',
      'professional_tax_monthly','employee_code',
      'probation_months','notice_period_months','custom_clauses','sig1_image','sig2_image','employment_type','contract_months'];
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

    // ── Generate PDF via Puppeteer (headless Chrome) ───────────────────────
    let offerPdfBuffer = null;
    try {
      offerPdfBuffer = await htmlToPdf(offerHTML);
      console.log('[offerLetter.sendEmail] PDF generated, size:', offerPdfBuffer.length);
    } catch (pdfErr) {
      console.error('[offerLetter.sendEmail] PDF generation failed:', pdfErr.message);
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
            &#128196; Offer Letter (PDF)<br>
            &#128203; Joining Form (DOCX &amp; PDF) — Please fill and submit on joining day
          </p>
        </div>
      </div>`;

    // ── Build attachments array ──────────────────────────────────────────────
    const attachments = [];

    // 1. Offer Letter — always as PDF
    if (offerPdfBuffer) {
      attachments.push({
        name:    `Offer_Letter_${ol.candidate_name.replace(/\s+/g,'_')}.pdf`,
        content: offerPdfBuffer.toString('base64'),
      });
    } else {
      return res.status(500).json({ success: false, message: 'PDF generation failed. Please try again.' });
    }

    // 2. Joining Form DOCX — always attach if file exists
    const joiningFormPath = path.join(__dirname, '..', 'assets', 'Joining_form_Krishi_Care.pdf');
    if (fs.existsSync(joiningFormPath)) {
      const docxBuffer = fs.readFileSync(joiningFormPath);
      attachments.push({
        name:    'Joining_Form_Krishi_Care.pdf',
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

    // ── Send via SMTP (nodemailer) ────────────────────────────────────────────
    const hrFrom     = process.env.EMAIL_FROM_HR || process.env.EMAIL_FROM || process.env.SMTP_USER || 'no-reply@krishicare.in';
    const senderName = process.env.EMAIL_FROM_NAME_HR || 'Krishi Care & Management Services Pvt. Ltd.';
    const cleanCc  = (Array.isArray(cc)  ? cc  : []).map(e => (e||'').trim()).filter(isValidEmail);
    const cleanBcc = (Array.isArray(bcc) ? bcc : []).map(e => (e||'').trim()).filter(isValidEmail);
    const archive = String(process.env.EMAIL_ARCHIVE_BCC || '').trim();
    if (archive && isValidEmail(archive) && !cleanBcc.includes(archive)) cleanBcc.push(archive);

    if (process.env.EMAIL_ENABLED !== 'true') {
      await db.query(`UPDATE offer_letters SET status='sent', sent_at=NOW() WHERE id=$1`, [ol.id]);
      return res.json({ success: true, message: `[Simulated] Offer letter to ${ol.candidate_email} with ${attachments.length} attachment(s)` });
    }

    const r = await emailSvc.sendRaw({
      from: { email: hrFrom, name: senderName },
      to: ol.candidate_email, toName: ol.candidate_name,
      replyTo: hrFrom, replyToName: senderName,
      subject: `Offer Letter — ${ol.designation} | Krishi Care & Management Services`,
      html: coverHtml,
      cc: cleanCc, bcc: cleanBcc,
      attachments,   // [{ name, content(base64) }]
    });
    if (!r.ok) return res.status(500).json({ success: false, message: `Email failed: ${r.error}` });

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

// ── BULK SEND: POST /offer-letters/bulk-send ──────────────────────────────────
// Accepts multipart Excel upload. Each row = one offer letter → PDF → email.
// Returns progress report: { total, sent, failed, results[] }
exports.bulkSend = async (req, res) => {
  const XLSX = require('xlsx');

  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No Excel file uploaded' });

    // Parse Excel
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    // Find the real header row (some templates have a title row on top), then parse
    // from there — otherwise sheet_to_json would treat the title as the headers.
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    let hdrIdx = grid.findIndex(r => Array.isArray(r) &&
      r.some(c => String(c || '').toLowerCase().includes('candidate name')));
    if (hdrIdx < 0) hdrIdx = 0;
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', range: hdrIdx });

    if (!rows.length) return res.status(400).json({ success: false, message: 'Excel is empty' });

    // CC / BCC from first data row (same for all)
    const ccRaw  = String(rows[0]['CC']  || rows[0]['cc']  || '').split(',').map(e=>e.trim()).filter(isValidEmail);
    const bccRaw = String(rows[0]['BCC'] || rows[0]['bcc'] || '').split(',').map(e=>e.trim()).filter(isValidEmail);

    const results = [];
    let sent = 0, failed = 0;

    // ── Live streaming (NDJSON): the UI reads each line as a candidate finishes,
    //    so it shows total / sent / remaining updating one-by-one. ────────────
    const nonEmpty = (r) => Object.keys(r).some(k => !/^(cc|bcc)$/i.test(k) && String(r[k]).trim() !== '');
    const total = rows.filter(nonEmpty).length;
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');   // disable proxy buffering (Render/nginx)
    res.write(JSON.stringify({ type: 'start', total }) + '\n');
    const emit = (r) => {
      results.push(r);
      if (String(r.status).startsWith('sent')) sent++; else failed++;
      try { res.write(JSON.stringify({ type: 'progress', row: r.row, name: r.name, email: r.email, status: r.status, reason: r.reason, sent, failed, total }) + '\n'); } catch (_) {}
    };

    // Fetch signatures from DB (shared across all letters)
    const sigRow = await db.query(`SELECT sig1_image, sig2_image FROM offer_letters WHERE sig1_image IS NOT NULL LIMIT 1`);
    const sig1   = sigRow.rows[0]?.sig1_image || null;
    const sig2   = sigRow.rows[0]?.sig2_image || null;

    const BREVO_KEY   = process.env.BREVO_API_KEY;
    const emailEnabled = process.env.EMAIL_ENABLED === 'true';

    // Launch browser ONCE for all PDFs (avoids timeout on Render)
    const browser = await launchBrowser();
    console.log('[bulkSend] Browser launched for PDF generation');

    try {
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!nonEmpty(row)) continue;   // skip fully-blank rows silently
      const rowNum = i + 2; // Excel row number (1=header, 2=first data)

      // ── Map Excel columns → offer letter object ────────────────────────────
      const candidateName  = String(row['Candidate Name']  || row['candidate_name']  || '').trim();
      const candidateEmail = String(row['Email']           || row['email']           || row['candidate_email'] || '').trim();
      const designation    = String(row['Designation']     || row['designation']     || '').trim();
      const location       = String(row['Location']        || row['location']        || 'Mumbai').trim();
      const joiningDateRaw = row['Joining Date']           || row['joining_date']    || '';
      const offerValidDays = parseInt(row['Offer Valid Days'] || row['offer_valid_days'] || 7) || 7;
      const probation      = parseInt(row['Probation Months'] || row['probation_months'] || 6) || 6;
      const noticePeriod   = parseInt(row['Notice Period Months'] || row['notice_period_months'] || 3) || 3;
      const employeeCode   = String(row['Employee Code']   || row['employee_code']   || '').trim();
      const candidateMobile= String(row['Mobile']          || row['mobile']          || row['candidate_mobile'] || '').trim();
      const candidateAddr  = String(row['Address']         || row['address']         || '').trim();
      const customClauses  = String(row['Custom Clauses']  || row['custom_clauses']  || '').trim();
      const employmentType = String(row['Employment Type'] || row['employment_type'] || 'permanent').trim().toLowerCase();
      const contractMon    = parseInt(row['Contract Months'] || row['contract_months'] || 0) || 0;
      const clientName     = String(row['Client Name'] || row['Client'] || row['client_name'] || '').trim();

      // Salary fields — accept the canonical (employee-import) names too
      const ctcAnnual    = parseFloat(String(row['CTC']              || row['CTC Annual']         || row['ctc_annual']         || 0).replace(/,/g,'')) || 0;
      const basic        = parseFloat(String(row['Basic Salary']     || row['Basic Monthly']      || row['basic_monthly']      || 0).replace(/,/g,'')) || 0;
      const hra          = parseFloat(String(row['HRA']              || row['HRA Monthly']        || row['hra_monthly']        || 0).replace(/,/g,'')) || 0;
      const conveyance   = parseFloat(String(row['Travel Allowance'] || row['Conveyance Monthly'] || row['conveyance_monthly'] || 0).replace(/,/g,'')) || 0;
      const otherAllow   = parseFloat(String(row['Special Allowance']|| row['Other Allowance']    || row['other_allowance_monthly'] || 0).replace(/,/g,'')) || 0;
      const gratuity     = parseFloat(String(row['Gratuity Monthly']   || row['gratuity_monthly']   || 0).replace(/,/g,'')) || 0;
      const pfEmployee   = parseFloat(String(row['PF Employee']        || row['pf_employee_monthly'] || 0).replace(/,/g,'')) || 0;
      const pfEmployer   = parseFloat(String(row['PF Employer']        || row['pf_employer_monthly'] || 0).replace(/,/g,'')) || 0;
      const pfAdmin      = parseFloat(String(row['PF Admin']           || row['pf_admin_monthly']   || 0).replace(/,/g,'')) || 0;
      const profTax      = parseFloat(String(row['Professional Tax']   || row['professional_tax_monthly'] || 0).replace(/,/g,'')) || 0;
      const esiEmployee  = parseFloat(String(row['ESIC Employee']      || row['ESI Employee'] || row['esi_employee_monthly'] || 0).replace(/,/g,'')) || 0;
      const esiEmployer  = parseFloat(String(row['ESIC Employer']      || row['ESI Employer'] || row['esi_employer_monthly'] || 0).replace(/,/g,'')) || 0;

      // Validation
      if (!candidateName || !candidateEmail || !designation) {
        emit({ row: rowNum, name: candidateName || '(empty)', email: candidateEmail || '(empty)', status: 'failed', reason: 'Missing required: Candidate Name, Email, or Designation' });
        continue;
      }
      if (!candidateEmail.includes('@')) {
        emit({ row: rowNum, name: candidateName, email: candidateEmail, status: 'failed', reason: 'Invalid email address' });
        continue;
      }

      // Parse joining date
      let joiningDate = null;
      if (joiningDateRaw) {
        const d = joiningDateRaw instanceof Date ? joiningDateRaw : new Date(joiningDateRaw);
        if (!isNaN(d)) {
          // Excel date cells authored in IST come through as ~midnight-minus in UTC
          // (e.g. 8 Jul → 2026-07-07T18:30Z), which naive UTC formatting rolls back a
          // day. Round to the NEAREST day so the intended calendar date is kept.
          const rounded = new Date(Math.round(d.getTime() / 86400000) * 86400000);
          joiningDate = rounded.toISOString().split('T')[0];
        }
      }

      // Build offer letter object (same shape as DB row)
      const ol = {
        id: `bulk_${Date.now()}_${i}`,
        candidate_name:          candidateName,
        candidate_email:         candidateEmail,
        candidate_address:       candidateAddr,
        candidate_mobile:        candidateMobile,
        designation,
        location,
        joining_date:            joiningDate,
        offer_date:              new Date(),
        offer_valid_days:        offerValidDays,
        probation_months:        probation,
        notice_period_months:    noticePeriod,
        employee_code:           employeeCode,
        ctc_annual:              ctcAnnual,
        basic_monthly:           basic,
        hra_monthly:             hra,
        conveyance_monthly:      conveyance,
        other_allowance_monthly: otherAllow,
        gratuity_monthly:        gratuity,
        pf_employee_monthly:     pfEmployee,
        pf_employer_monthly:     pfEmployer,
        pf_admin_monthly:        pfAdmin,
        esi_employee_monthly:    esiEmployee,
        esi_employer_monthly:    esiEmployer,
        professional_tax_monthly: profTax,
        client_name:             clientName || null,
        custom_clauses:          customClauses || null,
        employment_type:         employmentType,
        contract_months:         contractMon,
        sig1_image:              sig1,
        sig2_image:              sig2,
        status:                  'draft',
      };

      // Generate PDF (one retry on a transient render failure/timeout)
      let offerPdfBuffer = null;
      {
        const offerHTML = buildOfferLetterHTML(ol);
        let lastErr = null;
        for (let attempt = 1; attempt <= 2 && !offerPdfBuffer; attempt++) {
          try { offerPdfBuffer = await htmlToPdf(offerHTML, browser); }
          catch (pdfErr) { lastErr = pdfErr; console.error(`[bulkSend] PDF attempt ${attempt} failed for ${candidateName}: ${pdfErr.message}`); }
        }
        if (!offerPdfBuffer) {
          emit({ row: rowNum, name: candidateName, email: candidateEmail, status: 'failed', reason: `PDF generation failed: ${lastErr ? lastErr.message : 'unknown'}` });
          continue;
        }
      }

      // Build email payload
      const firstName  = candidateName.split(' ').filter(w => !['Mr.','Ms.','Mrs.','Dr.'].includes(w))[0] || candidateName;
      const coverHtml  = `
        <div style="font-family:Arial,sans-serif;font-size:13px;color:#222;line-height:1.7;max-width:600px;">
          <div style="background:#1B5E20;padding:16px 24px;border-radius:8px 8px 0 0;">
            <span style="color:#fff;font-size:16px;font-weight:700;">KrishiHR</span>
            <span style="color:#A5D6A7;font-size:12px;margin-left:8px;">Krishi Care &amp; Management Services</span>
          </div>
          <div style="border:1px solid #e0e0e0;border-top:none;padding:24px;border-radius:0 0 8px 8px;">
            <p>Dear ${firstName},</p>
            <p>Please find attached your offer letter for the position of <strong>"${designation}"</strong> at Krishi Care &amp; Management Services Private Limited.</p>
            <p>Kindly review the letter and revert back with your acceptance within <strong>${offerValidDays} days</strong>.</p>
            <p>Please also find attached the Joining Form. Kindly fill it and submit upon joining.</p>
            <p>For any queries, feel free to reach out to us.</p>
            <p>Warm regards,<br>Human Resource Team<br>Krishi Care &amp; Management Services Pvt. Ltd.</p>
          </div>
        </div>`;

      const attachments = [{
        name:    `Offer_Letter_${candidateName.replace(/\s+/g,'_')}.pdf`,
        content: offerPdfBuffer.toString('base64'),
      }];

      // Attach joining form if exists
      const joiningFormPath = path.join(__dirname, '..', 'assets', 'Joining_form_Krishi_Care.pdf');
      if (fs.existsSync(joiningFormPath)) {
        attachments.push({ name: 'Joining_Form_Krishi_Care.pdf', content: fs.readFileSync(joiningFormPath).toString('base64') });
      }

      const hrFrom     = process.env.EMAIL_FROM_HR || process.env.EMAIL_FROM || process.env.SMTP_USER || 'no-reply@krishicare.in';
      const senderName = process.env.EMAIL_FROM_NAME_HR || 'Krishi Care & Management Services Pvt. Ltd.';
      const archive  = String(process.env.EMAIL_ARCHIVE_BCC || '').trim();
      const bccList  = [...bccRaw];
      if (archive && isValidEmail(archive) && !bccList.includes(archive)) bccList.push(archive);

      // Send via SMTP (nodemailer)
      if (!emailEnabled) {
        emit({ row: rowNum, name: candidateName, email: candidateEmail, status: 'sent (simulated)', reason: '' });
        continue;
      }

      const r = await emailSvc.sendRaw({
        from: { email: hrFrom, name: senderName },
        to: candidateEmail, toName: candidateName,
        replyTo: hrFrom, replyToName: senderName,
        subject: `Offer Letter — ${designation} | Krishi Care & Management Services`,
        html: coverHtml,
        cc: ccRaw, bcc: bccList,
        attachments,
      });
      if (r.ok) emit({ row: rowNum, name: candidateName, email: candidateEmail, status: 'sent', reason: r.messageId ? `msgId: ${r.messageId}` : '' });
      else emit({ row: rowNum, name: candidateName, email: candidateEmail, status: 'failed', reason: `SMTP: ${r.error}` });

      // Small delay between sends
      await new Promise(r => setTimeout(r, 300));
    }
    } finally {
      await browser.close();
      console.log('[bulkSend] Browser closed');
    }

    // Final summary line, then close the stream.
    res.write(JSON.stringify({ type: 'done', success: true, total, sent, failed, results }) + '\n');
    res.end();

  } catch (err) {
    console.error('[offerLetter.bulkSend]', err.message);
    // If we already started streaming, emit an error line; else send JSON.
    if (res.headersSent) {
      try { res.write(JSON.stringify({ type: 'error', message: err.message }) + '\n'); } catch (_) {}
      res.end();
    } else {
      res.status(500).json({ success: false, message: `Server error: ${err.message}` });
    }
  }
};

// Map one bulk-template row → an offer-letter object (shared by send + zip).
function rowToOffer(row, i) {
  const S = (...keys) => { for (const k of keys) { const v = row[k]; if (v !== undefined && String(v).trim() !== '') return String(v).trim(); } return ''; };
  const N = (...keys) => parseFloat(String(S(...keys)).replace(/,/g, '')) || 0;
  const name  = S('Candidate Name', 'candidate_name');
  const email = S('Email', 'email', 'candidate_email');
  const desig = S('Designation', 'designation');
  if (!name || !desig) return { error: 'Missing Candidate Name or Designation' };

  let joiningDate = null;
  const jdRaw = row['Joining Date'] || row['joining_date'] || '';
  if (jdRaw) {
    const d = jdRaw instanceof Date ? jdRaw : new Date(jdRaw);
    if (!isNaN(d)) joiningDate = new Date(Math.round(d.getTime() / 86400000) * 86400000).toISOString().split('T')[0];
  }
  const ol = {
    id: `zip_${i}`,
    candidate_name: name, candidate_email: email,
    candidate_address: S('Address', 'address'), candidate_mobile: S('Mobile', 'mobile'),
    designation: desig, location: S('Location', 'location') || 'Mumbai',
    joining_date: joiningDate, offer_date: null,
    offer_valid_days: parseInt(S('Offer Valid Days', 'offer_valid_days')) || 7,
    probation_months: parseInt(S('Probation Months', 'probation_months')) || 6,
    notice_period_months: parseInt(S('Notice Period Months', 'notice_period_months')) || 3,
    employee_code: S('Employee Code', 'employee_code'),
    ctc_annual: N('CTC', 'CTC Annual', 'ctc_annual'),
    basic_monthly: N('Basic Salary', 'Basic Monthly', 'basic_monthly'),
    hra_monthly: N('HRA', 'HRA Monthly', 'hra_monthly'),
    conveyance_monthly: N('Travel Allowance', 'Conveyance Monthly', 'conveyance_monthly'),
    other_allowance_monthly: N('Special Allowance', 'Other Allowance', 'other_allowance_monthly'),
    gratuity_monthly: N('Gratuity Monthly', 'gratuity_monthly'),
    pf_employee_monthly: N('PF Employee', 'pf_employee_monthly'),
    pf_employer_monthly: N('PF Employer', 'pf_employer_monthly'),
    pf_admin_monthly: N('PF Admin', 'pf_admin_monthly'),
    esi_employee_monthly: N('ESIC Employee', 'ESI Employee', 'esi_employee_monthly'),
    esi_employer_monthly: N('ESIC Employer', 'ESI Employer', 'esi_employer_monthly'),
    professional_tax_monthly: N('Professional Tax', 'professional_tax_monthly'),
    client_name: S('Client Name', 'Client', 'client_name') || null,
    custom_clauses: S('Custom Clauses', 'custom_clauses') || null,
    employment_type: (S('Employment Type', 'employment_type') || 'permanent').toLowerCase(),
    contract_months: parseInt(S('Contract Months', 'contract_months')) || 0,
    sig1_image: null, sig2_image: null, status: 'draft',
  };
  return { ol, name, email };
}

// ── POST /offer-letters/bulk-zip — offer + joining PDFs per candidate, as a ZIP
// No email is sent (bypasses the daily quota) — for manual sending.
exports.bulkZip = async (req, res) => {
  const XLSX = require('xlsx');
  try {
    if (!req.file) return res.status(400).json({ success: false, message: 'No Excel file uploaded' });
    const wb   = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const ws   = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    let hdrIdx = grid.findIndex(r => Array.isArray(r) && r.some(c => String(c || '').toLowerCase().includes('candidate name')));
    if (hdrIdx < 0) hdrIdx = 0;
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', range: hdrIdx });
    const nonEmpty = (r) => Object.keys(r).some(k => !/^(cc|bcc)$/i.test(k) && String(r[k]).trim() !== '');

    const joiningPath = path.join(__dirname, '..', 'assets', 'Joining_form_Krishi_Care.pdf');
    const joiningBuf  = fs.existsSync(joiningPath) ? fs.readFileSync(joiningPath) : null;

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="Offer_Letters_Bundle.zip"');
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (e) => { console.error('[bulkZip] archive', e.message); });
    archive.pipe(res);

    const browser = await launchBrowser();
    const used = {};
    const skipped = [];
    try {
      for (let i = 0; i < rows.length; i++) {
        if (!nonEmpty(rows[i])) continue;
        const parsed = rowToOffer(rows[i], i);
        if (parsed.error || !parsed.ol) { skipped.push(`Row ${i + 2}: ${parsed.error || 'invalid'}`); continue; }
        let pdf;
        try { pdf = await htmlToPdf(buildOfferLetterHTML(parsed.ol), browser); }
        catch (e) { skipped.push(`Row ${i + 2} (${parsed.name}): PDF failed — ${e.message}`); continue; }

        let folder = String(parsed.name || `Candidate_${i}`).replace(/[^A-Za-z0-9 _-]/g, '').trim().replace(/\s+/g, '_') || `Candidate_${i}`;
        if (used[folder]) folder = `${folder}_${++used[folder]}`; else used[folder] = 1;
        archive.append(pdf, { name: `${folder}/Offer_Letter_${folder}.pdf` });
        if (joiningBuf) archive.append(joiningBuf, { name: `${folder}/Joining_Form.pdf` });
      }
    } finally {
      await browser.close();
    }
    if (skipped.length) archive.append(skipped.join('\n'), { name: '_skipped.txt' });
    archive.finalize();
  } catch (err) {
    console.error('[offerLetter.bulkZip]', err.message);
    if (!res.headersSent) res.status(500).json({ success: false, message: err.message });
  }
};
