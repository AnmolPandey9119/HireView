// Auth check
if (!authToken) window.location.href = '/auth';

// Escapes user-controlled text before it's interpolated into innerHTML
// — needed anywhere a custom-typed role or backend-forwarded reason
// text is rendered as HTML.
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}

// Deep-link from /interview's "View Plans" button when the free-trial
// quota was exceeded — jump straight to Payment & Subscription instead
// of leaving the user to find it themselves.
if (new URLSearchParams(window.location.search).get('openPayment') === '1') {
  window.addEventListener('DOMContentLoaded', () => {
    openBigPanel();
    switchTab('paymentPage', document.querySelector('.sidebar-link[data-page="paymentPage"]'));
  });
}

// Set by loadDashboard() from /api/dashboard's stats.interviews_remaining_free.
// null until the first successful load — treated as "don't know yet" so we
// never wrongly block a click before the data has arrived.
let remainingFreeInterviews = null;

// Same idea, but for paid users' 6/day cap — null means "not a paid
// user" or "not loaded yet", either way we don't block on it.
let remainingTodayInterviews = null;

// ────────────────────────────────────────────
// "+ New Interview" pre-check — runs BEFORE navigating to the setup
// form, so a user who has hit their limit finds out immediately
// instead of after filling in the whole form and clicking
// "Begin Interview". The backend still enforces this independently
// on POST /api/interviews — this is purely a faster, friendlier
// heads-up on the frontend.
// ────────────────────────────────────────────
function handleNewInterviewClick() {
  const activeUntil = currentUser?.subscription_active_until ? new Date(currentUser.subscription_active_until) : null;
  const hasActiveSubscription = !!(activeUntil && activeUntil.getTime() > Date.now());

  if (hasActiveSubscription && remainingTodayInterviews === 0) {
    showLimitModal('daily');
    return;
  }

  if (hasActiveSubscription || remainingFreeInterviews === null || remainingFreeInterviews > 0) {
    window.location.href = '/interview';
    return;
  }

  // No active subscription and no free interviews left. If they've
  // purchased a plan before (subscription_plan is set even after it
  // lapses), the more accurate message is "your plan expired" rather
  // than "you used your free trial".
  const hadPlanBefore = !!currentUser?.subscription_plan;
  showLimitModal(hadPlanBefore ? 'expired' : 'quota');
}

function showLimitModal(kind) {
  const icon  = document.getElementById('limitModalIcon');
  const title = document.getElementById('limitModalTitle');
  const sub   = document.getElementById('limitModalSub');

  if (kind === 'expired') {
    icon.textContent = '⏳';
    title.textContent = 'Your plan has expired';
    sub.textContent = 'Your subscription has ended. Please renew a plan to continue taking unlimited interviews.';
  } else if (kind === 'daily') {
    icon.textContent = '⏰';
    title.textContent = "Today's limit reached";
    sub.textContent = "You've used all 6 interviews for today. Come back after midnight IST for more.";
  } else {
    icon.textContent = '🔒';
    title.textContent = 'Free interviews used up';
    sub.textContent = "You've used all 3 free interviews. Please purchase a plan to continue.";
  }

  document.getElementById('limitModalBackdrop').classList.add('open');
}

function closeLimitModal() {
  document.getElementById('limitModalBackdrop').classList.remove('open');
}

function goToPlansFromLimitModal() {
  closeLimitModal();
  openBigPanel();
  switchTab('paymentPage', document.querySelector('.sidebar-link[data-page="paymentPage"]'));
}

function handleLogout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('hv_token');
  localStorage.removeItem('hv_user');
  window.location.href = '/auth';
}

// ────────────────────────────────────────────
// MINI DROPDOWN (Google-style, opens from avatar)
// ────────────────────────────────────────────
function toggleMiniDropdown() {
  document.getElementById('miniDropdown').classList.toggle('open');
}

document.addEventListener('click', (e) => {
  const widget = document.getElementById('profileWidget');
  if (widget && !widget.contains(e.target)) {
    document.getElementById('miniDropdown').classList.remove('open');
  }
});

// ────────────────────────────────────────────
// BIG ACCOUNT-MANAGEMENT PANEL
// ────────────────────────────────────────────
function openBigPanel() {
  document.getElementById('miniDropdown').classList.remove('open');
  document.getElementById('accountBackdrop').classList.add('open');
  document.getElementById('accountBigPanel').classList.add('open');
  switchTab('personalInfoPage', document.querySelector('.sidebar-link[data-page="personalInfoPage"]'));
  document.body.style.overflow = 'hidden';
}

function closeBigPanel() {
  document.getElementById('accountBackdrop').classList.remove('open');
  document.getElementById('accountBigPanel').classList.remove('open');
  document.body.style.overflow = '';
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.getElementById('miniDropdown').classList.remove('open');
    closeBigPanel();
  }
});

// ────────────────────────────────────────────
// TAB SWITCHING (sidebar navigation inside the big panel)
// ────────────────────────────────────────────
function switchTab(pageId, btnEl) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  document.querySelectorAll('.sidebar-link[data-page]').forEach(l => l.classList.remove('active'));
  if (btnEl) btnEl.classList.add('active');
}

// ────────────────────────────────────────────
// Toast notifications
// ────────────────────────────────────────────
let toastTimer = null;
function showToast(message, isError) {
  const toast = document.getElementById('hvToast');
  toast.textContent = message;
  toast.classList.toggle('error', !!isError);
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), isError ? 3500 : 2500);
}
function showComingSoon(feature) {
  showToast(`${feature} is coming soon 🚧`, false);
}

// ────────────────────────────────────────────
// PAYMENT — Razorpay checkout for Weekly/Monthly plans
// ────────────────────────────────────────────
const PLAN_LABELS = { weekly: 'Weekly Plan (₹99)', monthly: 'Monthly Plan (₹299)' };

async function startCheckout(plan, btnEl) {
  if (btnEl) { btnEl.disabled = true; btnEl.dataset.originalText = btnEl.textContent; btnEl.textContent = 'Please wait…'; }

  try {
    // 1. Ask our backend to create a Razorpay order for this plan.
    const orderRes = await fetch(`${BACKEND_URL}/api/payments/create-order`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ plan })
    });
    if (!orderRes.ok) {
      const err = await orderRes.json().catch(() => ({}));
      throw new Error(err.detail || 'Could not start checkout. Please try again.');
    }
    const order = await orderRes.json();

    // 2. Open Razorpay's Checkout popup with that order.
    const options = {
      key: order.key_id,
      amount: order.amount,
      currency: order.currency,
      name: 'HireView',
      description: order.plan_label,
      order_id: order.order_id,
      prefill: {
        name: currentUser?.name || '',
        email: currentUser?.email || ''
      },
      theme: { color: '#6366f1' },
      handler: async function (response) {
        // 3. Payment succeeded on Razorpay's side — verify it on OUR backend
        // before treating the subscription as active.
        try {
          const verifyRes = await fetch(`${BACKEND_URL}/api/payments/verify`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${authToken}`
            },
            body: JSON.stringify({
              razorpay_order_id: response.razorpay_order_id,
              razorpay_payment_id: response.razorpay_payment_id,
              razorpay_signature: response.razorpay_signature,
              plan
            })
          });
          if (!verifyRes.ok) {
            const err = await verifyRes.json().catch(() => ({}));
            throw new Error(err.detail || 'Payment verification failed.');
          }
          const result = await verifyRes.json();

          // Refresh local user state so subscription status is up to date
          // without needing a full page reload.
          if (currentUser) {
            currentUser.subscription_plan = result.plan;
            currentUser.subscription_active_until = result.subscription_active_until;
            localStorage.setItem('hv_user', JSON.stringify(currentUser));
            renderSubscriptionStatus(currentUser);
          }
          loadPaymentHistory();

          showToast(`${PLAN_LABELS[plan]} activated! 🎉`, false);
        } catch (verifyErr) {
          // Money was captured by Razorpay but our verification failed —
          // this should be rare, but don't silently say "success" here.
          showToast(verifyErr.message || 'Payment received but verification failed — contact support.', true);
        } finally {
          if (btnEl) { btnEl.disabled = false; btnEl.textContent = btnEl.dataset.originalText; }
        }
      },
      modal: {
        // User closed the popup without paying — just reset the button.
        ondismiss: function () {
          if (btnEl) { btnEl.disabled = false; btnEl.textContent = btnEl.dataset.originalText; }
        }
      }
    };

    const rzp = new Razorpay(options);
    rzp.on('payment.failed', function (response) {
      showToast(response?.error?.description || 'Payment failed. Please try again.', true);
      if (btnEl) { btnEl.disabled = false; btnEl.textContent = btnEl.dataset.originalText; }
    });
    rzp.open();
  } catch (err) {
    showToast(err.message || 'Something went wrong. Please try again.', true);
    if (btnEl) { btnEl.disabled = false; btnEl.textContent = btnEl.dataset.originalText; }
  }
}

// ────────────────────────────────────────────
// PROFILE INFO (avatar trigger, mini dropdown, big panel)
// ────────────────────────────────────────────
function getInitials(name) {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  const initials = parts.length > 1
    ? parts[0][0] + parts[parts.length - 1][0]
    : parts[0].slice(0, 2);
  return initials.toUpperCase();
}

// Renders either the uploaded photo (if any) or initials into an avatar circle
function renderAvatarEl(elId, user) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (user && user.profile_picture) {
    el.innerHTML = `<img src="${user.profile_picture}" alt="Profile photo" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  } else {
    el.textContent = getInitials(user && user.name);
  }

  // Golden ring + crown badge once a subscription is active — this is
  // what makes the account visibly "premium" at a glance, everywhere
  // the avatar shows up (header, mini-dropdown, big profile panel).
  const activeUntil = user?.subscription_active_until ? new Date(user.subscription_active_until) : null;
  const isPremium = !!(activeUntil && activeUntil.getTime() > Date.now());
  el.classList.toggle('is-premium', isPremium);

  if (elId === 'headerAvatar') {
    const badge = document.getElementById('headerCrownBadge');
    if (badge) badge.classList.toggle('show', isPremium);
  }
  if (elId === 'miniAvatar') {
    const badge = document.getElementById('miniCrownBadge');
    if (badge) badge.classList.toggle('show', isPremium);
  }

  // The big avatar on the Personal Info page doubles as a click-to-zoom
  // preview, but only when there's an actual photo — clicking initials
  // shouldn't open an empty lightbox.
  if (elId === 'profileAvatar') {
    const hasPhoto = !!(user && user.profile_picture);
    const ring = document.getElementById('profileAvatarRing');
    if (ring) {
      ring.classList.toggle('has-photo', hasPhoto);
      ring.classList.toggle('is-premium', isPremium);
    }
  }
}

// ────────────────────────────────────────────
// PREMIUM DASHBOARD BANNER — shown front-and-center on the main
// dashboard (not tucked inside the account panel) whenever the
// user's subscription is currently active.
// ────────────────────────────────────────────
function renderPremiumDashboardBanner(user) {
  const banner = document.getElementById('premiumDashBanner');
  if (!banner) return;

  const activeUntil = user?.subscription_active_until ? new Date(user.subscription_active_until) : null;
  const isActive = !!(activeUntil && activeUntil.getTime() > Date.now());

  if (!isActive) {
    banner.classList.add('hidden');
    return;
  }

  const planLabel = user.subscription_plan === 'monthly' ? 'Monthly Plan' : 'Weekly Plan';
  const daysLeft = Math.max(1, Math.ceil((activeUntil.getTime() - Date.now()) / 86400000));
  const expiryText = activeUntil.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  document.getElementById('premiumDashTitle').textContent = `Premium Member — ${planLabel}`;
  document.getElementById('premiumDashSub').textContent = `Unlimited interviews unlocked · Valid till ${expiryText}`;
  document.getElementById('premiumDashDays').textContent = `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
  banner.classList.remove('hidden');
}

// ────────────────────────────────────────────
// AVATAR PREVIEW LIGHTBOX
// ────────────────────────────────────────────
function openAvatarPreview() {
  if (!currentUser || !currentUser.profile_picture) return; // nothing to enlarge yet
  document.getElementById('avatarPreviewImg').src = currentUser.profile_picture;
  document.getElementById('avatarPreviewOverlay').classList.add('open');
}

function closeAvatarPreview() {
  document.getElementById('avatarPreviewOverlay').classList.remove('open');
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeAvatarPreview();
});

function populatePersonalInfo(user) {
  if (!user) return;
  const firstName = (user.name || '').trim().split(/\s+/)[0] || '';

  renderAvatarEl('headerAvatar', user);
  renderAvatarEl('miniAvatar', user);
  renderAvatarEl('profileAvatar', user);

  document.getElementById('miniEmail').textContent = user.email || '—';
  document.getElementById('miniGreeting').textContent = `Hi, ${firstName || 'there'}!`;

  document.getElementById('profileName').textContent = user.name || '—';
  document.getElementById('profileEmail').textContent = user.email || '—';

  renderSubscriptionStatus(user);
}

// ────────────────────────────────────────────
// SUBSCRIPTION STATUS — active-plan banner, gold profile chip,
// and the "Get a membership plan" card, all driven off
// user.subscription_plan / user.subscription_active_until.
// ────────────────────────────────────────────
function renderSubscriptionStatus(user) {
  const banner   = document.getElementById('activePlanBanner');
  const chip     = document.getElementById('profileGoldChip');
  const card     = document.getElementById('profileMembershipCard');
  const cardTitle = document.getElementById('profileMembershipTitle');
  const cardSub   = document.getElementById('profileMembershipSub');
  const cardBtn   = document.getElementById('profileMembershipBtn');

  const activeUntil = user?.subscription_active_until ? new Date(user.subscription_active_until) : null;
  const isActive = !!(activeUntil && activeUntil.getTime() > Date.now());

  renderPremiumDashboardBanner(user); // front-of-dashboard banner + welcome chip

  if (!isActive) {
    banner.classList.add('hidden');
    chip.classList.remove('show');
    card.classList.remove('is-active');
    cardTitle.textContent = 'Get a membership plan';
    cardTitle.classList.remove('is-gold');
    cardSub.textContent = 'Unlock access to more premium features';
    cardBtn.textContent = 'Explore plans';
    return;
  }

  const planLabel = user.subscription_plan === 'monthly' ? 'Monthly Plan' : 'Weekly Plan';
  const daysLeft = Math.max(1, Math.ceil((activeUntil.getTime() - Date.now()) / 86400000));
  const expiryText = activeUntil.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });

  // Active-plan banner on the Payment page
  document.getElementById('activePlanName').textContent = `${planLabel} — Active`;
  document.getElementById('activePlanExpiry').textContent = `Valid till ${expiryText}`;
  document.getElementById('activePlanDays').textContent = `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
  banner.classList.remove('hidden');

  // Gold crown chip next to the profile name
  chip.classList.add('show');

  // Membership card turns gold and reflects the current plan
  card.classList.add('is-active');
  cardTitle.textContent = `👑 ${planLabel} — Active`;
  cardTitle.classList.add('is-gold');
  cardSub.textContent = `Valid till ${expiryText} (${daysLeft} day${daysLeft === 1 ? '' : 's'} left)`;
  cardBtn.textContent = 'Renew / View plans';
}

// ────────────────────────────────────────────
// PAYMENT HISTORY — GET /api/payments/history
// ────────────────────────────────────────────
async function loadPaymentHistory() {
  const emptyEl = document.getElementById('paymentHistoryEmpty');
  const tableEl = document.getElementById('paymentHistoryTable');
  const bodyEl  = document.getElementById('paymentHistoryBody');

  try {
    const res = await fetch(`${BACKEND_URL}/api/payments/history`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });
    if (!res.ok) {
      // Don't fail silently — log it so it's debuggable from DevTools
      // Console/Network tab instead of just staying stuck on "No payments yet".
      const errBody = await res.text().catch(() => '');
      console.error(`[payments/history] request failed: ${res.status} ${errBody}`);
      return;
    }
    const data = await res.json();
    const transactions = data.transactions || [];

    if (transactions.length === 0) {
      emptyEl.classList.remove('hidden');
      tableEl.classList.add('hidden');
      return;
    }

    bodyEl.innerHTML = transactions.map(t => {
      const amount = `₹${(t.amount_paise / 100).toFixed(0)}`;
      const paidOn = new Date(t.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      const validTill = new Date(t.active_until).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
      return `
        <tr>
          <td>${t.plan_label}</td>
          <td class="hv-amount">${amount}</td>
          <td>${paidOn}</td>
          <td>${validTill}</td>
          <td><span class="history-status-pill">${t.status}</span></td>
        </tr>`;
    }).join('');

    emptyEl.classList.add('hidden');
    tableEl.classList.remove('hidden');
  } catch (err) {
    console.error('[payments/history] error:', err);
  }
}

// Show whatever we already have in localStorage immediately,
// then refresh once /api/dashboard responds below.
if (currentUser) populatePersonalInfo(currentUser);
loadPaymentHistory();

// ────────────────────────────────────────────
// Shared helper: PUT /api/auth/profile (name and/or photo)
// ────────────────────────────────────────────
async function saveProfile(payload) {
  const res = await fetch(`${BACKEND_URL}/api/auth/profile`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Something went wrong. Please try again.');

  currentUser = data;
  localStorage.setItem('hv_user', JSON.stringify(currentUser));
  populatePersonalInfo(currentUser);
  return currentUser;
}

// ────────────────────────────────────────────
// AVATAR UPLOAD
// ────────────────────────────────────────────
function triggerAvatarUpload() {
  document.getElementById('avatarFileInput').click();
}

function resizeImageFile(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That doesn\'t look like a valid image.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > height) {
          if (width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
        } else {
          if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function handleAvatarFile(e) {
  const file = e.target.files[0];
  e.target.value = ''; // allow re-selecting the same file later
  if (!file) return;

  if (!file.type.startsWith('image/')) {
    showToast('Please choose an image file.', true);
    return;
  }

  try {
    const dataUrl = await resizeImageFile(file, 400, 0.82);
    await saveProfile({ profile_picture: dataUrl });
    showToast('Profile photo updated!');
  } catch (err) {
    showToast(err.message || 'Could not update photo.', true);
  }
}

async function removeAvatarPhoto() {
  if (!currentUser || !currentUser.profile_picture) return; // nothing to remove
  if (!confirm('Remove your profile photo?')) return;

  try {
    // Empty string tells the backend to explicitly clear profile_picture
    // (as opposed to omitting the field, which leaves it untouched).
    await saveProfile({ profile_picture: '' });
    closeAvatarPreview();
    showToast('Profile photo removed.');
  } catch (err) {
    showToast(err.message || 'Could not remove photo.', true);
  }
}

// ────────────────────────────────────────────
// EDIT NAME
// ────────────────────────────────────────────
function startEditName() {
  document.getElementById('nameInput').value = currentUser?.name || '';
  document.getElementById('nameDisplay').classList.add('hidden');
  document.getElementById('nameEditForm').classList.remove('hidden');
  document.getElementById('nameInput').focus();
}

function cancelNameEdit() {
  document.getElementById('nameEditForm').classList.add('hidden');
  document.getElementById('nameDisplay').classList.remove('hidden');
}

async function saveNameEdit() {
  const val = document.getElementById('nameInput').value.trim();
  if (!val) { showToast('Name cannot be empty.', true); return; }

  const btn = document.getElementById('nameSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    await saveProfile({ name: val });
    cancelNameEdit();
    showToast('Name updated!');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// ────────────────────────────────────────────
// CHANGE PASSWORD
// ────────────────────────────────────────────
// Mirrors models/auth_utils.py's validate_password_strength on the
// backend — checked client-side too so the person gets an immediate,
// specific message instead of typing a 6-char password that passes
// here and then gets rejected by the server with no warning.
function getPasswordStrengthError(password) {
  if (!password || password.length < 8) {
    return 'Password must be at least 8 characters long and include an uppercase letter, a lowercase letter, a number, and a special character.';
  }
  if (!/[A-Z]/.test(password)) {
    return 'Password must include at least one uppercase letter.';
  }
  if (!/[a-z]/.test(password)) {
    return 'Password must include at least one lowercase letter.';
  }
  if (!/\d/.test(password)) {
    return 'Password must include at least one number.';
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/.test(password)) {
    return 'Password must include at least one special character.';
  }
  return null;
}

async function handleChangePassword() {
  const currentPassword = document.getElementById('currentPasswordInput').value;
  const newPassword = document.getElementById('newPasswordInput').value;
  const confirmPassword = document.getElementById('confirmPasswordInput').value;

  if (!currentPassword || !newPassword || !confirmPassword) {
    showToast('Please fill in all three fields.', true);
    return;
  }
  if (newPassword !== confirmPassword) {
    showToast('New passwords do not match.', true);
    return;
  }
  const passwordError = getPasswordStrengthError(newPassword);
  if (passwordError) {
    showToast(passwordError, true);
    return;
  }

  const btn = document.getElementById('updatePasswordBtn');
  btn.disabled = true;
  btn.textContent = 'Updating...';

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.detail || 'Could not update password.');
    }

    document.getElementById('currentPasswordInput').value = '';
    document.getElementById('newPasswordInput').value = '';
    document.getElementById('confirmPasswordInput').value = '';
    showToast('Password updated!');

  } catch (err) {
    showToast(err.message || 'Could not update password.', true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Update Password';
  }
}
// ────────────────────────────────────────────
let pendingNewEmail = null;
let resendCooldownTimer = null;

function startEditEmail() {
  document.getElementById('newEmailInput').value = '';
  document.getElementById('emailDisplay').classList.add('hidden');
  document.getElementById('emailEditForm').classList.remove('hidden');
  document.getElementById('emailOtpForm').classList.add('hidden');
  document.getElementById('newEmailInput').focus();
}

function cancelEmailEdit() {
  document.getElementById('emailEditForm').classList.add('hidden');
  document.getElementById('emailOtpForm').classList.add('hidden');
  document.getElementById('emailDisplay').classList.remove('hidden');
  pendingNewEmail = null;
  clearInterval(resendCooldownTimer);
}

async function sendEmailOtp(isResend) {
  const emailToUse = isResend ? pendingNewEmail : document.getElementById('newEmailInput').value.trim();
  if (!emailToUse) { showToast('Enter a new email address.', true); return; }

  const btn = isResend ? document.getElementById('resendOtpBtn') : document.getElementById('emailSendBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  if (!isResend) btn.textContent = 'Sending...';

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/change-email/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ new_email: emailToUse })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || 'Could not send the code. Please try again.');

    pendingNewEmail = emailToUse;
    document.getElementById('otpSentNote').textContent = `Code sent to ${emailToUse}`;
    document.getElementById('emailEditForm').classList.add('hidden');
    document.getElementById('emailOtpForm').classList.remove('hidden');
    document.getElementById('emailOtpInput').value = '';
    document.getElementById('emailOtpInput').focus();
    startResendCooldown();
    showToast(isResend ? 'Code resent!' : 'Verification code sent!');
  } catch (err) {
    showToast(err.message, true);
    if (!isResend) { btn.disabled = false; btn.textContent = originalText; }
  }
}

function startResendCooldown() {
  const btn = document.getElementById('resendOtpBtn');
  let seconds = 45; // matches backend OTP_RESEND_COOLDOWN_SECONDS
  btn.disabled = true;
  btn.textContent = `Resend code (${seconds}s)`;
  clearInterval(resendCooldownTimer);
  resendCooldownTimer = setInterval(() => {
    seconds--;
    if (seconds <= 0) {
      clearInterval(resendCooldownTimer);
      btn.disabled = false;
      btn.textContent = 'Resend code';
    } else {
      btn.textContent = `Resend code (${seconds}s)`;
    }
  }, 1000);
}

async function verifyEmailOtp() {
  const otp = document.getElementById('emailOtpInput').value.trim();
  if (!otp) { showToast('Enter the 6-digit code.', true); return; }
  if (!pendingNewEmail) { showToast('Please request a new code.', true); return; }

  const btn = document.getElementById('emailVerifyBtn');
  btn.disabled = true;
  btn.textContent = 'Verifying...';

  try {
    const res = await fetch(`${BACKEND_URL}/api/auth/change-email/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
      body: JSON.stringify({ new_email: pendingNewEmail, otp })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || 'Verification failed. Please try again.');

    // Backend returns a fresh Token { access_token, user } since the email claim changed
    authToken = data.access_token;
    currentUser = data.user;
    localStorage.setItem('hv_token', authToken);
    localStorage.setItem('hv_user', JSON.stringify(currentUser));
    populatePersonalInfo(currentUser);
    cancelEmailEdit();
    clearInterval(resendCooldownTimer);
    showToast('Email updated successfully!');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Verify & Update';
  }
}

function formatDate(isoString) {
  if (!isoString) return '—';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function getScoreColor(score) {
  if (score == null) return 'rgba(255,255,255,0.3)';
  if (score >= 8) return '#22c55e';
  if (score >= 6) return '#f59e0b';
  return '#ef4444';
}

function renderFreeTrialBanner(remaining, total) {
  const banner = document.getElementById('freeTrialBanner');
  const text = document.getElementById('freeTrialText');
  const badges = document.getElementById('freeTrialBadges');

  if (remaining > 0) {
    banner.style.display = 'flex';
    text.textContent = `You have ${remaining} free interview${remaining > 1 ? 's' : ''} remaining`;
    let html = '';
    for (let i = 0; i < 3; i++) {
      if (i < Math.min(total, 3)) {
        html += `<div class="trial-dot used">✓</div>`;
      } else {
        html += `<div class="trial-dot available">${i + 1}</div>`;
      }
    }
    badges.innerHTML = html;
  } else {
    banner.style.display = 'none';
  }
}

function renderStats(stats) {
  document.getElementById('statsGrid').innerHTML = `
    <div class="stat-card">
      <div class="stat-icon">🎯</div>
      <div class="stat-value stat-purple">${stats.total_interviews}</div>
      <div class="stat-label">Total Interviews</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">✅</div>
      <div class="stat-value stat-green">${stats.completed_interviews}</div>
      <div class="stat-label">Completed</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">⭐</div>
      <div class="stat-value stat-yellow">${stats.average_score || '—'}</div>
      <div class="stat-label">Average Score</div>
    </div>
    <div class="stat-card">
      <div class="stat-icon">🏆</div>
      <div class="stat-value stat-pink">${stats.best_score || '—'}</div>
      <div class="stat-label">Best Score</div>
    </div>`;
}

function getSectorBadge(i) {
  if (i.sector === 'government') {
    const label = i.government_domain ? `🏛️ ${escapeHtml(i.government_domain)}` : '🏛️ Government';
    return `<span class="sector-badge sector-government">${label}</span>`;
  }
  return `<span class="sector-badge sector-private">💼 Private</span>`;
}

function getRoundBadge(i) {
  if (i.sector !== 'private' || !i.interview_round || i.interview_round === 'mixed') return '';
  const map = {
    technical: { icon: '🖥️', label: 'Technical Round' },
    hr: { icon: '🗣️', label: 'HR Round' }
  };
  const r = map[i.interview_round];
  if (!r) return '';
  return `<span class="sector-badge" style="background:rgba(129,140,248,0.15);color:#818cf8;border:1px solid rgba(129,140,248,0.3)">${r.icon} ${r.label}</span>`;
}

function renderInterviews(interviews) {
  const list = document.getElementById('interviewsList');
  if (!interviews || interviews.length === 0) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">📋</div>
        <div style="font-weight:700;font-size:1.1rem;margin-bottom:0.5rem">No interviews yet</div>
        <div style="font-size:0.9rem">Start your first interview to see your progress here</div>
      </div>`;
    return;
  }

  list.innerHTML = interviews.map(i => `
    <div class="interview-card" onclick="window.location.href='/history?id=${i.id}'">
      <div>
        <div class="interview-role">${escapeHtml(i.role)}</div>
        <div class="interview-date">📅 ${formatDate(i.started_at)}</div>
      </div>
      <div class="interview-meta">
        ${getSectorBadge(i)}
        ${getRoundBadge(i)}
        <div class="interview-score" style="color:${getScoreColor(i.overall_score)}">
          ${i.overall_score != null ? `${i.overall_score}/10` : '—'}
        </div>
        <span class="status-badge status-${i.status}" ${i.status === 'failed' && i.failure_reason ? `title="${escapeHtml(i.failure_reason)}"` : ''}>
         ${i.status === 'completed' ? '✅ Completed'
            : i.status === 'cheating_terminated' ? '🚨 Terminated'
            : i.status === 'failed' ? '⚠️ Failed'
            : '🔄 In Progress'}
        </span>
      </div>
    </div>`).join('');
}

async function loadDashboard() {
  try {
    const res = await fetch(`${BACKEND_URL}/api/dashboard`, {
      headers: { 'Authorization': `Bearer ${authToken}` }
    });

    if (!res.ok) {
      if (res.status === 401) {
        // Stale/invalid token — clear it before redirecting, otherwise
        // /auth sees a token still sitting in localStorage and
        // bounces straight back to /dashboard, which hits 401 again,
        // causing an infinite /auth <-> /dashboard redirect loop.
        localStorage.removeItem('hv_token');
        localStorage.removeItem('hv_user');
        window.location.href = '/auth';
        return;
      }
      throw new Error('Failed to load dashboard');
    }

    const data = await res.json();

    // Welcome text
    document.getElementById('welcomeText').textContent =
      `Welcome back, ${data.user.name.split(' ')[0]}! 👋`;

    // Profile widgets (header avatar, mini dropdown, big panel)
    populatePersonalInfo(data.user);

    // Free trial banner
    renderFreeTrialBanner(data.stats.interviews_remaining_free, data.stats.total_interviews);
    remainingFreeInterviews = data.stats.interviews_remaining_free;
    remainingTodayInterviews = data.stats.interviews_remaining_today;

    // Stats
    renderStats(data.stats);

    // Recent interviews
    renderInterviews(data.recent_interviews);

  } catch (err) {
    console.error('Dashboard error:', err);
    document.getElementById('statsGrid').innerHTML =
      '<div style="color:#f87171;padding:1rem">Could not load dashboard. Is the backend running?</div>';
  }
}

loadDashboard();