const API = 'http://localhost:3000/api';

// ── State ─────────────────────────────────────────────────────────────────────
let scanMode         = null;   // 'ENTRY' or 'EXIT'
let scannedPassId    = null;
let scannedVisitor   = null;   // full visitor data from QR
let manualExitPassId = null;
let html5QrCode      = null;
let searchDebounce   = null;

// ═══════════════════════════════════════════════════════════════════════════════
//  QR SCANNING
// ═══════════════════════════════════════════════════════════════════════════════

function startScan(mode) {
    scanMode = mode;
    document.getElementById('scannerTitle').textContent =
        mode === 'ENTRY' ? 'Scanning Entry QR' : 'Scanning Exit QR';
    document.getElementById('scannerOverlay').classList.add('open');

    html5QrCode = new Html5Qrcode('qr-reader');
    html5QrCode.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        onQrSuccess,
        () => {} // ignore scan failures
    ).catch(err => {
        console.error('Camera error:', err);
        toast('Could not access camera', 'error');
        stopScan();
    });
}

function stopScan() {
    if (html5QrCode) {
        html5QrCode.stop().then(() => {
            html5QrCode.clear();
            html5QrCode = null;
        }).catch(() => {
            html5QrCode = null;
        });
    }
    document.getElementById('scannerOverlay').classList.remove('open');
}

async function onQrSuccess(decodedText) {
    // Stop scanning immediately
    stopScan();

    let qrData;
    try {
        qrData = JSON.parse(decodedText);
    } catch {
        toast('Invalid QR code format', 'error');
        return;
    }

    if (!qrData.passId) {
        toast('QR code does not contain a valid pass ID', 'error');
        return;
    }

    // Store full visitor data from QR
    scannedPassId = qrData.passId;
    scannedVisitor = {
        pass_id:    qrData.passId,
        name:       qrData.name || '—',
        age:        qrData.age || null,
        mobile:     qrData.mobile || '—',
        id_type:    qrData.id_type || null,
        id_number:  qrData.id_number || null,
        photo_path: qrData.photo_path || null,
        time:       qrData.time || null,
    };

    // For exit mode, also try to fetch check-in time from server
    if (scanMode === 'EXIT') {
        try {
            const res = await fetch(`${API}/guard/scan/${encodeURIComponent(scannedPassId)}`);
            const data = await res.json();
            if (data.success && data.visitor) {
                // Merge server data (has check_in, status, etc.)
                scannedVisitor.check_in = data.visitor.check_in;
                scannedVisitor.status   = data.visitor.status;
                scannedVisitor.photo_path = data.visitor.photo_path || scannedVisitor.photo_path;
            }
        } catch {
            // Use QR data as fallback
        }
    }

    showResult(scannedVisitor);
}

// ═══════════════════════════════════════════════════════════════════════════════
//  RESULT DISPLAY
// ═══════════════════════════════════════════════════════════════════════════════

function showResult(visitor) {
    // Photo
    const imgEl = document.getElementById('resultPhoto');
    const phEl  = document.getElementById('resultPhotoPlaceholder');
    if (visitor.photo_path) {
        imgEl.src = `http://localhost:3000${visitor.photo_path}`;
        imgEl.style.display = 'block';
        phEl.style.display  = 'none';
    } else {
        imgEl.style.display = 'none';
        phEl.style.display  = 'flex';
    }

    // Fields
    document.getElementById('resultName').textContent    = visitor.name;
    document.getElementById('resultPassId').textContent   = visitor.pass_id;
    document.getElementById('resultMobile').textContent   = visitor.mobile;
    document.getElementById('resultAge').textContent      = visitor.age || '—';
    document.getElementById('resultIdType').textContent   = visitor.id_type || '—';
    document.getElementById('resultIdNum').textContent    = visitor.id_number || '—';
    document.getElementById('resultCheckIn').textContent  = visitor.check_in ? fmtTime(visitor.check_in) : fmtTime(visitor.time);
    document.getElementById('resultStatus').innerHTML     = visitor.status ? statusBadge(visitor.status) : '<span class="badge badge-manual">○ Pending</span>';

    // Title
    document.getElementById('resultTitle').textContent =
        scanMode === 'ENTRY' ? '🟢 Entry Verification' : '🔴 Exit Verification';

    // Already exited warning
    const alreadyExited = (visitor.status === 'checked_out');
    document.getElementById('alreadyExitedWarning').classList.toggle('hidden', !alreadyExited);

    // Mismatch warning — hide (no longer relevant with unified QR)
    document.getElementById('mismatchWarning').classList.add('hidden');

    // Time on campus (for exit mode)
    const tocEl  = document.getElementById('timeOnCampus');
    const tocVal = document.getElementById('timeOnCampusVal');
    if (scanMode === 'EXIT' && visitor.check_in) {
        const diff = timeDiff(new Date(visitor.check_in), new Date());
        tocVal.textContent = diff;
        tocEl.classList.remove('hidden');
    } else {
        tocEl.classList.add('hidden');
    }

    // Buttons
    const entryBtn = document.getElementById('btnConfirmEntry');
    const exitBtn  = document.getElementById('btnConfirmExit');
    if (scanMode === 'ENTRY' && !alreadyExited) {
        entryBtn.classList.remove('hidden');
        exitBtn.classList.add('hidden');
    } else if (scanMode === 'EXIT' && !alreadyExited) {
        entryBtn.classList.add('hidden');
        exitBtn.classList.remove('hidden');
    } else {
        entryBtn.classList.add('hidden');
        exitBtn.classList.add('hidden');
    }

    // Show card
    document.getElementById('resultCard').classList.remove('hidden');

    // Scroll to it
    document.getElementById('resultCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function cancelResult() {
    document.getElementById('resultCard').classList.add('hidden');
    scannedPassId = null;
    scannedVisitor = null;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIRM ENTRY — sends full visitor data, creates DB record
// ═══════════════════════════════════════════════════════════════════════════════

async function confirmEntry() {
    if (!scannedPassId || !scannedVisitor) return;

    const btn = document.getElementById('btnConfirmEntry');
    btn.textContent = 'Processing…';
    btn.disabled = true;

    try {
        const res = await fetch(`${API}/guard/entry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pass_id:    scannedVisitor.pass_id,
                name:       scannedVisitor.name,
                age:        scannedVisitor.age,
                mobile:     scannedVisitor.mobile,
                id_type:    scannedVisitor.id_type,
                id_number:  scannedVisitor.id_number,
                photo_path: scannedVisitor.photo_path,
                note:       'Guard verified entry via QR',
            })
        });
        const data = await res.json();

        if (res.status === 403) {
            // Blacklisted
            toast(`🚫 ${data.message}`, 'error');
        } else if (data.success) {
            toast('✅ Entry confirmed — visitor allowed in', 'success');
            cancelResult();
            loadTodayLog();
            loadInsideList();
        } else {
            toast(data.message || 'Entry failed', 'error');
        }
    } catch {
        toast('Network error', 'error');
    } finally {
        btn.textContent = '✅ Confirm Entry';
        btn.disabled = false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONFIRM EXIT — uses existing guard exit endpoint
// ═══════════════════════════════════════════════════════════════════════════════

async function confirmExit() {
    if (!scannedPassId) return;

    const btn = document.getElementById('btnConfirmExit');
    btn.textContent = 'Processing…';
    btn.disabled = true;

    try {
        const res = await fetch(`${API}/guard/exit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pass_id: scannedPassId, note: 'Guard verified exit via QR' })
        });
        const data = await res.json();
        if (data.success) {
            toast('🚪 Exit confirmed — visitor checked out', 'success');
            cancelResult();
            loadTodayLog();
            loadInsideList();
        } else {
            toast(data.message || 'Exit failed', 'error');
        }
    } catch {
        toast('Network error', 'error');
    } finally {
        btn.textContent = '🚪 Confirm Exit';
        btn.disabled = false;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MANUAL EXIT — SEARCH
// ═══════════════════════════════════════════════════════════════════════════════

function searchActive() {
    clearTimeout(searchDebounce);
    const query = document.getElementById('manualSearch').value.trim();

    if (query.length < 2) {
        document.getElementById('searchResults').innerHTML = '';
        document.getElementById('searchEmpty').style.display = 'none';
        return;
    }

    searchDebounce = setTimeout(() => doSearch(query), 300);
}

async function doSearch(query) {
    try {
        const res  = await fetch(`${API}/guard/active?search=${encodeURIComponent(query)}`);
        const data = await res.json();
        const visitors = data.visitors || [];

        const container = document.getElementById('searchResults');
        // Clear and rebuild entirely — never re-query removed child elements
        container.innerHTML = '';

        if (visitors.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="icon">🔍</div>
                    <p>No active visitors found for "<strong>${esc(query)}</strong>"</p>
                </div>`;
            return;
        }

        visitors.forEach(v => {
            const div = document.createElement('div');
            div.className = 'search-result-item';
            div.innerHTML = `
                <div class="sr-info">
                    <div class="sr-name">${esc(v.name)}</div>
                    <div class="sr-meta">
                        <span>📱 ${esc(v.mobile)}</span>
                        <span>🕐 In: ${fmtTime(v.check_in)}</span>
                    </div>
                </div>
                <button class="btn btn-warning btn-sm" onclick="openReasonModal('${esc(v.pass_id)}', '${esc(v.name)}')">
                    Mark Exit
                </button>`;
            container.appendChild(div);
        });
    } catch (err) {
        console.error('Search error:', err);
        toast('Search failed — check connection', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MANUAL EXIT — REASON MODAL
// ═══════════════════════════════════════════════════════════════════════════════

function openReasonModal(passId, name) {
    manualExitPassId = passId;
    document.getElementById('reasonVisitorName').textContent = name;
    document.querySelectorAll('input[name="exitReason"]').forEach(r => r.checked = false);
    document.getElementById('otherReasonInput').classList.add('hidden');
    document.getElementById('otherReasonInput').value = '';
    document.getElementById('reasonModal').classList.add('open');
}

function closeReasonModal() {
    document.getElementById('reasonModal').classList.remove('open');
    manualExitPassId = null;
}

// Show/hide "Other" text input
document.querySelectorAll('input[name="exitReason"]').forEach(r => {
    r.addEventListener('change', () => {
        document.getElementById('otherReasonInput').classList.toggle('hidden', r.value !== 'Other');
    });
});

// Close modal on backdrop click
document.getElementById('reasonModal').addEventListener('click', e => {
    if (e.target === document.getElementById('reasonModal')) closeReasonModal();
});

async function confirmManualExit() {
    if (!manualExitPassId) return;

    const selected = document.querySelector('input[name="exitReason"]:checked');
    if (!selected) {
        toast('Please select a reason', 'error');
        return;
    }

    let reason = selected.value;
    if (reason === 'Other') {
        const txt = document.getElementById('otherReasonInput').value.trim();
        if (!txt) {
            toast('Please describe the reason', 'error');
            return;
        }
        reason = txt;
    }

    const note = `Manual exit by guard — ${reason}`;

    try {
        const res = await fetch(`${API}/guard/exit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pass_id: manualExitPassId, note })
        });
        const data = await res.json();
        if (data.success) {
            toast('🚪 Manual exit recorded', 'success');
            closeReasonModal();
            document.getElementById('manualSearch').value = '';
            document.getElementById('searchResults').innerHTML = '';
            loadTodayLog();
            loadInsideList();
        } else {
            toast(data.message || 'Exit failed', 'error');
        }
    } catch {
        toast('Network error', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TODAY'S LOG
// ═══════════════════════════════════════════════════════════════════════════════

async function loadTodayLog() {
    try {
        // Fetch today's guard log entries
        const res  = await fetch(`${API}/guard/logs/today`);
        const data = await res.json();
        const logs = data.logs || [];

        const tbody = document.getElementById('logBody');
        tbody.innerHTML = '';

        if (logs.length === 0) {
            document.getElementById('logEmpty').style.display = 'block';
            return;
        }
        document.getElementById('logEmpty').style.display = 'none';

        // Fetch current status for all unique pass_ids in this log batch
        const passIds = [...new Set(logs.map(l => l.pass_id).filter(Boolean))];
        const statusMap = {};
        await Promise.all(passIds.map(async pid => {
            try {
                const r = await fetch(`${API}/visitor/status/${encodeURIComponent(pid)}`);
                const d = await r.json();
                if (d.success) statusMap[pid] = d.status;
            } catch { /* silent */ }
        }));

        logs.forEach(log => {
            const tr = document.createElement('tr');

            const currentStatus = statusMap[log.pass_id];
            const campusStatusBadge = (currentStatus === 'inside' || currentStatus === 'checked_in')
                ? '<span class="badge badge-entry">● Inside</span>'
                : (currentStatus === 'checked_out')
                    ? '<span class="badge badge-exit">✓ Exited</span>'
                    : '<span class="badge badge-manual">— Unknown</span>';

            tr.innerHTML = `
                <td>
                    <strong>${esc(log.visitor_name || '—')}</strong><br/>
                    <span style="font-size:.72rem;color:var(--muted)">${esc(log.visitor_mobile || '')}</span>
                </td>

                <td>${fmtTime(log.created_at)}</td>
                <td>${campusStatusBadge}</td>
                <td style="font-size:.78rem;color:var(--muted)">${esc(log.note || '—')}</td>`;
            tbody.appendChild(tr);
        });
    } catch {
        toast('Could not load today\'s log', 'error');
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function esc(str) {
    if (str == null) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
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

function timeDiff(start, end) {
    const diff = Math.floor((end - start) / 1000);
    const hrs  = Math.floor(diff / 3600);
    const mins = Math.floor((diff % 3600) / 60);
    const secs = diff % 60;
    if (hrs > 0) return `${hrs}h ${mins}m`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
}

function statusBadge(status) {
    const map = {
        inside:      ['badge-entry',  '● Inside'],
        checked_in:  ['badge-entry',  '● Checked In'],
        checked_out: ['badge-exit',   '✓ Exited'],
        pending:     ['badge-manual', '○ Pending'],
    };
    const [cls, label] = map[status] || ['badge-exit', status];
    return `<span class="badge ${cls}">${label}</span>`;
}

function toast(msg, type = 'info') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `show ${type}`;
    setTimeout(() => t.className = '', 3000);
}


// ═══════════════════════════════════════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════════════════════════════════════

loadTodayLog();
// Auto-refresh every 30 seconds
setInterval(loadTodayLog, 30000);
