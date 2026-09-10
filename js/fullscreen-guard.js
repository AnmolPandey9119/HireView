/* ════════════════════════════════════════════════
   HireView — Fullscreen Integrity Guard
   ════════════════════════════════════════════════
   Shared secure-testing module used by the Coding Round, the
   Aptitude Test, and the live Interview session. It:

     1. Forces the page into fullscreen when a session starts.
     2. Treats leaving fullscreen (via Esc, F11, swipe, etc.) as a
        two-strike integrity violation:
          Strike 1 -> warning overlay + a "Resume Fullscreen" button
          Strike 2 -> FullscreenGuard.stop()s itself and calls
                      opts.onTerminate('fullscreen_exit') so the
                      calling page can flag the session as cheated.
     3. Optionally also tracks tab switches (visibilitychange) and
        window blur, with the same two-strike-then-terminate model —
        used by Coding/Aptitude, which had no such detection before.
        The Interview page already has its own tab/window detection
        (js/cheating.js) tied to Arjun's voice and messaging, so it
        passes maxTabSwitches/maxWindowBlur as Infinity and only uses
        this module for the fullscreen lock + Esc handling.

   Builds its own overlay DOM on first use — no HTML changes needed
   on any page that includes this script. Just:

     FullscreenGuard.start({
       maxTabSwitches: 2,      // Infinity to let another module handle it
       maxWindowBlur: 2,       // Infinity to let another module handle it
       onWarn: (reason, count) => { ... },       // 'tab_switch' | 'window_blur' | 'fullscreen_exit'
       onTerminate: (reason) => { ... },
     });

     FullscreenGuard.stop(); // call when the session ends normally

   Gracefully degrades on devices/browsers where the Fullscreen API
   isn't available (e.g. some mobile Safari versions) — tab/window
   detection still works, the session just isn't visually locked.
   ════════════════════════════════════════════════ */

   window.FullscreenGuard = (function () {
    let active = false;
    let opts = {};
    let fsExitCount = 0;
    let tabSwitchCount = 0;
    let windowBlurCount = 0;
    let blurArmed = false;
    let overlayEl = null;
    let badgeEl = null;
  
    function fullscreenSupported() {
      const el = document.documentElement;
      const has = !!(el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen);
      const enabled = document.fullscreenEnabled !== false && document.webkitFullscreenEnabled !== false;
      return has && enabled;
    }
  
    function isFullscreen() {
      return !!(document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement);
    }
  
    function requestFullscreen() {
      if (!fullscreenSupported()) return Promise.resolve(false);
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      try {
        const p = req.call(el);
        return p && p.then ? p.then(() => true).catch(() => false) : Promise.resolve(true);
      } catch (e) {
        return Promise.resolve(false);
      }
    }
  
    function exitFullscreen() {
      if (!isFullscreen()) return Promise.resolve();
      const ex = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      try {
        const p = ex && ex.call(document);
        return p && p.catch ? p.catch(() => {}) : Promise.resolve();
      } catch (e) {
        return Promise.resolve();
      }
    }
  
    // ────────────────────────────────────────────
    // Overlay UI (warning + resume, and initial "enable fullscreen" prompt)
    // ────────────────────────────────────────────
    function ensureOverlay() {
      if (overlayEl) return overlayEl;
  
      const style = document.createElement('style');
      style.id = 'fsGuardStyle';
      style.textContent = `
        #fsGuardOverlay { position:fixed; inset:0; z-index:99999; display:none;
          align-items:center; justify-content:center; padding:1.5rem;
          background:rgba(5,7,20,0.84); backdrop-filter:blur(10px); -webkit-backdrop-filter:blur(10px); }
        #fsGuardOverlay.show { display:flex; }
        #fsGuardCard { max-width:420px; width:100%; text-align:center; padding:2rem 1.75rem;
          border-radius:var(--hv-radius-xl,20px);
          background:linear-gradient(160deg, var(--hv-modal-grad-start,#171b3a), var(--hv-modal-grad-end,#120f2c));
          border:1px solid rgba(239,68,68,0.35);
          box-shadow:0 20px 60px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.03);
          animation: fsGuardPop .28s cubic-bezier(0.16,1,0.3,1) both; }
        @keyframes fsGuardPop { from{opacity:0; transform:scale(.94) translateY(8px);} to{opacity:1; transform:none;} }
        #fsGuardCard .fsg-icon { font-size:2.4rem; margin-bottom:.6rem; }
        #fsGuardCard h3 { margin:0 0 .5rem; font-size:1.15rem; color:#fff; font-weight:800; }
        #fsGuardCard p { margin:0 0 1.3rem; font-size:.92rem; line-height:1.5; color:rgba(255,255,255,0.72); }
        #fsGuardCard button { border:none; cursor:pointer; font-weight:700; font-size:.95rem;
          padding:.85rem 1.4rem; border-radius:var(--hv-radius-md,12px); width:100%;
          background:linear-gradient(135deg, var(--hv-primary,#6366f1), var(--hv-secondary,#8b5cf6));
          color:#fff; box-shadow:var(--hv-shadow-glow, 0 8px 30px rgba(99,102,241,.35));
          transition:transform 150ms ease; }
        #fsGuardCard button:active { transform:scale(0.97); }
        #fsGuardCard .fsg-strike { display:block; margin-top:1rem; font-size:.76rem;
          letter-spacing:.04em; color:var(--hv-warning,#f59e0b); font-weight:700; text-transform:uppercase; min-height:1em; }
        #fsGuardBadge { position:fixed; top:14px; left:14px; z-index:99998;
          display:flex; align-items:center; gap:.4rem; font-size:.72rem; font-weight:700;
          color:rgba(255,255,255,0.85); background:rgba(255,255,255,0.06);
          border:1px solid rgba(99,102,241,0.3); padding:.4rem .7rem; border-radius:999px;
          backdrop-filter:blur(8px); pointer-events:none; opacity:0; transition:opacity 300ms ease; }
        #fsGuardBadge.show { opacity:1; }
      `;
      document.head.appendChild(style);
  
      overlayEl = document.createElement('div');
      overlayEl.id = 'fsGuardOverlay';
      overlayEl.innerHTML = `
        <div id="fsGuardCard">
          <div class="fsg-icon">🔒</div>
          <h3 id="fsGuardTitle">Fullscreen Required</h3>
          <p id="fsGuardMsg">This session runs in fullscreen mode to keep things fair. Tap below to continue.</p>
          <button id="fsGuardResumeBtn" type="button">Enter Fullscreen</button>
          <span class="fsg-strike" id="fsGuardStrike"></span>
        </div>
      `;
      document.body.appendChild(overlayEl);
  
      document.getElementById('fsGuardResumeBtn').addEventListener('click', async () => {
        const ok = await requestFullscreen();
        if (ok) hideOverlay();
      });
  
      badgeEl = document.createElement('div');
      badgeEl.id = 'fsGuardBadge';
      badgeEl.innerHTML = '🔒 Secure Fullscreen Mode';
      document.body.appendChild(badgeEl);
  
      return overlayEl;
    }
  
    function showOverlay(title, msg, strikeText, btnLabel) {
      ensureOverlay();
      document.getElementById('fsGuardTitle').textContent = title;
      document.getElementById('fsGuardMsg').textContent = msg;
      document.getElementById('fsGuardStrike').textContent = strikeText || '';
      document.getElementById('fsGuardResumeBtn').textContent = btnLabel || 'Resume Fullscreen';
      overlayEl.classList.add('show');
    }
  
    function hideOverlay() {
      if (overlayEl) overlayEl.classList.remove('show');
    }
  
    function showBadge() { ensureOverlay(); badgeEl.classList.add('show'); }
    function hideBadge() { if (badgeEl) badgeEl.classList.remove('show'); }
  
    // ────────────────────────────────────────────
    // Event handlers
    // ────────────────────────────────────────────
    function onFsChange() {
      if (!active) return;
      if (!isFullscreen()) {
        fsExitCount++;
        if (fsExitCount === 1) {
          opts.onWarn && opts.onWarn('fullscreen_exit', fsExitCount);
          showOverlay(
            '⚠️ You left fullscreen',
            'Fullscreen is required for this session. Exiting one more time will end it and flag it as an integrity violation.',
            'Strike 1 of 2',
            'Resume Fullscreen'
          );
        } else {
          terminate('fullscreen_exit');
        }
      } else {
        hideOverlay();
      }
    }
  
    function onVisibilityChange() {
      if (!active || !document.hidden) return;
      tabSwitchCount++;
      const max = opts.maxTabSwitches ?? 2;
      opts.onWarn && opts.onWarn('tab_switch', tabSwitchCount);
      if (tabSwitchCount > max) terminate('tab_switch');
    }
  
    function onWindowBlur() {
      if (!active || !blurArmed) return;
      if (document.activeElement && document.activeElement.id === 'fsGuardResumeBtn') return;
      windowBlurCount++;
      const max = opts.maxWindowBlur ?? 2;
      opts.onWarn && opts.onWarn('window_blur', windowBlurCount);
      if (windowBlurCount > max) terminate('window_blur');
    }
  
    function addListeners() {
      document.addEventListener('fullscreenchange', onFsChange);
      document.addEventListener('webkitfullscreenchange', onFsChange);
      document.addEventListener('visibilitychange', onVisibilityChange);
      window.addEventListener('blur', onWindowBlur);
    }
  
    function removeListeners() {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('blur', onWindowBlur);
    }
  
    function terminate(reason) {
      if (!active) return;
      active = false;
      hideOverlay();
      hideBadge();
      removeListeners();
      exitFullscreen();
      opts.onTerminate && opts.onTerminate(reason);
    }
  
    // ────────────────────────────────────────────
    // Public API
    // ────────────────────────────────────────────
    function start(options) {
      removeListeners(); // idempotent restart, in case start() is called again without stop()
      opts = options || {};
      active = true;
      fsExitCount = 0;
      tabSwitchCount = 0;
      windowBlurCount = 0;
      blurArmed = false;
      // Ignore the initial focus dance while permission prompts / the
      // resume button's own click settle, so we don't immediately
      // count a false window-blur.
      setTimeout(() => { blurArmed = true; }, 15000);
      addListeners();
  
      requestFullscreen().then((ok) => {
        if (!ok && fullscreenSupported()) {
          // Most likely lost the user-gesture window after an await —
          // ask for one more explicit tap, which is a fresh gesture.
          showOverlay(
            '🔒 Enable Fullscreen',
            'This session runs in fullscreen mode to keep things fair. Tap below to continue.',
            '',
            'Enter Fullscreen'
          );
        } else if (ok) {
          showBadge();
          setTimeout(hideBadge, 2500);
        }
        // If fullscreenSupported() is false, the device/browser simply
        // doesn't support it — tab/window detection above still runs,
        // we just don't block the session on an unsupported API.
      });
    }
  
    function stop() {
      active = false;
      hideOverlay();
      hideBadge();
      removeListeners();
      exitFullscreen();
    }
  
    return { start, stop, isFullscreen, requestFullscreen };
  })();