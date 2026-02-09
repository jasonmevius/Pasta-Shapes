/* =============================================================================
  /src/js/scripts.js
  ------------------------------------------------------------------------------
  Global JS for Pasta Shapes (mobile-first behaviors)

  UPDATE IN THIS REVISION
  - Fix rotator "flash" / jarring swap:
    - Preload + decode icons
    - Fade out -> decode next -> swap -> fade in
    - Update placeholder text at the same moment as the icon swap for better sync

  Notes
  - Hamburger + search behavior preserved.
  - Heavily commented for future-proofing.
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
        // decode() helps prevent "flash" / partially decoded frames on swap
        // Some browsers (or cross-origin situations) may reject - safe to ignore.
        try {
          if (typeof img.decode === "function") await img.decode();
        } catch (_) { /* ignore */ }
        resolve();
      };

      img.onerror = () => resolve(); // fail open

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
    Rotator groups (synchronized placeholder + icon)
    ---------------------------------------------------------------------------
    Fixing the "flash" requires:
    - preloading + decoding all icon URLs
    - swapping src only after decode (while fully faded out)
    - syncing placeholder update to the same commit moment as the icon swap
  --------------------------------------------------------------------------- */
  function initRotators() {
    const groups = new Map();

    // Collect all rotator elements by group name
    $all("[data-rotator-group]").forEach((el) => {
      const groupName = el.getAttribute("data-rotator-group");
      if (!groupName) return;
      if (!groups.has(groupName)) groups.set(groupName, []);
      groups.get(groupName).push(el);
    });

    groups.forEach((elements) => {
      const placeholderEl = elements.find(el => el.getAttribute("data-rotator-role") === "placeholder");
      const iconEl = elements.find(el => el.getAttribute("data-rotator-role") === "icon");

      // Determine list of names
      const names =
        toCsvList((placeholderEl && placeholderEl.getAttribute("data-rotator-names")) ||
                  (iconEl && iconEl.getAttribute("data-rotator-names")) || "");

      if (!names.length) return;

      // Determine icons (optional)
      const icons = toCsvList(iconEl ? iconEl.getAttribute("data-rotator-icons") : "");

      // Interval + fade
      const intervalMsRaw =
        (placeholderEl && placeholderEl.getAttribute("data-rotate-interval")) ||
        (iconEl && iconEl.getAttribute("data-rotate-interval")) ||
        "2500";
      const intervalMs = clamp(parseInt(intervalMsRaw, 10) || 2500, 800, 20000);

      const fadeRaw = iconEl ? iconEl.getAttribute("data-rotate-fade") : "240";
      const fadeMs = clamp(parseInt(fadeRaw, 10) || 240, 0, 2000);

      // Preload/decode all icons up-front (best effort).
      // This dramatically reduces flicker on mobile Safari.
      const iconReady = new Map();
      if (icons.length) {
        icons.forEach((u) => {
          iconReady.set(u, preloadAndDecode(u));
        });
      }

      let idx = 0;
      let isAnimating = false;

      /**
       * Commit updates for a given index.
       * - If we have icons: fade out -> wait decode -> swap -> fade in
       * - Placeholder updates occur at the same commit moment as icon swap
       */
      async function applyIndex(i) {
        const safeI = ((i % names.length) + names.length) % names.length;
        const name = names[safeI];
        const iconSrc = (icons.length && iconEl) ? icons[safeI % icons.length] : null;

        // If no icon element, just update placeholder immediately
        if (!iconEl || !iconSrc) {
          if (placeholderEl && placeholderEl.tagName === "INPUT") {
            placeholderEl.placeholder = `Start typing - e.g., ${name}`;
          }
          return;
        }

        // Prevent overlapping animations if timers drift or tab resumes
        if (isAnimating) return;
        isAnimating = true;

        // Start fade-out
        if (fadeMs > 0) iconEl.classList.add("is-fading");

        // Wait until we're fully faded out (or immediately if fade disabled)
        if (fadeMs > 0) {
          await new Promise(r => window.setTimeout(r, fadeMs));
        }

        // Ensure next icon is decoded before swap (best effort)
        const readyPromise = iconReady.get(iconSrc);
        if (readyPromise) {
          try { await readyPromise; } catch (_) { /* ignore */ }
        }

        // COMMIT MOMENT: swap icon + update placeholder together
        iconEl.src = iconSrc;

        if (placeholderEl && placeholderEl.tagName === "INPUT") {
          placeholderEl.placeholder = `Start typing - e.g., ${name}`;
        }

        // Fade back in on the next frame to avoid a paint "flash"
        window.requestAnimationFrame(() => {
          iconEl.classList.remove("is-fading");
          isAnimating = false;
        });
      }

      // Initialize immediately
      applyIndex(idx);

      // One timer per group
      window.setInterval(() => {
        idx = (idx + 1) % names.length;
        applyIndex(idx);
      }, intervalMs);
    });
  }

  /* ---------------------------------------------------------------------------
    Home search filtering (table-based)
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
    const PAGE_SIZE = 10;
    let page = 1;

    function setSearching(on) {
      document.body.classList.toggle("is-searching", on);
      resultsPanel.hidden = !on;
      if (identifyCard) identifyCard.hidden = on;
    }

    function normalize(s) {
      return String(s || "").toLowerCase().trim();
    }

    function matchRow(row, qNorm) {
      const name = normalize(row.getAttribute("data-name") || "");
      if (name.startsWith(qNorm)) return { ok: true, score: 0 };

      const hay = normalize(row.getAttribute("data-search") || "");
      if (hay.includes(qNorm)) return { ok: true, score: 1 };

      return { ok: false, score: 999 };
    }

    function updateUI() {
      const q = normalize(input.value);

      if (!q) {
        setSearching(false);
        page = 1;
        rows.forEach(r => { r.hidden = true; });
        if (toggleBtn) toggleBtn.hidden = true;
        if (countEl) countEl.textContent = "Start typing to see matches.";
        return;
      }

      setSearching(true);

      const matches = [];
      rows.forEach((row) => {
        const res = matchRow(row, q);
        if (res.ok) {
          matches.push({ row, score: res.score, name: normalize(row.getAttribute("data-name")) });
        }
      });

      matches.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.name.localeCompare(b.name);
      });

      const total = matches.length;
      const visibleCount = Math.min(total, page * PAGE_SIZE);

      rows.forEach(r => { r.hidden = true; });
      matches.slice(0, visibleCount).forEach(m => { m.row.hidden = false; });

      if (countEl) {
        const more = total - visibleCount;
        if (total === 0) countEl.textContent = "No matches.";
        else if (more > 0) countEl.textContent = `${visibleCount} shown - ${more} more`;
        else countEl.textContent = `${total} shown`;
      }

      if (toggleBtn) {
        const more = total - visibleCount;
        toggleBtn.hidden = !(more > 0);
        toggleBtn.textContent = more > 0 ? `Next ${Math.min(PAGE_SIZE, more)}` : `Next ${PAGE_SIZE}`;
      }
    }

    rows.forEach(r => { r.hidden = true; });

    input.addEventListener("input", () => {
      page = 1;
      updateUI();
    });

    if (toggleBtn) {
      toggleBtn.addEventListener("click", (e) => {
        e.preventDefault();
        page += 1;
        updateUI();
      });
    }

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
