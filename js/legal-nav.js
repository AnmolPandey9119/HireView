/* ════════════════════════════════════════════════
   HireView — Shared "Back to home" nav
   Injects the simple two-link nav (logo + back-to-home) used by every
   legal/support page (contact, faq, privacy, terms, refund-policy).
   Same componentization pattern as footer.js. Do NOT use this on
   index.html (marketing nav) or dashboard.html (app sidebar nav) —
   those are genuinely different navs, not duplicates of this one.
   Usage: put <script src="/js/legal-nav.js"></script> exactly where
   the old <nav>...</nav> block used to sit.
   ════════════════════════════════════════════════ */
   (function () {
    var nav = document.createElement('nav');
    nav.innerHTML =
      '<a href="/" class="logo-text">HireView</a>' +
      '<div style="display:flex;align-items:center;">' +
      '<a href="/" class="back">\u2190 Back to home</a>' +
      '<button type="button" class="nav-theme-toggle" id="legalThemeToggle" aria-label="Toggle light mode" title="Toggle light mode">\u{1F319}</button>' +
      '</div>';
    document.currentScript.insertAdjacentElement('beforebegin', nav);

    var btn = nav.querySelector('#legalThemeToggle');
    var setIcon = function () {
      btn.textContent = document.documentElement.getAttribute('data-theme') === 'dark' ? '\u2600\uFE0F' : '\u{1F319}';
    };
    setIcon();
    btn.addEventListener('click', function () {
      var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      if (isDark) {
        document.documentElement.removeAttribute('data-theme');
        try { localStorage.setItem('hv-theme', 'light'); } catch (e) {}
      } else {
        document.documentElement.setAttribute('data-theme', 'dark');
        try { localStorage.setItem('hv-theme', 'dark'); } catch (e) {}
      }
      setIcon();
    });
  })();