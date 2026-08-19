/* ════════════════════════════════════════════════
   HireView — Shared app sidebar
   Same componentization pattern as footer.js / legal-nav.js: injects
   markup, one file, every app page references it. Add
   <script src="/js/sidebar.js" data-active="dashboard"></script>
   right after <body> opens (before .app-container) — data-active tells
   it which nav item to highlight on that page.

   NOT used on interview.html — that page is intentionally full-screen/
   distraction-free during an active interview, matching the rest of
   the app's UX for that flow.

   Items marked comingSoon: true are features whose backend/UI aren't
   built yet (tracked in the HireView rebuild roadmap). They render
   visibly, greyed out, with a "Soon" badge, and clicking one shows a
   toast instead of a broken/dead link — never silently do nothing and
   never link to a page that doesn't exist.
   ════════════════════════════════════════════════ */
   (function () {
    var NAV_ITEMS = [
      { key: 'dashboard',   label: 'Dashboard',      icon: '\u25A4', href: '/dashboard' },
      { key: 'start',       label: 'Start Interview',icon: '\u25B6', action: 'startInterview' },
      { key: 'reports',     label: 'My Reports',     icon: '\u{1F4C4}', href: '/history' },
      { key: 'questionbank',label: 'Question Bank',  icon: '\u{1F5C3}\uFE0F', href: '/questionbank' },
      { key: 'analytics',   label: 'Analytics',      icon: '\u{1F4CA}', comingSoon: true },
      { key: 'aptitude',    label: 'Aptitude Test',  icon: '\u{1F9EE}', comingSoon: true },
      { key: 'coding',      label: 'Coding Round',   icon: '\u{1F4BB}', comingSoon: true },
      { key: 'leaderboard', label: 'Leaderboard',    icon: '\u{1F3C6}', comingSoon: true },
    ];
  
    var scriptTag = document.currentScript;
    var activeKey = scriptTag.getAttribute('data-active') || '';
  
    function showComingSoonToast(label) {
      var existing = document.getElementById('sidebarToast');
      if (existing) existing.remove();
  
      var toast = document.createElement('div');
      toast.id = 'sidebarToast';
      toast.className = 'sidebar-toast';
      toast.textContent = label + ' is coming soon.';
      document.body.appendChild(toast);
  
      requestAnimationFrame(function () { toast.classList.add('show'); });
      setTimeout(function () {
        toast.classList.remove('show');
        setTimeout(function () { toast.remove(); }, 250);
      }, 2200);
    }
  
    function handleNavClick(item, evt) {
      if (item.comingSoon) {
        evt.preventDefault();
        showComingSoonToast(item.label);
        return;
      }
      if (item.action === 'startInterview') {
        evt.preventDefault();
        if (typeof window.handleNewInterviewClick === 'function') {
          window.handleNewInterviewClick();
        } else {
          window.location.href = '/dashboard';
        }
      }
    }
  
    var aside = document.createElement('aside');
    aside.className = 'app-sidebar';
  
    var brand = document.createElement('div');
    brand.className = 'app-sidebar-brand';
    brand.innerHTML = '<a href="/" class="app-sidebar-logo">HireView</a>';
    aside.appendChild(brand);
  
    var nav = document.createElement('nav');
    nav.className = 'app-sidebar-nav';
  
    NAV_ITEMS.forEach(function (item) {
      var el = document.createElement('a');
      el.href = item.href || '#';
      el.className = 'app-sidebar-link' +
        (item.key === activeKey ? ' active' : '') +
        (item.comingSoon ? ' coming-soon' : '');
      el.innerHTML =
        '<span class="app-sidebar-icon">' + item.icon + '</span>' +
        '<span class="app-sidebar-text">' + item.label + '</span>' +
        (item.comingSoon ? '<span class="app-sidebar-badge">Soon</span>' : '');
      el.addEventListener('click', function (evt) { handleNavClick(item, evt); });
      nav.appendChild(el);
    });
  
    aside.appendChild(nav);
  
    scriptTag.insertAdjacentElement('afterend', aside);
    document.body.classList.add('has-app-sidebar');
  })();