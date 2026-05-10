// background.js — service worker
// Opens the popup after a pick-mode element is selected,
// and handles privileged fetches (geo-ip, etc.) that need CORS bypass.

// ── Force Open with Reload ────────────────────────────────────────────────────
// Called only when the quick (no-reload) attempt in the popup failed to show
// the form — meaning Klaviyo's in-memory state is blocking it.
// Runs reload → wait → openForm in the background so the popup closing
// (due to tab navigation) doesn't interrupt the flow.
// Progress + final result are stored in chrome.storage.local under
// "klvForceOverrideResult" so the popup can display them on next open.

async function forceOpenWithReload(tabId, formId, variationId) {
  const store = (status, done, ok, detail) =>
    chrome.storage.local.set({
      klvForceOverrideResult: { formId, variationId, status, done, ok, detail, ts: Date.now() }
    });

  try {
    // Step 1: Clear Klaviyo localStorage BEFORE the reload so the SDK inits clean
    const preClean = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: () => {
        const removed = [];
        Object.keys(localStorage)
          .filter(k => k.startsWith("__klv") || k.startsWith("klaviyo") ||
                       k.startsWith("__kla") || k.startsWith("klv_") || k.startsWith("_klv"))
          .forEach(k => { localStorage.removeItem(k); removed.push(k); });
        return removed;
      },
    }).catch(() => null);

    const cleared = preClean?.[0]?.result || [];
    const clearedNote = cleared.length
      ? `Cleared ${cleared.length} localStorage key${cleared.length > 1 ? "s" : ""}.`
      : "No Klaviyo localStorage keys found.";

    await store("Reloading page…", false, null, clearedNote);

    // Step 2: Reload the tab
    await chrome.tabs.reload(tabId);

    // Wait for the tab to finish loading
    await new Promise(resolve => {
      const listener = (id, info) => {
        if (id === tabId && info.status === "complete") {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(resolve, 15000); // safety fallback
    });

    await store("Waiting for Klaviyo SDK…", false, null, clearedNote);

    // Step 3: Wait for Klaviyo SDK to initialise
    await new Promise(r => setTimeout(r, 2500));

    // Step 4: Call openForm (with optional variation filter)
    const openResults = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (id, varId) => {
        if (typeof klaviyo === "undefined") {
          return { error: "Klaviyo not found on this page — is the onsite script installed?" };
        }
        if (varId) {
          const orig = window.fetch;
          window.fetch = async function(url, ...args) {
            const res = await orig.apply(this, [url, ...args]);
            const urlStr = String(url);
            if (urlStr.includes("klaviyo") && (urlStr.includes("form") || urlStr.includes("signup"))) {
              try {
                const clone = res.clone();
                const text = await clone.text();
                const data = JSON.parse(text);
                const filterVariations = (form) => {
                  if (!form || typeof form !== "object") return form;
                  ["versions","variants","variations","form_versions"].forEach(key => {
                    if (Array.isArray(form[key])) {
                      form[key] = form[key].filter(v =>
                        String(v.id) === varId || String(v.version_id) === varId || String(v.versionId) === varId
                      );
                    }
                  });
                  return form;
                };
                const modified = Array.isArray(data) ? data.map(filterVariations) : filterVariations(data);
                return new Response(JSON.stringify(modified), { status: res.status, statusText: res.statusText, headers: res.headers });
              } catch(_) {}
            }
            return res;
          };
          // Auto-restore after 10s — only needed while Klaviyo loads the form config.
          // Without this the patch persists indefinitely on the page.
          setTimeout(() => { if (window.fetch !== orig) window.fetch = orig; }, 10000);
        }
        klaviyo.push(["openForm", id]);
        return { ok: true };
      },
      args: [formId, variationId],
    }).catch(() => null);

    const openResult = openResults?.[0]?.result;
    if (openResult?.error) {
      await store(openResult.error, true, false, clearedNote);
      return;
    }
    if (!openResult?.ok) {
      await store("Could not signal Klaviyo — try refreshing the page.", true, false, clearedNote);
      return;
    }

    await store("Signal sent — checking if the form appeared…", false, null, clearedNote);

    // Step 5: Check if the form actually appeared.
    // Wait a bit longer than usual — flyout forms animate in and may need extra time.
    await new Promise(r => setTimeout(r, 2500));

    const formCheck = await chrome.scripting.executeScript({
      target: { tabId },
      world: "MAIN",
      func: (fid) => {
        const selectors = [
          `[data-testid="${fid}"]`,
          `[data-form-id="${fid}"]`,
          `.klaviyo-form-${fid}`,
          `[id*="${fid}"]`,
          `form[class*="${fid}"]`,
        ];
        // Use computed style — offsetParent is always null for position:fixed elements
        // (flyout/slide-in forms), so we cannot rely on it.
        const isVisible = (el) => {
          if (!el) return false;
          const s = window.getComputedStyle(el);
          if (s.display === "none" || s.visibility === "hidden") return false;
          if (parseFloat(s.opacity) < 0.1) return false;
          const r = el.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        };
        for (const sel of selectors) {
          try {
            if (isVisible(document.querySelector(sel))) return { found: true };
          } catch(_) {}
        }
        // Fallback: any visible Klaviyo form container
        const candidates = document.querySelectorAll('[data-testid], [data-form-id], [class*="klaviyo-form"]');
        for (const el of candidates) {
          if (isVisible(el)) return { found: true };
        }
        return { found: false };
      },
      args: [formId],
    }).catch(() => null);

    const found = formCheck?.[0]?.result?.found;
    if (found) {
      // Store ok:true — when popup reopens it will run detectFormAppeared for the full UI
      await store(`Form ${formId} appeared — open the tool to see results and test it.`, true, true, clearedNote);
    } else {
      await store(
        `⚠ Signal sent but form ${formId} was not detected after reload — it may have targeting or geo rules preventing it from loading.`,
        true, false, clearedNote
      );
    }
  } catch (err) {
    await chrome.storage.local.set({
      klvForceOverrideResult: { formId, variationId, status: `⚠ ${err.message || "Unknown error"}`, done: true, ok: false, ts: Date.now() }
    });
  }
}

// ── HAR Recording ────────────────────────────────────────────────────────────
// Keyed by tabId. Each entry: { startTime, requests: {}, entries: [] }
// requests is a map from requestId → partial HAR entry (filled as events arrive)
const _harSessions = {};

// Build a partial HAR entry when a request starts
function harEntryFromRequest(ev) {
  const req = ev.request || {};
  const headers = Object.entries(req.headers || {}).map(([name, value]) => ({ name, value }));
  return {
    startedDateTime: new Date(ev.wallTime * 1000).toISOString(),
    _requestId: ev.requestId,
    time: 0,
    request: {
      method:      req.method || "GET",
      url:         req.url   || "",
      httpVersion: "HTTP/1.1",
      headers,
      queryString: [],
      cookies:     [],
      headersSize: -1,
      bodySize:    req.postData ? (req.postData.data || "").length : 0,
      postData:    req.postData ? { mimeType: req.postData.mimeType || "", text: req.postData.data || "" } : undefined,
    },
    response: {
      status: 0, statusText: "", httpVersion: "HTTP/1.1",
      headers: [], cookies: [], content: { size: -1, mimeType: "" },
      redirectURL: "", headersSize: -1, bodySize: -1,
    },
    cache: {},
    timings: { send: 0, wait: 0, receive: 0 },
  };
}

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  const session = _harSessions[tabId];
  if (!session) return;

  if (method === "Network.requestWillBeSent") {
    session.requests[params.requestId] = harEntryFromRequest(params);
  }

  if (method === "Network.responseReceived") {
    const entry = session.requests[params.requestId];
    if (!entry) return;
    const resp = params.response || {};
    const respHeaders = Object.entries(resp.headers || {}).map(([name, value]) => ({ name, value }));
    entry.response = {
      status:      resp.status      || 0,
      statusText:  resp.statusText  || "",
      httpVersion: "HTTP/1.1",
      headers:     respHeaders,
      cookies:     [],
      content:     { size: -1, mimeType: resp.mimeType || "" },
      redirectURL: resp.url !== entry.request.url ? (resp.url || "") : "",
      headersSize: -1,
      bodySize:    -1,
    };
  }

  if (method === "Network.loadingFinished") {
    const entry = session.requests[params.requestId];
    if (!entry) return;
    const elapsed = params.timestamp - (entry._startTs || params.timestamp);
    entry.time = Math.round(elapsed * 1000);
    entry.timings = { send: 0, wait: Math.round(elapsed * 1000), receive: 0 };
    session.entries.push(entry);
    delete session.requests[params.requestId];
  }
});

// Detach debugger cleanly if the tab is closed
chrome.tabs.onRemoved.addListener((tabId) => {
  if (_harSessions[tabId]) {
    chrome.debugger.detach({ tabId }).catch(() => {});
    delete _harSessions[tabId];
  }
});

// ── Side panel: tab-specific only ────────────────────────────────────────────
// Disable the panel globally so it doesn't appear on every tab automatically.
// It is enabled per-tab only when the user clicks the extension icon on that tab.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ enabled: false });
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setOptions({ enabled: false });
});

chrome.action.onClicked.addListener((tab) => {
  // IMPORTANT: chrome.sidePanel.open() requires a user gesture context.
  // Chaining it via .then() after setOptions breaks that context — Chrome
  // silently rejects the open call. Both must fire in the same synchronous
  // task so the gesture context is still active when open() runs.
  chrome.sidePanel.setOptions({ tabId: tab.id, enabled: true, path: "popup.html" });
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {

  if (request.action === "openPopup") {
    // Extension now runs as a side panel — enable + open it on the sender's tab.
    // setOptions must run first to ensure the panel is enabled for this tab
    // before sidePanel.open() is called (e.g. when pick mode triggers re-open).
    const tabId = request.tabId || sender?.tab?.id;
    if (tabId) {
      chrome.sidePanel.setOptions({ tabId, enabled: true, path: "popup.html" })
        .then(() => chrome.sidePanel.open({ tabId }))
        .catch(() => {});
    }
    sendResponse({ ok: true });
    return true;
  }

  if (request.action === "forceOpenWithReload") {
    const { tabId, formId, variationId } = request;
    forceOpenWithReload(tabId, formId, variationId);
    sendResponse({ ok: true, running: true });
    return true;
  }

  // ── HAR Recording — start ────────────────────────────────
  if (request.action === "startHarRecording") {
    const { tabId } = request;
    if (_harSessions[tabId]) {
      sendResponse({ ok: false, error: "Already recording on this tab." });
      return true;
    }
    chrome.debugger.attach({ tabId }, "1.3", () => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      chrome.debugger.sendCommand({ tabId }, "Network.enable", {}, () => {
        if (chrome.runtime.lastError) {
          chrome.debugger.detach({ tabId }).catch(() => {});
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        _harSessions[tabId] = { startTime: Date.now(), requests: {}, entries: [] };
        sendResponse({ ok: true });
      });
    });
    return true;
  }

  // ── HAR Recording — stop & export ────────────────────────
  if (request.action === "stopHarRecording") {
    const { tabId } = request;
    const session = _harSessions[tabId];
    if (!session) {
      sendResponse({ ok: false, error: "No active recording on this tab." });
      return true;
    }
    chrome.debugger.detach({ tabId }, () => {
      delete _harSessions[tabId];
      const har = {
        log: {
          version: "1.2",
          creator: { name: "CSS Conflict Inspector", version: "1.8.0" },
          pages: [{
            startedDateTime: new Date(session.startTime).toISOString(),
            id: "page_1",
            title: "Recorded session",
            pageTimings: {},
          }],
          entries: session.entries.map(e => {
            const out = Object.assign({}, e);
            delete out._requestId;
            delete out._startTs;
            return out;
          }),
        }
      };
      sendResponse({ ok: true, har });
    });
    return true;
  }

  // ── Geo-IP fetch ──────────────────────────────────────────
  // Background scripts bypass CORS, so we can fetch Klaviyo's geo-ip endpoint
  // and return the result to the popup.
  if (request.action === "fetchGeoIp") {
    const companyId = request.companyId || "";
    fetch(`https://a.klaviyo.com/forms/api/v3/geo-ip${companyId ? `?company_id=${companyId}` : ""}`)
      .then(r => r.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true; // keep channel open for async response
  }

  // ── Form submit test ──────────────────────────────────────
  // Proxies the Klaviyo subscription POST so we can check if it succeeds.
  if (request.action === "testFormSubmit") {
    const { endpoint, body } = request;
    fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "revision": "2024-10-15",
      },
      body: JSON.stringify(body),
    })
      .then(r => r.json().then(data => ({ status: r.status, data })).catch(() => ({ status: r.status, data: null })))
      .then(result => sendResponse({ ok: result.status >= 200 && result.status < 300, status: result.status, data: result.data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // ── Fetch full forms list ──────────────────────────────────
  // Gets all signup forms for an account via the full-forms API.
  if (request.action === "fetchFullForms") {
    const { companyId } = request;
    fetch(`https://static-forms.klaviyo.com/forms/api/v7/${companyId}/full-forms`, {
      headers: { "Accept": "application/json" }
    })
      .then(r => r.json())
      .then(data => sendResponse({ ok: true, data }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  return true;
});
