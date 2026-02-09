/* =============================================================================
  /src/js/scripts.js
  ------------------------------------------------------------------------------
  Global JS for Pasta Shapes (mobile-first behaviors)

  UPDATE IN THIS REVISION
  - Home Search results: show ALL matches (no "Next 10" pagination)
  - Typing "r" shows every pasta that starts with "r"
  - Hide/remove the paging control on the homepage search results

  Other behaviors preserved:
  - Hamburger drawer toggle
  - Rotator sync + anti-flash (preload/decode, fade swap)
  - Table-based filtering and count messaging

  This file is intentionally heavily commented for future-proofing.
============================================================================= */

(function () {
  "use strict";

  /* ---------------------------------------------------------------------------
    Utilities
  --------------------------------------------------------------------------- */
  function $(sel, root = document) { return root.querySelector(sel); }
  function $all(sel, root = document) { return Array.from(root.querySelectorAll(sel)); }

  function toCsvList(str) {
    if (!str) return [];
    return String(str).split(",").map(s => s.trim()).filter(Boolean);
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  /**
   * Preload an image URL and attempt to decode it (where supported).
   * Returns a Promise that resolves when the image is ready-ish to paint.
   */
  function preloadAndDecode(url) {
    return new Promise((resolve) => {
      if (!url) return resolve();

      const img = new Image();
      img.decoding = "async";
      img.loading = "eager";

      img.onload = async () => {
        try {
          if (typeof img.decode === "function") await img.decode();
        } catch (_) { /* ignore */ }
        resolve();
      };

      img.onerror = () => resolve();
      img.src = url;
    });
  }

  /* ---------------------------------------------------------------------------
    Mobile hamburger / drawer toggle
  --------------------------------------------------------------------------- */
  function initHamburgerNav() {
    const btn = $(".nav-toggle");
    if (!btn) return;

    const controlsId = btn.getAttribute("aria-controls");
    const drawer = (controlsId && document.getElementById(controlsId)) || $(".nav-drawer");
    if (!drawer) return;

    if (!btn.hasAttribute("aria-expanded")) {
      btn.setAttribute("aria-expanded", "false");
    }

    function isOpen() { return btn.getAttribute("aria-expanded") === "true"; }

    function setOpen(open) {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      drawer.hidden = !open;
      document.body.classList.toggle("nav-open", open);
    }

    setOpen(!drawer.hidden);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      setOpen(!isOpen());
    });

    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!isOpen()) return;
      setOpen(false);
      btn.focus();
    });

    document.addEventListener("click", (e) => {
      if (!isOpen()) return;
      const target = e.target;
      if (btn.contains(target)) return;
      if (drawer.contains(target)) return;
      setOpen(false);
    });
  }

  /* ---------------------------------------------------------------------------
    Rotator groups (synchronized placeholder + icon) with anti-flash swap
  --------------------------------------------------------------------------- */
  function initRotators() {
    const groups = new Map();

    $all("[data-rotator-group]").forEach((el) => {
      const groupName = el.getAttribute("data-rotator-group");
      if (!groupName) return;
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName).push(el);
    });

    groups.forEach((elements) => {
      const placeholderEl = elements.find(el => el.getAttribute("data-rotator-role") === "placeholder");
      const iconEl = elements.find(el => el.getAttribute("data-rotator-role") === "icon");

      const names =
        toCsvList((placeholderEl && placeholderEl.getAttribute("data-rotator-names")) ||
                  (iconEl && iconEl.getAttribute("data-rotator-names")) || "");

      if (!names.length) return;

      const icons = toCsvList(iconEl ? iconEl.getAttribute("data-rotator-icons") : "");

      const intervalMsRaw =
        (placeholderEl && placeholderEl.getAttribute("data-rotate-interval")) ||
        (iconEl && iconEl.getAttribute("data-rotate-interval")) ||
        "2500";
      const intervalMs = clamp(parseInt(intervalMsRaw, 10) || 2500, 800, 20000);

      const fadeRaw = iconEl ? iconEl.getAttribute("data-rotate-fade") : "240";
      const fadeMs = clamp(parseInt(fadeRaw, 10) || 240, 0, 2000);

      const iconReady = new Map();
      if (icons.length) {
        icons.forEach((u) => iconReady.set(u, preloadAndDecode(u)));
      }

      let idx = 0;
      let isAnimating = false;

      async function applyIndex(i) {
        const safeI = ((i % names.length) + names.length) % names.length;
        const name = names[safeI];
        const iconSrc = (icons.length && iconEl) ? icons[safeI % icons.length] : null;

        // No icon? Just update placeholder.
        if (!iconEl || !iconSrc) {
          if (placeholderEl && placeholderEl.tagName === "INPUT") {
            placeholderEl.placeholder = `Start typing - e.g., ${name}`;
          }
          return;
        }

        if (isAnimating) return;
        isAnimating = true;

        if (fadeMs > 0) iconEl.classList.add("is-fading");
        if (fadeMs > 0) await new Promise(r => window.setTimeout(r, fadeMs));

        const readyPromise = iconReady.get(iconSrc);
        if (readyPromise) {
          try { await readyPromise; } catch (_) { /* ignore */ }
        }

        // Commit moment: swap icon + placeholder together
        iconEl.src = iconSrc;
        if (placeholderEl && placeholderEl.tagName === "INPUT") {
          placeholderEl.placeholder = `Start typing - e.g., ${name}`;
        }

        window.requestAnimationFrame(() => {
          iconEl.classList.remove("is-fading");
          isAnimating = false;
        });
      }

      applyIndex(idx);

      window.setInterval(() => {
        idx = (idx + 1) % names.length;
        applyIndex(idx);
      }, intervalMs);
    });
  }

  /* ---------------------------------------------------------------------------
    Home search filtering (table-based)
    ---------------------------------------------------------------------------
    REQUIRED BEHAVIOR (per your request)
    - Show ALL matches on the homepage
    - No "Next 10" paging link at all
    - Typing "r" should show every pasta whose NAME starts with "r"
      (still allows secondary matches by contains - after prefix group)
  --------------------------------------------------------------------------- */
  function initHomeSearch() {
    const input = $("#pasta-q");
    const resultsPanel = $("#home-results-panel");
    const identifyCard = $("#home-identify-card");
    const tbody = $("#pasta-results-body");
    const countEl = $("#pasta-search-count");
    const toggleBtn = $("#pasta-toggle-all");

    if (!input || !resultsPanel || !tbody) return;

    const rows = $all("tr.data-row", tbody);

    // Ensure the paging control never appears (even if present in HTML)
    if (toggleBtn) {
      toggleBtn.hidden = true;
      // Defensive: prevent default if something else unhides it
      toggleBtn.addEventListener("click", (e) => e.preventDefault());
    }

    function setSearching(on) {
      document.body.classList.toggle("is-searching", on);
      resultsPanel.hidden = !on;
      if (identifyCard) identifyCard.hidden = on;
    }

    function normalize(s) {
      return String(s || "").toLowerCase().trim();
    }

    function matchRow(row, qNorm) {
      // Prefix match by name is the primary behavior
      const name = normalize(row.getAttribute("data-name") || "");
      if (name.startsWith(qNorm)) return { ok: true, score: 0 };

      // Secondary match: anywhere in name + aliases/synonyms
      const hay = normalize(row.getAttribute("data-search") || "");
      if (hay.includes(qNorm)) return { ok: true, score: 1 };

      return { ok: false, score: 999 };
    }

    function updateUI() {
      const q = normalize(input.value);

      if (!q) {
        setSearching(false);

        // Hide everything until typing
        rows.forEach(r => { r.hidden = true; });

        if (countEl) countEl.textContent = "Start typing to see matches.";
        if (toggleBtn) toggleBtn.hidden = true;
        return;
      }

      setSearching(true);

      const matches = [];
      rows.forEach((row) => {
        const res = matchRow(row, q);
        if (res.ok) {
          matches.push({
            row,
            score: res.score,
            name: normalize(row.getAttribute("data-name"))
          });
        }
      });

      // Sort: prefix matches first, then alphabetical within score bucket
      matches.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.name.localeCompare(b.name);
      });

      // Hide all then show ALL matches
      rows.forEach(r => { r.hidden = true; });
      matches.forEach(m => { m.row.hidden = false; });

      // Count copy: no paging language anymore
      if (countEl) {
        if (matches.length === 0) countEl.textContent = "No matches.";
        else countEl.textContent = `${matches.length} shown`;
      }

      if (toggleBtn) toggleBtn.hidden = true;
    }

    // Hide all rows initially
    rows.forEach(r => { r.hidden = true; });

    input.addEventListener("input", updateUI);

    // Run once (supports prefilled query later if you add it)
    updateUI();
  }

  /* ---------------------------------------------------------------------------
    Boot
  --------------------------------------------------------------------------- */
  document.addEventListener("DOMContentLoaded", () => {
    initHamburgerNav();
    initRotators();
    initHomeSearch();
  });

})();
