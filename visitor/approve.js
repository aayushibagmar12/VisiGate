document.addEventListener('DOMContentLoaded', () => {
    const BACKEND = '';

    const screens = {
        loading: document.getElementById('screen-loading'),
        pending: document.getElementById('screen-pending'),
        done:    document.getElementById('screen-done'),
        error:   document.getElementById('screen-error'),
    };

    function showScreen(name) {
        Object.values(screens).forEach(s => s.classList.add('hidden'));
        screens[name].classList.remove('hidden');
    }

    // Get token from URL: approve.html?token=xyz123
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');

    if (!token) {
        showScreen('error');
        return;
    }

    const requestSummary = document.getElementById('request-summary');
    const btnApprove = document.getElementById('btn-approve');
    const btnDeny = document.getElementById('btn-deny');
    const approveError = document.getElementById('approve-error');
    const doneTitle = document.getElementById('done-title');
    const doneMessage = document.getElementById('done-message');

    // Fetch request details
    async function loadRequest() {
        try {
            const res = await fetch(`${BACKEND}/api/meet/status/${encodeURIComponent(token)}`);
            const data = await res.json();

            if (!data.success) {
                showScreen('error');
                return;
            }

            const req = data.request;

            if (req.status !== 'pending') {
                doneTitle.textContent = req.status === 'approved' ? 'Already Approved' : 'Already Denied';
                doneMessage.textContent = `You already ${req.status} ${req.visitor_name}'s request.`;
                showScreen('done');
                return;
            }

requestSummary.textContent = `${req.visitor_name} wants to meet you. Reason: ${req.reason || 'Not specified'}`;

            const visitor = data.visitor;
            if (visitor) {
                if (visitor.photo_path) {
                    document.getElementById('visitor-photo-preview').src = `${window.location.origin}${visitor.photo_path}`;
                    document.getElementById('visitor-photo-preview').style.display = 'block';
                }
                document.getElementById('visitor-mobile-display').textContent = visitor.mobile || '—';
                document.getElementById('visitor-vehicle-display').textContent = visitor.vehicle_number || 'No vehicle';
                document.getElementById('visitor-accompanying-display').textContent = visitor.accompanying_count || '0';
                document.getElementById('visitor-extra-details').style.display = 'block';
            }

            showScreen('pending');        } catch (err) {
            showScreen('error');
        }
    }

    async function respond(decision) {
        btnApprove.disabled = true;
        btnDeny.disabled = true;
        approveError.style.display = 'none';

        try {
            const res = await fetch(`${BACKEND}/api/meet/respond`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, decision })
            });
            const data = await res.json();

            if (!data.success) {
                approveError.textContent = data.message || 'Something went wrong.';
                approveError.style.display = 'block';
                btnApprove.disabled = false;
                btnDeny.disabled = false;
                return;
            }

            doneTitle.textContent = decision === 'approved' ? 'Approved ✅' : 'Denied ❌';
            doneMessage.textContent = `You have ${decision} this visitor's request.`;
            showScreen('done');
        } catch (err) {
            approveError.textContent = 'Network error. Please try again.';
            approveError.style.display = 'block';
            btnApprove.disabled = false;
            btnDeny.disabled = false;
        }
    }

    btnApprove.addEventListener('click', () => respond('approved'));
    btnDeny.addEventListener('click', () => respond('denied'));

    loadRequest();
});
