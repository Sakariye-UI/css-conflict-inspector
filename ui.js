// ui.js — sidebar nav, manual check collapse, theme toggle, report panel
//
// ARCHITECTURE OVERVIEW (sidebar panels):
//   The popup has a 52 px icon-only rail on the left with eight nav buttons:
//     #nav-inspect  → main scan results  (#content)
//     #nav-pick     → pick element       (#section-pick)
//     #nav-har      → HAR file           (#section-har)
//     #nav-history  → scan history       (#section-history)
//     #nav-scanner  → site scanner       (#section-scanner)
//     #nav-settings → settings           (#section-settings)
//     #nav-help     → help               (#section-help)
//     #nav-report   → report feedback    (#section-report)
//
//   Only ONE panel is ever visible at a time. Show/hide is done with
//   element.style.display rather than CSS classes.

(function() {

  // ─────────────────────────────────────────────────────────────────────────
  // DOM REFERENCES
  // ─────────────────────────────────────────────────────────────────────────
  var settingsPanel   = document.getElementById('section-settings');
  var settingsWrapEl  = document.getElementById('settings-wrap');
  var navInspect      = document.getElementById('nav-inspect');
  var navPick         = document.getElementById('nav-pick');
  var navHar          = document.getElementById('nav-har');
  var navHistory      = document.getElementById('nav-history');
  var navSettings     = document.getElementById('nav-settings');
  var navScanner      = document.getElementById('nav-scanner');
  var navHelp         = document.getElementById('nav-help');
  var navReport       = document.getElementById('nav-report');

  var sectionPick     = document.getElementById('section-pick');
  var sectionHar      = document.getElementById('section-har');
  var sectionHistory  = document.getElementById('section-history');
  var sectionScanner  = document.getElementById('section-scanner');
  var sectionHelp     = document.getElementById('section-help');
  var sectionReport   = document.getElementById('section-report');

  var contentEl = document.getElementById('content');

  var manualBody      = document.getElementById('manual-body');
  var manualChevron   = document.getElementById('manual-chevron');
  var manualToggleBtn = document.getElementById('manual-toggle-btn');
  var manualWrapEl    = document.getElementById('manual-check-wrap');

  var themeDarkBtn    = document.getElementById('theme-dark-btn');
  var themeLightBtn   = document.getElementById('theme-light-btn');

  var _settingsMutating = false;
  var _manualMutating   = false;

  // ─────────────────────────────────────────────────────────────────────────
  // THEME
  // ─────────────────────────────────────────────────────────────────────────
  function applyTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    if (themeLightBtn) themeLightBtn.classList.toggle('theme-opt-active', theme === 'light');
    if (themeDarkBtn)  themeDarkBtn.classList.toggle('theme-opt-active', theme !== 'light');
  }

  if (themeDarkBtn)  themeDarkBtn.addEventListener('click', function() {
    applyTheme('dark');
    chrome.storage.local.set({ klvTheme: 'dark' });
  });
  if (themeLightBtn) themeLightBtn.addEventListener('click', function() {
    applyTheme('light');
    chrome.storage.local.set({ klvTheme: 'light' });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // HELPERS — clear all nav active states / hide all panels
  // ─────────────────────────────────────────────────────────────────────────
  function clearAllNavActive() {
    [navInspect, navPick, navHar, navHistory, navScanner, navSettings, navHelp, navReport].forEach(function(n) {
      if (n) n.classList.remove('active');
    });
  }

  function hideAllPanels() {
    if (contentEl)      contentEl.style.display      = 'none';
    if (settingsPanel)  settingsPanel.style.display  = 'none';
    if (sectionPick)    sectionPick.style.display    = 'none';
    if (sectionHar)     sectionHar.style.display     = 'none';
    if (sectionHistory) sectionHistory.style.display = 'none';
    if (sectionScanner) sectionScanner.style.display = 'none';
    if (sectionHelp)    sectionHelp.style.display    = 'none';
    if (sectionReport)  sectionReport.style.display  = 'none';
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PANEL SHOW FUNCTIONS
  // ─────────────────────────────────────────────────────────────────────────
  function showInspect() {
    hideAllPanels();
    clearAllNavActive();
    if (contentEl) contentEl.style.display = '';
    if (navInspect) navInspect.classList.add('active');
    chrome.storage.local.set({ klvSettingsOpen: false });
  }

  function showPickPanel() {
    hideAllPanels();
    clearAllNavActive();
    if (sectionPick) sectionPick.style.display = 'block';
    if (navPick) navPick.classList.add('active');
    chrome.storage.local.set({ klvSettingsOpen: false });
  }

  function showHar() {
    hideAllPanels();
    clearAllNavActive();
    if (sectionHar) sectionHar.style.display = 'block';
    if (navHar) navHar.classList.add('active');
    chrome.storage.local.set({ klvSettingsOpen: false });
  }

  function showHistory() {
    hideAllPanels();
    clearAllNavActive();
    if (sectionHistory) sectionHistory.style.display = 'block';
    if (navHistory) navHistory.classList.add('active');
    chrome.storage.local.set({ klvSettingsOpen: false });
    // Refresh page scan list each time the panel opens
    if (typeof renderHistoryInPanel === 'function') renderHistoryInPanel();
  }

  function showSettings() {
    hideAllPanels();
    clearAllNavActive();
    if (settingsPanel) settingsPanel.style.display = 'block';
    if (navSettings) navSettings.classList.add('active');
    chrome.storage.local.set({ klvSettingsOpen: true });
  }

  function hideSettings() {
    // "Hide settings" = go back to the main inspect view
    hideAllPanels();
    clearAllNavActive();
    if (contentEl) contentEl.style.display = '';
    if (navInspect) navInspect.classList.add('active');
    chrome.storage.local.set({ klvSettingsOpen: false });
  }

  function showScanner() {
    hideAllPanels();
    clearAllNavActive();
    if (sectionScanner) sectionScanner.style.display = 'block';
    if (navScanner) navScanner.classList.add('active');
    chrome.storage.local.set({ klvSettingsOpen: false });
  }

  function showHelp() {
    hideAllPanels();
    clearAllNavActive();
    if (sectionHelp) sectionHelp.style.display = 'block';
    if (navHelp) navHelp.classList.add('active');
    chrome.storage.local.set({ klvSettingsOpen: false });
  }

  function showReport() {
    hideAllPanels();
    clearAllNavActive();
    if (sectionReport) sectionReport.style.display = 'block';
    if (navReport) navReport.classList.add('active');
    chrome.storage.local.set({ klvSettingsOpen: false });
    loadReportEvents();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NAV CLICK HANDLERS
  // ─────────────────────────────────────────────────────────────────────────
  var scanBtn = document.getElementById('inspect-btn');
  if (scanBtn) scanBtn.addEventListener('click', showInspect);

  if (navInspect) navInspect.addEventListener('click', function() {
    if (contentEl && contentEl.style.display !== 'none') return; // already active
    showInspect();
  });

  if (navPick) navPick.addEventListener('click', function() {
    if (sectionPick && sectionPick.style.display !== 'none') showInspect();
    else showPickPanel();
  });

  if (navHar) navHar.addEventListener('click', function() {
    if (sectionHar && sectionHar.style.display !== 'none') showInspect();
    else showHar();
  });

  if (navHistory) navHistory.addEventListener('click', function() {
    if (sectionHistory && sectionHistory.style.display !== 'none') showInspect();
    else showHistory();
  });

  if (navSettings) navSettings.addEventListener('click', function() {
    if (settingsPanel && settingsPanel.style.display !== 'none') hideSettings();
    else showSettings();
  });

  if (navScanner) navScanner.addEventListener('click', function() {
    if (sectionScanner && sectionScanner.style.display !== 'none') showInspect();
    else showScanner();
  });

  if (navHelp) navHelp.addEventListener('click', function() {
    if (sectionHelp && sectionHelp.style.display !== 'none') showInspect();
    else showHelp();
  });

  if (navReport) navReport.addEventListener('click', function() {
    if (sectionReport && sectionReport.style.display !== 'none') showInspect();
    else showReport();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // HISTORY PANEL — tab switching
  // ─────────────────────────────────────────────────────────────────────────
  var histTabScans = document.getElementById('hist-tab-scans');
  var histTabHar   = document.getElementById('hist-tab-har');
  var histScansList = document.getElementById('hist-scans-list');
  var histHarList   = document.getElementById('hist-har-list');

  if (histTabScans) histTabScans.addEventListener('click', function() {
    histTabScans.classList.add('hist-tab-active');
    if (histTabHar) histTabHar.classList.remove('hist-tab-active');
    if (histScansList) histScansList.style.display = '';
    if (histHarList)   histHarList.style.display   = 'none';
  });

  if (histTabHar) histTabHar.addEventListener('click', function() {
    histTabHar.classList.add('hist-tab-active');
    if (histTabScans) histTabScans.classList.remove('hist-tab-active');
    if (histHarList)   histHarList.style.display   = '';
    if (histScansList) histScansList.style.display  = 'none';
    // Refresh HAR captures list each time this tab is opened
    if (typeof renderHarHistory === 'function') renderHarHistory();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // MUTATIONOBSERVER: popup.js → this file communication
  // ─────────────────────────────────────────────────────────────────────────
  if (settingsWrapEl) {
    new MutationObserver(function() {
      if (_settingsMutating) return;
      _settingsMutating = true;
      if (settingsWrapEl.open) showSettings();
      setTimeout(function() { _settingsMutating = false; }, 0);
    }).observe(settingsWrapEl, { attributes: true, attributeFilter: ['open'] });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MANUAL CHECK COLLAPSE
  // ─────────────────────────────────────────────────────────────────────────
  function setManualCollapsed(collapsed) {
    if (!manualBody || !manualChevron) return;
    manualBody.style.display = collapsed ? 'none' : '';
    manualChevron.style.transform = collapsed ? '' : 'rotate(90deg)';
    chrome.storage.local.set({ klvManualCollapsed: collapsed });
  }

  if (manualToggleBtn) {
    manualToggleBtn.addEventListener('click', function() {
      setManualCollapsed(manualBody && manualBody.style.display === 'none' ? false : true);
    });
  }

  if (manualWrapEl) {
    new MutationObserver(function() {
      if (_manualMutating) return;
      _manualMutating = true;
      if (manualWrapEl.open) setManualCollapsed(false);
      setTimeout(function() { _manualMutating = false; }, 0);
    }).observe(manualWrapEl, { attributes: true, attributeFilter: ['open'] });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RESTORE PERSISTED STATE ON POPUP OPEN
  // ─────────────────────────────────────────────────────────────────────────
  chrome.storage.local.get(
    ['klvSettingsOpen', 'klvManualCollapsed', 'klvTheme'],
    function(stored) {
      applyTheme(stored && stored.klvTheme === 'light' ? 'light' : 'dark');
      if (stored && stored.klvManualCollapsed === true) setManualCollapsed(true);
      if (stored && stored.klvSettingsOpen) showSettings();
    }
  );

  // ═══════════════════════════════════════════════════════════════════════
  // REPORT PANEL
  // ═══════════════════════════════════════════════════════════════════════
  var REPORT_URL = "https://script.google.com/macros/s/AKfycbwVMYcINKINY8pgAe3qDQsGk3lfnNWw_6IIagLLe8h_EOwgrGEX2VJ3UIrfTSZY9mGU/exec";

  var _rptType  = 'new_error';
  var _rptEvent = null;

  var rptTypeRow = document.getElementById('rpt-type-row');
  var rptDescEl  = document.getElementById('rpt-desc');
  var rptCharEl  = document.getElementById('rpt-char-n');
  var rptSubmit  = document.getElementById('rpt-submit');
  var rptSuccess = document.getElementById('rpt-success');

  if (rptTypeRow) {
    rptTypeRow.addEventListener('click', function(e) {
      var pill = e.target.closest('.rpt-pill');
      if (!pill) return;
      rptTypeRow.querySelectorAll('.rpt-pill').forEach(function(p) {
        p.classList.remove('rpt-pill-active');
      });
      pill.classList.add('rpt-pill-active');
      _rptType = pill.dataset.rtype || 'new_error';
    });
  }

  if (rptDescEl && rptCharEl) {
    rptDescEl.addEventListener('input', function() {
      rptCharEl.textContent = rptDescEl.value.length;
    });
  }

  if (rptSubmit) {
    rptSubmit.addEventListener('click', submitReport);
  }

  function loadReportEvents() {
    var listEl = document.getElementById('rpt-events-list');
    if (!listEl) return;
    listEl.innerHTML = '<div class="rpt-empty">Loading recent events…</div>';
    chrome.storage.local.get(['klvLastScan', 'klvHarHistory'], function(stored) {
      var scan       = stored.klvLastScan;
      var harHistory = stored.klvHarHistory || [];
      var cssEvents  = (scan && scan.data) ? extractEvents(scan) : [];
      var harEvents  = harHistory.slice(0, 5).map(function(h) {
        var domain = '';
        try { domain = new URL(h.url).hostname; } catch(_) { domain = h.url || 'unknown'; }
        return {
          evType:        'har',
          url:           h.url || '',
          formId:        '',
          componentType: '',
          issueLabel:    'HAR capture — ' + domain,
          cssRule:       '',
          sourceFile:    '',
          desc:          (h.entryCount || 0) + ' requests recorded',
          harTs:         h.ts,
        };
      });

      if (!cssEvents.length && !harEvents.length) {
        listEl.innerHTML = '<div class="rpt-empty" id="rpt-no-events">Run a scan or record a HAR session to see recent events here.</div>';
        return;
      }
      renderEventCards(listEl, cssEvents.concat(harEvents));
    });
  }

  function extractEvents(scan) {
    var events = [];
    var data   = scan.data || {};
    var url    = scan.url  || data.url || '';
    var forms  = data.forms || [];

    forms.forEach(function(form) {
      var allIssues = [].concat(
        (form.containerIssues || []).map(function(i) { return { issue: i, where: 'container' }; }),
        (form.buttonResults  || []).flatMap(function(b) {
          return (b.issues || []).map(function(i) { return { issue: i, where: 'button' }; });
        }),
        (form.inputResults   || []).flatMap(function(r) {
          return (r.issues || []).map(function(i) { return { issue: i, where: 'input' }; });
        })
      );

      allIssues.forEach(function(entry) {
        if (events.length >= 5) return;
        var issue = entry.issue;
        var firstSrc = (issue.sources || []).find(function(s) { return !s.crossOrigin; });
        var cssRule  = firstSrc
          ? (firstSrc.selector + ' { ' + (issue.property || '') + ': ' +
             (firstSrc.value || '') + (firstSrc.important ? ' !important' : '') + '; }')
          : '';

        events.push({
          evType:        issue.severity === 'critical' ? 'conflict' : 'warning',
          url:           url,
          formId:        form.formId        || '',
          componentType: form.componentType || 'Signup Form',
          issueLabel:    issue.label        || '',
          cssRule:       cssRule,
          sourceFile:    firstSrc ? (firstSrc.source || '') : '',
          desc:          issue.label        || 'Issue detected',
        });
      });
    });

    return events;
  }

  function renderEventCards(container, events) {
    container.innerHTML = '';
    _rptEvent = null;

    events.forEach(function(ev) {
      var card = document.createElement('div');
      card.className = 'rpt-event-card';
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');

      var typeClass = ev.evType === 'conflict' ? 'rpt-ev-conflict'
                    : ev.evType === 'warning'  ? 'rpt-ev-warning'
                    : ev.evType === 'har'       ? 'rpt-ev-har'
                    :                            'rpt-ev-ok';
      var typeLabel = ev.evType === 'conflict' ? 'Conflict'
                    : ev.evType === 'warning'  ? 'Warning'
                    : ev.evType === 'har'       ? 'HAR Capture'
                    :                            'OK';
      var subLine   = ev.evType === 'har' && ev.harTs
        ? escHtmlRpt(ev.desc) + ' · ' + new Date(ev.harTs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : escHtmlRpt(ev.issueLabel || ev.desc);

      card.innerHTML =
        '<div class="rpt-ev-type ' + typeClass + '">' + typeLabel + '</div>' +
        '<div class="rpt-ev-desc">' + subLine + '</div>';

      function toggle() {
        var already = card.classList.contains('rpt-selected');
        container.querySelectorAll('.rpt-event-card').forEach(function(c) {
          c.classList.remove('rpt-selected');
        });
        if (already) {
          _rptEvent = null;
        } else {
          card.classList.add('rpt-selected');
          _rptEvent = ev;
        }
      }

      card.addEventListener('click', toggle);
      card.addEventListener('keydown', function(e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      });

      container.appendChild(card);
    });
  }

  function submitReport() {
    if (!rptSubmit) return;
    var notes = rptDescEl ? rptDescEl.value.trim() : '';

    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      var tabUrl = (tabs && tabs[0]) ? tabs[0].url || '' : '';

      var payload = {
        verdict:       _rptType,
        siteUrl:       (_rptEvent && _rptEvent.url)           || tabUrl,
        componentType: (_rptEvent && _rptEvent.componentType) || '',
        formId:        (_rptEvent && _rptEvent.formId)        || '',
        issueLabel:    (_rptEvent && _rptEvent.issueLabel)    || '',
        cssRule:       (_rptEvent && _rptEvent.cssRule)       || '',
        sourceFile:    (_rptEvent && _rptEvent.sourceFile)    || '',
        comment:       notes,
        source:        'report',
        timestamp:     new Date().toISOString(),
      };

      rptSubmit.disabled    = true;
      rptSubmit.textContent = 'Submitting…';

      fetch(REPORT_URL, {
        method:   'POST',
        redirect: 'follow',
        headers:  { 'Content-Type': 'text/plain' },
        body:     JSON.stringify(payload),
      })
      .then(function() {
        rptSubmit.style.display = 'none';
        if (rptSuccess) rptSuccess.style.display = 'block';
        if (rptDescEl) rptDescEl.value = '';
        if (rptCharEl) rptCharEl.textContent = '0';
        _rptEvent = null;

        setTimeout(function() {
          rptSubmit.style.display   = '';
          rptSubmit.disabled        = false;
          rptSubmit.textContent     = 'Submit report';
          if (rptSuccess) rptSuccess.style.display = 'none';
          var listEl = document.getElementById('rpt-events-list');
          if (listEl) listEl.querySelectorAll('.rpt-event-card').forEach(function(c) {
            c.classList.remove('rpt-selected');
          });
        }, 4000);
      })
      .catch(function(err) {
        console.error('[Report] Submit failed:', err);
        rptSubmit.disabled    = false;
        rptSubmit.textContent = 'Submit report';
      });
    });
  }

  function escHtmlRpt(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

})();
