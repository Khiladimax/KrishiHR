// src/utils/scope.js
// Employee-visibility scoping by role, used everywhere client staff are filtered.
//
//   client_admin        → their client AND their own state only
//   super_admin_client  → their client, ALL states
//   hr/accounts/admin/super_admin → unrestricted (main + all clients)
//
// clientScopeFragment returns a SQL boolean fragment (safe: client_id is parsed
// to an int, state is single-quote escaped) using the given employees alias, or
// null when the user has no client restriction (main office staff).

function clientScopeFragment(user, alias = 'e') {
  const role = String((user && user.role) || '').toLowerCase();
  const cid  = parseInt(user && user.client_id) || 0;
  if (role === 'client_admin') {
    const st = String((user && user.state) || '').trim().replace(/'/g, "''");
    let f = `${alias}.client_id = ${cid}`;
    if (st) f += ` AND LOWER(TRIM(COALESCE(${alias}.state,''))) = LOWER('${st}')`;
    return f;
  }
  if (role === 'super_admin_client') {
    return `${alias}.client_id = ${cid}`;
  }
  return null; // main office staff — see everything
}

// ── Main vs client-manpower classification ───────────────────────────────────
// A person counts as "client / deployed manpower" if they are linked to a client
// (client_id set) OR their employee_code follows the deployed convention KC-C…
// (e.g. KC-C-0001). "Main" = own-company KC staff: no client_id AND not a KC-C code.
// Use these instead of a bare `client_id IS [NOT] NULL` so KC-C-coded staff are
// always grouped with client manpower even when their client_id wasn't filled in.
const CLIENT_CODE_LIKE = "ILIKE 'KC-C%'";

function clientManpowerFrag(alias = 'e') {
  const c = alias ? `${alias}.` : '';
  return `(${c}client_id IS NOT NULL OR ${c}employee_code ${CLIENT_CODE_LIKE})`;
}
function mainStaffFrag(alias = 'e') {
  const c = alias ? `${alias}.` : '';
  return `(${c}client_id IS NULL AND (${c}employee_code IS NULL OR ${c}employee_code NOT ${CLIENT_CODE_LIKE}))`;
}

// Roles that are client-side admins (scoped to one client).
const CLIENT_ADMIN_ROLES = ['client_admin', 'super_admin_client'];
const isClientSideAdmin  = (role) => CLIENT_ADMIN_ROLES.includes(String(role || '').toLowerCase());

module.exports = {
  clientScopeFragment, CLIENT_ADMIN_ROLES, isClientSideAdmin,
  clientManpowerFrag, mainStaffFrag, CLIENT_CODE_LIKE,
};
