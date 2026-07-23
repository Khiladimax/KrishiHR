// src/controllers/pfcController.js
// PFC (rented field offices) register — import, list, monthly rent-paid tracking,
// and "agreement ending" alerts to HR + Accounts.
const db     = require('../config/db');
const XLSX   = require('xlsx');
const multer = require('multer');
const emailSvc = require('../config/emailService');

const HR_ROLES = ['hr', 'accounts', 'admin', 'super_admin'];

exports.uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => /\.(xlsx|xls|csv)$/.test(file.originalname.toLowerCase()) ? cb(null, true) : cb(new Error('Only Excel/CSV allowed')),
}).single('file');

let schemaReady = false;
async function ensureSchema() {
  if (schemaReady) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS pfc_agreements (
      id            SERIAL PRIMARY KEY,
      sr_no         INTEGER,
      district      TEXT,
      taluka        TEXT,
      owner_name    TEXT,
      mobile_no     TEXT,
      office_address TEXT,
      owner_address  TEXT,
      advance       NUMERIC(12,2) DEFAULT 0,
      month_rent    NUMERIC(12,2) DEFAULT 0,
      aadhar        TEXT,
      pan           TEXT,
      bank_name     TEXT,
      account_no    TEXT,
      ifsc          TEXT,
      branch        TEXT,
      agreement_start DATE,
      agreement_end   DATE,
      contact_person  TEXT,
      contact_no      TEXT,
      last_notified   DATE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await db.query(`ALTER TABLE pfc_agreements ADD COLUMN IF NOT EXISTS contact_person TEXT`).catch(() => {});
  await db.query(`ALTER TABLE pfc_agreements ADD COLUMN IF NOT EXISTS contact_no TEXT`).catch(() => {});
  // Assets allocated to each PFC office (chair, table, laptop, sign board, …).
  await db.query(`
    CREATE TABLE IF NOT EXISTS pfc_assets (
      id         SERIAL PRIMARY KEY,
      pfc_id     INTEGER NOT NULL REFERENCES pfc_agreements(id) ON DELETE CASCADE,
      item_name  TEXT NOT NULL,
      quantity   INTEGER NOT NULL DEFAULT 1,
      serial_no  TEXT,
      remark     TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
  await db.query(`
    CREATE TABLE IF NOT EXISTS pfc_rent_payments (
      id       SERIAL PRIMARY KEY,
      pfc_id   INTEGER NOT NULL REFERENCES pfc_agreements(id) ON DELETE CASCADE,
      year     INTEGER NOT NULL,
      month    INTEGER NOT NULL,
      paid     BOOLEAN NOT NULL DEFAULT false,
      paid_at  TIMESTAMPTZ,
      paid_by  INTEGER,
      remark   TEXT,
      UNIQUE(pfc_id, year, month)
    )`);
  schemaReady = true;
}

const canManage = (u) => HR_ROLES.includes(String(u.role || '').toLowerCase());

// Excel serial or Date/string → 'YYYY-MM-DD' (rounded to nearest day for IST-authored cells).
function toISODate(v) {
  if (v === null || v === undefined || v === '') return null;
  let d;
  if (v instanceof Date) d = v;
  else if (typeof v === 'number') d = new Date(Math.round((v - 25569) * 86400000));
  else { d = new Date(v); if (isNaN(d)) return null; }
  const r = new Date(Math.round(d.getTime() / 86400000) * 86400000);
  return isNaN(r) ? null : r.toISOString().split('T')[0];
}
const S = (v) => (v === null || v === undefined) ? null : String(v).trim() || null;
const N = (v) => { const n = parseFloat(String(v ?? '').replace(/[,\s₹]/g, '')); return isNaN(n) ? 0 : n; };

// ── POST /pfc/import ──────────────────────────────────────────────────────────
exports.importPFC = async (req, res) => {
  try {
    await ensureSchema();
    if (!canManage(req.user)) return res.status(403).json({ success: false, message: 'Access denied' });
    if (!req.file) return res.status(400).json({ success: false, message: 'Excel file required' });

    const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });
    // header row = one containing "owner"
    let hi = grid.findIndex(r => Array.isArray(r) && r.some(c => String(c || '').toLowerCase().includes('owner')));
    if (hi < 0) hi = 0;
    const rows = XLSX.utils.sheet_to_json(ws, { defval: '', range: hi });

    const col = (row, ...keys) => { for (const k of Object.keys(row)) { const kn = k.toLowerCase().replace(/[^a-z]/g, ''); for (const want of keys) if (kn.includes(want)) return row[k]; } return ''; };

    let imported = 0, updated = 0;
    for (const row of rows) {
      const owner = S(col(row, 'ownername', 'owner')) || S(row['OWNER NAME']);
      if (!owner) continue;
      const rec = {
        sr_no: parseInt(col(row, 'srno', 'sr')) || null,
        district: S(col(row, 'dist')),
        taluka: S(col(row, 'taluka')),
        owner_name: owner,
        mobile_no: S(col(row, 'mono', 'mobile', 'phone')),
        office_address: S(col(row, 'officeaddress', 'office')),
        owner_address: S(col(row, 'owneraddress')),
        advance: N(col(row, 'advance')),
        month_rent: N(col(row, 'monthrent', 'rent')),
        aadhar: S(col(row, 'adhar', 'aadhar', 'aadhaar')),
        pan: S(col(row, 'pancard', 'pan')),
        bank_name: S(col(row, 'bankname')),
        account_no: S(col(row, 'accountno', 'account')),
        ifsc: S(col(row, 'ifsc')),
        branch: S(col(row, 'branch')),
        agreement_start: toISODate(col(row, 'agreementstart', 'startdate', 'start')),
        agreement_end: toISODate(col(row, 'agreementend', 'enddate', 'end')),
        contact_person: S(col(row, 'contactperson', 'contactname')),
        contact_no: S(col(row, 'contactno', 'contactnumber', 'contact')),
      };
      // Upsert by (owner_name + taluka) — a PFC is one office per owner per taluka.
      const existing = await db.query('SELECT id FROM pfc_agreements WHERE LOWER(owner_name)=LOWER($1) AND COALESCE(LOWER(taluka),\'\')=COALESCE(LOWER($2),\'\')', [rec.owner_name, rec.taluka]);
      if (existing.rows.length) {
        await db.query(`UPDATE pfc_agreements SET sr_no=$1,district=$2,taluka=$3,owner_name=$4,mobile_no=$5,office_address=$6,owner_address=$7,advance=$8,month_rent=$9,aadhar=$10,pan=$11,bank_name=$12,account_no=$13,ifsc=$14,branch=$15,agreement_start=$16,agreement_end=$17,contact_person=COALESCE($18,contact_person),contact_no=COALESCE($19,contact_no),updated_at=now() WHERE id=$20`,
          [rec.sr_no, rec.district, rec.taluka, rec.owner_name, rec.mobile_no, rec.office_address, rec.owner_address, rec.advance, rec.month_rent, rec.aadhar, rec.pan, rec.bank_name, rec.account_no, rec.ifsc, rec.branch, rec.agreement_start, rec.agreement_end, rec.contact_person, rec.contact_no, existing.rows[0].id]);
        updated++;
      } else {
        await db.query(`INSERT INTO pfc_agreements (sr_no,district,taluka,owner_name,mobile_no,office_address,owner_address,advance,month_rent,aadhar,pan,bank_name,account_no,ifsc,branch,agreement_start,agreement_end,contact_person,contact_no) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
          [rec.sr_no, rec.district, rec.taluka, rec.owner_name, rec.mobile_no, rec.office_address, rec.owner_address, rec.advance, rec.month_rent, rec.aadhar, rec.pan, rec.bank_name, rec.account_no, rec.ifsc, rec.branch, rec.agreement_start, rec.agreement_end, rec.contact_person, rec.contact_no]);
        imported++;
      }
    }
    res.json({ success: true, message: `${imported} added, ${updated} updated`, imported, updated });
  } catch (err) {
    console.error('[pfc/import]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /pfc?month=&year= — list with this month's paid status + expiring flag ─
exports.list = async (req, res) => {
  try {
    await ensureSchema();
    if (!canManage(req.user)) return res.status(403).json({ success: false, message: 'Access denied' });
    const m = parseInt(req.query.month) || new Date().getMonth() + 1;
    const y = parseInt(req.query.year)  || new Date().getFullYear();
    const r = await db.query(`
      SELECT a.*,
             TO_CHAR(a.agreement_start, 'YYYY-MM-DD') AS agreement_start,
             TO_CHAR(a.agreement_end,   'YYYY-MM-DD') AS agreement_end,
             p.paid AS paid_this_month, p.paid_at,
             (SELECT COALESCE(SUM(quantity),0) FROM pfc_assets WHERE pfc_id = a.id) AS asset_count,
             (a.agreement_end IS NOT NULL AND a.agreement_end <= (CURRENT_DATE + INTERVAL '31 days')) AS expiring_soon,
             (a.agreement_end IS NOT NULL AND a.agreement_end < CURRENT_DATE) AS expired
        FROM pfc_agreements a
        LEFT JOIN pfc_rent_payments p ON p.pfc_id = a.id AND p.year = $1 AND p.month = $2
       ORDER BY a.sr_no NULLS LAST, a.taluka`, [y, m]);
    res.json({ success: true, data: r.rows, month: m, year: y });
  } catch (err) {
    console.error('[pfc/list]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /pfc/pay — mark a PFC's rent paid/unpaid for a month ──────────────────
exports.setPaid = async (req, res) => {
  try {
    await ensureSchema();
    if (!canManage(req.user)) return res.status(403).json({ success: false, message: 'Access denied' });
    const pfcId = parseInt(req.body.pfc_id);
    const y = parseInt(req.body.year), m = parseInt(req.body.month);
    const paid = !(req.body.paid === false || req.body.paid === 'false');
    if (!pfcId || !y || !m) return res.status(400).json({ success: false, message: 'pfc_id, year, month required' });
    await db.query(`
      INSERT INTO pfc_rent_payments (pfc_id, year, month, paid, paid_at, paid_by)
        VALUES ($1,$2,$3,$4, CASE WHEN $4 THEN now() ELSE NULL END, $5)
      ON CONFLICT (pfc_id, year, month) DO UPDATE
        SET paid=$4, paid_at=CASE WHEN $4 THEN now() ELSE NULL END, paid_by=$5`,
      [pfcId, y, m, paid, parseInt(req.user.id)]);
    res.json({ success: true, paid });
  } catch (err) {
    console.error('[pfc/setPaid]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /pfc/notify-expiring — email HR + Accounts about PFCs in their last month
// Only notifies each PFC once per ~25 days (last_notified guard). Safe to call on
// page load. Returns how many alerts were sent.
exports.notifyExpiring = async (req, res) => {
  try {
    await ensureSchema();
    if (!canManage(req.user)) return res.status(403).json({ success: false, message: 'Access denied' });
    const due = await db.query(`
      SELECT *, TO_CHAR(agreement_end, 'YYYY-MM-DD') AS agreement_end FROM pfc_agreements
       WHERE agreement_end IS NOT NULL
         AND agreement_end <= (CURRENT_DATE + INTERVAL '31 days')
         AND agreement_end >= CURRENT_DATE
         AND (last_notified IS NULL OR last_notified < CURRENT_DATE - INTERVAL '25 days')
       ORDER BY agreement_end`);
    if (!due.rows.length) return res.json({ success: true, notified: 0 });

    const recips = await db.query(`SELECT DISTINCT email, first_name FROM employees WHERE role IN ('hr','accounts') AND is_active=true AND email IS NOT NULL AND email LIKE '%@%'`);
    const rows = due.rows.map(a => `<tr><td style="padding:6px 10px;border:1px solid #ddd">${a.owner_name}</td><td style="padding:6px 10px;border:1px solid #ddd">${a.taluka||''}</td><td style="padding:6px 10px;border:1px solid #ddd">₹${a.month_rent}</td><td style="padding:6px 10px;border:1px solid #ddd;color:#c62828;font-weight:700">${a.agreement_end}</td></tr>`).join('');
    const html = `<p>The following PFC office rent agreement(s) are in their <b>last month</b> and will end soon. Please plan renewal:</p>
      <table style="border-collapse:collapse;font-size:13px"><tr style="background:#f2f2f2"><th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Owner</th><th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Taluka</th><th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Monthly Rent</th><th style="padding:6px 10px;border:1px solid #ddd;text-align:left">Agreement Ends</th></tr>${rows}</table>`;

    for (const rcp of recips.rows) {
      await emailSvc.send({ to: rcp.email, toName: rcp.first_name, subject: `⚠️ PFC agreement(s) ending soon — ${due.rows.length} office(s)`, html, category: 'accounts' });
    }
    await db.query(`UPDATE pfc_agreements SET last_notified = CURRENT_DATE WHERE id = ANY($1::int[])`, [due.rows.map(a => a.id)]);
    res.json({ success: true, notified: due.rows.length, recipients: recips.rows.length });
  } catch (err) {
    console.error('[pfc/notifyExpiring]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── PATCH /pfc/:id — edit contact person / contact no (and other fields) ──────
exports.updatePFC = async (req, res) => {
  try {
    await ensureSchema();
    if (!canManage(req.user)) return res.status(403).json({ success: false, message: 'Access denied' });
    const id = parseInt(req.params.id);
    const allowed = ['contact_person', 'contact_no', 'owner_name', 'mobile_no', 'month_rent', 'advance', 'office_address', 'agreement_start', 'agreement_end', 'district', 'taluka'];
    const sets = [], vals = [];
    let i = 1;
    for (const f of allowed) if (req.body[f] !== undefined) { sets.push(`${f}=$${i++}`); vals.push(req.body[f] === '' ? null : req.body[f]); }
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to update' });
    sets.push('updated_at=now()'); vals.push(id);
    await db.query(`UPDATE pfc_agreements SET ${sets.join(',')} WHERE id=$${i}`, vals);
    res.json({ success: true });
  } catch (err) {
    console.error('[pfc/update]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /pfc/:id/assets — assets allocated to a PFC ───────────────────────────
exports.listAssets = async (req, res) => {
  try {
    await ensureSchema();
    if (!canManage(req.user)) return res.status(403).json({ success: false, message: 'Access denied' });
    const r = await db.query('SELECT * FROM pfc_assets WHERE pfc_id=$1 ORDER BY id', [parseInt(req.params.id)]);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── POST /pfc/:id/assets — add one asset to a PFC ─────────────────────────────
exports.addAsset = async (req, res) => {
  try {
    await ensureSchema();
    if (!canManage(req.user)) return res.status(403).json({ success: false, message: 'Access denied' });
    const pfcId = parseInt(req.params.id);
    const name = String(req.body.item_name || '').trim();
    if (!name) return res.status(400).json({ success: false, message: 'item_name required' });
    const r = await db.query(
      `INSERT INTO pfc_assets (pfc_id, item_name, quantity, serial_no, remark) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [pfcId, name, Math.max(1, parseInt(req.body.quantity) || 1), S(req.body.serial_no), S(req.body.remark)]);
    res.status(201).json({ success: true, data: r.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /pfc/assets/:id — remove one asset ─────────────────────────────────
exports.removeAsset = async (req, res) => {
  try {
    await ensureSchema();
    if (!canManage(req.user)) return res.status(403).json({ success: false, message: 'Access denied' });
    await db.query('DELETE FROM pfc_assets WHERE id=$1', [parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── DELETE /pfc/:id ───────────────────────────────────────────────────────────
exports.remove = async (req, res) => {
  try {
    await ensureSchema();
    if (!canManage(req.user)) return res.status(403).json({ success: false, message: 'Access denied' });
    await db.query('DELETE FROM pfc_agreements WHERE id=$1', [parseInt(req.params.id)]);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET /pfc/template — blank import template ──────────────────────────────────
exports.downloadTemplate = async (_req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const H = ['SR.NO','Dist','TALUKA','OWNER NAME','MO.NO','Office Address','Owner address','ADVANCE','MONTH RENT','Adhar','Pan Card','Bank Name','Account No.','IFSC','Branch','Agreement Start Date','Agreement End Date'];
    const ex = [1,'Gondia','GONDIA','Shriram Thakare','9765388169','Gaoutam nagar, Gondia 441601','Ward No.3, Goregaon, Gondia','6000','6000','812764702676','AWYPT0727F','Bank of Baroda','90278100001750','BARB0GONDIA','Gondia','2026-07-15','2027-07-14'];
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('PFC');
    ws.addRow(H); ws.addRow(ex);
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B5E20' } }; });
    H.forEach((h, i) => ws.getColumn(i + 1).width = Math.max(10, Math.min(24, h.length + 3)));
    const buf = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', 'attachment; filename="PFC_Import_Template.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(Buffer.from(buf));
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};
