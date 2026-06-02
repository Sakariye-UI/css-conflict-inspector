# CSS Conflict Inspector — Changelog

---

## v2.0.0 — 2026-06-02

### New: Find Source button
**Files:** `content.js`, `popup.js`, `popup.css`

Added a **🔍 Find Source** button alongside Preview Fix on every CSS issue card. When clicked, it runs a stylesheet disable-test loop in the background (body hidden to prevent flicker) — it disables each non-Klaviyo stylesheet one at a time and checks if the conflicting property's computed value changes. If it does, that sheet is confirmed as the culprit. Shows the exact stylesheet filename and the winning CSS rule + selector inline in the panel.

- Cross-origin sheets that can't be tested are flagged as a warning
- Result panel appears below the issue header after confirmation
- Button turns green when a conflict is confirmed

**To undo:** Remove the `findSource` message handler block in `content.js` (the `if (request.action === "findSource")` block), remove the `findSourceBtn` variable and its render in `popup.js`, remove the `async function findSource(btn)` function in `popup.js`, and remove the `.btn-find-source` and `.source-result` CSS blocks in `popup.css`.

---

### Changed: Preview Fix now covers overlapping element issues
**File:** `content.js`

The "Overlapping element covering form" issue previously had `fixId: null`. It now registers a fix via `_regFix(topEl, "pointer-events-off")`. Preview Fix sets `pointer-events: none` on the blocking element so you can confirm it's intercepting clicks.

Added synthetic property keys to `_FIX_VALUES`:
- `"pointer-events-off": "none"` — for overlapping elements
- `"outline-off": "none"` — for focus-visible ring
- `"box-shadow-off": "none"` — for focus-visible ring

`toggleFix` updated to strip the `-off` suffix and apply the real CSS property name.

**To undo:** Revert `fixId: null` and remove `fixSelector` on the overlapping element issue. Remove the three synthetic keys from `_FIX_VALUES`. Revert `toggleFix` to the original single-line `fix.el.style.setProperty(fix.property, goodVal, "important")`.

---

### Changed: Preview Fix now covers button style conflict issues
**File:** `content.js`

Button background/color override issues and the focus-visible ring issue previously had `fixId: null`. They now call `_regFix(btn, kebab)` and `_regFix(btn, prop === "outline" ? "outline-off" : "box-shadow-off")` respectively, so both Preview Fix and Find Source appear.

**To undo:** Revert `fixId: null` and remove `fixSelector` from the button style issues in `checkButtonStyleConflicts_single` and `checkFocusVisibleOutline`.

---

### Changed: Customer message format
**File:** `popup.js` — `buildCustomerMessage()` and `renderCustomerMessage()`

Rewrote both the plain-text (copy) and HTML preview versions of the customer message to match a shorter, more direct tone:

- **Before:** Multi-section breakdown with "What's wrong / Impact / What to do / Suggested fix" headers
- **After:** Short opener, "Support is limited when it comes to custom CSS/theme-level changes" framing, issue listed as a single heading + explain sentence, fenced code block for the conflicting CSS rule, "Source: filename" line, short closing

Also added `msg-code-block`, `msg-issue-explain`, and `msg-source-line` CSS classes in `popup.css`.

**To undo:** Restore the previous `buildCustomerMessage` and `renderCustomerMessage` function bodies and remove the three new CSS classes.

---

### Changed: Element selector removed from form card header
**File:** `popup.js`

The truncated element path (e.g. `div.needsclick.kl-private-reset-c…`) was showing in the card header chip next to the form name and issue count. Removed the `<span class="form-tag">` from both render paths (full scan and pick mode). The selector still appears inside issue detail rows.

**To undo:** Add back `<span class="form-tag">${escHtml(form.element)}</span>` inside the `.form-header-right` div in both `renderFormCard` and the pick-mode render path.

---

### Changed: Button sizing — Preview Fix and Find Source
**File:** `popup.css`

Both `.btn-preview-fix` and `.btn-find-source` now use `height: 20px; padding: 0 8px; box-sizing: border-box` instead of `padding: 2px 8px; line-height: 1.6` to prevent emoji glyph size differences from making the buttons appear different heights.

**To undo:** Revert both button rules to `padding: 2px 8px; line-height: 1.6` and remove `height: 20px; box-sizing: border-box`.

---

### Changed: Version bumped to 2.0.0
**Files:** `manifest.json`, `popup.html`, `background.js`

- `manifest.json`: `"version": "1.8.6"` → `"version": "2.0.0"`
- `popup.html`: `Klaviyo · v1.8.0` → `Klaviyo · v2.0.0`
- `background.js`: `"version": "1.8.0"` → `"version": "2.0.0"`

**To undo:** Revert the three version strings above.

---

## Previous version: v1.8.6
To fully revert to v1.8.6, check out the previous commit on GitHub:
```
git checkout 2e73661
```
