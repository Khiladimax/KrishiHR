// src/controllers/authController.js — COMPLETE
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const db     = require('../config/db');

const SECRET  = process.env.JWT_SECRET  || 'hrms_secret';
const EXPIRES = process.env.JWT_EXPIRES_IN || '30d';

function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES });
}

// ── Login ─────────────────────────────────────────────────────────────────────
exports.login = async (req, res) => {
  try {
    const { email, password, device_id, app_version, device_name } = req.body;
    if (!email || !password)
      return res.status(400).json({ success: false, message: 'Email and password required' });

    const result = await db.query(
      `SELECT e.*, d.name AS department_name, des.title AS designation_title,
              CONCAT(m.first_name,' ',m.last_name) AS manager_name,
              CONCAT(tl.first_name,' ',tl.last_name) AS team_leader_name
       FROM employees e
       LEFT JOIN departments d   ON e.department_id=d.id
       LEFT JOIN designations des ON e.designation_id=des.id
       LEFT JOIN employees m     ON e.reporting_manager_id=m.id
       LEFT JOIN employees tl    ON e.team_leader_id=tl.id
       WHERE LOWER(e.email)=LOWER($1) AND e.is_active=true`,
      [email.trim()]
    );

    if (!result.rows.length)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    const emp = result.rows[0];
    const valid = await bcrypt.compare(password, emp.password_hash);
    if (!valid)
      return res.status(401).json({ success: false, message: 'Invalid credentials' });

    // ── Security: 24h block + single-device lock (mobile only) ────────────────
    // device_id is sent only by the Android app; web logins are never blocked.
    // Privileged roles (admin/super_admin/client_admin/accounts/hr) and anyone
    // an admin has exempted (allow_multi_device) may use multiple devices.
    // Everyone else is locked to the first device they log in from.
    const PRIV_ROLES = ['super_admin', 'admin', 'client_admin', 'accounts', 'hr'];
    const isWebLogin = !device_id;
    const multiDeviceAllowed = isWebLogin || PRIV_ROLES.includes(emp.role) || emp.allow_multi_device === true;
    const device_model = req.body.device_model || null;

    // 24-hour security block (set when a violation is reported)
    if (emp.blocked_until && new Date(emp.blocked_until) > new Date()) {
      const hrs = Math.max(1, Math.ceil((new Date(emp.blocked_until) - new Date()) / 3_600_000));
      return res.status(403).json({
        success: false,
        code: 'ACCOUNT_BLOCKED',
        message: `Your account has been blocked due to security violations. Try again in ~${hrs} hour(s).\n\nContact Admin to unlock: Akshay Rai (7651900038)`
      });
    }

    if (!isWebLogin) {
      // Single-device lock: a different device is refused, not swapped in.
      if (!multiDeviceAllowed && emp.locked_device_id && emp.locked_device_id !== device_id) {
        await db.query(`UPDATE employees SET other_device_logins = COALESCE(other_device_logins,0)+1 WHERE id=$1`, [emp.id]).catch(() => {});
        return res.status(403).json({
          success: false,
          code: 'DEVICE_LOCKED',
          message: 'This account is already active on another device.\n\n' +
                   'One account can only be used on one mobile device at a time. This prevents duplicate or fake submissions.\n\n' +
                   'Contact Admin to unlock your account: Akshay Rai (7651900038)\n\n' +
                   'Ek account keval ek mobile par hi istemal ho sakta hai.\n' +
                   'Account unlock karvane ke liye Akshay Rai (7651900038) se sampark karein.'
        });
      }
      const updateFields = [device_id, emp.id];
      let updateQuery = `UPDATE employees SET device_token=$1, last_login_at=NOW()`;
      // Bind the lock to this device on first login for single-device users.
      if (!multiDeviceAllowed) updateQuery += `, locked_device_id=COALESCE(locked_device_id,$1)`;
      if (app_version)  { updateQuery += `, app_version=$${updateFields.length + 1}`;       updateFields.push(app_version); }
      if (device_name)  { updateQuery += `, last_login_device=$${updateFields.length + 1}`;  updateFields.push(device_name); }
      if (device_model) { updateQuery += `, last_login_model=$${updateFields.length + 1}`;   updateFields.push(device_model); }
      updateQuery += ` WHERE id=$2`;
      await db.query(updateQuery, updateFields);
    } else {
      await db.query(`UPDATE employees SET last_login_at=NOW() WHERE id=$1`, [emp.id]);
    }

    const token = signToken({ id: emp.id, role: emp.role, email: emp.email, device_id: device_id || null, client_id: emp.client_id || null });

    // Remove sensitive fields
    const { password_hash, pan_number, aadhar_number, bank_account, ...safeEmp } = emp;

    res.json({
      success: true,
      message: 'Login successful',
      data: { token, employee: safeEmp }
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Get Me ────────────────────────────────────────────────────────────────────
exports.getMe = async (req, res) => {
  try {
    const { password_hash, pan_number, aadhar_number, bank_account, ...safe } = req.user;
    res.json({ success: true, data: safe });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};


// ── Update Profile Photo (self) ───────────────────────────────────────────────
exports.updatePhoto = async (req, res) => {
  try {
    const { profile_photo } = req.body;
    if (!profile_photo) return res.status(400).json({ success: false, message: 'profile_photo required' });

    if (!profile_photo.startsWith('data:image/') && !profile_photo.startsWith('http')) {
      return res.status(400).json({ success: false, message: 'Invalid image format' });
    }

    const db = require('../config/db');

    // Save base64 image directly to PostgreSQL DB
    await db.query(
      'UPDATE employees SET profile_picture=$1, updated_at=NOW() WHERE id=$2',
      [profile_photo, req.user.id]
    );

    console.log(`✅ Profile photo saved to DB for ${req.user.employee_code}`);
    res.json({ success: true, message: 'Photo updated', data: { photo_url: profile_photo } });
  } catch (err) {
    console.error('[updatePhoto error]', err.message);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Refresh Token ─────────────────────────────────────────────────────────────
exports.refreshToken = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ success: false, message: 'Token required' });
    const decoded = jwt.verify(token, SECRET, { ignoreExpiration: true });
    const newToken = signToken({ id: decoded.id, role: decoded.role, email: decoded.email });
    res.json({ success: true, data: { token: newToken } });
  } catch (err) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

// ── Change Password ───────────────────────────────────────────────────────────
exports.changePassword = async (req, res) => {
  try {
    const { old_password, new_password } = req.body;
    if (!old_password || !new_password)
      return res.status(400).json({ success: false, message: 'Both passwords required' });
    if (new_password.length < 6)
      return res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });

    const emp = await db.query('SELECT password_hash FROM employees WHERE id=$1', [req.user.id]);
    const valid = await bcrypt.compare(old_password, emp.rows[0].password_hash);
    if (!valid)
      return res.status(400).json({ success: false, message: 'Current password is incorrect' });

    const hash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE employees SET password_hash=$1, updated_at=NOW() WHERE id=$2', [hash, req.user.id]);
    res.json({ success: true, message: 'Password changed successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Forgot Password — Step 1: Verify Employee Code + Email ───────────────────
exports.forgotVerify = async (req, res) => {
  try {
    const { employee_code, email } = req.body;
    if (!employee_code || !email)
      return res.status(400).json({ success: false, message: 'Employee Code and Email required' });

    const result = await db.query(
      `SELECT id, first_name, last_name, email, employee_code
       FROM employees WHERE LOWER(employee_code)=LOWER($1) AND LOWER(email)=LOWER($2) AND is_active=true`,
      [employee_code.trim(), email.trim()]
    );

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: 'No employee found with this Employee Code and Email combination' });

    const emp = result.rows[0];
    res.json({
      success: true,
      message: 'Identity verified',
      data: { employee_id: emp.id, name: `${emp.first_name} ${emp.last_name}` }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Forgot Password — Step 2: Verify PAN Number ──────────────────────────────
exports.forgotVerifyPAN = async (req, res) => {
  try {
    const { employee_id, pan_number } = req.body;
    if (!employee_id || !pan_number)
      return res.status(400).json({ success: false, message: 'Employee ID and PAN required' });

    const result = await db.query(
      `SELECT id, pan_number FROM employees WHERE id=$1 AND is_active=true`,
      [employee_id]
    );

    if (!result.rows.length)
      return res.status(404).json({ success: false, message: 'Employee not found' });

    const emp = result.rows[0];
    if (!emp.pan_number)
      return res.status(400).json({ success: false, message: 'No PAN number on file. Please contact HR to reset your password.' });

    if (emp.pan_number.toUpperCase().trim() !== pan_number.toUpperCase().trim())
      return res.status(401).json({ success: false, message: 'PAN number does not match our records' });

    // Generate a short-lived reset token (valid 15 mins)
    const resetToken = jwt.sign(
      { id: emp.id, purpose: 'password_reset' },
      SECRET,
      { expiresIn: '15m' }
    );

    res.json({
      success: true,
      message: 'PAN verified. You can now reset your password.',
      data: { reset_token: resetToken }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Forgot Password — Step 3: Set New Password ───────────────────────────────
exports.forgotReset = async (req, res) => {
  try {
    const { reset_token, new_password } = req.body;
    if (!reset_token || !new_password)
      return res.status(400).json({ success: false, message: 'Token and new password required' });
    if (new_password.length < 8)
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });

    let decoded;
    try {
      decoded = jwt.verify(reset_token, SECRET);
    } catch(e) {
      return res.status(401).json({ success: false, message: 'Reset link expired. Please start again.' });
    }

    if (decoded.purpose !== 'password_reset')
      return res.status(401).json({ success: false, message: 'Invalid reset token' });

    const hash = await bcrypt.hash(new_password, 10);
    await db.query(
      'UPDATE employees SET password_hash=$1, updated_at=NOW() WHERE id=$2',
      [hash, decoded.id]
    );

    res.json({ success: true, message: 'Password reset successfully. You can now log in.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── FCM Token ─────────────────────────────────────────────────────────────────
// POST /auth/fcm-token  (authenticated)
// Android calls this on login and whenever FCM refreshes the token.
exports.updateFcmToken = async (req, res) => {
  try {
    const { fcm_token } = req.body;
    if (!fcm_token) return res.status(400).json({ success: false, message: 'fcm_token required' });

    // Clear this token from any other employee who has it (e.g. shared/re-used device)
    await db.query(
      `UPDATE employees SET fcm_token = NULL WHERE fcm_token = $1 AND id != $2`,
      [fcm_token, req.user.id]
    );

    await db.query(
      `UPDATE employees SET fcm_token = $1 WHERE id = $2`,
      [fcm_token, req.user.id]
    );
    res.json({ success: true, message: 'FCM token updated' });
  } catch (err) {
    console.error('[FCM token update]', err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
