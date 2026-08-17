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
      '<a href="/" class="back">\u2190 Back to home</a>';
    document.currentScript.insertAdjacentElement('beforebegin', nav);
  })();