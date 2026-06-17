// utils/generateOfferLetterDocx.js
// Generates an offer letter DOCX by injecting content into the real Letterhead_New.docx template.

const fs     = require('fs');
const path   = require('path');
const AdmZip = require('adm-zip');

const LETTERHEAD_PATH = path.join(__dirname, '..', 'assets', 'Letterhead_New.docx');

// ── Helpers ───────────────────────────────────────────────────────────────────

function numberToWords(num) {
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
    'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen',
    'Seventeen','Eighteen','Nineteen'];
  const tens = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  if (num === 0) return 'Zero';
  if (num < 0) return 'Minus ' + numberToWords(-num);
  let words = '';
  if (Math.floor(num/10000000) > 0) { words += numberToWords(Math.floor(num/10000000)) + ' Crore '; num %= 10000000; }
  if (Math.floor(num/100000)   > 0) { words += numberToWords(Math.floor(num/100000))   + ' Lakh ';  num %= 100000;   }
  if (Math.floor(num/1000)     > 0) { words += numberToWords(Math.floor(num/1000))     + ' Thousand '; num %= 1000;  }
  if (Math.floor(num/100)      > 0) { words += numberToWords(Math.floor(num/100))      + ' Hundred '; num %= 100;   }
  if (num > 0) { words += num < 20 ? ones[num] + ' ' : tens[Math.floor(num/10)] + ' ' + ones[num%10] + ' '; }
  return words.trim();
}

function formatDate(d) {
  if (!d) return '';
  const dt = new Date(d);
  const day = dt.getDate();
  const months = ['January','February','March','April','May','June',
    'July','August','September','October','November','December'];
  const suffix = [,'st','nd','rd'][day] || 'th';
  return `${day}${suffix} ${months[dt.getMonth()]}, ${dt.getFullYear()}`;
}

// ── XML building blocks ───────────────────────────────────────────────────────

// Run properties — Times New Roman
function rPr(sz = 20, opts = {}) {
  const bold      = opts.bold      ? '<w:b/><w:bCs/>' : '';
  const underline = opts.underline ? '<w:u w:val="single"/>' : '';
  const sup       = opts.sup       ? '<w:vertAlign w:val="superscript"/>' : '';
  return `<w:rPr><w:rFonts w:ascii="Times New Roman" w:eastAsia="Calibri" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>${bold}${underline}${sup}<w:sz w:val="${sz}"/><w:szCs w:val="${sz}"/></w:rPr>`;
}

// Simple text run
function run(text, sz = 20, opts = {}) {
  const xml = text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  const preserve = (text.startsWith(' ') || text.endsWith(' ')) ? ' xml:space="preserve"' : '';
  return `<w:r>${rPr(sz, opts)}<w:t${preserve}>${xml}</w:t></w:r>`;
}

// Paragraph — default align is "both" (justified) to match the reference
function para(children, opts = {}) {
  // Default to justified unless explicitly overridden
  const alignVal = opts.align || 'both';
  const jc       = `<w:jc w:val="${alignVal}"/>`;
  const spacing  = opts.spacing
    ? `<w:spacing w:before="${opts.spacing.before||0}" w:after="${opts.spacing.after||80}" w:line="${opts.spacing.line||276}" w:lineRule="auto"/>`
    : '<w:spacing w:after="80" w:line="276" w:lineRule="auto"/>';
  const ind    = opts.indent ? `<w:ind w:left="${opts.indent.left||0}" w:right="${opts.indent.right||0}" w:hanging="${opts.indent.hanging||0}"/>` : '';
  const numPr  = opts.numId  ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${opts.numId}"/></w:numPr>` : '';
  const pPrRpr = opts.pPrRpr || '';
  return `<w:p><w:pPr>${numPr}${spacing}${ind}${jc}${pPrRpr}</w:pPr>${children}</w:p>`;
}

// Empty spacer paragraph
function emptyPara(before = 0, after = 80) {
  return `<w:p><w:pPr><w:spacing w:before="${before}" w:after="${after}" w:line="276" w:lineRule="auto"/></w:pPr></w:p>`;
}

// Table cell — tcW must be first in tcPr
function cell(children, w, opts = {}) {
  const borders = opts.noBorders
    ? `<w:tcBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/></w:tcBorders>`
    : '';
  const vAlign = opts.vAlign ? `<w:vAlign w:val="${opts.vAlign}"/>` : '';
  return `<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>${borders}${vAlign}</w:tcPr>${children}</w:tc>`;
}

function tableRow(cells, opts = {}) {
  const hdr = opts.header ? '<w:trPr><w:tblHeader/></w:trPr>' : '';
  return `<w:tr>${hdr}${cells}</w:tr>`;
}

function table(rows, widths, opts = {}) {
  const totalW = widths.reduce((a,b)=>a+b,0);
  const tblBorders = opts.borders ||
    `<w:tblBorders>
       <w:top    w:val="single" w:sz="6" w:space="0" w:color="000000"/>
       <w:left   w:val="single" w:sz="6" w:space="0" w:color="000000"/>
       <w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>
       <w:right  w:val="single" w:sz="6" w:space="0" w:color="000000"/>
       <w:insideH w:val="single" w:sz="6" w:space="0" w:color="000000"/>
       <w:insideV w:val="single" w:sz="6" w:space="0" w:color="000000"/>
     </w:tblBorders>`;
  const cols = widths.map(w=>`<w:gridCol w:w="${w}"/>`).join('');
  return `<w:tbl>
    <w:tblPr>
      <w:tblW w:w="${totalW}" w:type="dxa"/>
      <w:jc w:val="${opts.align||'left'}"/>
      ${tblBorders}
      <w:tblCellMar>
        <w:top    w:w="80"  w:type="dxa"/>
        <w:left   w:w="120" w:type="dxa"/>
        <w:bottom w:w="80"  w:type="dxa"/>
        <w:right  w:w="120" w:type="dxa"/>
      </w:tblCellMar>
    </w:tblPr>
    <w:tblGrid>${cols}</w:tblGrid>
    ${rows}
  </w:tbl>`;
}

const PAGE_BREAK = `<w:p><w:r><w:rPr/><w:br w:type="page"/></w:r></w:p>`;

// ── Body builder ──────────────────────────────────────────────────────────────

function buildBodyXml(ol) {
  const basic    = parseFloat(ol.basic_monthly             || 0);
  const hra      = parseFloat(ol.hra_monthly               || 0);
  const conv     = parseFloat(ol.conveyance_monthly        || 0);
  const other    = parseFloat(ol.other_allowance_monthly   || 0);
  const gratuity = parseFloat(ol.gratuity_monthly          || 0);
  const pfEmp    = parseFloat(ol.pf_employee_monthly       || 0);
  const pfEmpr   = parseFloat(ol.pf_employer_monthly       || 0);
  const pfAdmin  = parseFloat(ol.pf_admin_monthly          || 0);
  const pt       = parseFloat(ol.professional_tax_monthly  || 0);

  const gross      = basic + hra + conv + other + gratuity;
  const totalDed   = pfEmp + pt;
  const netSalary  = gross - totalDed;
  const ctcMonthly = gross + pfEmpr + pfAdmin;
  const ctcAnnual  = parseFloat(ol.ctc_annual || (ctcMonthly * 12));

  const fmtV = v => Number(Math.round(v)).toLocaleString('en-IN');
  const DASH = '\u2013';

  const probWords   = {3:'three',6:'six',12:'twelve'};
  const noticeWords = {1:'one',2:'two',3:'three',6:'six'};
  const probStr   = probWords[ol.probation_months]      || `${ol.probation_months  ||6}`;
  const noticeStr = noticeWords[ol.notice_period_months]|| `${ol.notice_period_months||3}`;

  const offerDateStr = formatDate(ol.offer_date || new Date());

  // Joining date with superscript ordinal
  let joiningRuns = '';
  if (ol.joining_date) {
    const dt  = new Date(ol.joining_date);
    const day = dt.getDate();
    const mos = ['January','February','March','April','May','June',
                 'July','August','September','October','November','December'];
    const sup = [,'st','nd','rd'][day] || 'th';
    joiningRuns = run(' as from ', 20, {bold:true})
      + run(String(day), 20, {bold:true})
      + run(sup, 20, {bold:true, sup:true})
      + run(` ${mos[dt.getMonth()]} ${dt.getFullYear()}`, 20, {bold:true});
  }

  // Candidate first name (strip titles)
  const firstName = ol.candidate_name.split(' ')
    .filter(w => !['Mr.','Ms.','Mrs.','Dr.'].includes(w))[0] || ol.candidate_name;

  const SP = {before:0, after:80, line:276};   // standard paragraph spacing
  const S0 = {before:0, after:0,  line:276};   // tight spacing
  const SH = {before:120,after:40,line:276};   // section heading spacing

  const parts = [];

  // ── Date line (right-aligned) ─────────────────────────────────────────────
  parts.push(para(run(offerDateStr, 20, {bold:true}),
    {align:'right', spacing:{before:0,after:80,line:276}}));

  // ── Candidate block ───────────────────────────────────────────────────────
  parts.push(para(run(ol.candidate_name, 20, {bold:true}),
    {align:'left', spacing:{before:80,after:0,line:276}}));
  if (ol.candidate_address) {
    for (const line of ol.candidate_address.split('\n')) {
      if (line.trim())
        parts.push(para(run(line.trim(), 20), {align:'left', spacing:S0}));
    }
  }
  parts.push(emptyPara(40, 40));

  // Employee code / mob / email (left-aligned, not justified)
  if (ol.employee_code)
    parts.push(para(run(`Employee Code ${DASH} ${ol.employee_code}`, 20, {bold:true}),
      {align:'left', spacing:S0}));
  if (ol.candidate_mobile)
    parts.push(para(run(`Mob ${DASH} ${ol.candidate_mobile}`, 20, {bold:true}),
      {align:'left', spacing:S0}));
  if (ol.candidate_email)
    parts.push(para(run(`Email ${DASH} ${ol.candidate_email}`, 20, {bold:true}),
      {align:'left', spacing:{before:0,after:80,line:276}}));

  // ── Salutation ────────────────────────────────────────────────────────────
  parts.push(para(run(`Dear ${firstName},`, 20),
    {align:'left', spacing:{before:80,after:80,line:276}}));

  // ── Subject line — indented center like reference ─────────────────────────
  parts.push(para(
    run(`Sub: Letter of offer/Appointment for the position of \u201C${ol.designation}\u201D`,
        20, {bold:true, underline:true}),
    {align:'center', spacing:{before:40,after:100,line:276}}
  ));

  // ── Body paragraphs (all justified) ───────────────────────────────────────
  parts.push(para(
    run('In reference to our discussions, we are pleased to offer you the position of ', 20)
    + run(`\u201C${ol.designation}\u201D`, 20, {bold:true})
    + run(' in Krishi Care & Management Services Private Limited to be based at our ', 20)
    + run(`${ol.location||'Mumbai'} Office`, 20, {bold:true})
    + (ol.joining_date ? joiningRuns : run('', 20))
    + run('.', 20),
    {spacing:SP}
  ));

  parts.push(para(
    run('The offer letter is valid for ', 20)
    + run(`${ol.offer_valid_days||7} days`, 20, {bold:true})
    + run(' by which time we must be informed of your decision; the said offer letter shall stand cancelled after the above-mentioned date.', 20),
    {spacing:SP}
  ));

  parts.push(para(
    run('We are pleased to issue this letter of offer on the following terms & conditions:', 20),
    {spacing:SP}
  ));

  // Helper: section heading + body paragraph
  function section(heading, body) {
    parts.push(para(run(heading, 20, {bold:true, underline:true}), {align:'left', spacing:SH}));
    parts.push(para(run(body, 20), {spacing:SP}));
  }

  // EMOLUMENTS
  parts.push(para(run('EMOLUMENTS:', 20, {bold:true, underline:true}), {align:'left', spacing:SH}));
  parts.push(para(
    run('Your compensation on a cost to company basis will be ', 20)
    + run(`Rs. ${Number(ctcAnnual).toLocaleString('en-IN')}/- PA (Rupees ${numberToWords(Math.round(ctcAnnual))} Only)`, 20, {bold:true})
    + run('. The remuneration has taken into consideration the status and responsibility of the appointment, and it is inclusive of all taxable and non-taxable emoluments, allowances and statutory contributions.', 20),
    {spacing:SP}
  ));

  section('RESPONSIBILITIES:',
    `You will work as \u201C${ol.designation}\u201D of the Company and will be responsible for carrying out the operations of the Company as directed to you by the management. A detailed responsibility statement will be provided to you upon your joining.`
  );

  section('PROBATION PERIOD:',
    `You will be on a probationary period of ${probStr} months during which the services can be terminated from employer without giving any reason and any time for notice of termination of services. The company may regularize your services subject to satisfactory completion of probationary period.`
  );

  section('SEPERATION OF SERVICES:',
    `Severance of relationship can be done by giving ${noticeStr} month written notice. If you are unable to complete this notice period you will be liable to compensate the company ${noticeStr} months of salary or for the period not served.`
  );

  if (ol.custom_clauses) {
    parts.push(para(run('ADDITIONAL TERMS:', 20, {bold:true, underline:true}), {align:'left', spacing:SH}));
    parts.push(para(run(ol.custom_clauses, 20), {spacing:SP}));
  }

  // OTHER RULES — pageBreakBefore forces new page; spacing.before=828 adds 3-line gap under header
  parts.push('<w:p><w:pPr>' +
    '<w:pageBreakBefore/>' +
    '<w:spacing w:before="828" w:after="40" w:line="276" w:lineRule="auto"/>' +
    '<w:jc w:val="left"/>' +
    '</w:pPr>' +
    run('OTHER RULES AND REGULATION:', 20, {bold:true, underline:true}) +
    '</w:p>');
  parts.push(para(
    run('The company will expect you to work in the Section / Department in which you are placed with a high standard of initiative, morality and economy.', 20),
    {spacing:{before:0,after:60,line:276}}
  ));

  // Bullet items — justified text, proper indent
  const bulletItems = [
    'You will, in all respects, be governed by the company\u2019s rules and regulations',
    'You will devote full time to the work of the Company and will not undertake any direct / indirect outside business or work, honorary or remunerative except with the prior written consent of the Management.',
    'You will abide by Leave Rules of company.',
    'You have been engaged on the presumption that the particulars furnished by you in your application are correct. In case the said particular are found to be incorrect or that you have concealed or withheld information or the relevant facts, the services can be terminated from the company without giving any reason and any time for notice of termination of services. The company may regularize your services subject to satisfactory completion of period.',
    'You will not, either during the period of your services of thereafter, disclose divulge or communicate to any other person or group or company any strategic information of the organization or its clients.',
    'All correspondence addressed to you by the company including press and other copies of such correspondence and all vouchers, books, records, including all note books containing notes or records of business or prices or other market data, samples and/or other papers belonging to the company, circulars and all other relevant papers and  documents of any nature whatsoever relating to the company\u2019s business, which shall come into your possession in the course of your employment shall be the absolute property of the company and you shall, at any time during your employment or upon termination there for any reason whatsoever, deliver the same to the company and without claiming any lien thereon.',
    'You will be responsible for the safe keeping and for returning in good condition and order, all on your own the company\u2019s property which may be in your use, custody, care or charge. The company shall have the right to deduct the monetary value of all such things from any amounts payable to you and to take such actions as may be deemed proper in the event of your failure to account for such property to the satisfaction of the management.',
    'You will keep us informed of your residential (mailing & permanent) address. Any change in the same should be notified in writing within one week. Failure to do so will be treated as willful withholding of information and appropriate action as deemed fit by management would be taken against you.',
  ];

  for (const item of bulletItems) {
    parts.push(para(
      run(item, 20),
      {
        numId: 1,
        // Justified — bullets in reference are also justified
        align: 'both',
        indent: {left:360, hanging:180},
        spacing: {before:0, after:80, line:276}
      }
    ));
  }

  parts.push(emptyPara(60, 40));

  // Acceptance paragraph (bold, justified)
  parts.push(para(
    run('If you are willing to accept this offer for the said position, we request you to submit 3 copies of your latest coloured Passport Size photograph, Self-attested Copy of your academic qualification, Self-attested copy of your PAN Card, Self-attested copy of your Aadhar Card, Self-attested Copy of Address Proof, and last 3 month Pay Slip / Form 16 from your previous employer. In addition, upon joining, you will have to submit a copy of your relieving letter from your previous employer.', 20, {bold:true}),
    {spacing:SP}
  ));

  parts.push(emptyPara(40, 40));

  parts.push(para(
    run('As a token of your acceptance and in confirmation of the terms and conditions of this offer, please sign the duplicate copy of this letter and return to us at the earliest duly intimating when you are going to join.', 20),
    {spacing:{before:0,after:120,line:276}}
  ));

  parts.push(emptyPara(40,40));

  // Sign-off (left-aligned like reference)
  parts.push(para(run('Yours truly,', 20), {align:'left', spacing:{before:0,after:40,line:276}}));
  parts.push(para(
    run('From ', 20) + run('Krishi Care & Management Services Private Limited,', 20, {bold:true}),
    {align:'left', spacing:{before:0,after:0,line:276}}
  ));

  parts.push(emptyPara(200, 0));

  // ── Signature row (2-column, no borders, left-aligned) ───────────────────
  const sigLeft  = cell(
    emptyPara(480, 0)
    + para(run('Authorized Signatory', 20), {align:'left', spacing:{before:40,after:0,line:276}}),
    4500, {noBorders:true}
  );
  const sigRight = cell(
    emptyPara(480, 0)
    + para(run('(Authorized Signatory)', 20), {align:'right', spacing:{before:40,after:0,line:276}})
    + para(run('Human Resource', 20),         {align:'right', spacing:{before:0, after:0, line:276}}),
    4500, {noBorders:true}
  );
  parts.push(table(tableRow(sigLeft + sigRight), [4500,4500], {
    align: 'left',
    borders: `<w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders>`
  }));

  // ════════════════════════════════════════════════════════════════
  // PAGE BREAK → ANNEXURE
  // ════════════════════════════════════════════════════════════════
  parts.push(PAGE_BREAK);

  // 3 blank lines after page break (space below header)
  parts.push(emptyPara(0,0));
  parts.push(emptyPara(0,0));
  parts.push(emptyPara(0,0));

  // Annexure title
  parts.push(para(
    run('Annexure I (Annual Cost to Company and Other Benefits)', 20, {bold:true}),
    {align:'center', spacing:{before:60,after:100,line:276}}
  ));

  // Annexure meta — plain text, left-aligned, like reference
  parts.push(para(run(`Name: ${ol.candidate_name}`, 20),
    {align:'left', spacing:{before:0,after:0,line:276}}));
  parts.push(para(run(`Designation: ${ol.designation}`, 20),
    {align:'left', spacing:{before:0,after:0,line:276}}));
  parts.push(para(run(`Location: ${ol.location||'Mumbai'}`, 20),
    {align:'left', spacing:{before:0,after:60,line:276}}));
  parts.push(emptyPara(0, 0));
  parts.push(para(
    run(`Annual Cost to Company ${DASH} Rs.${Number(ctcAnnual).toLocaleString('en-IN')} (Rupees ${numberToWords(Math.round(ctcAnnual))} Only)`, 20, {bold:true}),
    {align:'left', spacing:{before:0,after:100,line:276}}
  ));

  // ── Salary table — full content width, matching reference proportions ──────
  // Content width for A4 with 1" margins = 11906 - 2×1440 = 9026 twips
  const TW = 9026;
  const W_SR   = 720;          // Sr. No.
  const W_PART = TW - 720 - 1440 - 1440;  // Particulars (fills middle)
  const W_MON  = 1440;         // Monthly
  const W_YR   = 1440;         // Yearly
  const annWids = [W_SR, W_PART, W_MON, W_YR];

  const TH  = (txt, w) => cell(
    para(run(txt, 18, {bold:true}), {align:'center', spacing:{before:40,after:40,line:240}}), w);
  const TDC = (txt, w, bold=false) => cell(
    para(run(txt, 18, {bold}), {align:'center', spacing:{before:40,after:40,line:240}}), w);
  const TDL = (txt, w, bold=false) => cell(
    para(run(txt, 18, {bold}), {align:'left',   spacing:{before:40,after:40,line:240}}), w);
  const TDR = (txt, w, bold=false) => cell(
    para(run(txt, 18, {bold}), {align:'right',  spacing:{before:40,after:40,line:240}}), w);

  let tblRows = tableRow(
    TH('Sr. No.', W_SR) + TH('Particulars', W_PART) + TH('Monthly', W_MON) + TH('Yearly', W_YR),
    {header:true}
  );

  const salaryRows = [
    ['1',  'Fixed Basic',                         fmtV(basic),                        fmtV(basic*12)],
    ['2',  'HRA',                                 fmtV(hra),                          fmtV(hra*12)],
    ...(conv > 0 ? [['2a','Conveyance Allowances',fmtV(conv),                         fmtV(conv*12)]] : []),
    ['3',  'Other Allowances',                    fmtV(other),                        fmtV(other*12)],
    ['4',  'Gratuity',                            fmtV(gratuity),                     fmtV(gratuity*12)],
    ['5',  'Gross Pay',                           fmtV(gross),                        fmtV(gross*12),  true],
    ['6',  'Provident Fund',                      pfEmp>0 ? fmtV(pfEmp)  : DASH,      pfEmp>0 ? fmtV(pfEmp*12)  : DASH],
    ['7',  'Professional Tax',                    pt>0    ? fmtV(pt)     : DASH,      pt>0    ? fmtV(pt*12)     : DASH],
    ['8',  'Total Deduction',                     totalDed>0?fmtV(totalDed):DASH,     totalDed>0?fmtV(totalDed*12):DASH, true],
    ['9',  'Net Salary (Gross - Total Deduction)',fmtV(netSalary),                    fmtV(netSalary*12), true],
    ['10', 'Employer PF contribution',            pfEmpr>0 ? fmtV(pfEmpr) : DASH,    pfEmpr>0 ? fmtV(pfEmpr*12) : DASH],
    ['11', 'Employer PF contribution Admin charges', pfAdmin>0?fmtV(pfAdmin):DASH,   pfAdmin>0?fmtV(pfAdmin*12):DASH],
    ['12', 'Total Compensation Package',          fmtV(ctcMonthly),                  fmtV(ctcAnnual), true],
  ];

  for (const [sr, label, monthly, yearly, bold=false] of salaryRows) {
    tblRows += tableRow(TDC(sr,W_SR,bold) + TDL(label,W_PART,bold) + TDR(monthly,W_MON,bold) + TDR(yearly,W_YR,bold));
  }

  parts.push(table(tblRows, annWids, {align:'left'}));
  parts.push(emptyPara(80,80));

  // ── Acknowledgement ───────────────────────────────────────────────────────
  parts.push(para(run('Acknowledgement & Acceptance', 20, {bold:true, underline:true}),
    {align:'left', spacing:{before:60,after:60,line:276}}));
  parts.push(para(
    run('I have read understood, agree to the above terms and conditions, and hereby sign my acceptance of the same.', 20),
    {align:'left', spacing:{before:0,after:100,line:276}}
  ));

  // Ack table — 4 columns: label | underline-field | label | underline-field
  // Fixed widths so "Location:" never wraps
  const A_LBL1 = 1300;  // "Signature:" label
  const A_FLD1 = 2500;  // first field
  const A_LBL2 = 1300;  // "Date:" / "Location:" label
  const A_FLD2 = 3926;  // second field (fills rest)
  const ackTotal = A_LBL1 + A_FLD1 + A_LBL2 + A_FLD2;  // = 9026

  const lblCell  = (txt, w) => `<w:tc>
    <w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>
      <w:tcBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/></w:tcBorders>
    </w:tcPr>
    ${para(run(txt, 20, {bold:true}), {align:'left', spacing:{before:0,after:0,line:276}})}
  </w:tc>`;

  const fldCell  = (w) => `<w:tc>
    <w:tcPr><w:tcW w:w="${w}" w:type="dxa"/>
      <w:tcBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/><w:right w:val="none"/></w:tcBorders>
    </w:tcPr>
    ${para(run(' ', 20), {align:'left', spacing:{before:200,after:0,line:240}})}
  </w:tc>`;

  const ackRow1 = `<w:tr>${lblCell('Signature:',A_LBL1)}${fldCell(A_FLD1)}${lblCell('Date:',A_LBL2)}${fldCell(A_FLD2)}</w:tr>`;
  const ackRow2 = `<w:tr>${lblCell('Name:',A_LBL1)}${fldCell(A_FLD1)}${lblCell('Location:',A_LBL2)}${fldCell(A_FLD2)}</w:tr>`;

  parts.push(table(ackRow1 + ackRow2, [A_LBL1,A_FLD1,A_LBL2,A_FLD2], {
    align: 'left',
    borders: `<w:tblBorders><w:top w:val="none"/><w:left w:val="none"/><w:bottom w:val="none"/><w:right w:val="none"/><w:insideH w:val="none"/><w:insideV w:val="none"/></w:tblBorders>`
  }));

  return parts.join('\n');
}

// ── Numbering XML ─────────────────────────────────────────────────────────────
const NUMBERING_XML = `<?xml version="1.0" encoding="utf-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="0">
    <w:multiLevelType w:val="hybridMultilevel"/>
    <w:lvl w:ilvl="0">
      <w:start w:val="1"/>
      <w:numFmt w:val="bullet"/>
      <w:lvlText w:val="&#x2022;"/>
      <w:lvlJc w:val="left"/>
      <w:pPr><w:ind w:left="360" w:hanging="180"/></w:pPr>
      <w:rPr><w:rFonts w:ascii="Symbol" w:hAnsi="Symbol" w:hint="default"/></w:rPr>
    </w:lvl>
  </w:abstractNum>
  <w:num w:numId="1">
    <w:abstractNumId w:val="0"/>
  </w:num>
</w:numbering>`;

// ── Main export ───────────────────────────────────────────────────────────────

async function generateOfferLetterDocx(ol) {
  if (!fs.existsSync(LETTERHEAD_PATH)) {
    throw new Error(`Letterhead template not found at: ${LETTERHEAD_PATH}`);
  }

  const zip = new AdmZip(LETTERHEAD_PATH);

  const bodyContent = buildBodyXml(ol);

  const SECTION_PR = `<w:sectPr w:rsidR="008F08D6" w:rsidRPr="003245E9" w:rsidSect="003245E9">
      <w:headerReference w:type="default" r:id="rId9"/>
      <w:footerReference w:type="default" r:id="rId10"/>
      <w:pgSz w:w="11906" w:h="16838" w:code="9"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="397" w:footer="113" w:gutter="0"/>
      <w:cols w:space="708"/>
      <w:docGrid w:linePitch="360"/>
    </w:sectPr>`;

  const origDocEntry = zip.getEntry('word/document.xml');
  const origDocXml   = origDocEntry.getData().toString('utf8');
  const docOpenMatch = origDocXml.match(/^(<w:document[^>]*>)/);
  const docOpen = docOpenMatch ? docOpenMatch[1]
    : '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';

  const newDocXml = `<?xml version="1.0" encoding="UTF-8"?>${docOpen}
  <w:body>
${bodyContent}
    ${SECTION_PR}
  </w:body>
</w:document>`;

  zip.updateFile('word/document.xml', Buffer.from(newDocXml, 'utf8'));

  const numEntry = zip.getEntry('word/numbering.xml');
  if (numEntry) {
    zip.updateFile('word/numbering.xml', Buffer.from(NUMBERING_XML, 'utf8'));
  } else {
    zip.addFile('word/numbering.xml', Buffer.from(NUMBERING_XML, 'utf8'));
    const relsEntry = zip.getEntry('word/_rels/document.xml.rels');
    if (relsEntry) {
      let relsXml = relsEntry.getData().toString('utf8');
      if (!relsXml.includes('numbering')) {
        relsXml = relsXml.replace('</Relationships>',
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>\n</Relationships>');
        zip.updateFile('word/_rels/document.xml.rels', Buffer.from(relsXml, 'utf8'));
      }
    }
  }

  return zip.toBuffer();
}

module.exports = { generateOfferLetterDocx };
