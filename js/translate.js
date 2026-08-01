/**
 * HireView — Website Translate Button (English <-> Hindi)
 * -----------------------------------------------------------------------
 * Self-contained: include this ONE file on any page:
 *     <script src="js/translate.js"></script>
 * It injects its own button, styles, and Google Translate engine.
 * No other markup changes are required on any page.
 *
 * How it works:
 * - Uses Google's official website-translation engine (translate_a/element.js)
 *   so every bit of text on the page — including content added dynamically
 *   by other scripts — gets translated accurately, instead of relying on a
 *   hand-written dictionary that would need constant upkeep and would be
 *   error-prone across 9+ pages.
 * - The default ugly Google banner/toolbar is hidden; we drive translation
 *   ourselves through a small floating "EN | हिं" pill button.
 * - Selected language is remembered (localStorage) so it stays consistent
 *   as the user moves between pages.
 */
(function () {
    "use strict";
  
    var STORAGE_KEY = "hv_lang"; // 'en' or 'hi'
    var COOKIE_NAME = "googtrans";
  
    function getSavedLang() {
      try {
        return localStorage.getItem(STORAGE_KEY) || "en";
      } catch (e) {
        return "en";
      }
    }
  
    function saveLang(lang) {
      try {
        localStorage.setItem(STORAGE_KEY, lang);
      } catch (e) {
        /* ignore — private browsing etc. */
      }
    }
  
    function setGoogTransCookie(lang) {
      var host = window.location.hostname;
      var value = lang === "hi" ? "/en/hi" : "/en/en";
      // Clear first (helps Google Translate pick up the change cleanly)
      document.cookie = COOKIE_NAME + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/";
      document.cookie = COOKIE_NAME + "=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=." + host;
      document.cookie = COOKIE_NAME + "=" + value + "; path=/";
      if (host && host.indexOf("localhost") === -1) {
        document.cookie = COOKIE_NAME + "=" + value + "; path=/; domain=." + host;
      }
    }
  
    function injectStyles() {
      var style = document.createElement("style");
      style.textContent = [
        // Hide Google's default UI completely — we use our own button.
        ".goog-te-banner-frame, .skiptranslate, #goog-gt-tt, .goog-te-balloon-frame { display: none !important; visibility: hidden !important; }",
        "body { top: 0 !important; position: static !important; }",
        ".goog-tooltip, .goog-tooltip:hover { display: none !important; }",
        ".goog-text-highlight { background: none !important; box-shadow: none !important; }",
        "#google_translate_element { display: none !important; }",
  
        // Base button look (shared by both placements)
        "#hv-translate-btn { display: flex; align-items: center; gap: 6px; border-radius: 999px; border: none; cursor: pointer; font-family: inherit; font-weight: 700; letter-spacing: 0.02em; color: #fff; background: linear-gradient(135deg, #818cf8, #ec4899); box-shadow: 0 4px 14px rgba(99,102,241,0.3); transition: transform 0.15s ease, box-shadow 0.15s ease; }",
        "#hv-translate-btn:hover { transform: translateY(-1px); box-shadow: 0 8px 20px rgba(99,102,241,0.4); }",
        "#hv-translate-btn:active { transform: translateY(0); }",
        "#hv-translate-btn svg { width: 14px; height: 14px; flex-shrink: 0; }",
        "#hv-translate-btn.hv-loading { opacity: 0.7; cursor: wait; pointer-events: none; }",
  
        // Placement A: mounted directly inside the site's own top navbar
        // (.nav-links / <nav>) so it sits with the other menu items —
        // this is what most production websites do.
        "#hv-translate-btn.hv-inline { position: static; padding: 0.5rem 1rem; font-size: 0.82rem; }",
  
        // Placement B: fallback for pages with no top navbar (dashboard,
        // auth, history) — pinned top-right corner instead of the bottom.
        "#hv-translate-btn.hv-top-fixed { position: fixed; top: 18px; right: 20px; z-index: 99999; padding: 9px 15px; font-size: 12.5px; }",
        "@media (max-width: 640px) { #hv-translate-btn.hv-top-fixed { top: 12px; right: 12px; padding: 8px 12px; font-size: 11.5px; } #hv-translate-btn.hv-inline { padding: 0.45rem 0.85rem; font-size: 0.78rem; } }"
      ].join("\n");
      document.head.appendChild(style);
    }
  
    function protectBrandFromTranslation() {
      // Keep the HireView brand name / logo text untouched by translation.
      var selectors = [".hv-logo-text", ".nav-logo", "[data-notranslate]"];
      selectors.forEach(function (sel) {
        document.querySelectorAll(sel).forEach(function (el) {
          el.classList.add("notranslate");
        });
      });
    }
  
    function createButton(currentLang) {
      var btn = document.createElement("button");
      btn.id = "hv-translate-btn";
      btn.type = "button";
      btn.setAttribute("aria-label", "Translate website language");
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>' +
        '<span id="hv-translate-label">' + (currentLang === "hi" ? "हिं / EN" : "EN / हिं") + "</span>";
  
      btn.addEventListener("click", function () {
        var next = getSavedLang() === "hi" ? "en" : "hi";
        btn.classList.add("hv-loading");
        saveLang(next);
        setGoogTransCookie(next);
        window.location.reload();
      });
  
      mountButton(btn);
    }
  
    function isVisible(el) {
      if (!el) return false;
      var node = el;
      while (node && node.nodeType === 1) {
        var style = window.getComputedStyle(node);
        if (style.display === "none" || style.visibility === "hidden" || parseFloat(style.opacity) === 0) {
          return false;
        }
        node = node.parentElement;
      }
      return true;
    }
  
    function mountButton(btn) {
      // Prefer sitting inside the page's own top navbar, like a normal
      // menu item / language switcher — this is where it visually belongs.
      // Explicitly skip any nav that isn't the real, visible top navbar
      // (e.g. dashboard.html has a hidden "sidebar-nav" inside a closed
      // account-settings panel — mounting there would make the button
      // invisible until that panel is opened).
      var navLinks = document.querySelector(".nav-links");
      var nav = document.querySelector("nav:not(.sidebar-nav)");
  
      if (navLinks && isVisible(navLinks)) {
        btn.classList.add("hv-inline");
        navLinks.appendChild(btn);
      } else if (nav && isVisible(nav)) {
        btn.classList.add("hv-inline");
        nav.appendChild(btn);
      } else {
        // Pages with no usable top navbar (dashboard, auth, history) —
        // pin it to the top-right corner instead of the page bottom.
        btn.classList.add("hv-top-fixed");
        document.body.appendChild(btn);
      }
    }
  
    function loadGoogleTranslateScript() {
      if (document.getElementById("hv-google-translate-script")) return;
      window.googleTranslateElementInit = function () {
        /* eslint-disable no-new */
        new google.translate.TranslateElement(
          {
            pageLanguage: "en",
            includedLanguages: "en,hi",
            autoDisplay: false
          },
          "google_translate_element"
        );
      };
      var hiddenHost = document.createElement("div");
      hiddenHost.id = "google_translate_element";
      document.body.appendChild(hiddenHost);
  
      var script = document.createElement("script");
      script.id = "hv-google-translate-script";
      script.src = "https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit";
      script.async = true;
      document.body.appendChild(script);
    }
  
    function init() {
      injectStyles();
      protectBrandFromTranslation();
  
      var savedLang = getSavedLang();
      // Make sure the cookie always matches what the user last picked —
      // this is what actually drives Google's translation on page load.
      setGoogTransCookie(savedLang);
  
      createButton(savedLang);
      loadGoogleTranslateScript();
    }
  
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", init);
    } else {
      init();
    }
  })();