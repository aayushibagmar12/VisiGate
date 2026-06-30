const screens = {
    camera:  document.getElementById('screen-camera'),
    preview: document.getElementById('screen-preview'),
    error:   document.getElementById('screen-error'),
};

const video        = document.getElementById('video');
const canvas       = document.getElementById('canvas');
const photoPreview = document.getElementById('photo-preview');
const btnCapture   = document.getElementById('btn-capture');
const btnConfirm   = document.getElementById('btn-confirm');
const btnRetake    = document.getElementById('btn-retake');
const btnRetry     = document.getElementById('btn-retry');

let photoDataUrl = null;

function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.add('hidden'));
    screens[name].classList.remove('hidden');
}

// ── start camera ──
async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user' }, // front camera
            audio: false,
        });
        video.srcObject = stream;
        showScreen('camera');
    } catch (err) {
        showScreen('error');
    }
}

// ── capture photo from video frame ──
function capturePhoto() {
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    photoDataUrl = canvas.toDataURL('image/jpeg', 0.9);
    photoPreview.src = photoDataUrl;

    // stop camera stream
    video.srcObject.getTracks().forEach(t => t.stop());

    showScreen('preview');
}

// ── retake — restart camera ──
function retake() {
    photoDataUrl = null;
    photoPreview.src = '';
    startCamera();
}

// ── confirm — go to next page ──
// photo is saved in sessionStorage so next page can use it
function confirmPhoto() {
    sessionStorage.setItem('visitor_photo', photoDataUrl);
    window.location.href = 'pass.html'; // next page
}

// ── button listeners ──
btnCapture.addEventListener('click', capturePhoto);
btnConfirm.addEventListener('click', confirmPhoto);
btnRetake.addEventListener('click',  retake);
btnRetry.addEventListener('click',   startCamera);

// ── start on load ──
startCamera();