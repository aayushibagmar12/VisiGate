const API_BASE = ''; // same origin, since login.html is served by the same backend

const mobileForm   = document.getElementById('mobile-form');
const otpForm      = document.getElementById('otp-form');
const mobileInput  = document.getElementById('mobile');
const otpInput     = document.getElementById('otp');
const mobileError  = document.getElementById('mobile-error');
const otpError     = document.getElementById('otp-error');
const sendOtpBtn   = document.getElementById('send-otp-btn');
const verifyOtpBtn = document.getElementById('verify-otp-btn');
const resendBtn    = document.getElementById('resend-btn');
const resendTimer  = document.getElementById('resend-timer');
const pageSubtitle = document.getElementById('page-subtitle');

let verifiedMobile = '';
let cooldownInterval = null;

function showError(el, message) {
  el.textContent = message;
  el.style.display = 'block';
}

function hideError(el) {
  el.style.display = 'none';
}

function startResendCooldown(seconds) {
  let remaining = seconds;
  resendBtn.disabled = true;
  resendTimer.textContent = remaining;

  clearInterval(cooldownInterval);
  cooldownInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      clearInterval(cooldownInterval);
      resendBtn.disabled = false;
      resendBtn.textContent = 'Resend OTP';
    } else {
      resendTimer.textContent = remaining;
    }
  }, 1000);
}

async function sendOtp(mobile) {
  const response = await fetch(`${API_BASE}/api/auth/send-otp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mobile })
  });
  return response.json();
}

// STEP 1: Handle "Send OTP"
mobileForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError(mobileError);

  const mobile = mobileInput.value.trim();
  if (!/^[0-9]{10}$/.test(mobile)) {
    showError(mobileError, 'Please enter a valid 10-digit mobile number.');
    return;
  }

  sendOtpBtn.disabled = true;
  sendOtpBtn.textContent = 'Sending...';

  try {
    const data = await sendOtp(mobile);

    if (!data.success) {
      showError(mobileError, data.message || 'Failed to send OTP.');
      sendOtpBtn.disabled = false;
      sendOtpBtn.textContent = 'Send OTP';
      return;
    }

  verifiedMobile = mobile;
    mobileForm.style.display = 'none';
    otpForm.style.display = 'block';
    pageSubtitle.textContent = `OTP sent to ${mobile}. Check the server console.`;
    startResendCooldown(30);  } catch (err) {
    showError(mobileError, 'Something went wrong. Please try again.');
  }

  sendOtpBtn.disabled = false;
  sendOtpBtn.textContent = 'Send OTP';
});

// STEP 2: Handle "Verify OTP"
otpForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideError(otpError);

  const otp = otpInput.value.trim();
  if (!/^[0-9]{6}$/.test(otp)) {
    showError(otpError, 'Please enter the 6-digit OTP.');
    return;
  }

  verifyOtpBtn.disabled = true;
  verifyOtpBtn.textContent = 'Verifying...';

  try {
    const response = await fetch(`${API_BASE}/api/auth/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile: verifiedMobile, otp })
    });
    const data = await response.json();

    if (!data.success) {
      showError(otpError, data.message || 'Invalid OTP.');
      verifyOtpBtn.disabled = false;
      verifyOtpBtn.textContent = 'Verify OTP';
      return;
    }

    // Save verified mobile so the next page knows the visitor is logged in
    sessionStorage.setItem('visitor_mobile', verifiedMobile);
    sessionStorage.setItem('mobile_verified', 'true');

    window.location.href = 'index.html';
  } catch (err) {
    showError(otpError, 'Something went wrong. Please try again.');
    verifyOtpBtn.disabled = false;
    verifyOtpBtn.textContent = 'Verify OTP';
  }
});

// Handle "Resend OTP"
resendBtn.addEventListener('click', async () => {
  hideError(otpError);
  try {
    const data = await sendOtp(verifiedMobile);
    if (!data.success) {
      showError(otpError, data.message || 'Failed to resend OTP.');
      return;
    }
    startResendCooldown(30);
  } catch (err) {
    showError(otpError, 'Something went wrong. Please try again.');
  }
});