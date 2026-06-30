document.addEventListener('DOMContentLoaded', () => {
    const idTypeSelect = document.getElementById('id-type');
    const dynamicIdContainer = document.getElementById('dynamic-id-container');
    const dynamicIdLabel = document.getElementById('dynamic-id-label');
    const idNumberInput = document.getElementById('id-number');
    const form = document.getElementById('registration-form');

    const idOptions = {
        'adhar': {
            label: 'Aadhar Card Number',
            placeholder: 'e.g., 123456789012',
            pattern: '\\d{12}',
            title: 'Please enter a valid 12-digit Aadhar number'
        },
        'driving': {
            label: 'Driving License Number',
            placeholder: 'e.g., MH1420110062821',
            pattern: '^[A-Z]{2}[0-9]{2}[0-9]{11}$',
            title: 'Please enter a valid Driving License number'
        },
        'pan': {
            label: 'PAN Card Number',
            placeholder: 'e.g., ABCDE1234F',
            pattern: '^[A-Z]{5}[0-9]{4}[A-Z]{1}$',
            title: 'Please enter a valid 10-character PAN number'
        }
    };

    idTypeSelect.addEventListener('change', (e) => {
        const selectedOption = e.target.value;
        if (selectedOption && idOptions[selectedOption]) {
            dynamicIdLabel.textContent = idOptions[selectedOption].label;
            idNumberInput.placeholder = idOptions[selectedOption].placeholder;
            if (idOptions[selectedOption].pattern) {
                idNumberInput.pattern = idOptions[selectedOption].pattern;
            } else {
                idNumberInput.removeAttribute('pattern');
            }
            if (idOptions[selectedOption].title) {
                idNumberInput.title = idOptions[selectedOption].title;
            } else {
                idNumberInput.removeAttribute('title');
            }
            idNumberInput.value = '';
            dynamicIdContainer.style.display = 'block';
            setTimeout(() => { idNumberInput.focus(); }, 50);
        } else {
            dynamicIdContainer.style.display = 'none';
            idNumberInput.removeAttribute('pattern');
            idNumberInput.removeAttribute('title');
        }
    });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();

        if (form.checkValidity()) {
            const submitBtn = form.querySelector('.submit-btn');
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
            sessionStorage.setItem('visitor_id_type', idTypeSelect.value);
            sessionStorage.setItem('visitor_id_number', idNumberInput.value);

            setTimeout(() => {
                window.location.href = 'location.html';
            }, 800);
        }
    });
});