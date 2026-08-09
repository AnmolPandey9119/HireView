/* ════════════════════════════════════════════════
   HireView — Shared Fixed Footer
   Injects one consistent footer bar, pinned to the
   bottom of the viewport on every page that loads
   this file. Do NOT include this script on
   interview.html (interview + feedback screens stay
   footer-free by design).
   ════════════════════════════════════════════════ */
   (function () {
    if (document.getElementById('hvFooter')) return; // already injected
  
    // ── Styles ──
    if (!document.getElementById('hv-footer-style')) {
      var style = document.createElement('style');
      style.id = 'hv-footer-style';
      style.textContent = [
        '#hvFooter{position:fixed;left:0;right:0;bottom:0;z-index:500;',
        'display:flex;align-items:center;justify-content:space-between;gap:0.75rem 1.5rem;',
        'flex-wrap:wrap;padding:0.8rem 1.5rem;',
        'background:rgba(10,14,39,0.92);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);',
        'border-top:1px solid rgba(255,255,255,0.08);',
        'color:rgba(255,255,255,0.6);font-size:0.82rem;',
        "font-family:'Plus Jakarta Sans',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;}",
  
        '#hvFooter a{color:rgba(255,255,255,0.6);text-decoration:none;white-space:nowrap;}',
        '#hvFooter a:hover{color:#fff;}',
  
        '#hvFooter .hv-footer-brand{display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;white-space:nowrap;}',
        '#hvFooter #visitorCount:not(:empty){margin-left:0.75rem;}',
  
        '#hvFooter .hv-footer-links{display:flex;align-items:center;gap:1.1rem;overflow-x:auto;',
        'scrollbar-width:none;-ms-overflow-style:none;max-width:100%;}',
        '#hvFooter .hv-footer-links::-webkit-scrollbar{display:none;}',
  
        '@media (max-width:768px){',
        // On mobile a permanently fixed bar eats screen real estate and
        // overlaps whatever content scrolls under it (buttons, FAQ text,
        // etc). Drop it back into normal document flow so it only shows
        // at the true end of the page, like a regular footer.
        '#hvFooter{position:static;font-size:0.72rem;padding:0.65rem 1rem;gap:0.5rem 0.9rem;',
        'flex-direction:column;align-items:flex-start;}',
        '#hvFooter .hv-footer-links{gap:0.7rem 0.9rem;overflow-x:visible;flex-wrap:wrap;white-space:normal;}',
        '}'
      ].join('');
      document.head.appendChild(style);
    }
  
    // ── Markup ──
    var footer = document.createElement('footer');
    footer.id = 'hvFooter';
    footer.innerHTML =
      '<div class="hv-footer-brand">' +
        '<span style="font-weight:700;color:rgba(255,255,255,0.75)">HireView</span>' +
        '<span>&middot; Built by <a href="https://linkedin.com/in/anmol-pandey-240105376" target="_blank" rel="noopener">Anmol Pandey</a></span>' +
        '<span id="visitorCount"></span>' +
      '</div>' +
      '<div class="hv-footer-links">' +
        '<a href="/auth" id="hvFooterLogin">Login</a>' +
        '<a href="/blog">Blog</a>' +
        '<a href="/faq">FAQ</a>' +
        '<a href="/privacy">Privacy Policy</a>' +
        '<a href="/terms">Terms</a>' +
        '<a href="/refund-policy">Refund Policy</a>' +
        '<a href="mailto:hireviewadmin@gmail.com">Contact</a>' +
        '<a href="https://github.com/AnmolPandey9119/HireView" target="_blank" rel="noopener">GitHub</a>' +
      '</div>';
    document.body.appendChild(footer);
  
    // If the user is already logged in, "Login" makes more sense as "Dashboard"
    try {
      var token = localStorage.getItem('hv_token');
      var loginLink = document.getElementById('hvFooterLogin');
      if (token && loginLink) {
        loginLink.textContent = 'Dashboard';
        loginLink.setAttribute('href', '/dashboard');
      }
    } catch (e) { /* localStorage unavailable — ignore */ }
  
    // Visitor count (span stays empty here — it's only populated by the
    // home page's own tracking script, see index.html). Kept in the markup
    // so the layout is identical everywhere, it just shows nothing on
    // pages other than home.
  
    // ── Keep page content from hiding behind the fixed bar ──
    // Only needed when the footer is actually position:fixed (desktop) —
    // on mobile it's static now (see the max-width:768px rule above), so
    // it already takes its own space and no extra padding is needed.
    function reserveFooterSpace() {
      var isFixed = window.getComputedStyle(footer).position === 'fixed';
      document.body.style.paddingBottom = isFixed ? (footer.offsetHeight || 0) + 'px' : '';
    }
    reserveFooterSpace();
    window.addEventListener('resize', reserveFooterSpace);
    window.addEventListener('load', reserveFooterSpace);
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(reserveFooterSpace).observe(footer);
    }
  })();