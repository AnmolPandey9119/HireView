// ════════════════════════════════════════════════
// HireView AI — Auth Logic
// Password login/signup with inline email OTP verification,
// and OTP-based forgot password.
// ════════════════════════════════════════════════

let signupEmailVerified = false;   // true once the OTP for the current signup email is confirmed
let signupOtpSentForEmail = null;  // which email the last "Send OTP" was sent to

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
}

// Toggles a password <input> between type="password" and type="text",
// and swaps the eye / eye-off icon inside the clicked toggle button.
function togglePasswordVisibility(inputId, toggleEl) {
  const input = document.getElementById(inputId);
  const isHidden = input.type === 'password';
  input.type = isHidden ? 'text' : 'password';
  toggleEl.classList.toggle('showing', isHidden);
}

function showAuthError(elementId, message, isSuccess = false) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  if (isSuccess) {
    el.style.color = '#22c55e';
    el.style.background = 'rgba(34,197,94,0.1)';
    el.style.border = '1px solid rgba(34,197,94,0.3)';
  } else {
    el.style.color = '';
    el.style.background = '';
    el.style.border = '';
  }
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 5000);
}

async function postJSON(path, body) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function saveSession(token, user) {
  authToken = token;
  currentUser = user;
  localStorage.setItem('hv_token', authToken);
  localStorage.setItem('hv_user', JSON.stringify(currentUser));
}

// ────────────────────────────────────────────────
// PASSWORD LOGIN
// ────────────────────────────────────────────────
async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!email || !password) {
    showAuthError('loginError', 'Please enter your email and password.');
    return;
  }

  try {
    const { ok, data } = await postJSON('/api/auth/login', { email, password });

    if (!ok) {
      showAuthError('loginError', data.detail || 'Incorrect email or password.');
      return;
    }

    saveSession(data.access_token, data.user);
    updateLoggedInUser();
    window.location.href = 'dashboard.html';
    
  } catch (err) {
    showAuthError('loginError', 'Could not reach server. Is the backend running?');
  }
}

// ────────────────────────────────────────────────
// SIGNUP — EMAIL VERIFICATION (inline, before account creation)
// ────────────────────────────────────────────────

// If the user edits the email after verifying it, the verification no
// longer applies to whatever's currently typed — reset the tick/state.
function onSignupEmailChanged() {
  const current = document.getElementById('signupEmail').value.trim();
  if (current !== signupOtpSentForEmail) {
    signupEmailVerified = false;
    document.getElementById('emailVerifiedBadge').style.display = 'none';
    document.getElementById('sendOtpBtn').style.display = 'inline-block';
    document.getElementById('sendOtpBtn').disabled = false;
    document.getElementById('sendOtpBtn').textContent = 'Send OTP';
    document.getElementById('signupOtpBlock').style.display = 'none';
  }
}

async function handleSendEmailOtp(isResend = false) {
  const email = document.getElementById('signupEmail').value.trim();

  if (!email) {
    showAuthError('signupOtpMsg', 'Please enter your email first.');
    return;
  }

  const btn = document.getElementById('sendOtpBtn');
  btn.disabled = true;
  btn.textContent = 'Sending...';

  try {
    const { ok, data } = await postJSON('/api/auth/send-email-otp', { email });

    if (!ok) {
      showAuthError('signupOtpMsg', data.detail || 'Could not send OTP.');
      btn.disabled = false;
      btn.textContent = 'Send OTP';
      return;
    }

    signupOtpSentForEmail = email;
    document.getElementById('signupOtpBlock').style.display = 'block';
    document.getElementById('signupOtpCode').value = '';
    btn.textContent = isResend ? 'Send OTP' : 'Sent';
    btn.disabled = false;
    showAuthError('signupOtpMsg', data.message || 'Code sent — check your email.', true);

  } catch (err) {
    showAuthError('signupOtpMsg', 'Could not reach server. Is the backend running?');
    btn.disabled = false;
    btn.textContent = 'Send OTP';
  }
}

async function handleVerifyEmailOtp() {
  const email = document.getElementById('signupEmail').value.trim();
  const otp = document.getElementById('signupOtpCode').value.trim();

  if (!otp || otp.length !== 6) {
    showAuthError('signupOtpMsg', 'Please enter the 6-digit code.');
    return;
  }

  try {
    const { ok, data } = await postJSON('/api/auth/verify-email-otp', { email, otp });

    if (!ok) {
      showAuthError('signupOtpMsg', data.detail || 'Invalid code.');
      return;
    }

    // Verified — collapse the OTP UI, show a tick next to the email field
    signupEmailVerified = true;
    document.getElementById('signupOtpBlock').style.display = 'none';
    document.getElementById('sendOtpBtn').style.display = 'none';
    document.getElementById('emailVerifiedBadge').style.display = 'inline';
    document.getElementById('signupEmail').readOnly = true; // lock the verified email in place
    showAuthError('signupOtpMsg', 'Email verified!', true);

  } catch (err) {
    showAuthError('signupOtpMsg', 'Could not reach server. Is the backend running?');
  }
}

// ────────────────────────────────────────────────
// SIGNUP — CREATE ACCOUNT (only allowed after email is verified)
// ────────────────────────────────────────────────
async function handleSignup() {
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const confirm = document.getElementById('signupConfirm').value;

  if (!name || !email || !password || !confirm) {
    showAuthError('signupError', 'Please fill in all fields.');
    return;
  }
  if (!signupEmailVerified || email !== signupOtpSentForEmail) {
    showAuthError('signupError', 'Please verify your email with the OTP first.');
    return;
  }
  if (password !== confirm) {
    showAuthError('signupError', 'Passwords do not match.');
    return;
  }
  if (password.length < 6) {
    showAuthError('signupError', 'Password must be at least 6 characters.');
    return;
  }

  try {
    const { ok, data } = await postJSON('/api/auth/register', { name, email, password });

    if (!ok) {
      showAuthError('signupError', data.detail || 'Could not create account.');
      return;
    }

    saveSession(data.access_token, data.user);
    updateLoggedInUser();
    window.location.href = 'dashboard.html';

  } catch (err) {
    showAuthError('signupError', 'Could not reach server. Is the backend running?');
  }
}

// ────────────────────────────────────────────────
// FORGOT PASSWORD (OTP-based)
// ────────────────────────────────────────────────
let pendingResetEmail = null;

async function handleForgotPasswordRequest(isResend = false) {
  const email = isResend ? pendingResetEmail : document.getElementById('forgotEmail').value.trim();

  if (!email) {
    showAuthError('forgotMsg', 'Please enter your email.');
    return;
  }

  try {
    const { ok, data } = await postJSON('/api/auth/forgot-password/request', { email });

    if (!ok) {
      showAuthError('forgotMsg', data.detail || 'Something went wrong.');
      return;
    }

    pendingResetEmail = email;
    document.getElementById('forgotStep1').style.display = 'none';
    document.getElementById('forgotStep2').style.display = 'block';
    showAuthError('forgotResetMsg', data.message || 'If that email is registered, a code has been sent.', true);

  } catch (err) {
    showAuthError('forgotMsg', 'Could not reach server. Is the backend running?');
  }
}

async function handleForgotPasswordReset() {
  const otp = document.getElementById('forgotOtp').value.trim();
  const newPassword = document.getElementById('forgotNewPassword').value;

  if (!pendingResetEmail) {
    showAuthError('forgotResetMsg', 'Please request a code first.');
    return;
  }
  if (!otp || otp.length !== 6) {
    showAuthError('forgotResetMsg', 'Please enter the 6-digit code.');
    return;
  }
  if (!newPassword || newPassword.length < 6) {
    showAuthError('forgotResetMsg', 'Password must be at least 6 characters.');
    return;
  }

  try {
    const { ok, data } = await postJSON('/api/auth/forgot-password/reset', {
      email: pendingResetEmail,
      otp,
      new_password: newPassword
    });

    if (!ok) {
      showAuthError('forgotResetMsg', data.detail || 'Could not reset password.');
      return;
    }

    showAuthError('forgotResetMsg', data.message || 'Password updated. Please log in.', true);
    setTimeout(() => {
      resetForgotPasswordPage();
      showPage('loginPage');
    }, 1500);

  } catch (err) {
    showAuthError('forgotResetMsg', 'Could not reach server. Is the backend running?');
  }
}

function resetForgotPasswordPage() {
  pendingResetEmail = null;
  document.getElementById('forgotStep1').style.display = 'block';
  document.getElementById('forgotStep2').style.display = 'none';
  document.getElementById('forgotEmail').value = '';
  document.getElementById('forgotOtp').value = '';
  document.getElementById('forgotNewPassword').value = '';
}

// ────────────────────────────────────────────────
// LOGOUT / SESSION HELPERS
// ────────────────────────────────────────────────
function handleLogout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('hv_token');
  localStorage.removeItem('hv_user');
  showPage('loginPage');
}

function updateLoggedInUser() {
  const el = document.getElementById('loggedInAs');
  if (el && currentUser) el.textContent = `👤 ${currentUser.name}`;
}

window.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('loginPage')) {
    // 1. Strict Validation: Ensure tokens aren't corrupt, 'null', or 'undefined' strings
    const rawToken = localStorage.getItem('hv_token');
    const rawUser = localStorage.getItem('hv_user');

    const isValidToken = rawToken && rawToken !== 'null' && rawToken !== 'undefined' && rawToken.trim() !== '';
    let isValidUser = false;
    
    try {
      const parsedUser = JSON.parse(rawUser);
      isValidUser = parsedUser && typeof parsedUser === 'object' && Boolean(parsedUser.email || parsedUser.id);
    } catch (e) {
      isValidUser = false;
    }

    // 2. Only redirect if BOTH token and user are verifiably present
    if (isValidToken && isValidUser) {
      window.location.replace('dashboard.html');
    } else {
      // Clean up any corrupt leftover storage
      localStorage.removeItem('hv_token');
      localStorage.removeItem('hv_user');
      authToken = null;
      currentUser = null;

      const preferred = localStorage.getItem('hv_preferred_view');
      localStorage.removeItem('hv_preferred_view');
      if (preferred === 'signupPage' && document.getElementById('signupPage')) {
        showPage('signupPage');
      } else {
        showPage('loginPage');
      }
    }
  }
});
