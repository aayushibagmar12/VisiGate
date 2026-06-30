const BACKEND = 'http://localhost:3000';

const screens = {
    entry: document.getElementById('screen-entry'),
    exit:  document.getElementById('screen-exit'),
    done:  document.getElementById('screen-done'),
};

function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[name].classList.remove('hidden');
}

function formatTime(date) {
    return date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}

function timeDiff(start, end) {
    const diff = Math.floor((end - start) / 1000);
    const mins = Math.floor(diff / 60);
    const secs = diff % 60;
    return `${mins} min ${secs} sec`;
}

// ── get data from sessionStorage ──
const passId    = sessionStorage.getItem('visitor_pass_id') || 'VG-DEMO01';
const name      = sessionStorage.getItem('visitor_name') || 'Visitor';
const age       = sessionStorage.getItem('visitor_age');
const mobile    = sessionStorage.getItem('visitor_mobile');
const id_type   = sessionStorage.getItem('visitor_id_type');
const id_number = sessionStorage.getItem('visitor_id_number');
const photo     = sessionStorage.getItem('visitor_photo');
const checkIn   = new Date();

// ── fill pass details ──
document.getElementById('pass-name').textContent = name;
document.getElementById('pass-id').textContent   = passId;
document.getElementById('pass-time').textContent = formatTime(checkIn);

if (photo) document.getElementById('pass-photo').src = photo;

// ── generate QR codes once ──
document.getElementById('qr-entry').innerHTML = '';
new QRCode(document.getElementById('qr-entry'), {
    text: JSON.stringify({ type: 'ENTRY', passId, time: checkIn.toISOString() }),
    width: 200, height: 200,
    colorDark: '#111827', colorLight: '#ffffff',
});

document.getElementById('qr-exit').innerHTML = '';
new QRCode(document.getElementById('qr-exit'), {
    text: JSON.stringify({ type: 'EXIT', passId, time: checkIn.toISOString() }),
    width: 200, height: 200,
    colorDark: '#111827', colorLight: '#ffffff',
});

// ── save visitor to backend (once only) ──
async function saveVisitor() {
    try {
        const res = await fetch(`${BACKEND}/api/visitor/checkin`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pass_id: passId, name, age, mobile, id_type, id_number, photo }),
        });
        const data = await res.json();
        console.log('Checkin response:', data);
    } catch (err) {
        console.error('Backend save failed:', err);
    }
}

// ── location tracking ──
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

// ── checkout ──
document.getElementById('btn-exit').addEventListener('click', async () => {
    try {
        await fetch(`${BACKEND}/api/visitor/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pass_id: passId }),
        });
    } catch (_) {}
    const checkOut = new Date();
    document.getElementById('total-time').textContent = timeDiff(checkIn, checkOut);
    showScreen('done');
    sessionStorage.clear();
});

// ── start ──
saveVisitor();
startTracking();