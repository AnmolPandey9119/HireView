// ════════════════════════════════════════════════
// HireView AI — Auth Logic (Fixed)
// ════════════════════════════════════════════════

function showPage(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
}

function showAuthError(elementId, message) {
  const el = document.getElementById(elementId);
  el.textContent = message;
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 5000);
}

async function handleLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!email || !password) {
    showAuthError('loginError', 'Please enter your email and password.');
    return;
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      showAuthError('loginError', data.detail || 'Incorrect email or password.');
      return;
    }

    authToken = data.access_token;
    currentUser = data.user;
    localStorage.setItem('hv_token', authToken);
    localStorage.setItem('hv_user', JSON.stringify(currentUser));

    updateLoggedInUser();
    showPage('startInterviewPage');

  } catch (err) {
    showAuthError('loginError', 'Could not reach server. Is the backend running?');
  }
}

async function handleSignup() {
  const name = document.getElementById('signupName').value.trim();
  const email = document.getElementById('signupEmail').value.trim();
  const password = document.getElementById('signupPassword').value;
  const confirm = document.getElementById('signupConfirm').value;

  if (!name || !email || !password || !confirm) {
    showAuthError('signupError', 'Please fill in all fields.');
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
    const res = await fetch(`${BACKEND_URL}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });

    const data = await res.json();
    if (!res.ok) {
      showAuthError('signupError', data.detail || 'Could not create account.');
      return;
    }

    authToken = data.access_token;
    currentUser = data.user;
    localStorage.setItem('hv_token', authToken);
    localStorage.setItem('hv_user', JSON.stringify(currentUser));

    updateLoggedInUser();
    showPage('startInterviewPage');

  } catch (err) {
    showAuthError('signupError', 'Could not reach server. Is the backend running?');
  }
}

function handleForgotPassword() {
  const email = document.getElementById('forgotEmail').value.trim();
  const msgEl = document.getElementById('forgotMsg');

  if (!email) {
    msgEl.style.color = '#f87171';
    msgEl.textContent = 'Please enter your email.';
    msgEl.classList.add('show');
    return;
  }

  msgEl.style.color = '#22c55e';
  msgEl.style.background = 'rgba(34,197,94,0.1)';
  msgEl.style.border = '1px solid rgba(34,197,94,0.3)';
  msgEl.textContent = `✅ If ${email} is registered, a reset link has been sent. (Email service coming soon)`;
  msgEl.classList.add('show');
}

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
    if (authToken && currentUser) {
      window.location.href = 'interview.html';
    } else {
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