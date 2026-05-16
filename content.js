// ============================================================
// Klaviyo CSS Inspector — Content Script
// Enhanced with Klaviyo internal troubleshooting knowledge
// ============================================================

(function () {
  "use strict";

  // Guard: prevent double-registration when the script is injected both
  // statically (manifest content_scripts) and dynamically (executeScript).
  // Without this, two separate _fixReg Maps exist and Restore loses the race.
  if (window.__klv_inspector_loaded) return;
  window.__klv_inspector_loaded = true;

  // ── 1. SCRIPT HEALTH CHECK ────────────────────────────────
  // Source: internal KB — "Pre-Requisite" + "Form not showing" sections

  function checkScriptHealth() {
    const allScripts = Array.from(document.scripts);

    // Detect ALL Klaviyo-related scripts (used for type/head checks below)
    const klaviyoScripts = allScripts.filter(s =>
      s.src && (
        s.src.includes("klaviyo.com") ||
        s.src.includes("klaviyo.js") ||
        s.src.includes("a.klaviyo.com")
      )
    );

    // Only the MAIN loader scripts (contain company_id=) matter for
    // "installed / not installed / duplicated" checks.
    // Klaviyo loads many CDN chunk files (runtime.js, vendors.js, etc.)
    // that are normal and should NOT count as extra loader instances.
    const loaderScripts = klaviyoScripts.filter(s =>
      s.src.includes("company_id=") ||
      /static\.klaviyo\.com\/onsite\/js\/[A-Za-z0-9]+\/klaviyo\.js/.test(s.src)
    );

    const issues = [];

    // ── Not installed ──
    if (klaviyoScripts.length === 0) {
      issues.push({
        severity: "critical",
        code: "SCRIPT_MISSING",
        title: "Klaviyo.js not found",
        detail: "No Klaviyo script tag was detected on this page. Forms, reviews, and the customer agent will not function without it.",
        fix: 'Add <script async type="text/javascript" src="//static.klaviyo.com/onsite/js/klaviyo.js?company_id=YOUR_API_KEY"></script> to the <head> of every page.',
      });
      return { scripts: [], issues };
    }

    // ── Multiple LOADER scripts ──
    if (loaderScripts.length > 1) {
      issues.push({
        severity: "warning",
        code: "MULTIPLE_SCRIPTS",
        title: `${loaderScripts.length} Klaviyo loader scripts found`,
        detail: `More than one Klaviyo.js loader (with company_id=) is loaded on this page. This can cause duplicate form loads and unexpected behaviour. Only one loader instance should be present. (Note: additional CDN chunk files are normal and expected.)`,
        fix: "Remove all but one Klaviyo.js script tag from the page.",
      });
    }

    // ── Wrong script type (MutationObserver interference) ──
    // Only check the main loader scripts for type issues
    klaviyoScripts.forEach(s => {
      const type = s.getAttribute("type") || "";
      if (type && type !== "text/javascript") {
        issues.push({
          severity: "critical",
          code: "WRONG_SCRIPT_TYPE",
          title: `Script type changed to "${type}"`,
          detail: `A custom MutationObserver on this site has changed the Klaviyo script type from "text/javascript" to "${type}". This prevents Klaviyo's JS files from loading and will stop all forms from appearing.`,
          fix: 'Find the MutationObserver in the site\'s JS that is modifying script types and remove "klaviyo" from its list of targets so the type stays as "text/javascript".',
        });
      }
    });

    // ── Script not in <head> (nested issue) — check only loader scripts ──
    loaderScripts.forEach(s => {
      if (!document.head.contains(s)) {
        issues.push({
          severity: "warning",
          code: "SCRIPT_NOT_IN_HEAD",
          title: "Klaviyo.js not in <head>",
          detail: "Klaviyo.js should be loaded in the <head> of the page. When loaded elsewhere (e.g. via iFrame, Google Tag Manager, or in the body), forms may not display correctly.",
          fix: "Move the Klaviyo.js script tag into the <head> section. If it is being injected via GTM or iFrame, remove it from that setup and add it directly to the page template.",
        });
      }
    });

    // ── Async missing — check only loader scripts ──
    loaderScripts.forEach(s => {
      if (!s.async && !s.defer) {
        issues.push({
          severity: "info",
          code: "SCRIPT_NOT_ASYNC",
          title: "Klaviyo.js loaded synchronously",
          detail: "Klaviyo.js is missing the async attribute. This can slow down page load and may cause forms to interfere with page rendering.",
          fix: 'Add the async attribute: <script async type="text/javascript" src="...">',
        });
      }
    });

    // Step 20: Ad blocker / script interception detection
    // If the script tag exists but window.klaviyo is undefined/null,
    // it likely means an ad blocker or script blocker is intercepting the request.
    if (klaviyoScripts.length > 0) {
      // We check using the isolated world — window globals won't be accessible here,
      // but we can still check if window.klaviyo is falsy in the page context by
      // looking for side effects. Attempt to read via a safe pattern.
      try {
        // If window.klaviyo is accessible (same world check won't work in isolated world),
        // fallback: check for the klaviyo object by inspecting if any of the known
        // Klaviyo globals appear set via inline scripts.
        const inlineText2 = Array.from(document.scripts)
          .filter(s => !s.src && s.textContent)
          .map(s => s.textContent)
          .join("\n");
        const klaviyoPushPattern = /window\.klaviyo\s*=\s*window\.klaviyo\s*\|\||klaviyo\.push|_klOnsite/;
        const hasKlaviyoInline = klaviyoPushPattern.test(inlineText2);
        // If script is present but no evidence of Klaviyo initializing, flag it
        if (!hasKlaviyoInline) {
          // Check for ad-blocker signals: common blocked script status
          const allScripts3 = Array.from(document.scripts);
          const hasBlockedSignal = allScripts3.some(s =>
            s.src && s.src.includes("klaviyo") && s.getAttribute("data-blocked")
          );
          // Conservative: only flag if we find specific blocking indicators
          if (hasBlockedSignal) {
            issues.push({
              severity: "critical",
              code:     "SCRIPT_BLOCKED",
              title:    "Klaviyo script may be blocked by an ad blocker or content filter",
              detail:   "The Klaviyo script tag is present on the page, but there are signs it may be intercepted or blocked by a browser extension or network-level filter. This would prevent all forms from appearing.",
              fix:      "Check for ad blockers or privacy extensions in the browser. Ask the customer to test in an incognito window without extensions enabled.",
            });
          }
        }
      } catch (_) {}
    }

    // Return only loader scripts in the display list (chunk files are noise)
    const displayScripts = loaderScripts.length > 0 ? loaderScripts : klaviyoScripts.slice(0, 1);

    return {
      scripts: displayScripts.map(s => ({
        src: s.src,
        type: s.getAttribute("type") || "(default: text/javascript)",
        typeOk: !s.getAttribute("type") || s.getAttribute("type") === "text/javascript",
        inHead: document.head.contains(s),
        async: s.async,
        companyId: (s.src.match(/company_id=([^&]+)/) || [])[1] || null,
      })),
      issues,
    };
  }

  // ── 2. FORM BEHAVIOUR / JS CHECKS ─────────────────────────
  // Source: "Form keeps reopening" section of the KB article

  function checkFormBehaviourIssues() {
    const issues = [];
    const inlineText = Array.from(document.scripts)
      .filter(s => !s.src && s.textContent)
      .map(s => s.textContent)
      .join("\n");

    // localStorage.clear — clears Klaviyo's cookie/identity storage
    if (inlineText.includes("localStorage.clear")) {
      issues.push({
        severity: "critical",
        code: "LOCALSTORAGE_CLEAR",
        title: "localStorage.clear() detected",
        detail: "A script on this page calls localStorage.clear(). Klaviyo uses localStorage to track which forms have been shown and to identify visitors. Clearing it on every page load causes popup forms to reopen every visit and prevents onsite event tracking from working.",
        fix: "Ask the customer's developer to remove localStorage.clear() or scope it so it does not clear Klaviyo's keys (keys prefixed with __kla_id and similar).",
      });
    }

    // openForm being called programmatically
    if (inlineText.match(/klaviyo\.openForm\s*\(/)) {
      issues.push({
        severity: "warning",
        code: "OPEN_FORM_CALL",
        title: "klaviyo.openForm() called in page scripts",
        detail: "An inline script is calling klaviyo.openForm() directly. This can cause a form to reopen on every page load regardless of its display frequency settings.",
        fix: 'Find the klaviyo.openForm() call in the site\'s JavaScript and remove it, or ensure it is only called intentionally (e.g. from a button click handler, not on page load).',
      });
    }

    // ── Deeper JS conflict detection ──────────────────────────────────────────

    // window.klaviyo being reassigned / clobbered in inline scripts
    // Patterns like `window.klaviyo = []` or `klaviyo = {}` before the SDK
    // assigns its own push queue can break form loading entirely.
    if (inlineText.match(/window\.klaviyo\s*=\s*(?!\s*window\.klaviyo)/) ||
        inlineText.match(/\bklaviyo\s*=\s*(?:null|undefined|\[\]|\{\}|false)/)) {
      issues.push({
        severity: "critical",
        code: "KLAVIYO_OVERRIDE",
        title: "window.klaviyo reassigned in inline script",
        detail: "An inline script is reassigning the window.klaviyo object before or after the Klaviyo SDK initialises. This clobbers the SDK's internal push queue and prevents forms from loading. Common causes: theme or plugin scripts that reset globals, or a tag manager firing in the wrong order.",
        fix: "Find the inline script that assigns window.klaviyo or klaviyo = … and remove it. If it is intentional (e.g. a legacy push call), wrap it so it only runs before the SDK loads: if (!window.klaviyo) { window.klaviyo = []; }",
      });
    }

    // jQuery $.noConflict() — may strip $() from Klaviyo's internal jQuery dependency
    if (inlineText.match(/\$\.noConflict\s*\(|jQuery\.noConflict\s*\(/)) {
      issues.push({
        severity: "warning",
        code: "JQUERY_NOCONFLICT",
        title: "jQuery.noConflict() detected",
        detail: "An inline script calls jQuery.noConflict(), which unregisters the global $ variable. If Klaviyo's onsite scripts or any embedded form code relies on $, this can cause silent failures where forms load but do not function correctly.",
        fix: "Ensure jQuery.noConflict() is called AFTER Klaviyo.js has fully initialised, or use a scoped alias: var jq = jQuery.noConflict(); rather than reassigning the global.",
      });
    }

    // Conflicting event listeners — stopPropagation or return false on click/submit
    // can prevent Klaviyo's form interactions from reaching their handlers.
    if (inlineText.match(/stopPropagation|stopImmediatePropagation/) &&
        inlineText.match(/click|submit|keydown/)) {
      issues.push({
        severity: "warning",
        code: "EVENT_PROPAGATION_BLOCKED",
        title: "Event propagation blocked in inline script",
        detail: "An inline script calls stopPropagation() or stopImmediatePropagation() on click, submit, or keydown events. If this handler fires before Klaviyo's own event listeners, it can prevent form submissions, email validation, and close-button interactions from working.",
        fix: "Audit the inline event handler that calls stopPropagation and ensure it does not target elements inside Klaviyo form containers. If it is a global document-level listener, scope it to exclude Klaviyo elements: if (e.target.closest('[class*=\"klaviyo\"]')) return;",
      });
    }

    // Step 3: scroll-lock orphan check
    if (document.body && document.body.classList.contains("klaviyo-prevent-body-scrolling")) {
      const openForms = document.querySelectorAll(".klaviyo-form");
      const hasOpenForm = Array.from(openForms).some(f => {
        const cs = window.getComputedStyle(f);
        return cs.display === "flex" || cs.display === "grid" || cs.display === "block";
      });
      if (!hasOpenForm) {
        issues.push({
          severity: "warning",
          code:     "SCROLL_LOCK_ORPHAN",
          title:    "klaviyo-prevent-body-scrolling left on <body>",
          detail:   "The class klaviyo-prevent-body-scrolling is present on <body> but no Klaviyo form appears to be open. This is an orphaned scroll-lock that prevents the user from scrolling the page.",
          fix:      "Remove the class from <body> with: document.body.classList.remove('klaviyo-prevent-body-scrolling'). This can happen if a form was closed mid-animation or a script error interrupted Klaviyo's cleanup.",
        });
      }
    }

    // Step 14: external scripts limitation note
    const externalScripts = Array.from(document.scripts).filter(s => s.src);
    if (externalScripts.length > 0) {
      issues.push({
        severity: "info",
        code:     "EXTERNAL_SCRIPTS_NOT_SCANNED",
        title:    "External scripts not scanned",
        detail:   `This tool only scans inline <script> blocks for JS conflicts. ${externalScripts.length} external script(s) were found on this page and could not be inspected. A third-party script loaded from an external file may still be causing issues not detected here.`,
        fix:      null,
      });
    }

    // Step 17: body/html overflow hidden check
    for (const el of [document.body, document.documentElement]) {
      if (!el) continue;
      // Skip if it's Klaviyo's own scroll-lock class
      if (el.classList && el.classList.contains("klaviyo-prevent-body-scrolling")) continue;
      const cs = window.getComputedStyle(el);
      if (cs.overflow === "hidden" || cs.overflowX === "hidden" || cs.overflowY === "hidden") {
        const tagName = el.tagName.toLowerCase();
        const fixId17 = _regFix(el, "overflow");
        issues.push({
          severity: "warning",
          code:     "BODY_OVERFLOW_HIDDEN",
          title:    `overflow: hidden on <${tagName}>`,
          detail:   `The <${tagName}> element has overflow: hidden. This can prevent Klaviyo's position:fixed modals from scrolling or clip flyout forms near the viewport edges. It is not caused by Klaviyo's own scroll-lock class.`,
          fix:      `Set overflow: auto or overflow: visible on <${tagName}>.`,
          fixId:    fixId17,
          fixSelector: _fixReg.get(_fixId)?.sel || tagName,
          property: "overflow",
        });
      }
    }

    return issues;
  }

  // ── 3. FIND KLAVIYO COMPONENTS ────────────────────────────

  const COMPONENT_TYPES = [
    {
      type: "Reviews Widget",
      selectors: [
        "klaviyo-reviews",
        '[data-component="ReviewWidget"]',
        '[data-component="StarRating"]',
        '[class*="klv-review"]',
        '[class*="klaviyo-review"]',
        '[class*="kl_reviews"]',          // .kl_reviews__carousel, .kl_reviews__stars_badge, etc.
        '[id*="klv-reviews"]',
        '[id*="klaviyo-reviews"]',
        '[id*="klaviyo-featured-reviews"]', // #klaviyo-featured-reviews-carousel (carousel container)
        '[id*="klaviyo-star-reviews"]',     // star rating inline widget
        '[id*="klaviyo_reviews"]',          // Shopify app block IDs use underscores
        "[data-klaviyo-reviews]",
        ".klaviyo-reviews-widget",
        ".klv-star-rating",
      ],
    },
    {
      type: "Customer Agent",
      selectors: [
        "klaviyo-agent",
        "klaviyo-chat",
        "klaviyo-web-chat",
        '[class*="klaviyo-agent"]',
        '[id*="klaviyo-agent"]',
        '[class*="klaviyo-chat"]',
        '[id*="klaviyo-chat"]',
        '[class*="kl-agent"]',
        '[id*="kl-agent"]',
        '[class*="customer-hub"]',
        '[id*="customer-hub"]',
        '[data-klaviyo-chat]',
        '[data-klaviyo-agent]',
        '[class*="web-chat"]',
        // Web chat panel and bubble
        '[class*="klaviyo-web-chat"]',
        '[class*="kl-webchat"]',
      ],
    },
    {
      type: "Signup Form",
      selectors: [
        '[class*="klaviyo"]',
        '[id*="klaviyo"]',
        '[id*="kl-"]',
        '[class*="kl-private"]',
        "[class*=needsclick]",
        "[data-form-id]",
        "[data-embed-id]",
        'form[action*="klaviyo"]',
        ".klaviyo-form",
        '[data-testid*="klaviyo"]',
      ],
    },
  ];

  // ── KNOWN THEME CONFLICT PATTERNS ────────────────────────
  // When a detected CSS rule matches one of these, annotate the issue with the
  // theme name so agents know exactly what they're dealing with.
  const KNOWN_THEME_CONFLICTS = [
    { theme: "Shopify — Dawn",            pattern: /\.shopify-section/,                  props: ["overflow","display"], note: "Shopify Dawn sections have overflow:hidden by default. Add a dedicated section for the Klaviyo embed, or override with overflow:visible !important." },
    { theme: "Shopify — Dawn",            pattern: /\.page-width/,                       props: ["overflow"] },
    { theme: "Shopify — Debut/Venture",   pattern: /\.index-section/,                    props: ["overflow"] },
    { theme: "Shopify — Generic",         pattern: /\.shopify-/,                         props: ["overflow","display"] },
    { theme: "Divi (Elegant Themes)",     pattern: /\.et_pb_section/,                    props: ["overflow","display"], note: "Disable 'Overflow Hidden' in the Divi Section Settings → Design → Visibility for the section containing the Klaviyo form." },
    { theme: "Divi (Elegant Themes)",     pattern: /\.et_pb_row/,                        props: ["overflow"] },
    { theme: "Elementor",                 pattern: /\.elementor-section/,                props: ["overflow","display"], note: "In Elementor, edit the Section → Advanced tab and remove any overflow-hidden class, or set Overflow to Default." },
    { theme: "Elementor",                 pattern: /\.elementor-widget-wrap/,            props: ["overflow"] },
    { theme: "Squarespace",               pattern: /\.sqs-layout|\.Index-page/,          props: ["overflow","display"] },
    { theme: "WordPress — Astra",         pattern: /\.ast-container/,                    props: ["overflow"] },
    { theme: "WordPress — GeneratePress", pattern: /\.inside-article/,                   props: ["overflow"] },
    { theme: "WordPress — Avada",         pattern: /\.fusion-builder-row/,               props: ["overflow"] },
    { theme: "Bootstrap",                 pattern: /\.container(-fluid|-xl|-lg|-md|-sm)?$/, props: ["overflow"], note: "Add overflow:visible !important to the Bootstrap container, or move the Klaviyo embed outside it." },
    { theme: "Bootstrap",                 pattern: /^\.row$/,                            props: ["overflow"] },
    { theme: "Tailwind CSS",              pattern: /overflow-hidden/,                    props: ["overflow"], note: "Remove the overflow-hidden utility class from the parent element, or add overflow-visible to the embed wrapper." },
    { theme: "WooCommerce",               pattern: /\.woocommerce/,                      props: ["overflow","display"] },
    { theme: "Webflow",                   pattern: /\.w-container/,                      props: ["overflow"] },
    { theme: "Chakra UI",                 pattern: /\.chakra-/,                          props: ["overflow","display"] },
  ];

  function getThemeMatch(selector, property) {
    if (!selector) return null;
    for (const entry of KNOWN_THEME_CONFLICTS) {
      if (!entry.props.includes(property)) continue;
      if (entry.pattern.test(selector)) return { theme: entry.theme, note: entry.note || null };
    }
    return null;
  }

  // Tags that should never be treated as Klaviyo components
  const BLOCKED_TAGS = new Set([
    "body","html","head","style","script","link","meta","noscript",
    "svg","path","circle","rect","polygon","polyline","line","use","defs","g",
    "br","hr","img","picture","source","iframe","canvas","template",
  ]);

  // Only structural/container tags are valid Klaviyo component roots
  const ALLOWED_TAGS = new Set([
    "div","section","article","aside","main","nav","header","footer",
    "form","fieldset","figure","details","summary","dialog",
    // Klaviyo custom elements
    "klaviyo-form","klaviyo-reviews","klaviyo-agent","klaviyo-chat","klaviyo-web-chat",
    // Generic containers that could legitimately hold a component
    "span","p","ul","ol","li","table","tbody","tr","td","th",
  ]);

  // ── Shadow DOM + iframe-aware querySelectorAll ────────────────────────────
  // Collects matching elements from a root, then recursively enters any
  // shadow roots and same-origin iframes it encounters.
  function deepQueryAll(root, selector, _visited = new Set()) {
    const results = [];
    if (!root || _visited.has(root)) return results;
    _visited.add(root);

    try {
      root.querySelectorAll(selector).forEach(el => results.push(el));
    } catch (_) {}

    // Recurse into shadow roots
    try {
      root.querySelectorAll("*").forEach(el => {
        if (el.shadowRoot) {
          deepQueryAll(el.shadowRoot, selector, _visited).forEach(r => results.push(r));
        }
      });
    } catch (_) {}

    // Recurse into same-origin iframes
    try {
      root.querySelectorAll("iframe").forEach(frame => {
        try {
          const doc = frame.contentDocument;
          if (doc && doc !== document && !_visited.has(doc)) {
            deepQueryAll(doc, selector, _visited).forEach(r => results.push(r));
          }
        } catch (_) {} // cross-origin iframes throw SecurityError — skip silently
      });
    } catch (_) {}

    return results;
  }

  function findKlaviyoComponents() {
    const found = new Map();
    COMPONENT_TYPES.forEach(({ type, selectors }) => {
      selectors.forEach(sel => {
        try {
          // Use deepQueryAll to pierce shadow DOM and same-origin iframes
          deepQueryAll(document, sel).forEach(el => {
            const tag = el.tagName.toLowerCase();
            // Skip non-structural / layout-infrastructure elements
            if (BLOCKED_TAGS.has(tag)) return;
            if (!found.has(el)) found.set(el, type);
          });
        } catch (_) {}
      });
    });

    // Keep only topmost ancestors (deduplicate nested matches)
    const all = Array.from(found.keys());
    const roots = all.filter(el => !all.some(o => o !== el && o.contains(el)));

    // Secondary guard: if the matched root covers most of the page body
    // (i.e. it IS effectively the whole page), drop it to avoid false positives
    // Step 11: improved interactiveCount guard
    const pageInteractiveCount = document.querySelectorAll("button,input,select,textarea,a").length;
    const interactiveThreshold = Math.max(30, Math.floor(pageInteractiveCount * 0.4));

    return roots
      .filter(el => {
        const tag = el.tagName.toLowerCase();
        if (BLOCKED_TAGS.has(tag)) return false;
        // Always trust elements with explicit Klaviyo form ID attributes
        if (el.hasAttribute("data-form-id") || el.hasAttribute("data-embed-id")) return true;
        // Reject if the element contains more interactive elements than the threshold
        // (indicates we matched a full-page container, not a specific form)
        const interactiveCount = el.querySelectorAll("button, input, select, textarea").length;
        if (interactiveCount > interactiveThreshold) return false;
        return true;
      })
      .map(el => ({ el, type: found.get(el) }));
  }

  // ── 4. ELEMENT DESCRIPTION ────────────────────────────────

  function describeEl(el) {
    const id  = el.id ? `#${el.id}` : "";
    const tag = el.tagName.toLowerCase();
    const cls = el.className
      ? "." + el.className.toString().trim().split(/\s+/).filter(c => c.length < 40).slice(0, 2).join(".")
      : "";
    return `${tag}${id}${cls}`;
  }

  // ── 4b. DOM BREADCRUMB ────────────────────────────────────
  // Returns a compact path from <body> down to el, e.g.
  //   "body > div#app > main > div.klaviyo-form-container"
  // Capped at 6 levels; prefixed with "…" when deeper than that.
  function getDomBreadcrumb(el) {
    if (!el || el === document.documentElement) return "";
    const parts = [];
    let node = el;
    while (node && node !== document.documentElement && parts.length < 6) {
      const tag = node.tagName ? node.tagName.toLowerCase() : "";
      if (!tag) break;
      let step = tag;
      if (node.id) {
        step += `#${node.id}`;
      } else if (node.className && typeof node.className === "string") {
        const cls = node.className.trim().split(/\s+/)
          .filter(c => c.length > 0 && c.length < 40)
          .slice(0, 2)
          .join(".");
        if (cls) step += `.${cls}`;
      }
      parts.unshift(step);
      node = node.parentElement;
    }
    if (node && node !== document.documentElement) parts.unshift("…");
    return parts.join(" > ");
  }

  // ── 5. CSS SOURCE FINDER ──────────────────────────────────

  function findCSSSource(element, cssPropertyKebab) {
    const sources = [];
    const camel = cssPropertyKebab.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

    for (const sheet of document.styleSheets) {
      let rules;
      try { rules = sheet.cssRules || sheet.rules; }
      catch (_) {
        // Step 16: synthetic source entry with DevTools guidance
        sources.push({
          source: sheet.href ? new URL(sheet.href).pathname : "inline <style>",
          selector: "(cross-origin — cannot inspect)",
          value: null,
          important: false,
          crossOrigin: true,
          synthetic: true,
          syntheticNote: "This stylesheet is served from a different origin and cannot be read by the extension. To inspect it, open Chrome DevTools → Sources, navigate to the stylesheet, and search for the property manually.",
        });
        continue;
      }
      if (!rules) continue;
      walkRules(rules, sheet, element, cssPropertyKebab, camel, sources, null, null);
    }
    return sources;
  }

  // Compute CSS specificity (a, b, c) for a selector string.
  // a = ID count, b = class/attr/pseudo-class count, c = element count
  function computeSpecificity(selector, rule) {
    if (!selector) return null;
    // Step 13: try native API first if available
    if (rule && rule.specificity) {
      try {
        const [a, b, c] = rule.specificity;
        return { a, b, c };
      } catch (_) {}
    }
    try {
      let s = selector.split(",")[0].trim();
      let a = 0, b = 0, c = 0;
      s = s.replace(/#[a-zA-Z0-9_-]+/g,        () => { a++; return " "; });
      s = s.replace(/\.[a-zA-Z0-9_-]+/g,        () => { b++; return " "; });
      s = s.replace(/\[[^\]]+\]/g,              () => { b++; return " "; });
      s = s.replace(/::[a-zA-Z-]+/g,            () => { c++; return " "; });
      s = s.replace(/:(?!:)[a-zA-Z-]+(\([^)]*\))?/g, () => { b++; return " "; });
      (s.match(/\b[a-zA-Z][a-zA-Z0-9-]*\b/g) || []).forEach(t => {
        if (!/^(and|or|not|is|has|where|html|body)$/.test(t)) c++;
      });
      return { a, b, c };
    } catch (_) { return null; }
  }

  function walkRules(rules, sheet, el, kebab, camel, out, mediaText, layerName) {
    for (const rule of rules) {
      // Step 15: detect @layer blocks and pass layer name down
      if (typeof CSSLayerBlockRule !== "undefined" && rule instanceof CSSLayerBlockRule) {
        walkRules(rule.cssRules, sheet, el, kebab, camel, out, mediaText, rule.name || null);
        continue;
      }
      if (rule.cssRules) {
        walkRules(rule.cssRules, sheet, el, kebab, camel, out, rule.conditionText || null, layerName);
        continue;
      }
      if (!(rule instanceof CSSStyleRule)) continue;
      try {
        if (el.matches(rule.selectorText)) {
          const val = rule.style.getPropertyValue(kebab) || rule.style[camel];
          if (val) {
            out.push({
              source: sheet.href ? new URL(sheet.href).pathname : "inline <style>",
              selector: rule.selectorText,
              value: val,
              important: rule.style.getPropertyPriority(kebab) === "important",
              mediaQuery: mediaText,
              layerName: layerName || null,  // Step 15: layer annotation
              specificity: computeSpecificity(rule.selectorText, rule),
            });
          }
        }
      } catch (_) {}
    }
  }

  // ── 6. FIX REGISTRY, CONFIDENCE, Z-INDEX ─────────────────

  // Fix registry: maps fixId → {el, property, sel, active, orig}
  // Used by the before/after toggle so popup can ask content.js to momentarily
  // override a conflicting property and let the agent see the form appear.
  const _fixReg = new Map();
  let _fixId = 0;

  // Reset fix registry at the start of each scan (Step 22)
  function _resetFixRegistry() {
    _fixReg.clear();
    _fixId = 0;
  }

  const _FIX_VALUES = {
    "display": "block", "visibility": "visible", "opacity": "1",
    "pointer-events": "auto", "max-height": "none",
    "overflow": "visible", "overflow-x": "visible", "overflow-y": "visible",
    "transform": "none",
    "z-index": "2147483647",
    "touch-action": "pan-y",
    "filter": "none",
    "color": "inherit",
    "background-color": "transparent",
  };

  // Build a querySelector-compatible selector for an element so the popup can
  // re-find it after the popup is closed and reopened (fixing Bug 1: stale fixId).
  function _getFixSelector(el) {
    if (el.id) return `#${CSS.escape(el.id)}`;
    for (const attr of ["data-form-id", "data-testid", "data-test-id"]) {
      const val = el.getAttribute(attr);
      if (val) return `[${attr}="${CSS.escape(val)}"]`;
    }
    // Best-effort: tag + up to 3 stable classes
    const tag = el.tagName.toLowerCase();
    const cls = el.classList.length
      ? "." + [...el.classList].filter(c => c.length < 50).slice(0, 3).map(c => CSS.escape(c)).join(".")
      : "";
    return tag + cls;
  }

  function _regFix(el, property) {
    const id  = ++_fixId;
    const sel = _getFixSelector(el);
    _fixReg.set(id, { el, property, sel, active: false, orig: null });
    return id;
  }

  // Confidence score: how likely this issue is actually breaking the form.
  // 5 = almost certainly the cause, 1 = unlikely on its own.
  function getConfidence(property, hasImportant) {
    const base = {
      "display": 5, "visibility": 5, "opacity": 5,
      "pointer-events": 4, "max-height": 4, "dimensions": 4, "transform": 4,
      "overflow": 3,
    };
    return Math.min(5, (base[property] || 2) + (hasImportant ? 1 : 0));
  }

  // Z-index stacking context: walk from el up to body, collecting positioned
  // ancestors with explicit z-index values.  Returned root-first.
  function getZIndexStack(el) {
    const stack = [];
    let node = el;
    while (node && node !== document.documentElement) {
      const cs = window.getComputedStyle(node);
      if (cs.position !== "static" && cs.zIndex !== "auto") {
        stack.push({
          element: describeEl(node),
          zIndex: parseInt(cs.zIndex, 10),
          position: cs.position,
          isSelf: node === el,
        });
      }
      node = node.parentElement;
    }
    return stack.reverse(); // root → form element order
  }

  // ── 7. VISIBILITY CHECKS ──────────────────────────────────
  // Covers all patterns from the KB article + real ticket examples

  /**
   * Returns true if an element is intentionally hidden because it is a
   * Klaviyo form in its teaser / closed state.
   *
   * When a Klaviyo popup/flyout form is collapsed, Klaviyo hides the main
   * form container (display:none) and shows a small teaser tab/button
   * instead. This is expected behaviour — NOT a CSS conflict.
   *
   * Detection strategy (any one match → intentionally hidden):
   *  1. The element itself carries a teaser marker (class, id, or data attr).
   *  2. A visible Klaviyo sibling exists — the teaser button next to the form.
   *  3. The element contains a teaser child element.
   *  4. A parent wrapper has a "teaser" indicator, suggesting Klaviyo put
   *     the form in a closed-state container.
   */
  function isIntentionallyHidden(el) {
    const matchesTeaser = (node) => {
      if (!node || node.nodeType !== 1) return false;
      const cls  = (node.className && typeof node.className === "string" ? node.className : "").toLowerCase();
      const id   = (node.id || "").toLowerCase();
      const fv   = (node.getAttribute("data-form-version") || "").toLowerCase();
      const role = (node.getAttribute("data-role") || "").toLowerCase();
      return (
        cls.includes("teaser") || id.includes("teaser") ||
        fv === "teaser" || fv === "closed" ||
        role === "teaser" || role === "trigger" ||
        cls.includes("kl-teaser") || cls.includes("klaviyo-teaser") ||
        cls.includes("form-trigger") || cls.includes("form-launcher") ||
        cls.includes("signup-trigger") || id.includes("kl-teaser")
      );
    };

    // 1. The element itself is marked as a teaser container
    if (matchesTeaser(el)) return true;

    // 2. A visible Klaviyo/teaser sibling is present (the shown teaser button)
    // Step 12: only match siblings with explicit teaser/trigger roles
    const parent = el.parentElement;
    const formId12 = el.getAttribute("data-form-id") || el.getAttribute("data-embed-id") || el.id;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c !== el);
      const hasVisibleKlaviyoSibling = siblings.some(sib => {
        const sibComputed = window.getComputedStyle(sib);
        if (sibComputed.display === "none") return false;          // must be visible
        const sibCls = (sib.className && typeof sib.className === "string" ? sib.className : "").toLowerCase();
        const sibRole = (sib.getAttribute("data-role") || "").toLowerCase();
        const sibAriaControls = sib.getAttribute("aria-controls") || "";
        // Only count as intentional trigger if the sibling is explicitly a teaser/trigger
        return (
          matchesTeaser(sib) ||
          sibRole === "trigger" ||
          sibCls.includes("teaser") || sibCls.includes("form-launcher") || sibCls.includes("form-trigger") ||
          (formId12 && sibAriaControls === formId12)
        );
      });
      if (hasVisibleKlaviyoSibling) return true;

      // 3b. Parent itself is a teaser wrapper
      if (matchesTeaser(parent)) return true;
    }

    // 3. A teaser child is present inside the form element
    const teaserChild = el.querySelector(
      '[class*="teaser"],[id*="teaser"],[data-form-version="teaser"],[data-form-version="closed"],[data-role="teaser"],[data-role="trigger"],[class*="kl-teaser"],[class*="form-trigger"],[class*="form-launcher"]'
    );
    if (teaserChild) return true;

    // 4. Element has `display: block !important` as an inline style AND zero
    //    rendered dimensions. Klaviyo sets this on its teaser/closed-state
    //    wrappers to keep them in the DOM while their content is positioned
    //    outside (position:fixed). This is always Klaviyo's own behaviour.
    if (
      el.style.getPropertyValue("display") === "block" &&
      el.style.getPropertyPriority("display") === "important"
    ) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return true;
    }

    return false;
  }

  const CRITICAL_CHECKS = [
    {
      prop: "display",       cssProp: "display",        badValues: ["none"],
      severity: "critical",  label: "display: none",
      explain: "Element is completely hidden. This is the most common CSS conflict seen with Klaviyo forms.",
    },
    {
      prop: "visibility",    cssProp: "visibility",     badValues: ["hidden", "collapse"],
      severity: "critical",  label: "visibility: hidden",
      explain: "Element is invisible but still occupies space on the page.",
    },
    {
      prop: "opacity",       cssProp: "opacity",        badValues: ["0"],
      severity: "critical",  label: "opacity: 0",
      explain: "Element is fully transparent — visible in the DOM but not to users.",
    },
    {
      prop: "pointerEvents", cssProp: "pointer-events", badValues: ["none"],
      severity: "warning",   label: "pointer-events: none",
      explain: "Clicks pass through the element. Buttons and inputs will not respond.",
    },
  ];

  function checkElement(el, { skipTeaserCheck = false } = {}) {
    const computed = window.getComputedStyle(el);
    const rect     = el.getBoundingClientRect();
    const issues   = [];

    CRITICAL_CHECKS.forEach(({ prop, cssProp, badValues, severity, label, explain }) => {
      const val = computed[prop];
      if (badValues.includes(val)) {
        // display:none on a Klaviyo form root is intentional when the form is
        // in teaser/closed state — do not flag it as a CSS conflict.
        if (prop === "display" && val === "none" && !skipTeaserCheck) {
          if (isIntentionallyHidden(el)) return; // skip — it's a teaser
        }

        // Skip display:none on input[type="hidden"] — always intentional.
        // Skip display:none on input[type="submit"|"button"] when there is a
        // visible <button> in the same form — Klaviyo uses a styled <button>
        // as the real submit trigger and hides the fallback input.
        if (prop === "display" && val === "none" && el.tagName === "INPUT") {
          const t = (el.type || "").toLowerCase();
          if (t === "hidden") return;
          if (t === "submit" || t === "button") {
            const form = el.closest("form");
            if (form) {
              const visibleBtn = Array.from(form.querySelectorAll("button")).some(b => {
                const bs = window.getComputedStyle(b);
                return bs.display !== "none" && bs.visibility !== "hidden" && bs.opacity !== "0";
              });
              if (visibleBtn) return; // hidden submit input is intentional
            }
          }
        }
        const sources = findCSSSource(el, cssProp);
        const hasImportant = sources.some(s => s.important);
        const themeMatch = sources.reduce((found, src) =>
          found || getThemeMatch(src.selector, cssProp), null);
        issues.push({
          severity,
          label: hasImportant ? `${label} !important` : label,
          explain,
          property: cssProp,
          computedValue: val,
          hasImportant,
          sources,
          confidence: getConfidence(cssProp, hasImportant),
          themeMatch,
          fixId: _regFix(el, cssProp),
          fixSelector: _fixReg.get(_fixId)?.sel || "",
          domPath: getDomBreadcrumb(el),
        });
      }
    });

    // Zero dimensions
    // Only flag if the element clips its children (overflow hidden/scroll/auto).
    // If overflow is "visible" on both axes, content can still show outside the
    // element's bounds even at zero dimensions — this is how Klaviyo popup
    // wrappers work (0-height div containing a position:fixed modal).
    // Also skip elements that are intentionally zero-sized because the form is
    // in teaser/closed state — the collapsed container is expected behaviour.
    if (computed.display !== "none" && (rect.width === 0 || rect.height === 0)) {
      const isTeaserEl = !skipTeaserCheck && isIntentionallyHidden(el);
      if (!isTeaserEl) {
        const oxHides = computed.overflowX !== "visible";
        const oyHides = computed.overflowY !== "visible";
        const clipsContent = (rect.width  === 0 && oxHides) ||
                             (rect.height === 0 && oyHides);
        if (clipsContent) {
          issues.push({
            severity: "critical",
            label: `Zero dimensions (${Math.round(rect.width)}×${Math.round(rect.height)}px)`,
            explain: "The element has no visible size and its overflow is hidden, so content is being clipped. Check for width:0, height:0, or max-height:0 on this element or a parent.",
            property: "dimensions",
            computedValue: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
            sources: [],
            confidence: 4,
            themeMatch: null,
            fixId: null,
            domPath: getDomBreadcrumb(el),
          });
        }
      }
    }

    // max-height: 0
    // Skip for teaser/closed-state containers — intentional collapse.
    const maxH = computed.maxHeight;
    if (maxH && maxH !== "none" && parseFloat(maxH) === 0) {
      const isTeaserEl = !skipTeaserCheck && isIntentionallyHidden(el);
      if (!isTeaserEl) {
        const mhSources = findCSSSource(el, "max-height");
        issues.push({
          severity: "critical",
          label: "max-height: 0",
          explain: "A max-height of zero collapses the element, hiding all its content.",
          property: "max-height",
          computedValue: maxH,
          sources: mhSources,
          confidence: getConfidence("max-height", mhSources.some(s => s.important)),
          themeMatch: mhSources.reduce((f, src) => f || getThemeMatch(src.selector, "max-height"), null),
          fixId: _regFix(el, "max-height"),
          fixSelector: _fixReg.get(_fixId)?.sel || "",
          domPath: getDomBreadcrumb(el),
        });
      }
    }

    // transform: scale(0) or off-viewport translate (Step 8)
    const transform = computed.transform;
    if (transform && transform !== "none") {
      let flagTransform = false;
      let transformLabel = "transform: scale(0)";
      let transformExplain = "The element has been scaled to zero via CSS transform.";

      // Skip Klaviyo teaser/popup elements — they intentionally use scale(0) to
      // hide themselves until triggered and this is not a CSS conflict.
      const isKlaviyoTeaser = el.matches('[class*="kl-teaser-"]') ||
        !!el.closest('[class*="kl-teaser-"]');

      if (transform.startsWith("matrix(0") && !isKlaviyoTeaser) {
        flagTransform = true;
      } else if (!isKlaviyoTeaser) {
        // Parse 2D matrix(a,b,c,d,e,f) and check if translateX(e) or translateY(f)
        // places the element outside the viewport
        const matMatch = transform.match(/^matrix\(\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*,\s*([-\d.e]+)\s*\)$/);
        if (matMatch) {
          const e = parseFloat(matMatch[5]); // translateX
          const f = parseFloat(matMatch[6]); // translateY
          if (Math.abs(e) > window.innerWidth || Math.abs(f) > window.innerHeight) {
            flagTransform = true;
            transformLabel = `transform translates element off-screen (${Math.round(e)}px, ${Math.round(f)}px)`;
            transformExplain = `The element is translated ${Math.round(e)}px horizontally and ${Math.round(f)}px vertically via CSS transform, placing it outside the viewport (${window.innerWidth}×${window.innerHeight}px). The element exists in the DOM but is not visible to users.`;
          }
        }
      }

      if (flagTransform) {
        const tfSources = findCSSSource(el, "transform");
        issues.push({
          severity: "critical",
          label: transformLabel,
          explain: transformExplain,
          property: "transform",
          computedValue: transform,
          sources: tfSources,
          confidence: getConfidence("transform", tfSources.some(s => s.important)),
          themeMatch: null,
          fixId: _regFix(el, "transform"),
          fixSelector: _fixReg.get(_fixId)?.sel || "",
          domPath: getDomBreadcrumb(el),
        });
      }
    }

    // Step 2: touch-action check (walk up max 5 levels)
    {
      let taNode = el;
      let taLevels = 0;
      while (taNode && taNode !== document.documentElement && taLevels < 6) {
        const taStyle = window.getComputedStyle(taNode);
        const taVal = taStyle.touchAction;
        if (taVal === "none" || taVal === "pan-x") {
          const taSources = findCSSSource(taNode, "touch-action");
          const taFixId = _regFix(taNode, "touch-action");
          issues.push({
            severity:      "warning",
            label:         `touch-action: ${taVal}${taNode !== el ? ` on ancestor ${describeEl(taNode)}` : ""}`,
            explain:       `touch-action: ${taVal} prevents vertical scrolling on touch devices. Set touch-action: pan-y on the Klaviyo form container to allow users to scroll through the form.`,
            property:      "touch-action",
            computedValue: taVal,
            fixSuggestion: `.klaviyo-form-container { touch-action: pan-y; }`,
            sources:       taSources,
            confidence:    3,
            hasImportant:  taSources.some(s => s.important),
            themeMatch:    null,
            fixId:         taFixId,
            fixSelector:   _fixReg.get(_fixId)?.sel || "",
            domPath:       getDomBreadcrumb(taNode),
          });
          break;
        }
        taNode = taNode.parentElement;
        taLevels++;
      }
    }

    // Ancestor overflow clipping
    let ancestor = el.parentElement;
    let ancestorLevel = 0;
    while (ancestor && ancestor !== document.documentElement) {
      // Skip: Klaviyo adds this class to <body> when a form opens to lock
      // background scroll. It's Klaviyo's own behaviour — never a conflict.
      if (
        ancestor.classList &&
        ancestor.classList.contains("klaviyo-prevent-body-scrolling")
      ) {
        ancestor = ancestor.parentElement;
        continue;
      }

      const aStyle = window.getComputedStyle(ancestor);
      if (aStyle.overflow === "hidden" || aStyle.overflowY === "hidden" || aStyle.overflowX === "hidden") {
        const aRect = ancestor.getBoundingClientRect();
        const clipped =
          rect.bottom < aRect.top  || rect.top  > aRect.bottom ||
          rect.right  < aRect.left || rect.left  > aRect.right;
        if (clipped) {
          const ovSources = findCSSSource(ancestor, "overflow");
          const ovTheme   = ovSources.reduce((f, src) => f || getThemeMatch(src.selector, "overflow"), null);
          issues.push({
            severity: "critical",
            label: `overflow:hidden on parent — ${describeEl(ancestor)}`,
            explain: "A parent element has overflow:hidden and is clipping this Klaviyo component outside its visible area.",
            property: "overflow",
            computedValue: "hidden",
            sources: ovSources,
            confidence: 3,
            themeMatch: ovTheme,
            fixId: _regFix(ancestor, "overflow"),
            fixSelector: _fixReg.get(_fixId)?.sel || "",
            domPath: getDomBreadcrumb(ancestor),
          });
          break;
        }
      }

      // Step 5: filter on ancestors (up to 10 levels)
      if (ancestorLevel < 10) {
        const filterVal = aStyle.filter;
        if (filterVal && filterVal !== "none") {
          const filterSources = findCSSSource(ancestor, "filter");
          const filterFixId   = _regFix(ancestor, "filter");
          issues.push({
            severity:      "warning",
            label:         `filter on ancestor — ${describeEl(ancestor)}`,
            explain:       `A parent element (${describeEl(ancestor)}) has a CSS filter applied (${filterVal}). This creates a new stacking context and can cause Klaviyo popup overlays to render incorrectly or be clipped.`,
            property:      "filter",
            computedValue: filterVal,
            fixSuggestion: `${_getFixSelector(ancestor)} { filter: none; }`,
            sources:       filterSources,
            confidence:    3,
            hasImportant:  filterSources.some(s => s.important),
            themeMatch:    null,
            fixId:         filterFixId,
            fixSelector:   _fixReg.get(_fixId)?.sel || "",
            domPath:       getDomBreadcrumb(ancestor),
          });
        }

        // Step 6: isolation, will-change, contain stacking context checks
        const isolation = aStyle.isolation;
        const willChange = aStyle.willChange;
        const contain = aStyle.contain;

        if (isolation === "isolate") {
          issues.push({
            severity:      "info",
            label:         `isolation: isolate on ancestor — ${describeEl(ancestor)}`,
            explain:       `A parent element (${describeEl(ancestor)}) has isolation: isolate, which creates a new stacking context. This can confine Klaviyo's z-index within this boundary, potentially causing popup layers to appear behind page content.`,
            property:      "isolation",
            computedValue: isolation,
            sources:       [],
            confidence:    2,
            themeMatch:    null,
            fixId:         null,
            domPath:       getDomBreadcrumb(ancestor),
          });
        }

        if (willChange && willChange !== "auto" && willChange.includes("transform")) {
          issues.push({
            severity:      "info",
            label:         `will-change: transform on ancestor — ${describeEl(ancestor)}`,
            explain:       `A parent element (${describeEl(ancestor)}) has will-change: transform, which creates a new stacking context. Klaviyo's position:fixed elements may be positioned relative to this element rather than the viewport.`,
            property:      "will-change",
            computedValue: willChange,
            sources:       [],
            confidence:    2,
            themeMatch:    null,
            fixId:         null,
            domPath:       getDomBreadcrumb(ancestor),
          });
        }

        if (contain && (contain.includes("layout") || contain.includes("paint"))) {
          issues.push({
            severity:      "info",
            label:         `contain: ${contain} on ancestor — ${describeEl(ancestor)}`,
            explain:       `A parent element (${describeEl(ancestor)}) has contain: ${contain}, which creates a new stacking context boundary. This can interfere with how Klaviyo's popup overlays are layered on the page.`,
            property:      "contain",
            computedValue: contain,
            sources:       [],
            confidence:    2,
            themeMatch:    null,
            fixId:         null,
            domPath:       getDomBreadcrumb(ancestor),
          });
        }
      }

      ancestorLevel++;
      ancestor = ancestor.parentElement;
    }

    return issues;
  }

  // ── 7. INLINE STYLE CHECK ─────────────────────────────────

  function checkInlineStyle(el) {
    const warnings = [];
    const dangerProps = ["display","visibility","opacity","pointer-events","height","width","max-height","overflow","z-index"];
    dangerProps.forEach(p => {
      const val = el.style.getPropertyValue(p);
      if (val) warnings.push({ property: p, value: val, important: el.style.getPropertyPriority(p) === "important" });
    });
    return warnings;
  }

  // ── 7b. BUTTON STYLE CONFLICT CHECK ──────────────────────────────────────
  // Detects when the site's theme CSS overrides Klaviyo's intended button
  // background-color or text color. This happens when a theme selector targeting
  // <button> has higher CSS specificity than Klaviyo's generated triple-class
  // rule (e.g. .goXXX.goXXX.goXXX = specificity 0,3,0), causing the button to
  // render with the wrong color even though Klaviyo's styles are present.
  //
  // Real example: Motaclan's theme uses
  //   button:not([class*="btn-"]):not(.single_add_to_cart_button)...(12 :not clauses)
  // giving it specificity (0,12,1) which beats Klaviyo's (0,3,0), turning an
  // orange button white.

  function _isKlaviyoSource(src) {
    if (!src || !src.source) return false;
    if (src.source === "inline <style>") return true;
    if (src.source.includes("klaviyo")) return true;
    // Klaviyo's generated triple-class selectors look like .go219079318.go219079318
    if (src.selector && /\.go\d{5,}/.test(src.selector)) return true;
    return false;
  }

  function checkButtonStyleConflicts_single(btn) {
    const issues = [];
    const computed = window.getComputedStyle(btn);
    const TRANSPARENT = new Set(["transparent", "rgba(0, 0, 0, 0)", "rgba(0,0,0,0)", "initial", ""]);

    const propsToCheck = [
      { kebab: "background-color", camel: "backgroundColor", label: "Button background overridden by site CSS" },
      { kebab: "color",            camel: "color",            label: "Button text colour overridden by site CSS" },
    ];

    for (const { kebab, camel, label } of propsToCheck) {
      const sources = findCSSSource(btn, kebab);
      if (!sources.length) continue;

      // Klaviyo's own rules — inline injected styles with generated class names
      // or served from a klaviyo.com domain. Ignore reset rules (transparent).
      const klaviyoSources = sources.filter(s =>
        _isKlaviyoSource(s) && s.value && !TRANSPARENT.has(s.value.trim())
      );
      if (!klaviyoSources.length) continue; // Klaviyo didn't set this property

      // What Klaviyo intended (take the last matching Klaviyo rule — highest declared)
      const klaviyoIntended = klaviyoSources[klaviyoSources.length - 1].value;

      // Site/theme rules competing with the button (non-Klaviyo, non-transparent)
      const siteSources = sources.filter(s =>
        !_isKlaviyoSource(s) && s.value && !TRANSPARENT.has(s.value.trim())
      );
      if (!siteSources.length) continue; // No competing site rules

      // Compare computed value to Klaviyo's intended value
      const computedVal = computed[camel];
      const normalise = v => v.replace(/\s/g, "").toLowerCase();
      if (normalise(computedVal) === normalise(klaviyoIntended)) continue; // No conflict

      // Find the highest-specificity site rule (the one that won)
      const winningRule = siteSources.reduce((best, src) => {
        if (!src.specificity) return best;
        if (!best || !best.specificity) return src;
        const b = best.specificity, s = src.specificity;
        if (s.a > b.a) return src;
        if (s.a === b.a && s.b > b.b) return src;
        if (s.a === b.a && s.b === b.b && s.c > b.c) return src;
        return best;
      }, null);

      const specNote = winningRule && winningRule.specificity
        ? ` (specificity ${winningRule.specificity.a},${winningRule.specificity.b},${winningRule.specificity.c} vs Klaviyo's triple-class 0,3,0)`
        : "";

      const fixSuggestion = `.klaviyo-form-button { ${kebab}: ${klaviyoIntended} !important; }`;

      issues.push({
        severity:       "warning",
        label,
        explain:        `Klaviyo set this button's ${kebab} to ${klaviyoIntended}, but the site's theme CSS is overriding it to ${computedVal}${specNote}. The theme selector has higher CSS specificity than Klaviyo's own button styles.`,
        property:       kebab,
        computedValue:  computedVal,
        klaviyoIntended,
        fixSuggestion,
        sources:        siteSources,
        confidence:     4,
        hasImportant:   siteSources.some(s => s.important),
        themeMatch:     null,
        fixId:          null,
        domPath:        getDomBreadcrumb(btn),
      });
    }

    // ── Focus-visible ring check ──────────────────────────────
    issues.push(...checkFocusVisibleOutline(btn));

    return issues;
  }

  // ── 7c. FOCUS-VISIBLE OUTLINE DETECTION ────────────────────
  // Detects a browser-default or theme :focus-visible ring on
  // Klaviyo form buttons. This only activates when the button is
  // focused (e.g. after clicking the close button), which is why
  // static CSS scans miss it — the outline is invisible at rest.
  // Real-world example: customer sets the close button background
  // to transparent, but a browser/theme rule adds a circle outline
  // via `button:focus-visible { outline: auto }`.

  function checkFocusVisibleOutline(btn) {
    const issues = [];
    const prev = document.activeElement;
    try {
      btn.focus({ preventScroll: true });

      const cs = window.getComputedStyle(btn);
      const outlineStyle  = cs.outlineStyle;
      const outlineWidth  = parseFloat(cs.outlineWidth) || 0;
      const outlineColor  = (cs.outlineColor || '').replace(/\s/g, '');
      const boxShadow     = cs.boxShadow;

      const INVISIBLE = new Set(['none', 'transparent', 'rgba(0,0,0,0)']);
      const hasOutline   = outlineStyle !== 'none' && outlineWidth > 0 && !INVISIBLE.has(outlineColor);
      const hasBoxShadow = boxShadow && boxShadow !== 'none';

      if (hasOutline || hasBoxShadow) {
        // Only flag if not intentionally set inline by the customer
        const inlineOutline   = btn.style.outline || btn.style.outlineStyle;
        const inlineBoxShadow = btn.style.boxShadow;

        if (!inlineOutline && !inlineBoxShadow) {
          const prop = hasOutline ? 'outline' : 'box-shadow';
          const val  = hasOutline ? cs.outline : boxShadow;

          issues.push({
            severity:        'warning',
            label:           'Focus ring visible on button (:focus-visible)',
            explain:         `A browser-default or theme focus ring appears on this button when focused (e.g. after clicking the close button). The :focus-visible pseudo-class is applying "${prop}: ${val}". This causes an unexpected circle or ring that only appears after interaction — which is why it doesn't show up in a static scan.`,
            property:        prop,
            computedValue:   val,
            klaviyoIntended: 'none',
            fixSuggestion:   `.klaviyo-form button:focus-visible {\n  outline: none;\n  box-shadow: none;\n}`,
            sources:         [],
            confidence:      4,
            hasImportant:    false,
            themeMatch:      null,
            fixId:           null,
            domPath:         getDomBreadcrumb(btn),
          });
        }
      }
    } catch (e) {
      // Silent fail — never let focus detection break the scan
    } finally {
      if (prev && typeof prev.focus === 'function') prev.focus({ preventScroll: true });
      else btn.blur();
    }
    return issues;
  }

  // ── 7d. INPUT STYLE CONFLICT CHECK (Step 1) ──────────────────────────────
  // Detects invisible text (white-on-white etc.) on form input fields.

  function _parseRGB(color) {
    // Returns [r, g, b] or null
    const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
    return m ? [parseInt(m[1]), parseInt(m[2]), parseInt(m[3])] : null;
  }

  function _colorDistance(a, b) {
    if (!a || !b) return 999;
    return Math.sqrt(
      Math.pow(a[0] - b[0], 2) +
      Math.pow(a[1] - b[1], 2) +
      Math.pow(a[2] - b[2], 2)
    );
  }

  function checkInputStyleConflicts(inp) {
    const issues = [];
    const computed = window.getComputedStyle(inp);
    const TRANSPARENT = new Set(["transparent", "rgba(0, 0, 0, 0)", "rgba(0,0,0,0)", "initial", ""]);

    const textColor = computed.color;
    const bgColor   = computed.backgroundColor;

    // Check if text color and background color are the same or nearly the same
    if (textColor && bgColor && !TRANSPARENT.has(bgColor.trim())) {
      const tc = _parseRGB(textColor);
      const bc = _parseRGB(bgColor);
      if (tc && bc) {
        const dist = _colorDistance(tc, bc);
        if (dist < 30) {
          // Very similar — invisible text
          const colorSources = findCSSSource(inp, "color");
          const bgSources    = findCSSSource(inp, "background-color");
          issues.push({
            severity:       "warning",
            label:          "Invisible input text (text colour ≈ background)",
            explain:        `The input's text colour (${textColor}) is nearly identical to its background colour (${bgColor}). Users will not be able to see what they type.`,
            property:       "color",
            computedValue:  textColor,
            klaviyoIntended: null,
            fixSuggestion:  `.klaviyo-form input { color: #000 !important; }`,
            sources:        colorSources,
            confidence:     4,
            hasImportant:   colorSources.some(s => s.important),
            themeMatch:     null,
            fixId:          _regFix(inp, "color"),
            fixSelector:    _fixReg.get(_fixId)?.sel || "",
            domPath:        getDomBreadcrumb(inp),
          });
          return issues; // No need to check further for this input
        }
      }
    }

    // Also check if a site source is overriding Klaviyo's intended color
    const propsToCheck = [
      { kebab: "color",            camel: "color",            label: "Input text colour overridden by site CSS" },
      { kebab: "background-color", camel: "backgroundColor",  label: "Input background overridden by site CSS" },
    ];

    for (const { kebab, camel, label } of propsToCheck) {
      const sources = findCSSSource(inp, kebab);
      if (!sources.length) continue;

      const klaviyoSources = sources.filter(s =>
        _isKlaviyoSource(s) && s.value && !TRANSPARENT.has(s.value.trim())
      );
      if (!klaviyoSources.length) continue;

      const klaviyoIntended = klaviyoSources[klaviyoSources.length - 1].value;
      const siteSources = sources.filter(s =>
        !_isKlaviyoSource(s) && s.value && !TRANSPARENT.has(s.value.trim())
      );
      if (!siteSources.length) continue;

      const computedVal = computed[camel];
      const normalise = v => v.replace(/\s/g, "").toLowerCase();
      if (normalise(computedVal) === normalise(klaviyoIntended)) continue;

      issues.push({
        severity:       "warning",
        label,
        explain:        `Klaviyo set this input's ${kebab} to ${klaviyoIntended}, but the site's CSS is overriding it to ${computedVal}.`,
        property:       kebab,
        computedValue:  computedVal,
        klaviyoIntended,
        fixSuggestion:  `.klaviyo-form input { ${kebab}: ${klaviyoIntended} !important; }`,
        sources:        siteSources,
        confidence:     3,
        hasImportant:   siteSources.some(s => s.important),
        themeMatch:     null,
        fixId:          _regFix(inp, kebab),
        fixSelector:    _fixReg.get(_fixId)?.sel || "",
        domPath:        getDomBreadcrumb(inp),
      });
    }

    return issues;
  }

  // ── 7b. CLOSE BUTTON Z-INDEX CONFLICT DETECTION ────────────
  // Detects when a third-party script applies z-index to Klaviyo's
  // .needsclick utility class, flattening sibling stacking order so
  // the form content (later in DOM) paints over the close button.
  // Real-world example: a "widget-dynamic-client" script injecting
  // `.needsclick { z-index: 2147483643 !important; }` — every element
  // in the form gets the same z-index, CSS falls back to DOM order,
  // and the content div (which comes after the close button in the DOM)
  // wins, hiding the X entirely.

  function checkCloseButtonZIndexConflict(formEl) {
    const issues = [];
    try {
      // Find the close button within this specific form element
      const closeBtn = formEl.querySelector(".klaviyo-close-form");
      if (!closeBtn) return issues;

      // ── Check 1: site stylesheets applying z-index to .needsclick ──
      const conflictingSources = [];
      for (const sheet of Array.from(document.styleSheets)) {
        let rules;
        try { rules = Array.from(sheet.cssRules || []); } catch (e) { continue; }
        const href = sheet.href || "inline";
        if (href.includes("klaviyo")) continue; // Skip Klaviyo's own sheets
        for (const rule of rules) {
          try {
            if (!rule.selectorText || rule.type !== 1) continue;
            const sel = rule.selectorText;
            // Flag any site rule that sets z-index on .needsclick or kl- classes
            if (
              (sel.includes(".needsclick") || sel.includes("[class*=\"kl-\"]")) &&
              rule.style.zIndex
            ) {
              conflictingSources.push({
                source:     href.split("/").pop().split("?")[0].slice(0, 50) || "inline <style>",
                selector:   sel.slice(0, 120),
                value:      String(rule.style.zIndex),
                important:  rule.style.getPropertyPriority("z-index") === "important",
                specificity: null,
                crossOrigin: false,
              });
            }
          } catch (e) { /* cross-origin rule — skip */ }
        }
      }

      // ── Check 2: is the close button actually covered by something? ──
      let buttonIsCovered = false;
      try {
        const rect = closeBtn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          const cx = rect.left + rect.width  / 2;
          const cy = rect.top  + rect.height / 2;
          if (cx > 0 && cy > 0 && cx < window.innerWidth && cy < window.innerHeight) {
            const topEl = document.elementFromPoint(cx, cy);
            if (topEl && topEl !== closeBtn && !closeBtn.contains(topEl)) {
              buttonIsCovered = true;
            }
          }
        }
      } catch (e) {}

      // Only report if we found a conflicting rule OR visually confirmed it's covered
      if (conflictingSources.length === 0 && !buttonIsCovered) return issues;

      const worstSrc = conflictingSources[0];
      const explain = worstSrc
        ? `A site stylesheet applies \`z-index: ${worstSrc.value}${worstSrc.important ? " !important" : ""}\` to \`${worstSrc.selector}\`. ` +
          `Because Klaviyo's close button also carries this class, every sibling element inside the form ends up with the same z-index. ` +
          `CSS then falls back to DOM paint order — form content (which appears later in the DOM than the close button) is painted on top of the X button, hiding it completely.`
        : `The close button appears to be painted behind form content. ` +
          `A site rule may be collapsing the z-index stacking order inside the Klaviyo form overlay.`;

      // Register a preview-fix entry so the "👁 Preview Fix" button is enabled
      const closeBtnFixId = _regFix(closeBtn, "z-index");

      issues.push({
        severity:       "warning",
        label:          "Close (✕) button hidden by z-index conflict",
        explain,
        property:       "z-index",
        computedValue:  window.getComputedStyle(closeBtn).zIndex,
        klaviyoIntended: "2147483647",
        fixSuggestion:  `.klaviyo-close-form {\n  z-index: 2147483647 !important;\n  position: absolute !important;\n}`,
        sources:        conflictingSources,
        confidence:     conflictingSources.length > 0 ? 5 : 3,
        hasImportant:   conflictingSources.some(s => s.important),
        themeMatch:     null,
        fixId:          closeBtnFixId,
        fixSelector:    ".klaviyo-close-form",
        domPath:        getDomBreadcrumb(closeBtn),
      });
    } catch (_) {}
    return issues;
  }

  // ── 8. MAIN ANALYSIS ──────────────────────────────────────

  // ── Per-component deep analysis ────────────────────────────
  // Shared by both analyze() (full scan) and showPickPanel() (pick mode).
  // Returns the same shape as a form entry in the full scan result.

  function inspectComponent(el, type, index) {
    const containerIssues = [
      ...checkElement(el),
      ...checkCloseButtonZIndexConflict(el),
    ];

    // Step 7: iframe context warning
    if (el.ownerDocument && el.ownerDocument !== document) {
      containerIssues.push({
        severity:      "warning",
        label:         "Component found inside an iframe",
        explain:       "This Klaviyo component was detected inside an iframe. position:fixed popup overlays will be clipped to the iframe bounds rather than the full viewport, which may cause the form to appear cut off or positioned incorrectly.",
        property:      "iframe",
        computedValue: "iframe",
        sources:       [],
        confidence:    3,
        themeMatch:    null,
        fixId:         null,
        domPath:       getDomBreadcrumb(el),
      });
    }

    // Step 10: Reviews carousel — improve overflow fix text
    if (type === "Reviews Widget") {
      containerIssues.forEach(issue => {
        if (issue.property === "overflow" && issue.label && issue.label.includes("overflow:hidden")) {
          issue.explain = "A parent element has overflow:hidden and is clipping the Klaviyo Reviews carousel. This commonly causes the carousel navigation arrows or star-rating widgets to be cut off at the container edge.";
          if (issue.fixSuggestion == null) {
            issue.fixSuggestion = `/* Override overflow on the parent containing the reviews carousel */\n${issue.domPath ? issue.domPath.split(" > ").pop() : "parent-element"} {\n  overflow: visible !important;\n}`;
          }
        }
      });
    }
    const containerInline = checkInlineStyle(el);

    // Skip child inputs/buttons for teaser containers — they are intentionally
    // collapsed/hidden and would produce false positives (zero dimensions, etc.).
    const isTeaserContainer = isIntentionallyHidden(el);

    const buttons = el.querySelectorAll('button, input[type="submit"], [role="button"]');
    const buttonResults = isTeaserContainer ? [] : Array.from(buttons).map(btn => ({
      element: describeEl(btn),
      issues:  [...checkElement(btn), ...checkButtonStyleConflicts_single(btn)],
      inlineStyle: checkInlineStyle(btn),
    })).filter(r => r.issues.length > 0 || r.inlineStyle.length > 0);

    const inputs = el.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], textarea');
    const inputResults = isTeaserContainer ? [] : Array.from(inputs).map(inp => ({
      element: describeEl(inp),
      issues:  [...checkElement(inp), ...checkInputStyleConflicts(inp)],
      inlineStyle: checkInlineStyle(inp),
    })).filter(r => r.issues.length > 0 || r.inlineStyle.length > 0);

    // Pull the Klaviyo form ID for display + dashboard link.
    // Priority: data-form-id / data-embed-id → data-testid → className match
    const formId = (() => {
      function extractId(node) {
        if (!node) return null;
        const explicit = node.getAttribute("data-form-id") || node.getAttribute("data-embed-id");
        if (explicit) return explicit;
        const testId = node.getAttribute("data-testid") || "";
        const match = testId.match(/klaviyo-form-([A-Za-z0-9]+)/i);
        if (match) return match[1];
        // Fallback: extract from class name e.g. klaviyo-form-PpOpUp
        const cls = (typeof node.className === "string" ? node.className : "");
        const classMatch = cls.match(/\bklaviyo-form-([A-Za-z0-9]{4,})\b/);
        if (classMatch) return classMatch[1];
        return null;
      }
      const fromRoot = extractId(el);
      if (fromRoot) return fromRoot;
      const child = el.querySelector('[data-form-id],[data-embed-id],[data-testid*="klaviyo-form-"],[class*="klaviyo-form-"]');
      return extractId(child);
    })();

    // Step 21: Overlay element covering form
    try {
      const rect21 = el.getBoundingClientRect();
      if (rect21.width > 0 && rect21.height > 0) {
        const cx = rect21.left + rect21.width  / 2;
        const cy = rect21.top  + rect21.height / 2;
        if (cx >= 0 && cy >= 0 && cx < window.innerWidth && cy < window.innerHeight) {
          const topEl = document.elementFromPoint(cx, cy);
          if (topEl && topEl !== el && !el.contains(topEl)) {
            const topStyle = window.getComputedStyle(topEl);
            if (topStyle.pointerEvents !== "none") {
              containerIssues.push({
                severity:      "warning",
                label:         `Overlapping element covering form — ${describeEl(topEl)}`,
                explain:       `At the center of this Klaviyo component, the topmost visible element is ${describeEl(topEl)}, which is not part of the form. This element may be intercepting clicks and preventing users from interacting with the form.`,
                property:      "z-index",
                computedValue: topStyle.zIndex,
                sources:       [],
                confidence:    3,
                themeMatch:    null,
                fixId:         null,
                domPath:       getDomBreadcrumb(topEl),
              });
            }
          }
        }
      }
    } catch (_) {}

    const finalTotalIssues =
      containerIssues.length +
      buttonResults.reduce((a, b) => a + b.issues.length, 0) +
      inputResults.reduce((a, b) => a + b.issues.length, 0);

    return {
      index,
      element:        describeEl(el),
      formId,
      componentType:  type,
      healthy:        finalTotalIssues === 0,
      containerIssues,
      containerInline,
      buttonResults,
      inputResults,
      totalIssues:    finalTotalIssues,
      zIndexStack:    getZIndexStack(el),
    };
  }

  // ── 8b. CSP CHECK ─────────────────────────────────────────
  function checkCSP() {
    const issues = [];
    const klaviyoDomains = ["klaviyo.com", "static.klaviyo.com", "a.klaviyo.com", "fast.a.klaviyo.com"];

    // Check <meta http-equiv="Content-Security-Policy"> tags
    const cspMetas = [...document.querySelectorAll('meta[http-equiv="Content-Security-Policy"]')];
    const cspString = cspMetas.map(m => m.getAttribute("content") || "").join(" ");

    // Also look for any <meta name="referrer"> or similar that hint at CSP
    const hasCspMeta = cspMetas.length > 0;

    if (hasCspMeta && cspString) {
      const scriptSrc = (cspString.match(/script-src([^;]*)/i) || [])[1] || "";
      const connectSrc = (cspString.match(/connect-src([^;]*)/i) || [])[1] || "";
      const defaultSrc = (cspString.match(/default-src([^;]*)/i) || [])[1] || "";

      const effectiveScript  = scriptSrc  || defaultSrc;
      const effectiveConnect = connectSrc || defaultSrc;

      const hasWildcard = (s) => s.includes("*") && !s.includes("'none'");
      const allowsKlaviyo = (src) =>
        hasWildcard(src) || klaviyoDomains.some(d => src.includes(d));

      if (effectiveScript && !allowsKlaviyo(effectiveScript) && !effectiveScript.includes("'unsafe-inline'")) {
        issues.push({
          severity: "critical",
          code: "CSP_BLOCKS_SCRIPTS",
          title: "CSP may block Klaviyo scripts",
          detail: `The page has a Content-Security-Policy that restricts script-src and does not explicitly allow Klaviyo's CDN (static.klaviyo.com). This will silently prevent Klaviyo's JavaScript from loading with no visible error to the visitor.`,
          fix: "Ask the developer to add 'static.klaviyo.com' and 'a.klaviyo.com' to the site's Content-Security-Policy script-src and connect-src directives.",
        });
      } else if (effectiveConnect && !allowsKlaviyo(effectiveConnect)) {
        issues.push({
          severity: "warning",
          code: "CSP_BLOCKS_CONNECT",
          title: "CSP may block Klaviyo API calls",
          detail: `The Content-Security-Policy restricts connect-src and may not allow connections to a.klaviyo.com. This can prevent form submissions and analytics from reaching Klaviyo.`,
          fix: "Add 'a.klaviyo.com' and 'fast.a.klaviyo.com' to the site's Content-Security-Policy connect-src directive.",
        });
      } else if (hasCspMeta) {
        issues.push({
          severity: "info",
          code: "CSP_PRESENT",
          title: "Content-Security-Policy detected",
          detail: "A CSP is in place on this page. Klaviyo domains appear to be allowed, but if forms fail to load in an incognito/clean browser session, double-check the full CSP header (not just the meta tag) on the server.",
          fix: null,
        });
      }
    }

    // Check if Klaviyo script is blocked by looking for noscript fallback or blocked indicator
    const noscripts = [...document.querySelectorAll("noscript")];
    const hasKlaviyoNoscript = noscripts.some(n => n.textContent.includes("klaviyo"));
    if (hasKlaviyoNoscript) {
      issues.push({
        severity: "warning",
        code: "CSP_NOSCRIPT_KLAVIYO",
        title: "Klaviyo referenced in <noscript>",
        detail: "A <noscript> block references Klaviyo, suggesting the site may have a no-JS fallback or tracking pixel. This is not necessarily a problem but worth checking if scripts aren't loading.",
        fix: null,
      });
    }

    // Step 4: CSP img-src check for Klaviyo CloudFront images
    if (hasCspMeta && cspString) {
      const imgSrcRaw   = (cspString.match(/img-src([^;]*)/i) || [])[1] || "";
      const defaultSrc2 = (cspString.match(/default-src([^;]*)/i) || [])[1] || "";
      const effectiveImg = imgSrcRaw || defaultSrc2;
      if (effectiveImg) {
        const allowsCloudFront = effectiveImg.includes("*") ||
          effectiveImg.includes("cloudfront.net") ||
          effectiveImg.includes("d3k81ch9hvuctc.cloudfront.net");
        if (!allowsCloudFront) {
          issues.push({
            severity: "info",
            code:     "CSP_BLOCKS_IMG_CLOUDFRONT",
            title:    "CSP img-src may block Klaviyo form images (served from CloudFront)",
            detail:   "Klaviyo serves form images from d3k81ch9hvuctc.cloudfront.net. The page's CSP img-src directive does not appear to allow this domain, which may cause form images to not load.",
            fix:      "Add 'd3k81ch9hvuctc.cloudfront.net' or '*.cloudfront.net' to the site's Content-Security-Policy img-src directive.",
          });
        }
      }
    }

    return { issues, hasCsp: hasCspMeta };
  }

  // ── 8c. CMP CHECK ─────────────────────────────────────────
  // NOTE: window globals can't be read from an isolated world, so CMP detection
  // here is DOM-based only (script src patterns, cookie banners, data attributes).
  // MAIN-world global checks happen in popup.js via executeScript({world:"MAIN"}).
  function checkCMP() {
    const detected = [];
    const allScripts = [...document.scripts];
    const allSrcs = allScripts.map(s => s.src.toLowerCase());

    const cmpSignatures = [
      { name: "OneTrust",       patterns: ["onetrust", "optanon"] },
      { name: "Cookiebot",      patterns: ["cookiebot", "consentapiurl"] },
      { name: "TrustArc",       patterns: ["trustarc", "truste.com"] },
      { name: "Usercentrics",   patterns: ["usercentrics", "privacy-proxy.usercentrics"] },
      { name: "CookieYes",      patterns: ["cookieyes", "cookie-law-info"] },
      { name: "Klaro",          patterns: ["klaro.js", "/klaro/"] },
      { name: "Quantcast CMP", patterns: ["quantcast.mgr", "quantcast.com/cmp"] },
      { name: "Didomi",         patterns: ["sdk.privacy-center.org", "didomi"] },
    ];

    cmpSignatures.forEach(({ name, patterns }) => {
      if (allSrcs.some(src => patterns.some(p => src.includes(p)))) {
        detected.push(name);
      }
    });

    // Also check for common CMP data attributes on <body> or <html>
    const bodyData = document.body ? document.body.dataset : {};
    if (bodyData.privacyManager || bodyData.consentManager) detected.push("Unknown CMP (data attr)");

    // Step 18: Check if Klaviyo script tag has consent-gating attributes
    const cmpIssues = [];
    if (detected.length > 0) {
      const allScripts2 = Array.from(document.scripts);
      const klaviyoScript = allScripts2.find(s =>
        s.src && (s.src.includes("klaviyo.com") || s.src.includes("company_id="))
      );
      if (klaviyoScript) {
        const consentAttrs = ["data-cookieconsent", "data-consent", "type"];
        const hasConsentGating = consentAttrs.some(attr => {
          const val = klaviyoScript.getAttribute(attr);
          if (!val) return false;
          // type="text/plain" is a common consent-blocking pattern
          if (attr === "type" && val === "text/plain") return true;
          return val.toLowerCase().includes("consent") || val.toLowerCase().includes("analytics") || val.toLowerCase().includes("marketing");
        });
        if (hasConsentGating) {
          cmpIssues.push({
            severity: "warning",
            code:     "CMP_CONSENT_GATES_KLAVIYO",
            title:    `${detected[0]} is consent-gating Klaviyo's script`,
            detail:   `The Klaviyo script tag has consent-management attributes (e.g. type="text/plain" or data-cookieconsent). First-time visitors who have not accepted cookies will not see any Klaviyo forms, as the script will not load until consent is given.`,
            fix:      "If Klaviyo is necessary for the site's core functionality, consider excluding it from consent gating, or ensure the consent banner fires early enough that forms load for all visitors.",
          });
        }
      }
    }

    return { detected, cmpIssues };
  }

  function analyze() {
    _resetFixRegistry(); // Step 22: clear stale fix registry on each scan
    const scriptHealth    = checkScriptHealth();
    const behaviourIssues = checkFormBehaviourIssues();
    const components      = findKlaviyoComponents();
    const forms           = components.map(({ el, type }, i) => inspectComponent(el, type, i + 1));
    const csp             = checkCSP();
    const cmp             = checkCMP();

    return {
      url: window.location.href,
      scriptHealth,
      behaviourIssues,
      formsFound: components.length,
      forms,
      totalIssues: forms.reduce((a, b) => a + b.totalIssues, 0),
      csp,
      cmp,
    };
  }

  // ── 9. PICK MODE ──────────────────────────────────────────
  // Lets the agent click any element on the page for instant inspection.

  let pickActive    = false;
  let pickHighlight = null;
  let pickBanner    = null;

  function startPickMode() {
    if (pickActive) return;
    pickActive = true;

    // ── Highlight box (follows cursor) ──
    pickHighlight = document.createElement("div");
    pickHighlight.id = "__klv_pick_highlight";
    Object.assign(pickHighlight.style, {
      position:      "fixed",
      pointerEvents: "none",
      zIndex:        "2147483646",
      border:        "2px solid #635bff",
      background:    "rgba(99,91,255,0.08)",
      borderRadius:  "3px",
      transition:    "top .05s,left .05s,width .05s,height .05s",
      display:       "none",
      boxSizing:     "border-box",
    });
    document.documentElement.appendChild(pickHighlight);

    // ── Top banner ──
    pickBanner = document.createElement("div");
    pickBanner.id = "__klv_pick_banner";
    Object.assign(pickBanner.style, {
      position:   "fixed",
      top:        "0",
      left:       "0",
      right:      "0",
      zIndex:     "2147483647",
      background: "#0f0f2e",
      color:      "white",
      fontSize:   "12px",
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      padding:    "8px 14px",
      display:    "flex",
      alignItems: "center",
      gap:        "10px",
    });
    pickBanner.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" style="flex-shrink:0">
        <path d="M4 4l7.5 18 3-7 7-3L4 4z" stroke="#a5b4fc" stroke-width="2" stroke-linejoin="round"/>
        <path d="M14.5 14.5L20 20" stroke="#a5b4fc" stroke-width="2" stroke-linecap="round"/>
      </svg>
      <span style="flex:1;color:#c7d2fe">Click any element to inspect it &nbsp;·&nbsp; <kbd style="background:#1e1e3f;border:1px solid #3b3b6b;border-radius:3px;padding:1px 5px;font-size:11px">Esc</kbd> to cancel</span>
      <button id="__klv_cancel_pick" style="background:#635bff;color:white;border:none;border-radius:5px;padding:4px 10px;font-size:11px;cursor:pointer;font-family:inherit">✕ Cancel</button>
    `;
    document.documentElement.appendChild(pickBanner);
    document.getElementById("__klv_cancel_pick").addEventListener("click", stopPickMode);

    document.addEventListener("mousemove", onPickMove,    true);
    document.addEventListener("mouseover", onPickMove,    true);
    document.addEventListener("click",     onPickClick,   true);
    document.addEventListener("keydown",   onPickKeyDown, true);
    document.documentElement.style.cursor = "crosshair";
  }

  function stopPickMode() {
    // Always clean up — do not guard on pickActive.
    // If listeners were added they must be removed regardless of state.
    pickActive = false;
    document.removeEventListener("mousemove", onPickMove,    true);
    document.removeEventListener("mouseover", onPickMove,    true);
    document.removeEventListener("click",     onPickClick,   true);
    document.removeEventListener("keydown",   onPickKeyDown, true);
    document.documentElement.style.cursor = "";
    // Belt-and-suspenders: also query and remove in case reference is stale
    document.querySelectorAll("#__klv_pick_highlight, #__klv_pick_banner").forEach(el => el.remove());
    if (pickHighlight) { pickHighlight.remove(); pickHighlight = null; }
    if (pickBanner)    { pickBanner.remove();    pickBanner    = null; }
  }

  function onPickMove(e) {
    const el = e.target;
    // Ignore our own injected UI
    if (el.closest && el.closest("#__klv_cancel_pick, #__klv_inspector_panel")) return;
    if (el === pickHighlight || el === pickBanner) return;

    const rect = el.getBoundingClientRect();
    Object.assign(pickHighlight.style, {
      display: "block",
      top:     rect.top    + "px",
      left:    rect.left   + "px",
      width:   rect.width  + "px",
      height:  rect.height + "px",
    });
  }

  function onPickClick(e) {
    const el = e.target;
    if (el.closest && el.closest("#__klv_cancel_pick")) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    stopPickMode();
    showPickPanel(el);
  }

  function onPickKeyDown(e) {
    if (e.key === "Escape") stopPickMode();
  }

  // ── Pick results — save to storage & reopen popup ─────────

  function showPickPanel(el) {
    // ── Step 1: check if the clicked element is inside a known Klaviyo component ──
    // First look at components already found by the full scan selector list,
    // since those are already de-duplicated to the topmost root element.
    let klaviyoRoot = null;
    let klaviyoType = null;

    const components = findKlaviyoComponents();
    for (const { el: compEl, type } of components) {
      if (compEl === el || compEl.contains(el)) {
        klaviyoRoot = compEl;
        klaviyoType = type;
        break;
      }
    }

    // ── Step 2: if not found, walk up the DOM checking against COMPONENT_TYPES ──
    // Catches components that are display:none or otherwise missed by findKlaviyoComponents.
    if (!klaviyoRoot) {
      let node = el;
      outer: while (node && node !== document.documentElement) {
        for (const { type, selectors } of COMPONENT_TYPES) {
          for (const sel of selectors) {
            try {
              if (node.matches && node.matches(sel)) {
                klaviyoRoot = node;
                klaviyoType = type;
                break outer;
              }
            } catch (_) {}
          }
        }
        node = node.parentElement;
      }
    }

    // ── Step 3: if still not found, search INSIDE the clicked element's subtree ──
    // Handles the common case where the user clicks a wrapper section or parent
    // div that contains a Klaviyo component — the component is a descendant, not
    // an ancestor, of the clicked element.
    if (!klaviyoRoot) {
      for (const { el: compEl, type } of components) {
        if (el.contains(compEl)) {
          klaviyoRoot = compEl;
          klaviyoType = type;
          break;
        }
      }
    }

    // ── Step 4: subtree selector search (catches hidden forms inside wrappers) ──
    if (!klaviyoRoot) {
      outer2: for (const { type, selectors } of COMPONENT_TYPES) {
        for (const sel of selectors) {
          try {
            const found = el.querySelector(sel);
            if (found) { klaviyoRoot = found; klaviyoType = type; break outer2; }
          } catch (_) {}
        }
      }
    }

    let result;

    if (klaviyoRoot) {
      // ── Full component analysis — identical depth to Scan Page ──
      const form = inspectComponent(klaviyoRoot, klaviyoType, 1);
      result = {
        mode:        "pick-component",
        element:     describeEl(klaviyoRoot),
        form,
        url:         window.location.href,
        totalIssues: form.totalIssues,
        timestamp:   Date.now(),
      };
    } else {
      // ── Generic element — simple CSS visibility check ──
      const issues       = checkElement(el);
      const inlineStyles = checkInlineStyle(el);
      result = {
        mode:        "pick",
        element:     describeEl(el),
        issues,
        inlineStyles,
        totalIssues: issues.length,
        url:         window.location.href,
        timestamp:   Date.now(),
      };
    }

    // Save result, clear pick mode flag, ask background to reopen popup
    chrome.storage.local.set({ klvPickResult: result, klvPickMode: false }, () => {
      chrome.runtime.sendMessage({ action: "openPopup" }, () => void chrome.runtime.lastError);
    });

    // Brief on-page toast in case openPopup fails on older Chrome
    showToast("✓ Inspection complete — click the extension icon to view results");
  }

  function showToast(msg) {
    const existing = document.getElementById("__klv_toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.id = "__klv_toast";
    Object.assign(toast.style, {
      position:   "fixed",
      bottom:     "20px",
      left:       "50%",
      transform:  "translateX(-50%)",
      zIndex:     "2147483647",
      background: "#0f0f2e",
      color:      "#c7d2fe",
      fontSize:   "12px",
      fontFamily: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
      padding:    "9px 18px",
      borderRadius:"8px",
      boxShadow:  "0 4px 16px rgba(0,0,0,0.3)",
      whiteSpace: "nowrap",
      transition: "opacity 0.4s",
    });
    toast.textContent = msg;
    document.documentElement.appendChild(toast);
    setTimeout(() => { toast.style.opacity = "0"; }, 2400);
    setTimeout(() => toast.remove(), 2900);
  }

  function esc(str) {
    if (str == null) return "";
    return String(str).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  // ── 10. MANUAL FORM CHECK ─────────────────────────────────
  // Given a Klaviyo form ID, find its DOM element and run the full
  // CSS analysis on it — regardless of whether auto-detection found it.

  function manualCheckForm(formId) {
    _resetFixRegistry(); // Step 22: clear stale fix registry
    const escSel = id => id.replace(/([!"#$%&'()*+,.\/:;<=>?@[\\\]^`{|}~])/g, "\\$1");

    // Find any element that carries this form ID
    const found = (
      document.querySelector(`[data-testid="klaviyo-form-${escSel(formId)}"]`) ||
      document.querySelector(`[data-testid*="${escSel(formId)}"]`) ||
      document.querySelector(`[data-form-id="${escSel(formId)}"]`) ||
      document.querySelector(`[data-embed-id="${escSel(formId)}"]`)
    );

    if (!found) return { found: false, formId };

    // Walk UP from the found element to the topmost Klaviyo container.
    // The data-testid is often on an inner wrapper — we want the root form div.
    //
    // IMPORTANT: Never go past <body> or <html>. Those are page-level elements,
    // not Klaviyo containers. Going past them would include unrelated elements
    // (video players, reCAPTCHA, etc.) in the analysis.
    let container = found;
    let ancestor = found.parentElement;
    while (
      ancestor &&
      ancestor !== document.body &&
      ancestor !== document.documentElement
    ) {
      const cls = (ancestor.className && typeof ancestor.className === "string")
        ? ancestor.className.toLowerCase() : "";
      const id  = (ancestor.id || "").toLowerCase();
      const hasKlaviyoAttr =
        ancestor.hasAttribute("data-form-id") ||
        ancestor.hasAttribute("data-embed-id") ||
        (ancestor.getAttribute("data-testid") || "").includes("klaviyo-form-");
      if (
        cls.includes("klaviyo") || cls.includes("needsclick") || cls.includes("kl-") ||
        id.includes("klaviyo") || id.includes("kl-") || hasKlaviyoAttr
      ) {
        container = ancestor;
      }
      ancestor = ancestor.parentElement;
    }

    // Step 23: delegate to inspectComponent for deduplication
    const result = inspectComponent(container, "Signup Form", 1);

    return {
      found: true,
      formId,
      element: result.element,
      containerIssues: result.containerIssues,
      containerInline: result.containerInline,
      buttonResults:   result.buttonResults,
      inputResults:    result.inputResults,
      totalIssues:     result.totalIssues,
    };
  }

  // ── 11. MESSAGE LISTENER ──────────────────────────────────

  chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
    if (request.action === "inspect") {
      try {
        sendResponse({ success: true, data: analyze() });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }
    if (request.action === "manualCheck") {
      try {
        sendResponse({ success: true, data: manualCheckForm(request.formId) });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    }
    if (request.action === "startPick") {
      startPickMode();
      sendResponse({ success: true });
    }
    if (request.action === "stopPick") {
      stopPickMode();
      sendResponse({ success: true });
    }
    if (request.action === "toggleFix") {
      try {
        let fix = _fixReg.get(request.fixId);

        // Fallback: if fixId is stale (content script was re-injected after page
        // reload), try to re-find the element by its stored CSS selector so the
        // preview still works without needing a full re-scan (Bug 1 fix).
        if (!fix && request.fixSelector && request.fixProperty) {
          const el = document.querySelector(request.fixSelector);
          if (el) {
            const newId = ++_fixId;
            _fixReg.set(newId, { el, property: request.fixProperty, sel: request.fixSelector, active: false, orig: null });
            fix = _fixReg.get(newId);
          }
        }

        if (!fix) { sendResponse({ success: false, error: "Fix not found" }); return true; }

        if (!fix.active) {
          // Save existing inline value and apply override
          fix.orig = {
            value:    fix.el.style.getPropertyValue(fix.property),
            priority: fix.el.style.getPropertyPriority(fix.property),
          };
          const goodVal = _FIX_VALUES[fix.property] || "initial";
          fix.el.style.setProperty(fix.property, goodVal, "important");
          fix.active = true;
          sendResponse({ success: true, active: true });
        } else {
          // Restore
          fix.el.style.removeProperty(fix.property);
          if (fix.orig && fix.orig.value) {
            fix.el.style.setProperty(fix.property, fix.orig.value, fix.orig.priority);
          }
          fix.active = false;
          sendResponse({ success: true, active: false });
        }
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
      return true;
    }
    return true;
  });
})();
