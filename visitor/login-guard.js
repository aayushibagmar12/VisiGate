// Blocks direct access to this page unless the visitor has verified their mobile via OTP
if (sessionStorage.getItem('mobile_verified') !== 'true') {
  window.location.href = 'login.html';
}