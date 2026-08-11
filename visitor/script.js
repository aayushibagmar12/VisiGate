document.addEventListener('DOMContentLoaded', () => {
    // ── Pre-fill and lock the mobile number field with the OTP-verified number ──
    const mobileInput = document.getElementById('mobile');
    const verifiedMobile = sessionStorage.getItem('visitor_mobile');
    if (verifiedMobile) {
        mobileInput.value = verifiedMobile;
        mobileInput.readOnly = true;
    }

    const form = document.getElementById('registration-form');

    // ── Vehicle Yes/No toggle ──
    const vehicleYes = document.getElementById('vehicle-yes');
    const vehicleNo = document.getElementById('vehicle-no');
    const vehicleNumberContainer = document.getElementById('vehicle-number-container');
    const vehicleNumberInput = document.getElementById('vehicle-number');

    function updateVehicleField() {
        if (vehicleYes.checked) {
            vehicleNumberContainer.style.display = 'block';
            vehicleNumberInput.setAttribute('required', 'required');
        } else {
            vehicleNumberContainer.style.display = 'none';
            vehicleNumberInput.removeAttribute('required');
            vehicleNumberInput.value = '';
        }
    }
    vehicleYes.addEventListener('change', updateVehicleField);
    vehicleNo.addEventListener('change', updateVehicleField);

    // ── Face Photo: Modal Capture ──
    const btnOpenCamera = document.getElementById('btn-open-camera');
    const cameraModal = document.getElementById('cameraModal');
    const modalVideo = document.getElementById('modal-video');
    const modalCanvas = document.getElementById('modal-canvas');
    const btnModalSnap = document.getElementById('btn-modal-snap');
    const btnModalCancel = document.getElementById('btn-modal-cancel');
    const facePreviewWrap = document.getElementById('face-preview-wrap');
    const facePhotoPreview = document.getElementById('face-photo-preview');
    const btnRetakeFace = document.getElementById('btn-retake-face');
    const facePhotoError = document.getElementById('face-photo-error');

    let facePhotoDataUrl = null;
    let cameraStream = null;

    btnOpenCamera.addEventListener('click', async () => {
        try {
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user' },
                audio: false
            });
            modalVideo.srcObject = cameraStream;
            cameraModal.style.display = 'flex';
            facePhotoError.style.display = 'none';
        } catch (err) {
            facePhotoError.textContent = 'Camera access denied or unavailable.';
            facePhotoError.style.display = 'block';
        }
    });

    function stopCamera() {
        if (cameraStream) {
            cameraStream.getTracks().forEach(t => t.stop());
            cameraStream = null;
        }
    }

    btnModalCancel.addEventListener('click', () => {
        stopCamera();
        cameraModal.style.display = 'none';
    });

    btnModalSnap.addEventListener('click', () => {
        modalCanvas.width = modalVideo.videoWidth;
        modalCanvas.height = modalVideo.videoHeight;
        modalCanvas.getContext('2d').drawImage(modalVideo, 0, 0);
        facePhotoDataUrl = modalCanvas.toDataURL('image/jpeg', 0.8);
        stopCamera();
        cameraModal.style.display = 'none';
        
        facePhotoPreview.src = facePhotoDataUrl;
        facePreviewWrap.style.display = 'block';
        btnOpenCamera.style.display = 'none';
    });

    btnRetakeFace.addEventListener('click', () => {
        facePhotoDataUrl = null;
        facePhotoPreview.src = '';
        facePreviewWrap.style.display = 'none';
        btnOpenCamera.style.display = 'inline-block';
        btnOpenCamera.click();
    });

    // ── Form submit ──
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Custom validation: Face photo is required
        if (!facePhotoDataUrl) {
            facePhotoError.textContent = 'Please take a photo of your face.';
            facePhotoError.style.display = 'block';
            return;
        }

        if (form.checkValidity()) {
            const submitBtn = form.querySelector('button[type="submit"]');
            submitBtn.textContent = 'Submitting...';
            submitBtn.style.opacity = '0.8';
            submitBtn.disabled = true;

            // generate pass ID here so photo page can use it
            const passId = 'VG-' + Math.random().toString(36).substring(2, 8).toUpperCase();

            // save form data to sessionStorage so next pages can use it
            sessionStorage.setItem('visitor_pass_id', passId);
            sessionStorage.setItem('visitor_name', document.getElementById('name').value);
            sessionStorage.setItem('visitor_age', document.getElementById('age').value);
            sessionStorage.setItem('visitor_mobile', document.getElementById('mobile').value);
            sessionStorage.setItem('visitor_accompanying_count', document.getElementById('accompanying').value);
            sessionStorage.setItem('visitor_bringing_vehicle', vehicleYes.checked ? 'yes' : 'no');
            sessionStorage.setItem('visitor_vehicle_number', vehicleYes.checked ? vehicleNumberInput.value : '');
            sessionStorage.setItem('visitor_photo', facePhotoDataUrl);

            setTimeout(() => {
                window.location.href = 'meet.html';
            }, 800);
        }
    });
});