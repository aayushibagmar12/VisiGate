document.addEventListener('DOMContentLoaded', () => {
    const BACKEND = '';

    const form = document.getElementById('meet-form');
    const enrollmentInput = document.getElementById('enrollment');
    const reasonInput = document.getElementById('reason');
    const meetError = document.getElementById('meet-error');
    const submitBtn = document.getElementById('meet-submit-btn');

    // Guard: if details page wasn't completed, send back
    const passId = sessionStorage.getItem('visitor_pass_id');
    const visitorName = sessionStorage.getItem('visitor_name');
    if (!passId || !visitorName) {
        window.location.href = 'index.html';
        throw new Error('No session — redirecting to index.html');
    }

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        meetError.style.display = 'none';

        const enrollment = enrollmentInput.value.trim();
        const reason = reasonInput.value.trim();

        if (!enrollment || !reason) {
            meetError.textContent = 'Please fill in both fields.';
            meetError.style.display = 'block';
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = 'Submitting...';

        try {
            const res = await fetch(`${BACKEND}/api/meet/request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    pass_id: passId,
                    visitor_name: visitorName,
                    reason,
                    enrollment_number: enrollment
                })
            });
            const data = await res.json();

            if (!data.success) {
                meetError.textContent = data.message || 'Something went wrong.';
                meetError.style.display = 'block';
                submitBtn.disabled = false;
                submitBtn.textContent = 'Continue';
                return;
            }

            // Save enrollment/reason too, in case we need them later
            sessionStorage.setItem('visitor_enrollment', enrollment);
            sessionStorage.setItem('visitor_meet_reason', reason);

            window.location.href = 'location.html';
        } catch (err) {
            meetError.textContent = 'Network error. Please try again.';
            meetError.style.display = 'block';
            submitBtn.disabled = false;
            submitBtn.textContent = 'Continue';
        }
    });
});