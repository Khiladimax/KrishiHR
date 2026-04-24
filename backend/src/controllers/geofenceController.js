// src/controllers/geofenceController.js — COMPLETE
const db = require('../config/db');

// Haversine distance in meters
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

// ── Get All Locations ─────────────────────────────────────────────────────────
exports.getLocations = async (req, res) => {
  try {
    const role   = req.user.role;
    const userId = req.user.id;

    let q, params = [];
    if (['admin','super_admin','hr'].includes(role)) {
      q = `SELECT ol.*,
                  COUNT(DISTINCT eg.employee_id) AS assigned_count,
                  CONCAT(e.first_name,' ',e.last_name) AS created_by_name
           FROM office_locations ol
           LEFT JOIN employee_geofence eg ON ol.id = eg.office_location_id
           LEFT JOIN employees e ON ol.created_by = e.id
           GROUP BY ol.id, e.first_name, e.last_name
           ORDER BY ol.name`;
    } else {
      q = `SELECT DISTINCT ol.*,
                  CONCAT(e.first_name,' ',e.last_name) AS created_by_name
           FROM office_locations ol
           LEFT JOIN employee_geofence eg ON ol.id = eg.office_location_id
           LEFT JOIN employees e ON ol.created_by = e.id
           WHERE ol.is_active = true
             AND (eg.is_universal = true OR eg.employee_id IN (
               SELECT id FROM employees WHERE team_leader_id=$1 OR reporting_manager_id=$1
             ) OR ol.created_by=$1)
           ORDER BY ol.name`;
      params = [userId];
    }

    const r = await db.query(q, params);
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Create Location ───────────────────────────────────────────────────────────
exports.createLocation = async (req, res) => {
  try {
    const { name, latitude, longitude, radius_meters = 100, address } = req.body;
    if (!name || !latitude || !longitude)
      return res.status(400).json({ success: false, message: 'name, latitude, longitude required' });

    const r = await db.query(
      `INSERT INTO office_locations(name, latitude, longitude, radius_meters, address, created_by)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
      [name, latitude, longitude, radius_meters, address, req.user.id]
    );
    res.status(201).json({ success: true, message: 'Location created', data: r.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Update Location ───────────────────────────────────────────────────────────
exports.updateLocation = async (req, res) => {
  try {
    const { name, latitude, longitude, radius_meters, address, is_active } = req.body;
    const sets = [], params = [];
    let idx = 1;
    if (name          !== undefined) { sets.push(`name=$${idx++}`);           params.push(name); }
    if (latitude      !== undefined) { sets.push(`latitude=$${idx++}`);       params.push(latitude); }
    if (longitude     !== undefined) { sets.push(`longitude=$${idx++}`);      params.push(longitude); }
    if (radius_meters !== undefined) { sets.push(`radius_meters=$${idx++}`);  params.push(radius_meters); }
    if (address       !== undefined) { sets.push(`address=$${idx++}`);        params.push(address); }
    if (is_active     !== undefined) { sets.push(`is_active=$${idx++}`);      params.push(is_active); }
    if (!sets.length) return res.status(400).json({ success: false, message: 'Nothing to update' });
    sets.push(`updated_at=NOW()`);
    params.push(parseInt(req.params.id));
    await db.query(`UPDATE office_locations SET ${sets.join(',')} WHERE id=$${idx}`, params);
    res.json({ success: true, message: 'Updated' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Delete Location (Hard Delete) ─────────────────────────────────────────────
exports.deleteLocation = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const locId = parseInt(req.params.id);

    // 1. Check if any active employees are mapped to this location
    const mappedRes = await client.query(
      `SELECT e.id, CONCAT(e.first_name,' ',e.last_name) AS name, e.employee_code
       FROM employee_geofence eg
       JOIN employees e ON e.id = eg.employee_id
       WHERE eg.office_location_id = $1 AND e.is_active = TRUE`,
      [locId]
    );

    if (mappedRes.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        success: false,
        blocked: true,
        count: mappedRes.rows.length,
        employees: mappedRes.rows
      });
    }

    // 2. Nullify FK in attendance_geofence_logs (no ON DELETE rule)
    await client.query(
      `UPDATE attendance_geofence_logs SET office_location_id = NULL WHERE office_location_id = $1`,
      [locId]
    );

    // 3. Hard delete — employee_geofence cascades automatically
    await client.query(`DELETE FROM office_locations WHERE id = $1`, [locId]);

    await client.query('COMMIT');
    res.json({ success: true, message: 'Location permanently deleted' });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  } finally {
    client.release();
  }
};

// ── Get employees assigned to a location ─────────────────────────────────────
exports.getLocationEmployees = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name,
              d.name AS department_name, eg.is_universal
       FROM employee_geofence eg
       JOIN employees e ON e.id = eg.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE eg.office_location_id = $1 AND e.is_active = TRUE
       ORDER BY e.first_name`, [id]
    );
    res.json({ success: true, data: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Get employees NOT yet assigned to THIS location, filtered by city ─────────
// Logic:
//   1. Get the location name (e.g. "Corporate Office – Delhi" → keyword "Delhi")
//      Also check location address for city keyword.
//   2. Return ONLY employees whose city matches that keyword AND are not yet
//      assigned to this location.
//   3. Special case: State-wide locations (radius >= 500000) show employees
//      whose city matches the state name in the location name.
//   4. "Work From Home" location shows all unassigned employees regardless of city.
exports.getUnassignedEmployees = async (req, res) => {
  try {
    const { id } = req.params;

    // Fetch the location details first
    const locRes = await db.query(
      `SELECT id, name, address, radius_meters FROM office_locations WHERE id = $1`,
      [id]
    );
    if (!locRes.rows.length)
      return res.status(404).json({ success: false, message: 'Location not found' });

    const loc = locRes.rows[0];
    const locNameLower = loc.name.toLowerCase();
    const locAddrLower = (loc.address || '').toLowerCase();

    // ── Special case: Work From Home — show ALL unassigned employees ──────────
    if (locNameLower.includes('work from home') || locNameLower.includes('wfh') || locNameLower.includes('remote')) {
      const result = await db.query(
        `SELECT e.id, e.employee_code, e.first_name, e.last_name,
                d.name AS department_name, e.city
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id
         WHERE e.is_active = TRUE
           AND e.id NOT IN (
             SELECT employee_id FROM employee_geofence
             WHERE office_location_id = $1
           )
         ORDER BY e.first_name`,
        [id]
      );
      return res.json({ success: true, data: result.rows });
    }

    // ── Extract city keyword from location name ────────────────────────────────
    // Location names follow patterns like:
    //   "Corporate Office – Delhi"
    //   "Krishi Care HQ – Mumbai"
    //   "State – Andhra Pradesh"
    //   "State – Maharashtra"
    // We extract the part after "–" or "-" as the city/state keyword.
    let cityKeyword = '';

    const dashMatch = loc.name.match(/[–\-—]\s*(.+)$/);
    if (dashMatch) {
      cityKeyword = dashMatch[1].trim().toLowerCase();
    } else {
      // Fallback: use full location name
      cityKeyword = locNameLower;
    }

    // Clean up common prefixes like "state – " 
    cityKeyword = cityKeyword.replace(/^state\s*[–\-—]\s*/i, '').trim();

    // ── City keyword aliases ───────────────────────────────────────────────────
    // Map location keywords → possible values in employee city field
    const cityAliases = {
      'delhi':             ['delhi', 'new delhi', 'delhi ncr'],
      'mumbai':            ['mumbai', 'bombay', 'navi mumbai', 'thane'],
      'andhra pradesh':    ['andhra pradesh', 'andra pradesh', 'andhra', 'andra', 'ap', 'hyderabad', 'vijayawada', 'visakhapatnam'],
      'karnataka':         ['karnataka', 'bengaluru', 'bangalore', 'mysuru', 'mysore'],
      'maharastra':        ['maharastra', 'maharashtra', 'pune', 'nagpur', 'nashik', 'aurangabad', 'solapur'],
      'maharashtra':       ['maharastra', 'maharashtra', 'pune', 'nagpur', 'nashik', 'aurangabad', 'solapur'],
      'odisha':            ['odisha', 'orissa', 'bhubaneswar', 'cuttack'],
      'tamil nadu':        ['tamil nadu', 'tamilnadu', 'tn', 'chennai', 'coimbatore', 'madurai'],
    };

    // Get all possible city values for this location
    let matchCities = [cityKeyword];
    for (const [key, aliases] of Object.entries(cityAliases)) {
      if (cityKeyword.includes(key) || key.includes(cityKeyword)) {
        matchCities = [...new Set([...matchCities, ...aliases])];
        break;
      }
    }

    // Build ILIKE conditions for city matching
    const cityConditions = matchCities.map((_, i) => `LOWER(COALESCE(e.city,'')) ILIKE $${i + 2}`).join(' OR ');
    const cityParams = matchCities.map(c => `%${c}%`);

    const result = await db.query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name,
              d.name AS department_name, e.city
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE e.is_active = TRUE
         AND e.id NOT IN (
           SELECT employee_id FROM employee_geofence
           WHERE office_location_id = $1
         )
         AND (${cityConditions})
       ORDER BY e.first_name`,
      [id, ...cityParams]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Validate Punch (called before punch-in/out) ───────────────────────────────
// Priority: employee_buffer_rules.rule_type ALWAYS wins over raw office radius check.
// Flow:
//   1. Load employee's buffer rule (rule_type: office | district | state | universal)
//   2. If rule_type = universal  → always allow
//   3. If rule_type = state      → resolve GPS to state polygon, compare
//   4. If rule_type = district   → resolve GPS to district polygon, compare
//   5. If rule_type = office     → check distance against assigned office radius
//   6. If no rule set            → fall back to legacy office radius check
exports.validatePunch = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const empId = req.user.id;
    const punchType = req.body.punch_type || 'in';

    if (!latitude || !longitude)
      return res.json({ success: true, data: { valid: true, message: 'No GPS provided — punch allowed', distance: 0 } });

    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    // ── 1. Load buffer rule ───────────────────────────────────────────────────
    const ruleRes = await db.query(
      `SELECT ebr.rule_type, ebr.state, ebr.district
       FROM employee_buffer_rules ebr
       WHERE ebr.employee_id = $1`,
      [empId]
    );
    const rule = ruleRes.rows[0] || null;

    // Helper to log punch attempt
    const logPunch = (locId, dist, valid) =>
      db.query(
        `INSERT INTO attendance_geofence_logs
           (employee_id, office_location_id, employee_lat, employee_lng, distance_meters, is_within_geofence, punch_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [empId, locId || null, lat, lng, Math.round(dist || 0), valid, punchType]
      ).catch(() => {});

    // ── 2. UNIVERSAL — punch from anywhere ───────────────────────────────────
    if (rule?.rule_type === 'universal') {
      await logPunch(null, 0, true);
      return res.json({ success: true, data: { valid: true, message: 'Universal access — punch allowed from anywhere', distance: 0 } });
    }

    // ── 3. STATE — must be inside assigned state polygon ────────────────────
    if (rule?.rule_type === 'state') {
      const resolved = resolveLocation(lat, lng);
      if (!resolved) {
        await logPunch(null, 0, false);
        return res.json({ success: true, data: { valid: false, message: 'Your location could not be matched to any region in India.' } });
      }
      const match = resolved.state.toUpperCase() === (rule.state || '').toUpperCase();
      await logPunch(null, 0, match);
      return res.json({
        success: true,
        data: {
          valid: match,
          message: match
            ? `✓ Verified in ${resolved.state}`
            : `You are in ${resolved.state}. Must be in ${rule.state} to punch in.`
        }
      });
    }

    // ── 4. DISTRICT — must be inside assigned district polygon ──────────────
    if (rule?.rule_type === 'district') {
      const resolved = resolveLocation(lat, lng);
      if (!resolved) {
        await logPunch(null, 0, false);
        return res.json({ success: true, data: { valid: false, message: 'Your location could not be matched to any region in India.' } });
      }
      const stateOk    = resolved.state.toUpperCase()    === (rule.state    || '').toUpperCase();
      const districtOk = resolved.district.toLowerCase() === (rule.district || '').toLowerCase();
      const match = stateOk && districtOk;
      await logPunch(null, 0, match);
      return res.json({
        success: true,
        data: {
          valid: match,
          message: match
            ? `✓ Verified in ${rule.district}, ${rule.state}`
            : `You are in ${resolved.district}, ${resolved.state}. Must be in ${rule.district}, ${rule.state} to punch in.`
        }
      });
    }

    // ── 5. OFFICE — check distance against assigned office radius ────────────
    // (also used as fallback when rule_type = 'office' or no rule set)
    const buffers = await db.query(
      `SELECT ol.*, eg.is_universal
       FROM employee_geofence eg
       JOIN office_locations ol ON eg.office_location_id = ol.id
       WHERE eg.employee_id = $1 AND ol.is_active = true`,
      [empId]
    );

    if (!buffers.rows.length) {
      return res.json({ success: true, data: { valid: true, message: 'No office assigned — punch allowed', distance: 0 } });
    }

    // If no rule set at all and employee has universal geofence flag → allow
    if (!rule && buffers.rows.some(b => b.is_universal)) {
      await logPunch(buffers.rows[0].id, 0, true);
      return res.json({ success: true, data: { valid: true, message: 'Universal access — punch allowed from any location', distance: 0 } });
    }

    let minDist = Infinity, closestBuf = null;
    for (const buf of buffers.rows) {
      // Skip global zones (radius >= 10000) when doing office distance check
      if (buf.radius_meters >= 10000) continue;
      const dist = haversine(lat, lng, parseFloat(buf.latitude), parseFloat(buf.longitude));
      if (dist < minDist) { minDist = dist; closestBuf = buf; }
      if (dist <= buf.radius_meters) {
        await logPunch(buf.id, dist, true);
        return res.json({
          success: true,
          data: {
            valid: true,
            message: `✓ Within ${buf.name} (${Math.round(dist)}m from center)`,
            distance: Math.round(dist),
            location_id: buf.id,
            location_name: buf.name
          }
        });
      }
    }

    // Outside all office buffers
    if (closestBuf) {
      await logPunch(closestBuf.id, minDist, false);
      return res.json({
        success: true,
        data: {
          valid: false,
          message: `You are ${Math.round(minDist)}m from ${closestBuf.name}. Must be within ${closestBuf.radius_meters}m.`,
          distance: Math.round(minDist),
          location_id: closestBuf.id,
          location_name: closestBuf.name
        }
      });
    }

    // All assigned locations are global zones — allow
    await logPunch(null, 0, true);
    return res.json({ success: true, data: { valid: true, message: 'No strict office assigned — punch allowed', distance: 0 } });

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Get Geofence Logs ─────────────────────────────────────────────────────────
exports.getLogs = async (req, res) => {
  try {
    const { employee_id, from_date, to_date, limit = 100 } = req.query;
    const userId = req.user.id, role = req.user.role;

    let conds = [], params = [], idx = 1;

    if (role === 'manager') {
      conds.push(`gl.employee_id IN (
        SELECT id FROM employees WHERE department_id=(SELECT department_id FROM employees WHERE id=$${idx++})
      )`);
      params.push(userId);
    } else if (role === 'tl') {
      conds.push(`gl.employee_id IN (SELECT id FROM employees WHERE team_leader_id=$${idx++})`);
      params.push(userId);
    }

    if (employee_id) { conds.push(`gl.employee_id=$${idx++}`); params.push(employee_id); }
    if (from_date)   { conds.push(`(gl.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date>=$${idx++}`); params.push(from_date); }
    if (to_date)     { conds.push(`(gl.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata')::date<=$${idx++}`); params.push(to_date); }

    const where = conds.length ? 'WHERE ' + conds.join(' AND ') : '';

    const r = await db.query(
      `SELECT gl.*,
              -- FIX: Convert UTC created_at to IST for display
              (gl.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata') AS created_at_ist,
              TO_CHAR(gl.created_at AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata', 'DD/MM/YYYY, HH12:MI:SS AM') AS punch_time_ist,
              CONCAT(e.first_name,' ',e.last_name) AS employee_name,
              e.employee_code, d.name AS department_name,
              ol.name AS location_name
       FROM attendance_geofence_logs gl
       JOIN employees e ON gl.employee_id = e.id
       LEFT JOIN departments d ON e.department_id = d.id
       LEFT JOIN office_locations ol ON gl.office_location_id = ol.id
       ${where}
       ORDER BY gl.created_at DESC
       LIMIT $${idx}`,
      [...params, limit]
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Get Employee Geofence Assignments ─────────────────────────────────────────
exports.getEmployeeGeofence = async (req, res) => {
  try {
    const empId = parseInt(req.params.employee_id);
    const [assigned, universal] = await Promise.all([
      db.query(
        `SELECT eg.*, ol.name, ol.latitude, ol.longitude, ol.radius_meters, ol.address, ol.is_active
         FROM employee_geofence eg
         JOIN office_locations ol ON eg.office_location_id = ol.id
         WHERE eg.employee_id = $1 AND ol.is_active = true`,
        [empId]
      ),
      db.query(
        `SELECT ol.* FROM office_locations ol
         WHERE ol.is_active = true
           AND EXISTS (SELECT 1 FROM employee_geofence eg WHERE eg.office_location_id=ol.id AND eg.is_universal=true)`
      )
    ]);
    res.json({ success: true, data: assigned.rows, universal_buffers: universal.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Assign Buffer to Employee ─────────────────────────────────────────────────
exports.assignBuffer = async (req, res) => {
  try {
    const { employee_id, office_location_id, is_universal = false } = req.body;
    if (!employee_id || !office_location_id)
      return res.status(400).json({ success: false, message: 'employee_id and office_location_id required' });

    await db.query(
      `INSERT INTO employee_geofence(employee_id, office_location_id, is_universal, assigned_by)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(employee_id, office_location_id)
       DO UPDATE SET is_universal=$3, assigned_by=$4`,
      [employee_id, office_location_id, is_universal, req.user.id]
    );
    res.json({ success: true, message: `Buffer assigned${is_universal ? ' (universal)' : ''}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Bulk Assign Buffer ────────────────────────────────────────────────────────
exports.bulkAssignBuffer = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { employee_ids, office_location_id, is_universal = false } = req.body;
    if (!employee_ids?.length || !office_location_id)
      return res.status(400).json({ success: false, message: 'employee_ids[] and office_location_id required' });

    for (const eid of employee_ids) {
      await client.query(
        `INSERT INTO employee_geofence(employee_id, office_location_id, is_universal, assigned_by)
         VALUES($1,$2,$3,$4)
         ON CONFLICT(employee_id, office_location_id)
         DO UPDATE SET is_universal=$3, assigned_by=$4`,
        [eid, office_location_id, is_universal, req.user.id]
      );
    }
    await client.query('COMMIT');
    res.json({ success: true, message: `Buffer assigned to ${employee_ids.length} employees` });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: 'Server error' });
  } finally { client.release(); }
};

// ── Remove Buffer from Employee ───────────────────────────────────────────────
exports.removeBuffer = async (req, res) => {
  try {
    await db.query(
      'DELETE FROM employee_geofence WHERE employee_id=$1 AND office_location_id=$2',
      [req.params.employee_id, req.params.location_id]
    );
    res.json({ success: true, message: 'Buffer assignment removed' });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Toggle Universal/Specific for already-assigned employee ───────────────────
exports.toggleUniversal = async (req, res) => {
  try {
    const { employee_id, location_id } = req.params;
    const { is_universal } = req.body;
    if (is_universal === undefined)
      return res.status(400).json({ success: false, message: 'is_universal required' });

    await db.query(
      `UPDATE employee_geofence SET is_universal=$1, assigned_by=$2
       WHERE employee_id=$3 AND office_location_id=$4`,
      [is_universal, req.user.id, employee_id, location_id]
    );
    res.json({ success: true, message: `Access changed to ${is_universal ? 'Universal' : 'Specific'}` });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Get Employees for Location (used by frontend assign panel) ────────────────
// Returns TWO groups:
//   assigned: employees already assigned to this location (with is_universal flag)
//   unassigned: employees of the SAME CITY not yet assigned here
exports.getEmployeesForLocation = async (req, res) => {
  try {
    const locationId = req.query.location_id;

    if (!locationId) {
      // No location selected — return empty
      return res.json({ success: true, data: [] });
    }

    // Get location details
    const locRes = await db.query(
      `SELECT id, name, address, radius_meters FROM office_locations WHERE id = $1`,
      [locationId]
    );
    if (!locRes.rows.length)
      return res.status(404).json({ success: false, message: 'Location not found' });

    const loc = locRes.rows[0];
    const locNameLower = loc.name.toLowerCase();

    // ── 1. Get ASSIGNED employees ─────────────────────────────────────────────
    const assignedRes = await db.query(
      `SELECT e.id, e.employee_code,
              CONCAT(e.first_name,' ',e.last_name) AS full_name,
              d.name AS department_name, e.role, e.city,
              eg.is_universal,
              TRUE AS is_assigned_here,
              $2::text AS assigned_location_name,
              CASE WHEN eg.is_universal THEN 'Universal' ELSE 'Specific' END AS buffer_type
       FROM employee_geofence eg
       JOIN employees e ON e.id = eg.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE eg.office_location_id = $1 AND e.is_active = TRUE
       ORDER BY e.first_name`,
      [locationId, loc.name]
    );

    // ── 2. Get UNASSIGNED employees of same city ──────────────────────────────
    // Work From Home: show all unassigned
    if (locNameLower.includes('work from home') || locNameLower.includes('wfh') || locNameLower.includes('remote')) {
      const unassignedRes = await db.query(
        `SELECT e.id, e.employee_code,
                CONCAT(e.first_name,' ',e.last_name) AS full_name,
                d.name AS department_name, e.role, e.city,
                FALSE AS is_universal,
                FALSE AS is_assigned_here,
                NULL AS assigned_location_name,
                'Not assigned' AS buffer_type
         FROM employees e
         LEFT JOIN departments d ON d.id = e.department_id
         WHERE e.is_active = TRUE
           AND e.id NOT IN (SELECT employee_id FROM employee_geofence WHERE office_location_id = $1)
         ORDER BY e.first_name`,
        [locationId]
      );
      return res.json({
        success: true,
        data: [...assignedRes.rows, ...unassignedRes.rows]
      });
    }

    // Extract city keyword from location name (after – or -)
    let cityKeyword = '';
    const dashMatch = loc.name.match(/[–\-—]\s*(.+)$/);
    if (dashMatch) {
      cityKeyword = dashMatch[1].trim().toLowerCase();
    } else {
      cityKeyword = locNameLower;
    }
    cityKeyword = cityKeyword.replace(/^state\s*[–\-—]\s*/i, '').trim();

    // City aliases map
    const cityAliases = {
      'delhi':          ['delhi', 'new delhi', 'delhi ncr'],
      'mumbai':         ['mumbai', 'bombay', 'navi mumbai', 'thane'],
      'andhra pradesh': ['andhra pradesh', 'andra pradesh', 'andhra', 'andra'],
      'karnataka':      ['karnataka', 'bengaluru', 'bangalore'],
      'maharastra':     ['maharastra', 'maharashtra'],
      'maharashtra':    ['maharastra', 'maharashtra'],
      'odisha':         ['odisha', 'orissa'],
      'tamil nadu':     ['tamil nadu', 'tamilnadu'],
    };

    let matchCities = [cityKeyword];
    for (const [key, aliases] of Object.entries(cityAliases)) {
      if (cityKeyword.includes(key) || key.includes(cityKeyword)) {
        matchCities = [...new Set([...matchCities, ...aliases])];
        break;
      }
    }

    const cityConditions = matchCities.map((_, i) => `LOWER(COALESCE(e.city,'')) ILIKE $${i + 2}`).join(' OR ');
    const cityParams = matchCities.map(c => `%${c}%`);

    const unassignedRes = await db.query(
      `SELECT e.id, e.employee_code,
              CONCAT(e.first_name,' ',e.last_name) AS full_name,
              d.name AS department_name, e.role, e.city,
              FALSE AS is_universal,
              FALSE AS is_assigned_here,
              NULL AS assigned_location_name,
              'Not assigned' AS buffer_type
       FROM employees e
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE e.is_active = TRUE
         AND e.id NOT IN (SELECT employee_id FROM employee_geofence WHERE office_location_id = $1)
         AND (${cityConditions})
       ORDER BY e.first_name`,
      [locationId, ...cityParams]
    );

    res.json({
      success: true,
      data: [...assignedRes.rows, ...unassignedRes.rows]
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Get employee's own assigned geofence locations (for mobile map) ────────────
exports.getMyLocations = async (req, res) => {
  try {
    const empId = req.user.id;

    const result = await db.query(
      `SELECT ol.id, ol.name, ol.address,
              CAST(ol.latitude AS FLOAT)       AS latitude,
              CAST(ol.longitude AS FLOAT)      AS longitude,
              ol.radius_meters,
              eg.is_universal
       FROM employee_geofence eg
       JOIN office_locations ol ON ol.id = eg.office_location_id
       WHERE eg.employee_id = $1
         AND ol.is_active = true
       ORDER BY ol.name`,
      [empId]
    );

    res.json({ success: true, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  EMPLOYEE BUFFER RULES — state / district / office / universal
// ══════════════════════════════════════════════════════════════════════════════
const DISTRICT_BOUNDARIES = require('../config/district_boundaries_geo_simplified.json');

/**
 * Ray-casting point-in-polygon for GeoJSON rings.
 * coords = [[lng,lat], ...] (GeoJSON order)
 */
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInGeometry(lng, lat, geometry) {
  if (geometry.type === 'Polygon') {
    return pointInRing(lng, lat, geometry.coordinates[0]);
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(poly => pointInRing(lng, lat, poly[0]));
  }
  return false;
}

/**
 * Resolve { state, district } from lat/lng using real polygon boundaries.
 * Returns { state, district } or null if outside all known districts.
 */
function resolveLocation(lat, lng) {
  for (const [stateName, districts] of Object.entries(DISTRICT_BOUNDARIES)) {
    for (const d of districts) {
      if (pointInGeometry(lng, lat, d.geometry)) {
        return { state: stateName, district: d.district };
      }
    }
  }
  return null;
}

/**
 * Core validation — rule_type ALWAYS takes priority over employee_type.
 * Returns { valid: Boolean, message: String, outside_boundary?: Boolean }
 */
async function validateEmployeeBuffer(empId, latitude, longitude) {
  // No GPS → allow
  if (!latitude || !longitude)
    return { valid: true, message: 'No GPS — punch allowed' };

  // Get buffer rule (rule_type drives everything)
  const ruleRes = await db.query(
    `SELECT ebr.*, e.employee_type
     FROM employee_buffer_rules ebr
     JOIN employees e ON e.id = ebr.employee_id
     WHERE ebr.employee_id = $1`,
    [empId]
  );

  // No rule assigned → allow (shouldn't happen after seeding)
  if (!ruleRes.rows.length)
    return { valid: true, message: 'No rule assigned — punch allowed' };

  const rule = ruleRes.rows[0];

  // ── UNIVERSAL → punch from anywhere ──────────────────────────────────────
  if (rule.rule_type === 'universal')
    return { valid: true, message: 'Universal access — punch allowed from anywhere' };

  // ── OFFICE → must be within office radius ─────────────────────────────────
  if (rule.rule_type === 'office') {
    const buffers = await db.query(
      `SELECT ol.* FROM employee_geofence eg
       JOIN office_locations ol ON eg.office_location_id = ol.id
       WHERE eg.employee_id = $1 AND ol.is_active = true`,
      [empId]
    );
    if (!buffers.rows.length)
      return { valid: true, message: 'No office assigned — punch allowed' };

    let minDist = Infinity, closestBuf = null;
    for (const buf of buffers.rows) {
      const dist = haversine(
        parseFloat(latitude), parseFloat(longitude),
        parseFloat(buf.latitude), parseFloat(buf.longitude)
      );
      if (dist < minDist) { minDist = dist; closestBuf = buf; }
      if (dist <= buf.radius_meters) {
        return {
          valid: true,
          message: `Within ${buf.name} (${Math.round(dist)}m)`,
          distance: Math.round(dist)
        };
      }
    }
    return {
      valid: false, outside_boundary: true,
      message: `You are ${Math.round(minDist)}m from ${closestBuf.name}. Must be within ${closestBuf.radius_meters}m.`
    };
  }

  // ── STATE or DISTRICT → resolve GPS to polygon boundary ──────────────────
  if (rule.rule_type === 'state' || rule.rule_type === 'district') {
    const resolved = resolveLocation(parseFloat(latitude), parseFloat(longitude));
    if (!resolved)
      return {
        valid: false, outside_boundary: true,
        message: 'Your location could not be matched to any region in India.'
      };

    if (rule.rule_type === 'state') {
      const match = resolved.state.toUpperCase() === (rule.state || '').toUpperCase();
      return match
        ? { valid: true,  message: `Verified in ${resolved.state}` }
        : { valid: false, outside_boundary: true,
            message: `You are in ${resolved.state}. Must be in ${rule.state} to punch.` };
    }

    if (rule.rule_type === 'district') {
      const stateOk    = resolved.state.toUpperCase()    === (rule.state    || '').toUpperCase();
      const districtOk = resolved.district.toLowerCase() === (rule.district || '').toLowerCase();
      if (stateOk && districtOk)
        return { valid: true, message: `Verified in ${rule.district}, ${rule.state}` };
      return {
        valid: false, outside_boundary: true,
        message: `You are in ${resolved.district}, ${resolved.state}. Must be in ${rule.district}, ${rule.state}.`
      };
    }
  }

  return { valid: true, message: 'Punch allowed' };
}
exports.validateEmployeeBuffer = validateEmployeeBuffer;

// ── GET buffer rule for one employee ─────────────────────────────────────────
exports.getBufferRule = async (req, res) => {
  try {
    const { employee_id } = req.params;
    const r = await db.query(
      `SELECT ebr.*, e.first_name, e.last_name, e.employee_code, e.employee_type
       FROM employee_buffer_rules ebr
       JOIN employees e ON e.id = ebr.employee_id
       WHERE ebr.employee_id = $1`,
      [employee_id]
    );
    res.json({ success: true, data: r.rows[0] || null });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── UPSERT (POST or PUT) buffer rule ─────────────────────────────────────────
exports.upsertBufferRule = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    const employee_id = req.params.employee_id || req.body.employee_id;
    const { rule_type, state, district } = req.body;
    if (!employee_id || !rule_type)
      return res.status(400).json({ success: false, message: 'employee_id and rule_type required' });

    // ── 1. Sync employee_type ─────────────────────────────────────────────────
    if (rule_type === 'office') {
      await client.query(`UPDATE employees SET employee_type = 'onsite' WHERE id = $1`, [employee_id]);
    } else if (rule_type === 'state' || rule_type === 'district') {
      await client.query(`UPDATE employees SET employee_type = 'offsite' WHERE id = $1`, [employee_id]);
    }

    // ── 2. Save the buffer rule ───────────────────────────────────────────────
    const r = await client.query(
      `INSERT INTO employee_buffer_rules
         (employee_id, rule_type, state, district, assigned_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (employee_id) DO UPDATE
         SET rule_type   = EXCLUDED.rule_type,
             state       = EXCLUDED.state,
             district    = EXCLUDED.district,
             assigned_by = EXCLUDED.assigned_by,
             updated_at  = NOW()
       RETURNING *`,
      [employee_id, rule_type, state || null, district || null, req.user.id]
    );

    // ── 3. Move employee OUT of old locations, clean up empty auto-locations ────

    if (rule_type === 'district' || rule_type === 'state' || rule_type === 'universal') {
      // Moving AWAY from office → remove from all strict-office assignments
      await client.query(
        `DELETE FROM employee_geofence
         WHERE employee_id = $1
           AND office_location_id IN (
             SELECT id FROM office_locations WHERE radius_meters < 10000
           )`,
        [employee_id]
      );
    }

    if (rule_type === 'office') {
      // Moving BACK to office → remove from all global (district/state) locations
      // then delete any auto-created district/state locations that now have 0 employees
      const globalLocs = await client.query(
        `SELECT eg.office_location_id AS loc_id
         FROM employee_geofence eg
         JOIN office_locations ol ON ol.id = eg.office_location_id
         WHERE eg.employee_id = $1 AND ol.radius_meters >= 10000`,
        [employee_id]
      );
      const globalLocIds = globalLocs.rows.map(r => r.loc_id);

      if (globalLocIds.length) {
        // Remove employee from those global locations
        await client.query(
          `DELETE FROM employee_geofence
           WHERE employee_id = $1 AND office_location_id = ANY($2::int[])`,
          [employee_id, globalLocIds]
        );

        // Delete any auto-created global locations now with 0 employees
        for (const locId of globalLocIds) {
          const remaining = await client.query(
            `SELECT COUNT(*) AS cnt FROM employee_geofence WHERE office_location_id = $1`,
            [locId]
          );
          if (parseInt(remaining.rows[0].cnt) === 0) {
            // Only delete auto-created zones (radius 999999), not manually-set ones
            await client.query(
              `DELETE FROM office_locations WHERE id = $1 AND radius_meters >= 999999`,
              [locId]
            );
          }
        }
      }

      // Assign employee to the specified office location
      const { office_location_id } = req.body;
      if (office_location_id) {
        await client.query(
          `INSERT INTO employee_geofence (employee_id, office_location_id, is_universal, assigned_by)
           VALUES ($1, $2, FALSE, $3)
           ON CONFLICT (employee_id, office_location_id) DO UPDATE SET is_universal = FALSE`,
          [employee_id, office_location_id, req.user.id]
        );
      }
    }

    // ── 4. Auto-create / find location for district or state, then assign ──────
    let newLocId = null;

    if (rule_type === 'district' && district && state) {
      const locName = `District – ${district}, ${state}`;
      const address = `${district} District, ${state}, India`;

      // Find existing or create
      const existing = await client.query(
        `SELECT id FROM office_locations WHERE LOWER(name) = LOWER($1) AND is_active = TRUE LIMIT 1`,
        [locName]
      );
      if (existing.rows.length) {
        newLocId = existing.rows[0].id;
      } else {
        const created = await client.query(
          `INSERT INTO office_locations (name, latitude, longitude, radius_meters, address, is_active, created_by)
           VALUES ($1, 0, 0, 999999, $2, TRUE, $3) RETURNING id`,
          [locName, address, req.user.id]
        );
        newLocId = created.rows[0].id;
      }
    } else if (rule_type === 'state' && state) {
      const locName = `State – ${state}`;
      const address = `${state}, India`;

      const existing = await client.query(
        `SELECT id FROM office_locations WHERE LOWER(name) = LOWER($1) AND is_active = TRUE LIMIT 1`,
        [locName]
      );
      if (existing.rows.length) {
        newLocId = existing.rows[0].id;
      } else {
        const created = await client.query(
          `INSERT INTO office_locations (name, latitude, longitude, radius_meters, address, is_active, created_by)
           VALUES ($1, 0, 0, 999999, $2, TRUE, $3) RETURNING id`,
          [locName, address, req.user.id]
        );
        newLocId = created.rows[0].id;
      }
    }

    // ── 5. Assign employee to the new district/state location ─────────────────
    if (newLocId) {
      await client.query(
        `INSERT INTO employee_geofence (employee_id, office_location_id, is_universal, assigned_by)
         VALUES ($1, $2, TRUE, $3)
         ON CONFLICT (employee_id, office_location_id) DO NOTHING`,
        [employee_id, newLocId, req.user.id]
      );
    }

    await client.query('COMMIT');
    res.json({ success: true, data: r.rows[0], new_location_id: newLocId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
};

// ── DELETE buffer rule ────────────────────────────────────────────────────────
exports.deleteBufferRule = async (req, res) => {
  try {
    const { employee_id } = req.params;
    await db.query(`DELETE FROM employee_buffer_rules WHERE employee_id=$1`, [employee_id]);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── GET all rules (for admin list view) ──────────────────────────────────────
exports.getAllBufferRules = async (req, res) => {
  try {
    const r = await db.query(
      `SELECT e.id, e.employee_code, e.first_name, e.last_name, e.employee_type,
              ebr.rule_type, ebr.state, ebr.district, ebr.assigned_at, ebr.updated_at
       FROM employees e
       LEFT JOIN employee_buffer_rules ebr ON ebr.employee_id = e.id
       WHERE e.is_active = TRUE
       ORDER BY e.first_name`
    );
    res.json({ success: true, data: r.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

// ── Validate buffer (called from frontend map modal) ─────────────────────────
exports.validateBuffer = async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    const empId = req.user.id;
    const result = await validateEmployeeBuffer(empId, latitude, longitude);
    res.json({ success: true, valid: result.valid, message: result.message, outside_boundary: result.outside_boundary || false });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// ── Get boundary polygon for map display ─────────────────────────────────────
exports.getBoundary = async (req, res) => {
  try {
    const { state, district } = req.query;
    if (!state) return res.status(400).json({ success: false, message: 'state required' });

    const stateData = DISTRICT_BOUNDARIES[state.toUpperCase()];
    if (!stateData) return res.status(404).json({ success: false, message: 'State not found' });

    if (district) {
      // Return single district polygon
      const found = stateData.find(d => d.district.toLowerCase() === district.toLowerCase());
      if (!found) return res.status(404).json({ success: false, message: 'District not found' });
      return res.json({
        success: true,
        data: { district: found.district, coordinates: found.geometry.coordinates }
      });
    }

    // Return merged state outline — union of all district polygons' outer rings
    // For mobile rendering we return all districts as separate polygons
    const districts = stateData.map(d => ({
      district: d.district,
      coordinates: d.geometry.type === 'Polygon'
        ? d.geometry.coordinates
        : d.geometry.coordinates.map(poly => poly[0]) // MultiPolygon → flatten
    }));
    res.json({ success: true, data: districts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
