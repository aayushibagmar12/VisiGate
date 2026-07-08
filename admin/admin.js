const API = 'http://localhost:3000/api';

// ── State ─────────────────────────────────────────────────────────────────────
let currentVisitorId     = null;
let currentPassId        = null;
let currentVisitorMobile = null;
let currentPreserve      = 0;
let detailMap            = null;
let overviewMap          = null;
let refreshTimer         = null;
let loggedInUser         = '';

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTH
// ═══════════════════════════════════════════════════════════════════════════════

async function doLogin() {
  const username = document.getElementById('loginUser').value.trim();
  const password = document.getElementById('loginPass').value;
  const errEl    = document.getElementById('loginError');
  errEl.classList.remove('show');

  try {
    const res  = await fetch(`${API}/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();

    if (data.success) {
      sessionStorage.setItem('vg_admin', data.username);
      loggedInUser = data.username;
      document.getElementById('loginPage').style.display = 'none';
      document.getElementById('app').style.display = 'block';
      document.getElementById('ddUsername').textContent = data.username;
      document.getElementById('acctBtn').textContent = data.username[0].toUpperCase();
      initApp();
    } else {
      errEl.textContent = data.message;
      errEl.classList.add('show');
    }
  } catch (e) {
    errEl.textContent = 'Cannot connect to server. Is it running?';
    errEl.classList.add('show');
  }
}

function doLogout() {
  sessionStorage.removeItem('vg_admin');
  clearInterval(refreshTimer);
  document.getElementById('app').style.display       = 'none';
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('loginUser').value = '';
  document.getElementById('loginPass').value = '';
  document.getElementById('loginError').classList.remove('show');
  closeDropdown();
}

// Enter key on login
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('loginPage').style.display !== 'none') doLogin();
});

// Auto-login if session exists
window.addEventListener('load', () => {
  const saved = sessionStorage.getItem('vg_admin');
  if (saved) {
    loggedInUser = saved;
    document.getElementById('loginPage').style.display = 'none';
    document.getElementById('app').style.display = 'block';
    document.getElementById('ddUsername').textContent = saved;
    document.getElementById('acctBtn').textContent = saved[0].toUpperCase();
    initApp();
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
//  ACCOUNT DROPDOWN
// ═══════════════════════════════════════════════════════════════════════════════

function toggleDropdown() {
  document.getElementById('acctDropdown').classList.toggle('open');
}
function closeDropdown() {
  document.getElementById('acctDropdown').classList.remove('open');
}
document.addEventListener('click', e => {
  if (!document.getElementById('acctBtn').contains(e.target) &&
      !document.getElementById('acctDropdown').contains(e.target)) {
    closeDropdown();
  }
});

async function createAccount() {
  const username = document.getElementById('newUser').value.trim();
  const password = document.getElementById('newPass').value;
  const errEl    = document.getElementById('addAcctError');
  errEl.classList.remove('show');

  if (!username || !password) {
    errEl.textContent = 'Both fields are required.';
    errEl.classList.add('show');
    return;
  }

  try {
    const res  = await fetch(`${API}/admin/create-account`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (data.success) {
      toast('Account created successfully', 'success');
      closeModal('addAccountModal');
      document.getElementById('newUser').value = '';
      document.getElementById('newPass').value = '';
    } else {
      errEl.textContent = data.message;
      errEl.classList.add('show');
    }
  } catch (e) {
    errEl.textContent = 'Network error.';
    errEl.classList.add('show');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  NAVIGATION
// ═══════════════════════════════════════════════════════════════════════════════

function initApp() {
  showPage('live');
  refreshTimer = setInterval(loadLive, 30000);
}

function showPage(name) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.getElementById('page-' + name).classList.add('active');
  document.getElementById('tab-'  + name).classList.add('active');
  closeDropdown();

  if (name === 'live')      loadLive();
  if (name === 'map')       loadOverviewMap();
  if (name === 'all')       loadAll();
  if (name === 'blacklist') loadBlacklist();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LIVE VISITORS
// ═══════════════════════════════════════════════════════════════════════════════

async function loadLive() {
  try {
    const [insideRes, allRes] = await Promise.all([
      fetch(`${API}/admin/visitors?status=inside`),
      fetch(`${API}/admin/visitors`)
    ]);
    const insideData = await insideRes.json();
    const allData    = await allRes.json();

    const inside = insideData.visitors || [];
    const all    = allData.visitors    || [];
    const today  = new Date().toDateString();
    const todayV = all.filter(v => v.check_in && new Date(v.check_in).toDateString() === today);

    document.getElementById('statInside').textContent = inside.length;
    document.getElementById('statToday').textContent  = todayV.length;
    document.getElementById('statTotal').textContent  = all.length;

    const tbody = document.getElementById('liveBody');
    tbody.innerHTML = '';

    if (inside.length === 0) {
      document.getElementById('liveEmpty').style.display = 'block';
      return;
    }
    document.getElementById('liveEmpty').style.display = 'none';

    inside.forEach(v => {
      const tr = document.createElement('tr');
      tr.classList.add('clickable');
      tr.dataset.visitorId = v.id;
      tr.innerHTML = `
        <td>${photoCell(v.photo_path)}</td>
        <td><strong>${esc(v.name)}</strong></td>
        <td>${esc(v.mobile)}</td>
        <td style="font-size:.8rem;color:var(--muted)">${esc(v.id_type||'—')}</td>
        <td>${fmtTime(v.check_in)}</td>
        <td style="font-size:.78rem;color:var(--primary)">${esc(v.pass_id)}</td>
        <td>
          <button class="btn btn-ghost" style="font-size:.78rem;padding:6px 12px"
            onclick="event.stopPropagation();openExitModalDirect('${esc(v.pass_id)}')">
            Exit
          </button>
        </td>`;
      tr.addEventListener('click', () => openDetail(v.id));
      tbody.appendChild(tr);
    });
  } catch (e) {
    toast('Could not load live visitors', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  OVERVIEW MAP
// ═══════════════════════════════════════════════════════════════════════════════

const CAMPUS = [21.127956, 81.765625]; // IIIT Naya Raipur

async function loadOverviewMap() {
  if (!overviewMap) {
    overviewMap = L.map('overviewMap').setView(CAMPUS, 17);
    L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
        subdomains: ['mt0','mt1','mt2','mt3'],
        attribution: '© Google Maps',
        maxZoom: 20
}).addTo(overviewMap);
  }

  // Clear existing markers
  overviewMap.eachLayer(layer => {
    if (layer instanceof L.Marker || layer instanceof L.CircleMarker) {
      overviewMap.removeLayer(layer);
    }
  });

  try {
    const res  = await fetch(`${API}/admin/visitors?status=inside`);
    const data = await res.json();
    const visitors = data.visitors || [];

    let placed = 0;
    for (const v of visitors) {
      const locRes  = await fetch(`${API}/admin/visitor/${v.id}`);
      const locData = await locRes.json();
      const logs    = locData.location_logs || [];
      if (logs.length === 0) continue;

      const last = logs[logs.length - 1];
      const marker = L.circleMarker([last.latitude, last.longitude], {
        radius: 10, color: '#4f46e5', fillColor: '#4f46e5',
        fillOpacity: 0.85, weight: 2
      }).addTo(overviewMap);
      marker.bindPopup(`
        <strong>${esc(v.name)}</strong><br/>
        📱 ${esc(v.mobile)}<br/>
        🕐 In: ${fmtTime(v.check_in)}<br/>
        📍 Last seen: ${fmtTime(last.recorded_at)}
      `);
      placed++;
    }

    if (placed === 0) {
      L.marker(CAMPUS)
        .addTo(overviewMap)
        .bindPopup('IIIT Naya Raipur — No active location data')
        .openPopup();
    }
  } catch (e) {
    toast('Could not load map data', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ALL VISITS
// ═══════════════════════════════════════════════════════════════════════════════

async function loadAll() {
  const search = document.getElementById('searchInput').value.trim();
  const status = document.getElementById('statusFilter').value;
  const date   = document.getElementById('dateFilter').value;

  let url = `${API}/admin/visitors?`;
  if (search) url += `search=${encodeURIComponent(search)}&`;
  if (status) url += `status=${encodeURIComponent(status)}&`;

  try {
    const res  = await fetch(url);
    const data = await res.json();
    let visitors = data.visitors || [];

    if (date) visitors = visitors.filter(v => v.check_in && v.check_in.startsWith(date));

    const tbody = document.getElementById('allBody');
    tbody.innerHTML = '';

    if (visitors.length === 0) {
      document.getElementById('allEmpty').style.display = 'block';
      return;
    }
    document.getElementById('allEmpty').style.display = 'none';

    visitors.forEach(v => {
      const tr = document.createElement('tr');
      tr.classList.add('clickable');
      tr.dataset.visitorId = v.id;
      tr.innerHTML = `
        <td>${photoCell(v.photo_path)}</td>
        <td><strong>${esc(v.name)}</strong></td>
        <td>${esc(v.mobile)}</td>
        <td>${statusBadge(v.status)}</td>
        <td>${fmtTime(v.check_in)}</td>
        <td>${v.check_out ? fmtTime(v.check_out) : '<span style="color:var(--muted)">—</span>'}</td>
        <td style="font-size:.78rem;color:var(--primary)">${esc(v.pass_id)}</td>`;
      tr.addEventListener('click', () => openDetail(v.id));
      tbody.appendChild(tr);
    });
  } catch (e) {
    toast('Could not load visits', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  VISITOR DETAIL
// ═══════════════════════════════════════════════════════════════════════════════

async function openDetail(id) {
  currentVisitorId = id;
  try {
    const res  = await fetch(`${API}/admin/visitor/${id}`);
    const data = await res.json();
    if (!data.success) return toast('Could not load visitor', 'error');

    const { visitor, location_logs, location_gaps } = data;
    currentPassId        = visitor.pass_id;
    currentVisitorMobile = visitor.mobile;
    currentPreserve      = visitor.preserve_location || 0;

    // Fill fields
    document.getElementById('detailTitle').textContent = visitor.name;
    document.getElementById('dName').textContent    = visitor.name;
    document.getElementById('dAge').textContent     = visitor.age || '—';
    document.getElementById('dMobile').textContent  = visitor.mobile;
    document.getElementById('dIdType').textContent  = visitor.id_type || '—';
    document.getElementById('dIdNum').textContent   = visitor.id_number || '—';
    document.getElementById('dPassId').textContent  = visitor.pass_id;
    document.getElementById('dStatus').innerHTML    = statusBadge(visitor.status);
    document.getElementById('dCheckIn').textContent = fmtTime(visitor.check_in);
    document.getElementById('dCheckOut').textContent = visitor.check_out ? fmtTime(visitor.check_out) : '—';
    document.getElementById('dPreserve').textContent = currentPreserve ? '✅ Saved permanently' : '⏳ 7-day auto-delete';

    // Photo
    const imgEl = document.getElementById('visitorPhotoLg');
    const phEl  = document.getElementById('visitorPhotoPlaceholder');
    if (visitor.photo_path) {
      imgEl.src = `http://localhost:3000${visitor.photo_path}`;
      imgEl.style.display = 'block'; phEl.style.display = 'none';
    } else {
      imgEl.style.display = 'none'; phEl.style.display = 'flex';
    }

    // Delete name
    document.getElementById('deleteVisitorName').textContent = visitor.name;

    // Exit button visibility
    const exitBtn = document.getElementById('exitBtn');
    exitBtn.style.display = (visitor.status === 'inside' || visitor.status === 'checked_in') ? 'inline-flex' : 'none';

    // Preserve toggle
    updatePreserveUI(currentPreserve);

    // Map
    buildDetailMap(location_logs);

    // Gaps
    buildGaps(location_gaps);

    // Past visits
    await loadPastVisits(visitor.mobile, visitor.id);

    openModal('detailModal');
    setTimeout(() => { if (detailMap) detailMap.invalidateSize(); }, 300);
  } catch (e) {
    toast('Error loading visitor detail', 'error');
  }
}

function updatePreserveUI(val) {
  const tog = document.getElementById('preserveToggle');
  const lbl = document.getElementById('preserveLabel');
  const sub = document.getElementById('preserveSub');
  const btn = document.getElementById('preserveBtn');
  const ico = document.getElementById('preserveIcon');

  if (val) {
    tog.classList.add('active');
    ico.textContent = '✅';
    lbl.textContent = 'Location data saved permanently';
    sub.textContent = 'Click to remove permanent save and allow auto-delete';
    btn.textContent = 'Remove save';
    btn.className   = 'btn btn-ghost';
  } else {
    tog.classList.remove('active');
    ico.textContent = '⚠️';
    lbl.textContent = 'Location data will be deleted after 7 days';
    sub.textContent = 'Toggle to save permanently for investigation';
    btn.textContent = 'Save permanently';
    btn.className   = 'btn btn-primary';
    btn.style.fontSize = '.8rem';
    btn.style.padding  = '7px 14px';
  }
}

async function togglePreserve() {
  try {
    const res  = await fetch(`${API}/admin/visitor/${currentVisitorId}/preserve`, { method: 'PATCH' });
    const data = await res.json();
    if (data.success) {
      currentPreserve = data.preserve_location;
      updatePreserveUI(currentPreserve);
      document.getElementById('dPreserve').textContent = currentPreserve ? '✅ Saved permanently' : '⏳ 7-day auto-delete';
      toast(currentPreserve ? 'Location data saved permanently' : 'Reverted to 7-day auto-delete', 'success');
    }
  } catch (e) {
    toast('Could not update preserve setting', 'error');
  }
}

function buildDetailMap(logs) {
  const mapDiv = document.getElementById('detailMap');
  const noMap  = document.getElementById('noMap');

  if (detailMap) { detailMap.remove(); detailMap = null; }

  if (!logs || logs.length === 0) {
    mapDiv.style.display = 'none';
    noMap.style.display = 'block';
    return;
}
mapDiv.style.display = 'block';
noMap.style.display = 'none';

  const coords = logs.map(l => [l.latitude, l.longitude]);
  detailMap = L.map('detailMap', { maxZoom: 20 }).setView(coords[coords.length - 1], 17);
  L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
    subdomains: ['mt0','mt1','mt2','mt3'],
    attribution: '© Google Maps',
    maxZoom: 20
}).addTo(detailMap);

  L.polyline(coords, { color: '#4f46e5', weight: 3, opacity: .7 }).addTo(detailMap);

  coords.forEach((c, i) => {
    const isFirst = i === 0, isLast = i === coords.length - 1;
    const color = isFirst ? '#16a34a' : isLast ? '#dc2626' : '#4f46e5';
    L.circleMarker(c, { radius: isFirst||isLast ? 8 : 4, color, fillColor: color, fillOpacity: 1, weight: 2 })
      .addTo(detailMap)
      .bindPopup(`${isFirst ? '🟢 Start' : isLast ? '🔴 Last' : '📍'} ${fmtTime(logs[i].recorded_at)}`);
  });

  detailMap.fitBounds(L.latLngBounds(coords).pad(0.15));
}

function buildGaps(gaps) {
  const list  = document.getElementById('gapsList');
  const noGap = document.getElementById('noGaps');
  list.innerHTML = '';

  if (!gaps || gaps.length === 0) { noGap.style.display = 'block'; return; }
  noGap.style.display = 'none';

  gaps.forEach(g => {
    const div = document.createElement('div');
    div.className = 'gap-entry';
    div.textContent = `⚠️ Location was off from ${fmtTime(g.gap_start)} to ${g.gap_end ? fmtTime(g.gap_end) : 'still off'}`;
    list.appendChild(div);
  });
}

async function loadPastVisits(mobile, excludeId) {
  const div = document.getElementById('pastVisits');
  div.innerHTML = '';
  try {
    const res  = await fetch(`${API}/admin/visitors?search=${encodeURIComponent(mobile)}`);
    const data = await res.json();
    const past = (data.visitors || []).filter(v => v.id !== excludeId);
    if (past.length === 0) {
      div.innerHTML = '<div style="color:var(--muted);font-size:.83rem;padding:6px 0">No previous visits on record.</div>';
      return;
    }
    past.forEach(v => {
      const row = document.createElement('div');
      row.className = 'past-visit-row';
      row.innerHTML = `
        <span>${fmtTime(v.check_in)}</span>
        ${statusBadge(v.status)}
        <span style="font-size:.75rem;color:var(--primary)">${esc(v.pass_id)}</span>`;
      div.appendChild(row);
    });
  } catch (e) { /* silent */ }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MANUAL EXIT
// ═══════════════════════════════════════════════════════════════════════════════

function openExitModal() {
  document.querySelectorAll('input[name="exitReason"]').forEach(r => r.checked = false);
  document.getElementById('exitOtherText').style.display = 'none';
  document.getElementById('exitOtherText').value = '';
  openModal('exitModal');
}

function openExitModalDirect(passId) {
  currentPassId = passId;
  openExitModal();
}

document.querySelectorAll('input[name="exitReason"]').forEach(r => {
  r.addEventListener('change', () => {
    document.getElementById('exitOtherText').style.display = r.value === 'Other' ? 'block' : 'none';
  });
});

async function confirmExit() {
  const selected = document.querySelector('input[name="exitReason"]:checked');
  if (!selected) return toast('Please select a reason', 'error');

  let reason = selected.value;
  if (reason === 'Other') {
    const txt = document.getElementById('exitOtherText').value.trim();
    if (!txt) return toast('Please describe the reason', 'error');
    reason = txt;
  }

  try {
    const res  = await fetch(`${API}/guard/exit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pass_id: currentPassId, note: `Admin manual exit — ${reason}` })
    });
    const data = await res.json();
    if (data.success) {
      toast('Visitor marked as exited', 'success');
      closeModal('exitModal');
      closeModal('detailModal');
      loadLive();
    } else {
      toast(data.message || 'Exit failed', 'error');
    }
  } catch (e) {
    toast('Network error', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DELETE VISITOR
// ═══════════════════════════════════════════════════════════════════════════════

function openDeleteConfirm() { openModal('deleteModal'); }

async function confirmDelete() {
  try {
    const res  = await fetch(`${API}/admin/visitor/${currentVisitorId}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) {
      toast('Visitor record deleted', 'success');
      closeModal('deleteModal');
      closeModal('detailModal');
      // Immediately remove matching rows from both visible tables
      document.querySelectorAll(`[data-visitor-id="${currentVisitorId}"]`)
        .forEach(row => row.remove());
      // Then refresh tables in background to sync server state
      loadLive();
      loadAll();
    } else {
      toast(data.message || 'Delete failed', 'error');
    }
  } catch (e) {
    toast('Network error', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BLOCK FROM DETAIL
// ═══════════════════════════════════════════════════════════════════════════════

async function blockFromDetail() {
  if (!confirm(`Block ${currentVisitorMobile}? They will not be able to check in again.`)) return;
  try {
    const res  = await fetch(`${API}/admin/blacklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: currentVisitorMobile, reason: 'Blocked by admin from visitor detail' })
    });
    const data = await res.json();
    if (data.success) {
      toast(`${currentVisitorMobile} has been blocked`, 'success');
      closeModal('detailModal');
    } else {
      toast(data.message || 'Block failed', 'error');
    }
  } catch (e) {
    toast('Network error', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BLACKLIST
// ═══════════════════════════════════════════════════════════════════════════════

async function loadBlacklist() {
  try {
    const res  = await fetch(`${API}/admin/blacklist`);
    const data = await res.json();
    const list = data.blacklist || [];
    const tbody = document.getElementById('blBody');
    tbody.innerHTML = '';

    if (list.length === 0) {
      document.getElementById('blEmpty').style.display = 'block'; return;
    }
    document.getElementById('blEmpty').style.display = 'none';

    list.forEach(b => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td><strong>${esc(b.mobile)}</strong></td>
        <td>${esc(b.reason || '—')}</td>
        <td>${fmtTime(b.created_at)}</td>
        <td>
          <button class="btn btn-ghost" style="font-size:.78rem;padding:6px 12px"
            onclick="removeBlacklist('${esc(b.mobile)}')">Unblock</button>
        </td>`;
      tbody.appendChild(tr);
    });
  } catch (e) {
    toast('Could not load blacklist', 'error');
  }
}

async function addBlacklist() {
  const mobile = document.getElementById('blMobile').value.trim();
  const reason = document.getElementById('blReason').value.trim();
  if (!mobile) return toast('Enter a mobile number', 'error');
  try {
    const res  = await fetch(`${API}/admin/blacklist`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, reason })
    });
    const data = await res.json();
    if (data.success) {
      toast('Number blocked', 'success');
      document.getElementById('blMobile').value = '';
      document.getElementById('blReason').value = '';
      loadBlacklist();
    } else {
      toast(data.message || 'Failed', 'error');
    }
  } catch (e) {
    toast('Network error', 'error');
  }
}

async function removeBlacklist(mobile) {
  if (!confirm(`Unblock ${mobile}?`)) return;
  try {
    const res  = await fetch(`${API}/admin/blacklist/${encodeURIComponent(mobile)}`, { method: 'DELETE' });
    const data = await res.json();
    if (data.success) { toast('Number unblocked', 'success'); loadBlacklist(); }
    else toast(data.message || 'Failed', 'error');
  } catch (e) {
    toast('Network error', 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function openModal(id)  {
  document.getElementById(id).classList.add('open');
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
});

function esc(str) {
  if (str == null) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function statusBadge(status) {
  const map = {
    inside:      ['inside',  '● Inside'],
    checked_in:  ['inside',  '● Checked In'],
    checked_out: ['exited',  '✓ Exited'],
    pending:     ['pending', '○ Pending'],
  };
  const [cls, label] = map[status] || ['exited', status];
  return `<span class="badge badge-${cls}">${label}</span>`;
}

function photoCell(path) {
  if (path) return `<img src="http://localhost:3000${path}" class="visitor-photo" alt="photo" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"/><div class="photo-placeholder" style="display:none">👤</div>`;
  return `<div class="photo-placeholder">👤</div>`;
}

function toast(msg, type = 'info') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => t.className = '', 3000);
}