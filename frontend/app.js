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
// Emoji icons — consistent size via CSS, clean and recognisable
const ICONS = {
  dashboard:    `🏠`,
  attendance:   `🕐`,
  leaves:       `🌿`,
  movement:     `🚶`,
  announcements:`📢`,
  form16:       `📋`,
  itdecl:       `🧾`,
  payslip:      `💳`,
  employees:    `👥`,
  offerletter:  `✉️`,
  separation:   `🚪`,
  payroll:      `💰`,
  advance:      `💸`,
  provision:    `⏳`,
  geofence:     `📍`,
};

const NAV_GROUPS = [
  {
    label: null,
    items: [
      { href:'dashboard.html',      icon: ICONS.dashboard,    label:'Dashboard',        roles:['admin','super_admin','hr','accounts','manager','tl'] },
    ]
  },
  {
    label: 'Workspace',
    items: [
      { href:'attendance.html',     icon: ICONS.attendance,   label:'Attendance',       always:true },
      { href:'leaves.html',         icon: ICONS.leaves,       label:'Leaves',           always:true },
      { href:'movement.html',       icon: ICONS.movement,     label:'Movement',         roles:['admin','super_admin','hr','manager','tl'] },
      { href:'announcements.html',  icon: ICONS.announcements,label:'Announcements',    always:true },
    ]
  },
  {
    label: 'Documents',
    items: [
      { href:'form16.html',         icon: ICONS.form16,       label:'Form 16',          always:true },
      { href:'it-declaration.html', icon: ICONS.itdecl,       label:'IT Declaration',   always:true },
      { href:'payslip.html',        icon: ICONS.payslip,      label:'My Payslip',       always:true },
    ]
  },
  {
    label: 'Organisation',
    items: [
      { href:'employees.html',      icon: ICONS.employees,    label:'Employees',        roles:['admin','super_admin','hr','accounts','manager','tl'] },
      { href:'offer-letter.html',   icon: ICONS.offerletter,  label:'Offer Letter',     roles:['hr','admin','super_admin'] },
      { href:'separation.html',     icon: ICONS.separation,   label:'Separation',       always:true },
    ]
  },
  {
    label: 'Finance',
    items: [
      { href:'payroll.html',        icon: ICONS.payroll,      label:'Payroll',          roles:['super_admin','hr','accounts'] },
      { href:'advance.html',        icon: ICONS.advance,      label:'Advance Salary',   always:true },
      { href:'provision.html',      icon: ICONS.provision,    label:'Provision',        roles:['admin','super_admin','hr','manager','tl'] },
    ]
  },
  {
    label: 'System',
    items: [
      { href:'geofence.html',       icon: ICONS.geofence,     label:'Geofence',         roles:['admin','super_admin','hr'] },
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
    logoEl.innerHTML = '<img src="data:image/png;base64,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" alt="Krishi Care" style="width:100%;height:100%;object-fit:cover;border-radius:10px;">';
  }

  const nav = document.getElementById('sidebar-nav'); if (!nav) return;

  // Build grouped nav HTML with collapsible sections
  // Load saved collapse states from localStorage
  let collapseState = {};
  try { collapseState = JSON.parse(localStorage.getItem('navCollapse') || '{}'); } catch(e) {}

  let html = '';
  for (const group of NAV_GROUPS) {
    const visibleItems = group.items.filter(l => l.always || (l.roles && l.roles.includes(user.role)));
    if (visibleItems.length === 0) continue;

    if (group.label) {
      const groupId = 'navgroup-' + group.label.replace(/\s+/g, '-').toLowerCase();
      const hasActive = visibleItems.some(l => l.href === activePage);
      // Default closed; open if user expanded it before OR if it contains the active page
      const savedOpen = collapseState[groupId]; // true/false/undefined
      const open = hasActive || savedOpen === true;
      html += `
        <div class="nav-section-header" data-group="${groupId}" onclick="toggleNavGroup('${groupId}')">
          <span class="nav-section-label-text">${group.label}</span>
          <span class="nav-section-chevron ${open ? 'open' : ''}">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M2 4L6 8L10 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </span>
        </div>
        <div class="nav-section-items ${open ? 'open' : ''}" id="${groupId}">
      `;
      for (const l of visibleItems) {
        html += `<a href="${l.href}" class="nav-link ${activePage === l.href ? 'active' : ''}"><span class="nav-icon">${l.icon}</span><span>${l.label}</span></a>`;
      }
      html += `</div>`;
    } else {
      // No label group (Dashboard) — always visible
      for (const l of visibleItems) {
        html += `<a href="${l.href}" class="nav-link ${activePage === l.href ? 'active' : ''}"><span class="nav-icon">${l.icon}</span><span>${l.label}</span></a>`;
      }
    }
  }
  nav.innerHTML = html;

  const u = document.getElementById('sidebar-user');
  if (u) u.innerHTML = `<div class="user-avatar">${(user.first_name?.[0]||'')}${(user.last_name?.[0]||'')}</div><div class="user-info" style="flex:1;min-width:0"><div class="user-name">${user.first_name} ${user.last_name}</div><div class="user-role" style="background:${Role.badge(user.role)}">${user.role.toUpperCase()}</div></div>`;
}

function toggleNavGroup(groupId) {
  const items = document.getElementById(groupId);
  const header = document.querySelector('[data-group="' + groupId + '"]');
  if (!items || !header) return;
  const chevron = header.querySelector(".nav-section-chevron");
  const isOpen = items.classList.contains("open");

  if (isOpen) {
    // Collapse with animation
    items.style.height = items.scrollHeight + "px";
    items.style.overflow = "hidden";
    items.style.transition = "height 0.25s ease";
    requestAnimationFrame(() => {
      items.style.height = "0px";
    });
    setTimeout(() => {
      items.classList.remove("open");
      items.style.height = "";
      items.style.overflow = "";
      items.style.transition = "";
    }, 260);
  } else {
    // Expand with animation
    items.classList.add("open");
    const h = items.scrollHeight;
    items.style.height = "0px";
    items.style.overflow = "hidden";
    items.style.transition = "height 0.25s ease";
    requestAnimationFrame(() => {
      items.style.height = h + "px";
    });
    setTimeout(() => {
      items.style.height = "";
      items.style.overflow = "";
      items.style.transition = "";
      // Force sidebar-nav to recalculate scroll
      const nav = document.getElementById("sidebar-nav");
      if (nav) { nav.style.overflow = "hidden"; requestAnimationFrame(() => { nav.style.overflow = "auto"; }); }
    }, 260);
  }

  if (chevron) chevron.classList.toggle("open", !isOpen);
  let collapseState = {};
  try { collapseState = JSON.parse(localStorage.getItem("navCollapse") || "{}"); } catch(e) {}
  collapseState[groupId] = !isOpen;
  localStorage.setItem("navCollapse", JSON.stringify(collapseState));
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
