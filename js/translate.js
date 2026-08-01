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
        // Our floating toggle button
        "#hv-translate-btn { position: fixed; bottom: 22px; right: 22px; z-index: 99999; display: flex; align-items: center; gap: 6px; padding: 10px 16px; border-radius: 999px; border: none; cursor: pointer; font-family: inherit; font-size: 13px; font-weight: 700; letter-spacing: 0.02em; color: #fff; background: linear-gradient(135deg, #818cf8, #ec4899); box-shadow: 0 6px 20px rgba(99,102,241,0.35); transition: transform 0.15s ease, box-shadow 0.15s ease; }",
        "#hv-translate-btn:hover { transform: translateY(-2px); box-shadow: 0 10px 26px rgba(99,102,241,0.45); }",
        "#hv-translate-btn:active { transform: translateY(0); }",
        "#hv-translate-btn svg { width: 16px; height: 16px; flex-shrink: 0; }",
        "#hv-translate-btn.hv-loading { opacity: 0.7; cursor: wait; pointer-events: none; }",
        "@media (max-width: 640px) { #hv-translate-btn { bottom: 16px; right: 16px; padding: 9px 14px; font-size: 12px; } }"
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
  
      document.body.appendChild(btn);
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