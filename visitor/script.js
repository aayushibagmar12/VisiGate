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

    // ── ID Card Photo: upload / capture ──
    const btnUploadId = document.getElementById('btn-upload-id');
    const btnCaptureId = document.getElementById('btn-capture-id');
    const idPhotoFile = document.getElementById('id-photo-file');
    const idCameraWrap = document.getElementById('id-camera-wrap');
    const idVideo = document.getElementById('id-video');
    const idCanvas = document.getElementById('id-canvas');
    const btnIdSnap = document.getElementById('btn-id-snap');
    const idPreviewWrap = document.getElementById('id-preview-wrap');
    const idPhotoPreview = document.getElementById('id-photo-preview');
    const btnIdRetake = document.getElementById('btn-id-retake');
    const idPhotoError = document.getElementById('id-photo-error');

    let idPhotoDataUrl = null;
    let idCameraStream = null;

    function showIdPreview(dataUrl) {
        idPhotoDataUrl = dataUrl;
        idPhotoPreview.src = dataUrl;
        idPreviewWrap.style.display = 'block';
        idCameraWrap.style.display = 'none';
        btnUploadId.style.display = 'none';
        btnCaptureId.style.display = 'none';
        idPhotoError.style.display = 'none';
    }

    function resetIdPhoto() {
        idPhotoDataUrl = null;
        idPhotoPreview.src = '';
        idPreviewWrap.style.display = 'none';
        idCameraWrap.style.display = 'none';
        btnUploadId.style.display = 'inline-block';
        btnCaptureId.style.display = 'inline-block';
        idPhotoFile.value = '';
        if (idCameraStream) {
            idCameraStream.getTracks().forEach(t => t.stop());
            idCameraStream = null;
        }
    }

    // Upload from gallery
    btnUploadId.addEventListener('click', () => idPhotoFile.click());
    idPhotoFile.addEventListener('change', () => {
        const file = idPhotoFile.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => showIdPreview(e.target.result);
        reader.readAsDataURL(file);
    });

    // Take photo (inline camera)
    btnCaptureId.addEventListener('click', async () => {
        try {
            idCameraStream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment' },
                audio: false
            });
            idVideo.srcObject = idCameraStream;
            idCameraWrap.style.display = 'block';
            btnUploadId.style.display = 'none';
            btnCaptureId.style.display = 'none';
        } catch (err) {
            idPhotoError.textContent = 'Camera access denied or unavailable. Please use Upload instead.';
            idPhotoError.style.display = 'block';
        }
    });

    btnIdSnap.addEventListener('click', () => {
        idCanvas.width = idVideo.videoWidth;
        idCanvas.height = idVideo.videoHeight;
        idCanvas.getContext('2d').drawImage(idVideo, 0, 0);
        const dataUrl = idCanvas.toDataURL('image/jpeg', 0.9);
        if (idCameraStream) {
            idCameraStream.getTracks().forEach(t => t.stop());
            idCameraStream = null;
        }
        showIdPreview(dataUrl);
    });

    btnIdRetake.addEventListener('click', resetIdPhoto);

    // ── Form submit ──
    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Custom validation: ID photo is required
        if (!idPhotoDataUrl) {
            idPhotoError.textContent = 'Please upload or take a photo of your ID card.';
            idPhotoError.style.display = 'block';
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
            sessionStorage.setItem('visitor_id_photo', idPhotoDataUrl);

            setTimeout(() => {
                window.location.href = 'meet.html';
            }, 800);
        }
    });
});