const BACKEND = ''; // relative to current host — works on any device, any network

const screens = {
    waiting: document.getElementById('screen-waiting'),
    inside:  document.getElementById('screen-inside'),
    done:    document.getElementById('screen-done'),
    blocked: document.getElementById('screen-blocked'),
};

let currentScreen = 'waiting';
let pollTimer     = null;
let trackingStarted = false;

function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[name].classList.remove('hidden');
    currentScreen = name;
}

// ── Debug helper — writes to the on-screen status strip ──
function dbg(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg;
    console.log('[pass.js]', id, ':', msg);
}

function formatTime(date) {
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function timeDiff(start, end) {
    const diff = Math.floor((end - start) / 1000);
    const hrs  = Math.floor(diff / 3600);
    const mins = Math.floor((diff % 3600) / 60);
    const secs = diff % 60;
    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
    return `${mins} min ${secs} sec`;
}

// ── get data from sessionStorage ──
const passId    = sessionStorage.getItem('visitor_pass_id');
const name      = sessionStorage.getItem('visitor_name');
const age       = sessionStorage.getItem('visitor_age');
const mobile    = sessionStorage.getItem('visitor_mobile');
const id_type   = sessionStorage.getItem('visitor_id_type');
const id_number = sessionStorage.getItem('visitor_id_number');
const photo     = sessionStorage.getItem('visitor_photo');
const accompanying_count = sessionStorage.getItem('visitor_accompanying_count');
const vehicle_number     = sessionStorage.getItem('visitor_bringing_vehicle') === 'yes' ? sessionStorage.getItem('visitor_vehicle_number') : null;
const checkIn   = new Date();
// ── Guard: if session is empty (e.g. page refreshed after exit), go back home ──
if (!passId || !name || !mobile) {
    window.location.replace('index.html');
    // Stop executing the rest of this script
    throw new Error('No session — redirecting to index.html');
}

// ── fill pass details ──
document.getElementById('pass-name').textContent = name;
document.getElementById('pass-id').textContent   = passId;
document.getElementById('pass-time').textContent = formatTime(checkIn);

if (photo) document.getElementById('pass-photo').src = photo;

// Debug: show session data state immediately on load
dbg('dbg-session', passId !== 'VG-DEMO01'
    ? `✅ Session OK — passId=${passId}, name=${name}, photo=${photo ? (photo.length + 'chars') : 'MISSING'}`
    : `❌ No session data found (passId is default VG-DEMO01)`);


// ═══════════════════════════════════════════════════════════════════════════════
//  STEP 1: Upload photo first, then generate QR
// ═══════════════════════════════════════════════════════════════════════════════

let photoPath = null;

async function uploadPhotoAndGenerateQR() {
    // Upload visitor's own photo to server (QR can't hold base64 images)
    if (photo) {
        dbg('dbg-photo', '⏳ Uploading photo (' + photo.length + ' chars)…');
        try {
            const res = await fetch(`${BACKEND}/api/visitor/upload-photo`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ photo }),
            });
            const data = await res.json();
            if (data.success) {
                photoPath = data.photo_path;
                dbg('dbg-photo', '✅ Photo uploaded → ' + photoPath);
            } else {
                dbg('dbg-photo', '❌ Upload failed: ' + JSON.stringify(data));
            }
        } catch (err) {
            dbg('dbg-photo', '❌ Upload error: ' + err.message);
            console.error('Photo upload failed:', err);
        }
    } else {
        dbg('dbg-photo', '⚠️ No photo in session — skipping upload');
    }

    // Generate QR with ALL visitor data (no photo blob — just the path reference)
        const qrData = {
            passId,
            name,
            age: age || null,
            mobile,
            id_type: id_type || null,
            id_number: id_number || null,
            photo_path: photoPath,
            accompanying_count: accompanying_count || 0,
            vehicle_number: vehicle_number || null,
            time: checkIn.toISOString(),
        };
    dbg('dbg-qr', '⏳ Generating QR (' + JSON.stringify(qrData).length + ' chars, level L)…');
    try {
        document.getElementById('qr-code').innerHTML = '';
        new QRCode(document.getElementById('qr-code'), {
            text: JSON.stringify(qrData),
            width: 240, height: 240,
            colorDark: '#111827', colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.L,
        });
        dbg('dbg-qr', '✅ QR generated (' + JSON.stringify(qrData).length + ' chars)');
    } catch (e) {
        dbg('dbg-qr', '❌ QR error: ' + e.message);
        console.error('QRCode generation failed:', e);
    }

    try {
        document.getElementById('qr-exit').innerHTML = '';
        new QRCode(document.getElementById('qr-exit'), {
            text: JSON.stringify(qrData),
            width: 240, height: 240,
            colorDark: '#111827', colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.L,
        });
    } catch (e) {
        console.error('Exit QRCode generation failed:', e);
    }

    // ── Trial mode: auto-confirm entry after 5 seconds ──
    startAutoEntry(qrData);

    // Start polling for guard action
    startPolling();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  TRIAL: Auto-entry countdown (5 seconds after QR shown)
// ═══════════════════════════════════════════════════════════════════════════════

function startAutoEntry(qrData) {
    const countdownEl = document.getElementById('auto-entry-countdown');
    const numEl       = document.getElementById('auto-entry-num');
    if (!countdownEl || !numEl) {
        dbg('dbg-entry', '❌ Countdown elements not found in DOM');
        return;
    }

    countdownEl.classList.remove('hidden');
    let secs = 5;
    numEl.textContent = secs;
    dbg('dbg-entry', '⏳ Auto-entry countdown started (5s)…');

    const tick = setInterval(() => {
        secs--;
        numEl.textContent = secs;
        if (secs <= 0) {
            clearInterval(tick);
            countdownEl.classList.add('hidden');
            dbg('dbg-entry', '⏳ Sending auto-entry request…');
            autoConfirmEntry(qrData);
        }
    }, 1000);
}

async function autoConfirmEntry(qrData) {
    try {
        const res = await fetch(`${BACKEND}/api/guard/entry`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                pass_id:    qrData.passId,
                name:       qrData.name,
                age:        qrData.age,
                mobile:     qrData.mobile,
                id_type:    qrData.id_type,
                id_number:  qrData.id_number,
                photo_path: qrData.photo_path,
                accompanying_count: qrData.accompanying_count,
                vehicle_number:     qrData.vehicle_number,
                id_photo_path:      qrData.id_photo_path,
                note:       'Auto-entry (trial mode)',
            }),        });
        const data = await res.json();

        if (res.status === 403) {
            // Explicitly blacklisted by admin — show blocked screen
            dbg('dbg-entry', '❌ Blacklisted: ' + data.message);
            const msg = document.getElementById('blocked-reason');
            if (msg) msg.textContent = data.message;
            showScreen('blocked');
            stopPolling();
        } else if (!data.success) {
            // Any other error (400, 500, etc.) — log but do NOT block the visitor
            dbg('dbg-entry', '⚠️ Auto-entry warning (non-blocking): ' + data.message);
        } else {
            dbg('dbg-entry', '✅ Auto-entry confirmed! Waiting for poll…');
        }
        // Success: polling will detect status=inside and switch screen
    } catch (err) {
        dbg('dbg-entry', '❌ Network error: ' + err.message);
        console.error('Auto-entry failed:', err);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  STEP 2: Poll for status changes (guard actions)
// ═══════════════════════════════════════════════════════════════════════════════

function startPolling() {
    // Poll immediately, then every 3 seconds
    pollStatus();
    pollTimer = setInterval(pollStatus, 3000);
}

async function pollStatus() {
    try {
        const res = await fetch(`${BACKEND}/api/visitor/status/${encodeURIComponent(passId)}`);
        const data = await res.json();

        if (!data.success) return;

        switch (data.status) {
            case 'not_found':
                // Guard hasn't scanned yet — stay on waiting screen
                break;

            case 'inside':
                // Guard confirmed entry!
                if (currentScreen === 'waiting') {
                    showScreen('inside');
                    if (!trackingStarted) {
                        startTracking();
                        trackingStarted = true;
                    }
                }
                break;

            case 'checked_out':
                // Guard confirmed exit (or self-checkout)
                if (currentScreen !== 'done') {
                    const checkOut = data.check_out ? new Date(data.check_out) : new Date();
                    const start = data.check_in ? new Date(data.check_in) : checkIn;
                    document.getElementById('total-time').textContent = timeDiff(start, checkOut);
                    showScreen('done');
                    stopPolling();
                    sessionStorage.clear();
                }
                break;

            case 'blocked':
                showScreen('blocked');
                stopPolling();
                sessionStorage.clear();
                break;
        }
    } catch (err) {
        // Silent — network blip, will retry on next poll
    }
}

function stopPolling() {
    if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LOCATION TRACKING (starts only after guard confirms entry)
// ═══════════════════════════════════════════════════════════════════════════════

let gapActive    = false;
let gapStartTime = null;

async function sendPing(lat, lng, accuracy) {
    try {
        await fetch(`${BACKEND}/api/location/ping`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pass_id: passId, latitude: lat, longitude: lng, accuracy, timestamp: new Date().toISOString() }),
        });
    } catch (_) {}
}

async function sendGapStart(startTime) {
    try {
        await fetch(`${BACKEND}/api/location/gap-start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pass_id: passId, gap_start: startTime }),
        });
    } catch (_) {}
}

async function sendGapEnd(startTime, endTime) {
    try {
        await fetch(`${BACKEND}/api/location/gap-end`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pass_id: passId, gap_start: startTime, gap_end: endTime }),
        });
    } catch (_) {}
}

function startTracking() {
    navigator.geolocation.watchPosition(
        (pos) => {
            const { latitude, longitude, accuracy } = pos.coords;
            if (gapActive && gapStartTime) {
                sendGapEnd(gapStartTime, new Date().toISOString());
                gapStartTime = null;
                gapActive    = false;
            }
            sendPing(latitude, longitude, accuracy);
        },
        () => {
            if (!gapActive) {
                gapActive    = true;
                gapStartTime = new Date().toISOString();
                sendGapStart(gapStartTime);
            }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  START
// ═══════════════════════════════════════════════════════════════════════════════

uploadPhotoAndGenerateQR();