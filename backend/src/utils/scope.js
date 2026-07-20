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

// Roles that are client-side admins (scoped to one client).
const CLIENT_ADMIN_ROLES = ['client_admin', 'super_admin_client'];
const isClientSideAdmin  = (role) => CLIENT_ADMIN_ROLES.includes(String(role || '').toLowerCase());

module.exports = { clientScopeFragment, CLIENT_ADMIN_ROLES, isClientSideAdmin };
