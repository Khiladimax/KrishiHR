// app.js — Shared utilities for all KrishiHR pages
const API_BASE = 'https://krishihr-zuui.onrender.com/api';

const Auth = {
  getToken:   () => localStorage.getItem('krishihr_token'),
  getUser:    () => JSON.parse(localStorage.getItem('krishihr_user') || 'null'),
  setSession: (token, user) => { localStorage.setItem('krishihr_token', token); localStorage.setItem('krishihr_user', JSON.stringify(user)); },
  clear:      () => { localStorage.removeItem('krishihr_token'); localStorage.removeItem('krishihr_user'); },
  guard:      () => { if (!Auth.getToken()) { window.location.href = 'login.html'; return false; } return true; },
  guardDashboard: () => {
    if (!Auth.getToken()) { window.location.href = 'login.html'; return false; }
    if (!['admin','super_admin','hr','accounts'].includes(Auth.getUser()?.role)) { window.location.href = 'attendance.html'; return false; }
    return true;
  },
  logout: () => { Auth.clear(); window.location.href = 'login.html'; },
  getForgotToken: (token) => {
    const params = new URLSearchParams(window.location.search);
    return params.get('token');
  },
};

async function api(method, path, body, _retry = 0) {
  const token = Auth.getToken();
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    // FIX: abort if server takes > 15s (Render cold-start can be slow)
    signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined,
  };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(API_BASE + path, opts);
    if (res.status === 401) { Auth.logout(); return null; }
    // FIX: guard against non-JSON responses (e.g. 502/504 HTML error pages from Render cold-start)
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      const text = await res.text();
      console.warn('KrishiHR: Non-JSON response from', path, res.status, text.slice(0, 120));
      if ((res.status === 502 || res.status === 503 || res.status === 504) && _retry === 0) {
        toast('Server is starting up… retrying in 3s', 'warning');
        await new Promise(r => setTimeout(r, 3000));
        return api(method, path, body, 1);
      }
      return { success: false, message: 'Server error (' + res.status + ') — please try again' };
    }
    return await res.json();
  } catch (e) {
    if (e.name === 'AbortError') return { success: false, message: 'Request timed out — server may be starting, please retry in a moment' };
    return { success: false, message: 'Cannot connect to server' };
  }
}

function toast(msg, type = 'success') {
  let el = document.getElementById('__toast');
  if (!el) {
    el = document.createElement('div'); el.id = '__toast';
    el.style.cssText = `position:fixed;bottom:24px;right:24px;z-index:9999;padding:13px 20px;border-radius:12px;font-size:13.5px;font-weight:600;font-family:'Plus Jakarta Sans',sans-serif;max-width:360px;box-shadow:0 8px 32px rgba(15,23,42,.18);transition:all .3s cubic-bezier(.4,0,.2,1);transform:translateY(80px);opacity:0;display:flex;align-items:center;gap:10px;min-width:240px;`;
    document.body.appendChild(el);
  }
  const icons={success:'✓',error:'✕',warning:'⚠'}, colors={success:'#10b981',error:'#ef4444',warning:'#f59e0b'};
  el.innerHTML = `<span style="width:22px;height:22px;border-radius:50%;background:${colors[type]||colors.success};color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;flex-shrink:0">${icons[type]||icons.success}</span><span>${msg}</span>`;
  el.style.cssText += `background:#0f172a;color:#fff;border-left:3px solid ${colors[type]||colors.success};transform:translateY(0);opacity:1;`;
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.transform='translateY(80px)'; el.style.opacity='0'; }, 3500);
}

const fmt = {
  date:   s => { if (!s) return '—'; return new Date(s).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); },
  time:   s => { if (!s) return '—'; return String(s).slice(0,5); },
  money:  n => '₹'+(parseFloat(n)||0).toLocaleString('en-IN',{minimumFractionDigits:0}),
  num:    n => parseFloat(n||0).toFixed(1),
  ago:    s => { if (!s) return ''; const d=(Date.now()-new Date(s))/1000; if(d<60) return 'just now'; if(d<3600) return Math.floor(d/60)+'m ago'; if(d<86400) return Math.floor(d/3600)+'h ago'; return Math.floor(d/86400)+'d ago'; },
  months: ['January','February','March','April','May','June','July','August','September','October','November','December'],
};

const Role = {
  is:            (...r) => r.includes(Auth.getUser()?.role),
  isAdminOrHR:   ()     => Role.is('admin','hr','accounts'),          // super_admin EXCLUDED — view only
  isAdminOnly:   ()     => Role.is('admin','super_admin'),
  isManagerUp:   ()     => Role.is('admin','super_admin','hr','accounts','manager'),
  isDashboard:   ()     => Role.is('admin','super_admin','hr','accounts','manager','tl'),
  canApproveLeave: ()   => Role.is('admin','manager','tl'),            // only these can approve leaves
  canUploadPayroll: ()  => Role.is('accounts'),                        // only accounts can upload payroll
  canProcessAdvancePayment: () => Role.is('accounts'),                 // only accounts can mark advance paid
  badge: r => ({admin:'#ef4444',super_admin:'#7c3aed',hr:'#10b981',accounts:'#f59e0b',manager:'#4361ee',tl:'#f59e0b',employee:'#6b7280'})[r]||'#6b7280',
};

// SVG icons — consistent, clean, professional
const ICONS = {
  dashboard:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>`,
  attendance:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>`,
  announcements:`<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 8s-4 4-10 4S2 8 2 8"/><path d="M2 8v8a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8"/><path d="M6 8V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3"/></svg>`,
  form16:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14,2 14,8 20,8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10,9 9,9 8,9"/></svg>`,
  itdecl:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>`,
  leaves:      `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10z"/><path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12"/></svg>`,
  movement:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="10" r="3"/><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/></svg>`,
  separation:  `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16,17 21,12 16,7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>`,
  advance:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`,
  employees:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  offerletter: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>`,
  payroll:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>`,
  payslip:     `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 12V22H4V12"/><path d="M22 7H2v5h20V7z"/><path d="M12 22V7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>`,
  provision:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12,6 12,12 16,14"/></svg>`,
  reshuffle:   `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16,3 21,3 21,8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21,16 21,21 16,21"/><line x1="15" y1="15" x2="21" y2="21"/></svg>`,
  geofence:    `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="3,6 9,3 15,6 21,3 21,18 15,21 9,18 3,21"/><line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/></svg>`,
};

// NAV grouped: Dashboard first, then Employee section (always), then Management section (roles), then Settings
const NAV_GROUPS = [
  {
    label: null, // no section header for dashboard
    items: [
      { href:'dashboard.html',      icon: ICONS.dashboard,    label:'Dashboard',       roles:['admin','super_admin','hr','accounts','manager','tl'] },
    ]
  },
  {
    label: 'Employee',
    items: [
      { href:'attendance.html',     icon: ICONS.attendance,   label:'Attendance',      always:true },
      { href:'announcements.html',  icon: ICONS.announcements,label:'Announcements',   always:true },
      { href:'form16.html',         icon: ICONS.form16,       label:'Form 16',         always:true },
      { href:'it-declaration.html', icon: ICONS.itdecl,       label:'IT Declaration',  always:true },
      { href:'leaves.html',         icon: ICONS.leaves,       label:'Leaves',          always:true },
      { href:'movement.html',       icon: ICONS.movement,     label:'Movement',        roles:['admin','super_admin','hr','manager','tl'] },
      { href:'separation.html',     icon: ICONS.separation,   label:'Separation',      always:true },
    ]
  },
  {
    label: 'Finance',
    items: [
      { href:'advance.html',        icon: ICONS.advance,      label:'Advance Salary',  always:true },
      { href:'payslip.html',        icon: ICONS.payslip,      label:'My Payslip',      always:true },
      { href:'payroll.html',        icon: ICONS.payroll,      label:'Payroll',         roles:['super_admin','hr','accounts'] },
    ]
  },
  {
    label: 'Management',
    items: [
      { href:'employees.html',      icon: ICONS.employees,    label:'Employees',       roles:['admin','super_admin','hr','accounts','manager','tl'] },
      { href:'offer-letter.html',   icon: ICONS.offerletter,  label:'Offer Letter',    roles:['hr','admin','super_admin'] },
      { href:'provision.html',      icon: ICONS.provision,    label:'Provision',       roles:['admin','super_admin','hr','manager','tl'] },
      { href:'reshuffle.html',      icon: ICONS.reshuffle,    label:'Reshuffle',       roles:['admin','super_admin','hr'] },
    ]
  },
  {
    label: 'Settings',
    items: [
      { href:'geofence.html',       icon: ICONS.geofence,     label:'Geofence',        roles:['admin','super_admin','hr'] },
    ]
  },
];

// Flat NAV kept for any code that references it
const NAV = NAV_GROUPS.flatMap(g => g.items);

function buildSidebar(activePage) {
  const user = Auth.getUser(); if (!user) return;

  // Inject logo
  const logoEl = document.getElementById('sidebar-logo-mark');
  if (logoEl) {
    logoEl.innerHTML = '<img src="data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoH BwYIDAoMCwsKCwsNCxAQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAE+AVADASIAAhEBAxEB/8QAHQAAAQQDAQEAAAAAAAAAAAAAAAEFBgcCAwQICf/EAFIQAAEDAwEEBAcLCQYDCAMAAAEAAgMEBREGBxIhMUFRYXETIjZygbHRFBcyM1V0kZOhssEIFSM1QkNSc5IWJDRiguFFU9IlJmNklKLw8URUg//EABsBAAEFAQEAAAAAAAAAAAAAAAABAwQFBgIH/8QAOREAAQMCBAMECAYBBQEAAAAAAQACAwQRBRIhMRMUQVFScZEGFSIyM2GBoSM0QrHB0RYkJTVD8PH/2gAMAwEAAhEDEQA/APGSELbTQS1M7III3SSvOGtaMklCFr6eCkendG3++4dR0bmw" alt="Krishi Care" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">';
  }

  const nav = document.getElementById('sidebar-nav'); if (!nav) return;

  // Build grouped nav HTML
  let html = '';
  for (const group of NAV_GROUPS) {
    const visibleItems = group.items.filter(l => l.always || (l.roles && l.roles.includes(user.role)));
    if (visibleItems.length === 0) continue;

    if (group.label) {
      html += `<div class="nav-section-label">${group.label}</div>`;
    }
    for (const l of visibleItems) {
      html += `<a href="${l.href}" class="nav-link ${activePage === l.href ? 'active' : ''}"><span class="nav-icon">${l.icon}</span><span>${l.label}</span></a>`;
    }
  }
  nav.innerHTML = html;

  const u = document.getElementById('sidebar-user');
  if (u) u.innerHTML = `<div class="user-avatar">${(user.first_name?.[0]||'')}${(user.last_name?.[0]||'')}</div><div class="user-info" style="flex:1;min-width:0"><div class="user-name">${user.first_name} ${user.last_name}</div><div class="user-role" style="background:${Role.badge(user.role)}">${user.role.toUpperCase()}</div></div>`;
}

function getNotifDeepLink(n) {
  const type = n.reference_type || '';
  const id   = n.reference_id   || '';
  if (type === 'attendance_regularization') return `attendance.html#regularize:${id}`;
  if (type === 'leave')                     return `leaves.html`;
  if (type === 'advance')                   return `advance.html`;
  if (type === 'payslip')                   return `payroll.html`;
  return null;
}

async function loadNotifBadge() {
  const data = await api('GET', '/notifications');
  if (!data?.success) return;

  const unread = data.unread || 0;
  const notifs = data.data   || [];

  // Badge
  const badge = document.getElementById('notif-badge');
  if (badge) {
    if (unread > 0) { badge.textContent = unread > 99 ? '99+' : unread; badge.style.display = 'flex'; }
    else             { badge.style.display = 'none'; }
  }

  // Bell button — inject if not present
  const bellBtn = document.getElementById('notif-bell-btn');
  if (!bellBtn) return;

  // Panel
  let panel = document.getElementById('notif-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'notif-panel';
    panel.style.cssText = `
      display:none;position:fixed;top:56px;right:16px;z-index:9998;
      width:360px;max-height:480px;overflow-y:auto;
      background:#fff;border-radius:16px;box-shadow:0 8px 40px rgba(15,23,42,.18);
      border:1px solid #e2e8f0;font-family:'DM Sans',sans-serif;`;
    document.body.appendChild(panel);
  }

  function renderPanel() {
    panel.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid #f1f5f9;position:sticky;top:0;background:#fff;z-index:1">
        <div style="font-weight:700;font-size:15px;color:#0f172a">Notifications</div>
        <div style="display:flex;gap:8px;align-items:center">
          <button onclick="markAllNotifsRead()" style="font-size:11px;color:#10b981;font-weight:600;background:none;border:none;cursor:pointer;padding:4px 8px;border-radius:6px;hover:background:#f0fdf4">Mark all read</button>
          <button onclick="document.getElementById('notif-panel').style.display='none'" style="background:none;border:none;cursor:pointer;font-size:18px;color:#94a3b8;line-height:1">×</button>
        </div>
      </div>
      ${notifs.length === 0
        ? `<div style="padding:32px;text-align:center;color:#94a3b8;font-size:13px">No notifications</div>`
        : notifs.map(n => {
            const link    = getNotifDeepLink(n);
            const isUnread= !n.is_read;
            return `
            <div onclick="handleNotifClick(${n.id},'${link||''}')"
                 style="padding:14px 16px;border-bottom:1px solid #f8fafc;cursor:${link?'pointer':'default'};
                        background:${isUnread?'#f0fdf4':'#fff'};transition:background .15s"
                 onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background='${isUnread?'#f0fdf4':'#fff'}'">
              <div style="display:flex;gap:10px;align-items:flex-start">
                <div style="font-size:20px;flex-shrink:0;margin-top:1px">${n.title?.match(/[\u{1F300}-\u{1FFFF}]|[\u2600-\u27FF]/u)?.[0] || '🔔'}</div>
                <div style="flex:1;min-width:0">
                  <div style="font-weight:${isUnread?'700':'600'};font-size:13px;color:#0f172a;margin-bottom:2px">${n.title}</div>
                  <div style="font-size:12px;color:#64748b;line-height:1.45">${n.message}</div>
                  <div style="font-size:11px;color:#94a3b8;margin-top:5px">${fmt.ago(n.created_at)}</div>
                </div>
                ${isUnread ? `<div style="width:8px;height:8px;border-radius:50%;background:#10b981;flex-shrink:0;margin-top:5px"></div>` : ''}
              </div>
            </div>`;
          }).join('')
      }`;
  }

  renderPanel();

  // Toggle on bell click
  bellBtn.onclick = (e) => {
    e.stopPropagation();
    const visible = panel.style.display === 'block';
    panel.style.display = visible ? 'none' : 'block';
    if (!visible) loadNotifBadge(); // refresh on open
  };

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (panel.style.display === 'block' && !panel.contains(e.target) && e.target !== bellBtn)
      panel.style.display = 'none';
  }, { once: false });
}

async function handleNotifClick(id, link) {
  await api('PATCH', `/notifications/${id}/read`);
  if (link) window.location.href = link;
}

async function markAllNotifsRead() {
  await api('PATCH', '/notifications/read-all');
  document.getElementById('notif-panel').style.display = 'none';
  loadNotifBadge();
}

function openModal(id)  { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) { document.getElementById(id)?.classList.remove('open'); }
document.addEventListener('click', e => { if (e.target.classList.contains('modal-backdrop')) e.target.classList.remove('open'); });

// ── Sidebar mobile toggle ─────────────────────────────────────────
function toggleSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (!sidebar) return;
  sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('open');
}
function closeSidebar() {
  const sidebar = document.querySelector('.sidebar');
  const overlay = document.getElementById('sidebar-overlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('open');
}
