// ════════════════════════════════════════════════
// HireView — Website Assistant Widget
// A self-contained chat launcher + panel that answers visitor
// questions about HireView, right on the page (no WhatsApp/redirect
// involved). Talks to POST {BACKEND_URL}/api/assistant/chat.
//
// Drop <script src="js/assistant-widget.js"></script> onto any
// page, after js/config.js (which defines BACKEND_URL).
//
// Launcher placement (checked in this order):
//   1. If the page has an element with id="hva-launcher-slot", the
//      launcher renders INLINE inside that element instead (e.g. next
//      to the profile avatar on dashboard.html).
//   2. Else, if js/translate.js has already mounted its "EN / हिं"
//      button (#hv-translate-btn) on the page, the launcher is paired
//      right next to it — inside the top navbar if that's where
//      translate landed, or in the fixed top-right corner if translate
//      fell back to that. The chat panel opens BELOW the launcher in
//      this case, so the launcher's own close ("×") icon stays visible
//      above the open panel instead of getting hidden behind it.
//   3. Else (no translate button on the page), it falls back to the
//      original floating "Help & Support" pill, bottom-right, sitting
//      above the fixed site footer if present — panel opens upward
//      above the pill, as before.
// On narrow screens, the launcher always collapses to icon-only
// (label text hidden) regardless of placement.
// ════════════════════════════════════════════════

(function () {
  const API_URL = (typeof BACKEND_URL !== 'undefined' ? BACKEND_URL : '') + '/api/assistant/chat';
  const LAUNCHER_LABEL = 'Help & Support';

  // Conversation only lives in memory for the current page view — never
  // persisted (session or local storage), so a fresh page open/reload
  // always starts a clean conversation instead of showing last time's
  // questions.
  let history = [];

  // ---------- styles ----------
  const style = document.createElement('style');
  style.textContent = `
    /* Shared launcher look, used both floating (bottom-right pill)
       and docked (inline in a header, e.g. next to the profile avatar). */
    .hva-launcher {
      display: inline-flex; align-items: center; gap: 0.55rem; border: none; cursor: pointer;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #ec4899 100%);
      color: #fff; font-weight: 700; font-size: 0.85rem; white-space: nowrap;
      border-radius: 999px; padding: 0.5rem 1.1rem 0.5rem 0.5rem;
      box-shadow: 0 8px 25px rgba(99,102,241,0.45);
      transition: transform 0.25s ease, box-shadow 0.25s ease;
    }
    .hva-launcher:hover { transform: translateY(-2px); box-shadow: 0 12px 32px rgba(99,102,241,0.65); }
    .hva-launcher-icon {
      width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0;
      background: rgba(255,255,255,0.2); display: flex; align-items: center; justify-content: center;
    }
    .hva-launcher-icon svg { width: 16px; height: 16px; display: block; }
    .hva-launcher .hva-icon-close { display: none; }
    .hva-launcher.open .hva-icon-chat { display: none; }
    .hva-launcher.open .hva-icon-close { display: block; }

    /* Floating placement (default): fixed pill, bottom-right, lifted
       above the fixed site footer via inline style set by JS. */
    .hva-launcher--floating { position: fixed; right: 24px; bottom: 24px; z-index: 9999; }

    /* Docked placement: sits inline wherever the page puts the slot
       (e.g. dashboard header, next to the avatar), or paired next to
       the translate button. No fixed position of its own — position
       comes from wherever it's mounted in the DOM. */
    .hva-launcher--docked { position: relative; }

    /* Groups the launcher with the translate button so they sit
       together as one visual pair, "EN / हिं" then "Help & Support". */
    .hva-launcher-group { display: flex; align-items: center; gap: 0.6rem; }
    /* Only added when translate itself had to fall back to a fixed
       top-right corner (pages with no usable top navbar) — mirrors
       that same fixed placement so the pair moves together. */
    .hva-launcher-group--fixed { position: fixed; top: 18px; right: 20px; z-index: 99999; }
    @media (max-width: 640px) {
      .hva-launcher-group--fixed { top: 12px; right: 12px; gap: 0.5rem; }
    }

    /* Icon-only on narrow screens, for BOTH placements. */
    @media (max-width: 640px) {
      .hva-launcher { padding: 0; width: 46px; height: 46px; justify-content: center; border-radius: 50%; }
      .hva-launcher-label { display: none; }
      .hva-launcher-icon { width: 100%; height: 100%; background: transparent; }
      .hva-launcher-icon svg { width: 20px; height: 20px; }
    }

    .hva-panel {
      position: fixed; bottom: 98px; right: 24px; z-index: 9999;
      width: 360px; max-width: calc(100vw - 32px);
      height: 520px; max-height: calc(100vh - 140px);
      background: rgba(20,22,40,0.98); backdrop-filter: blur(20px);
      border: 1px solid rgba(99,102,241,0.25); border-radius: 20px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
      display: flex; flex-direction: column; overflow: hidden;
      opacity: 0; pointer-events: none; transform: translateY(-10px) scale(0.97);
      transition: opacity 0.22s ease, transform 0.22s ease;
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    .hva-panel.open { opacity: 1; pointer-events: auto; transform: translateY(0) scale(1); }

    .hva-header {
      padding: 1.1rem 1.25rem; display: flex; align-items: center; gap: 0.7rem;
      background: linear-gradient(135deg, rgba(99,102,241,0.18), rgba(236,72,153,0.12));
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .hva-avatar {
      width: 36px; height: 36px; border-radius: 50%; flex-shrink: 0;
      background: linear-gradient(135deg, #6366f1, #8b5cf6, #ec4899);
      display: flex; align-items: center; justify-content: center;
      font-weight: 800; color: white; font-size: 0.95rem;
    }
    .hva-header-text { line-height: 1.25; }
    .hva-header-title { font-weight: 700; color: #fff; font-size: 0.95rem; }
    .hva-header-sub { font-size: 0.78rem; color: rgba(255,255,255,0.55); display: flex; align-items: center; gap: 0.35rem; }
    .hva-dot { width: 7px; height: 7px; border-radius: 50%; background: #22c55e; box-shadow: 0 0 6px #22c55e; }

    .hva-messages {
      flex: 1; overflow-y: auto; padding: 1rem 1rem 0.5rem;
      display: flex; flex-direction: column; gap: 0.65rem;
    }
    .hva-messages::-webkit-scrollbar { width: 6px; }
    .hva-messages::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.15); border-radius: 6px; }

    .hva-msg { max-width: 82%; padding: 0.65rem 0.9rem; border-radius: 14px; font-size: 0.88rem; line-height: 1.45; word-wrap: break-word; }
    .hva-msg.user { align-self: flex-end; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: white; border-bottom-right-radius: 4px; }
    .hva-msg.assistant { align-self: flex-start; background: rgba(255,255,255,0.07); color: rgba(255,255,255,0.92); border: 1px solid rgba(255,255,255,0.06); border-bottom-left-radius: 4px; }
    .hva-msg.error { align-self: flex-start; background: rgba(239,68,68,0.12); color: #f87171; border: 1px solid rgba(239,68,68,0.25); }

    .hva-typing { align-self: flex-start; display: flex; gap: 4px; padding: 0.65rem 0.9rem; }
    .hva-typing span { width: 6px; height: 6px; border-radius: 50%; background: rgba(255,255,255,0.5); animation: hvaDot 1.2s infinite ease-in-out; }
    .hva-typing span:nth-child(2) { animation-delay: 0.15s; }
    .hva-typing span:nth-child(3) { animation-delay: 0.3s; }
    @keyframes hvaDot { 0%,60%,100% { opacity: 0.3; transform: scale(0.85); } 30% { opacity: 1; transform: scale(1.1); } }

    .hva-suggestions { display: flex; flex-wrap: wrap; gap: 0.4rem; padding: 0 1rem 0.75rem; }
    .hva-chip {
      font-size: 0.76rem; padding: 0.4rem 0.7rem; border-radius: 999px; cursor: pointer;
      background: rgba(99,102,241,0.12); border: 1px solid rgba(99,102,241,0.3); color: rgba(255,255,255,0.85);
      transition: background 0.2s ease;
    }
    .hva-chip:hover { background: rgba(99,102,241,0.22); }

    .hva-input-row { display: flex; gap: 0.5rem; padding: 0.85rem; border-top: 1px solid rgba(255,255,255,0.08); }
    .hva-input {
      flex: 1; resize: none; background: rgba(255,255,255,0.05); border: 1.5px solid rgba(99,102,241,0.25);
      border-radius: 12px; color: white; padding: 0.6rem 0.8rem; font-size: 0.88rem; font-family: inherit;
      max-height: 90px; outline: none;
    }
    .hva-input:focus { border-color: #6366f1; }
    .hva-input::placeholder { color: rgba(255,255,255,0.4); }
    .hva-send {
      width: 40px; height: 40px; border-radius: 12px; border: none; cursor: pointer; flex-shrink: 0;
      background: linear-gradient(135deg, #6366f1, #8b5cf6, #ec4899); display: flex; align-items: center; justify-content: center;
      transition: opacity 0.2s ease;
    }
    .hva-send:disabled { opacity: 0.45; cursor: not-allowed; }
    .hva-send svg { width: 18px; height: 18px; }

    @media (max-width: 480px) {
      .hva-panel { right: 16px; bottom: 90px; width: calc(100vw - 32px); }
      .hva-launcher--floating { right: 16px; }
    }
    @media (prefers-reduced-motion: reduce) {
      .hva-launcher, .hva-panel, .hva-typing span { transition: none; animation: none; }
    }
  `;
  document.head.appendChild(style);

  // ---------- launcher placement: docked slot (dashboard) > floating pill (everywhere else) ----------
  const dockSlot = document.getElementById('hva-launcher-slot');
  // translate.js runs before this script on every page that has it, so
  // by the time we get here its button (if any) already exists in the DOM.
  // Pairing the launcher with translate — and opening the panel BELOW
  // the launcher instead of above it — is dashboard-only: dashboard is
  // the only page with #hva-launcher-slot. Every other page keeps the
  // plain floating "Help & Support" pill, unaffected by translate.
  const translateBtn = document.getElementById('hv-translate-btn');
  const isDocked = !!dockSlot;
  const isPaired = isDocked && !!translateBtn;

  const bubble = document.createElement('button');
  bubble.className = 'hva-launcher ' + (isDocked ? 'hva-launcher--docked' : 'hva-launcher--floating');
  bubble.setAttribute('aria-label', LAUNCHER_LABEL);
  bubble.innerHTML = `
    <span class="hva-launcher-icon">
      <svg class="hva-icon-chat" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
      <svg class="hva-icon-close" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
    </span>
    <span class="hva-launcher-label">${LAUNCHER_LABEL}</span>
  `;

  const panel = document.createElement('div');
  panel.className = 'hva-panel';
  panel.innerHTML = `
    <div class="hva-header">
      <div class="hva-avatar">A</div>
      <div class="hva-header-text">
        <div class="hva-header-title">Ask HireView</div>
        <div class="hva-header-sub"><span class="hva-dot"></span>Usually replies in seconds</div>
      </div>
    </div>
    <div class="hva-messages" id="hva-messages"></div>
    <div class="hva-suggestions" id="hva-suggestions">
      <div class="hva-chip" data-q="How much does HireView cost?">Pricing?</div>
      <div class="hva-chip" data-q="How does the AI interviewer work?">How does it work?</div>
      <div class="hva-chip" data-q="Does it support UPSC or SSC interviews?">Govt exam support?</div>
    </div>
    <div class="hva-input-row">
      <textarea class="hva-input" id="hva-input" rows="1" placeholder="Type your question..." maxlength="1000"></textarea>
      <button class="hva-send" id="hva-send" aria-label="Send">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4 20-7z"/></svg>
      </button>
    </div>
  `;

  document.body.appendChild(panel);
  if (isPaired) {
    // Dashboard, with translate present: pair the launcher with the
    // translate button as one visual group, right where translate.js
    // mounted it (translate is fixed top-right on dashboard, since it
    // has no plain top navbar).
    const group = document.createElement('div');
    const translateWasFixed = translateBtn.classList.contains('hv-top-fixed');
    group.className = 'hva-launcher-group' + (translateWasFixed ? ' hva-launcher-group--fixed' : '');
    translateBtn.parentElement.insertBefore(group, translateBtn);
    if (translateWasFixed) {
      // The translate button's own position:fixed (from .hv-top-fixed)
      // would otherwise still anchor it to its own fixed coordinate,
      // fighting the group's layout and leaving it stuck in its old
      // spot instead of sitting next to the launcher. Cancel just the
      // positioning (keep its padding/font-size from that class) now
      // that the *group* carries the fixed placement instead.
      translateBtn.style.position = 'static';
      translateBtn.style.top = 'auto';
      translateBtn.style.right = 'auto';
    }
    group.appendChild(bubble);
    group.appendChild(translateBtn);
    // The slot next to the avatar is now unused — collapse it instead
    // of leaving a stray empty gap in that flex row.
    if (dockSlot) dockSlot.style.display = 'none';
  } else if (isDocked) {
    // Dashboard fallback (translate button missing for some reason):
    // dock inline next to the profile avatar, as before.
    dockSlot.appendChild(bubble);
  } else {
    document.body.appendChild(bubble);
  }

  // ---------- position the chat panel ----------
  // - Paired: panel opens BELOW the launcher (which sits up near the
  //   translate button), so the launcher's own "×" close icon stays
  //   visible above the open panel instead of being covered by it.
  // - Docked / floating fallback: unchanged — panel opens upward,
  //   clearing the fixed site footer (js/footer.js) if present.
  // Re-checked on load/resize and whenever the footer's size changes
  // (it wraps to multiple lines at some widths).
  function positionPanel() {
    if (isPaired) {
      const rect = bubble.getBoundingClientRect();
      const gap = 12;
      panel.style.top = (rect.bottom + gap) + 'px';
      panel.style.right = Math.max(window.innerWidth - rect.right, 16) + 'px';
      panel.style.bottom = 'auto';
      return;
    }

    const footer = document.getElementById('hvFooter');
    let clearance = 24; // default gap from viewport bottom
    if (footer && window.getComputedStyle(footer).position === 'fixed') {
      clearance = footer.offsetHeight + 16;
    }
    if (!isDocked) {
      bubble.style.bottom = clearance + 'px';
    }
    panel.style.top = 'auto';
    panel.style.bottom = (clearance + 74) + 'px';
  }

  positionPanel();
  window.addEventListener('load', positionPanel);
  window.addEventListener('resize', positionPanel);
  const footerEl = document.getElementById('hvFooter');
  if (footerEl && typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(positionPanel).observe(footerEl);
  }
  if (isPaired && typeof ResizeObserver !== 'undefined') {
    // Also re-measure if the launcher/nav itself changes size (e.g.
    // mobile nav wrapping, or the translate label swapping languages).
    new ResizeObserver(positionPanel).observe(bubble.parentElement);
  }

  const messagesEl = panel.querySelector('#hva-messages');
  const suggestionsEl = panel.querySelector('#hva-suggestions');
  const inputEl = panel.querySelector('#hva-input');
  const sendBtn = panel.querySelector('#hva-send');

  let isOpen = false;
  let isSending = false;

  function renderMessage(role, text) {
    const div = document.createElement('div');
    div.className = 'hva-msg ' + role;
    div.textContent = text;
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return div;
  }

  function renderHistory() {
    messagesEl.innerHTML = '';
    if (history.length === 0) {
      renderMessage('assistant', "Hi! I'm HireView's assistant. Ask me anything about mock interviews, pricing, or how Arjun works.");
    } else {
      history.forEach(m => renderMessage(m.role === 'user' ? 'user' : 'assistant', m.content));
    }
  }

  function showTyping() {
    const div = document.createElement('div');
    div.className = 'hva-typing';
    div.id = 'hva-typing-indicator';
    div.innerHTML = '<span></span><span></span><span></span>';
    messagesEl.appendChild(div);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function hideTyping() {
    const el = document.getElementById('hva-typing-indicator');
    if (el) el.remove();
  }

  async function sendMessage(text) {
    if (!text.trim() || isSending) return;
    isSending = true;
    sendBtn.disabled = true;
    suggestionsEl.style.display = 'none';

    renderMessage('user', text);
    history.push({ role: 'user', content: text });
    showTyping();

    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history.slice(-12) })
      });

      hideTyping();

      if (!res.ok) {
        if (res.status === 429) {
          renderMessage('error', "You've sent a lot of messages — please wait a bit before trying again.");
        } else {
          renderMessage('error', "Something went wrong on our end. Please try again, or email hireviewadmin@gmail.com.");
        }
        isSending = false;
        sendBtn.disabled = false;
        return;
      }

      const data = await res.json();
      const reply = data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : "Sorry, I didn't quite catch that — could you rephrase?";

      renderMessage('assistant', reply);
      history.push({ role: 'assistant', content: reply });
    } catch (err) {
      hideTyping();
      renderMessage('error', "Couldn't reach the assistant — check your connection and try again.");
    } finally {
      isSending = false;
      sendBtn.disabled = false;
    }
  }

  function autoGrow() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 90) + 'px';
  }

  inputEl.addEventListener('input', autoGrow);
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const text = inputEl.value;
      inputEl.value = '';
      autoGrow();
      sendMessage(text);
    }
  });

  sendBtn.addEventListener('click', () => {
    const text = inputEl.value;
    inputEl.value = '';
    autoGrow();
    sendMessage(text);
  });

  suggestionsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.hva-chip');
    if (chip) sendMessage(chip.dataset.q);
  });



  bubble.addEventListener('click', () => {
    isOpen = !isOpen;
    bubble.classList.toggle('open', isOpen);
    panel.classList.toggle('open', isOpen);
    if (isOpen) {
      positionPanel();
      renderHistory();
      setTimeout(() => inputEl.focus(), 200);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && isOpen) bubble.click();
  });
})();