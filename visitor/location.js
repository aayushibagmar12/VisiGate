const screens = {
    idle:       document.getElementById('screen-idle'),
    requesting: document.getElementById('screen-requesting'),
    denied:     document.getElementById('screen-denied'),
    granted:    document.getElementById('screen-granted'),
};

const btnEnable  = document.getElementById('btn-enable');
const btnRetry   = document.getElementById('btn-retry');
const coordsEl   = document.getElementById('coords-display');
const gapWarning = document.getElementById('gap-warning');

let watchId      = null;
let gapStartTime = null;
let gapActive    = false;

function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[name].classList.remove('hidden');
}

function requestLocation() {
    if (!navigator.geolocation) { showScreen('denied'); return; }
    showScreen('requesting');
    navigator.geolocation.getCurrentPosition(onGranted, onDenied, {
        enableHighAccuracy: true, timeout: 15000,
    });
}

function onGranted(pos) {
    const { latitude, longitude, accuracy } = pos.coords;
    showScreen('granted');
    coordsEl.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}  ·  ±${Math.round(accuracy)} m accuracy`;
    sendPing(latitude, longitude, accuracy);
    startWatch();
    setTimeout(() => { window.location.href = 'photo.html'; }, 1500);
}

function onDenied() { showScreen('denied'); }

function startWatch() {
    watchId = navigator.geolocation.watchPosition(
        (pos) => {
            const { latitude, longitude, accuracy } = pos.coords;
            if (gapActive && gapStartTime) {
                sendGapEnd(gapStartTime, new Date().toISOString());
                gapStartTime = null;
                gapActive    = false;
                gapWarning.classList.add('hidden');
            }
            sendPing(latitude, longitude, accuracy);
        },
        () => {
            if (!gapActive) {
                gapActive    = true;
                gapStartTime = new Date().toISOString();
                sendGapStart(gapStartTime);
                gapWarning.classList.remove('hidden');
            }
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
}

async function sendPing(lat, lng, accuracy) {
    try {
        await fetch('/api/location/ping', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ latitude: lat, longitude: lng, accuracy, timestamp: new Date().toISOString() }),
        });
    } catch (_) {}
}

async function sendGapStart(startTime) {
    try {
        await fetch('/api/location/gap-start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gap_start: startTime }),
        });
    } catch (_) {}
}

async function sendGapEnd(startTime, endTime) {
    try {
        await fetch('/api/location/gap-end', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ gap_start: startTime, gap_end: endTime }),
        });
    } catch (_) {}
}

btnEnable.addEventListener('click', requestLocation);
btnRetry.addEventListener('click',  requestLocation);