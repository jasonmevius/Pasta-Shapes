/* =============================================================================
  /src/js/scripts.js
  ------------------------------------------------------------------------------
  Global, dependency-free JS for Pasta Shapes.

  This file is intentionally heavily commented for future-proofing.

  HOME FIXES IN THIS REVISION
  1) Hamburger drawer now toggles open/close on click
  2) Hamburger ARIA state is kept in sync (aria-expanded)
  3) Home rotator is synchronized (placeholder text + icon share one timer)
  4) Home cards height: handled in CSS (styles.css)

  DESIGN PRINCIPLES
  - Progressive enhancement: site should still work without JS.
  - Defensive selectors: work even if markup changes slightly.
============================================================================= */

(function () {
  "use strict";

  /* ---------------------------------------------------------------------------
    Utilities
  --------------------------------------------------------------------------- */

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function $all(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function toCsvList(str) {
    if (!str) return [];
    return String(str)
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
  }

  function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
  }

  /* ---------------------------------------------------------------------------
    1) Mobile Hamburger / Drawer Toggle
    ---------------------------------------------------------------------------
    Expected patterns:
    - Button has class ".nav-toggle"
    - Drawer has class ".nav-drawer"
    - Preferred: button has aria-controls="<drawerId>"
      and drawer uses id="<drawerId>" and hidden attribute.

    This script supports:
    - aria-controls wiring (best)
    - fallback to first ".nav-drawer" found
  --------------------------------------------------------------------------- */
  function initHamburgerNav() {
    const btn = $(".nav-toggle");
    if (!btn) return;

    // Find drawer via aria-controls first, then fallback to .nav-drawer
    const controlsId = btn.getAttribute("aria-controls");
    const drawer = (controlsId && document.getElementById(controlsId)) || $(".nav-drawer");
    if (!drawer) return;

    // Ensure aria-expanded exists and starts false if not set
    if (!btn.hasAttribute("aria-expanded")) {
      btn.setAttribute("aria-expanded", "false");
    }

    function isOpen() {
      return btn.getAttribute("aria-expanded") === "true";
    }

    function setOpen(open) {
      btn.setAttribute("aria-expanded", open ? "true" : "false");
      drawer.hidden = !open;
      document.body.classList.toggle("nav-open", open);
    }

    // If drawer is currently visible (not hidden), reflect that state
    // This keeps behavior stable if you change HTML defaults.
    setOpen(!drawer.hidden);

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      setOpen(!isOpen());
    });

    // Close drawer on Escape (mobile usability)
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (!isOpen()) return;
      setOpen(false);
      btn.focus();
    });

    // Close drawer when clicking outside (common mobile expectation)
    document.addEventListener("click", (e) => {
      if (!isOpen()) return;
      const target = e.target;
      if (btn.contains(target)) return;
      if (drawer.contains(target)) return;
      setOpen(false);
    });
  }

  /* ---------------------------------------------------------------------------
    2) Rotator Groups (synchronized placeholder + icon)
    ---------------------------------------------------------------------------
    Markup contract (from index.njk):
      - Elements share data-rotator-group="homeHero"
      - Placeholder input:
          data-rotator-role="placeholder"
          data-rotator-names="penne,ravioli,..."
          data-rotate-interval="2500"
      - Icon image:
          data-rotator-role="icon"
          data-rotator-names="same csv"
          data-rotator-icons="https://...,https://..."
          data-rotate-interval="2500"
          data-rotate-fade="240"

    Goal:
      - One timer per group
      - Same index used for placeholder + icon
      - No drift between “name” switching and icon switching
  --------------------------------------------------------------------------- */
  function initRotators() {
    const groups = new Map();

    // Collect all rotator elements by group name
    $all("[data-rotator-group]").forEach((el) => {
      const groupName = el.getAttribute("data-rotator-group");
      if (!groupName) return;

      if (!groups.has(groupName)) {
        groups.set(groupName, []);
      }
      groups.get(groupName).push(el);
    });

    groups.forEach((elements, groupName) => {
      // Identify roles
      const placeholderEl = elements.find(el => el.getAttribute("data-rotator-role") === "placeholder");
      const iconEl = elements.find(el => el.getAttribute("data-rotator-role") === "icon");

      // Determine list of names
      const names =
        toCsvList((placeholderEl && placeholderEl.getAttribute("data-rotator-names")) ||
                  (iconEl && iconEl.getAttribute("data-rotator-names")) || "");

      if (!names.length) return;

      // Determine icons (optional)
      const icons = toCsvList(iconEl ? iconEl.getAttribute("data-rotator-icons") : "");

      // Determine interval + fade
      const intervalMsRaw =
        (placeholderEl && placeholderEl.getAttribute("data-rotate-interval")) ||
        (iconEl && iconEl.getAttribute("data-rotate-interval")) ||
        "2500";
      const intervalMs = clamp(parseInt(intervalMsRaw, 10) || 2500, 800, 20000);

      const fadeRaw = iconEl ? iconEl.getAttribute("data-rotate-fade") : "240";
      const fadeMs = clamp(parseInt(fadeRaw, 10) || 240, 0, 2000);

      let idx = 0;

      // Apply index to all participants
      function applyIndex(i) {
        const safeI = ((i % names.length) + names.length) % names.length;
        const name = names[safeI];

        // Placeholder update
        if (placeholderEl && placeholderEl.tagName === "INPUT") {
          // Keep the “Start typing - e.g., {name}” phrasing consistent
          placeholderEl.placeholder = `Start typing - e.g., ${name}`;
        }

        // Icon update
        if (iconEl && icons.length) {
          const iconSrc = icons[safeI % icons.length];

          // Fade-out / swap / fade-in
          if (fadeMs > 0) iconEl.classList.add("is-fading");

          window.setTimeout(() => {
            iconEl.src = iconSrc;

            // Remove fade after swap
            if (fadeMs > 0) {
              window.setTimeout(() => {
                iconEl.classList.remove("is-fading");
              }, Math.max(50, Math.floor(fadeMs * 0.8)));
            } else {
              iconEl.classList.remove("is-fading");
            }
          }, fadeMs);
        }
      }

      // Initialize immediately to avoid first-tick mismatch
      applyIndex(idx);

      // One timer per group
      window.setInterval(() => {
        idx = (idx + 1) % names.length;
        applyIndex(idx);
      }, intervalMs);
    });
  }

  /* ---------------------------------------------------------------------------
    3) Home Search - show/hide results and filter table
    ---------------------------------------------------------------------------
    Assumes the homepage table is pre-rendered with <tr class="data-row" ...>
    and each row has:
      data-name
      data-search (name + aliases/synonyms)
      data-category
      data-slug

    Behavior:
    - When input is empty: hide results panel, show Identify card, clear filters
    - When typing:
        - body.is-searching enabled
        - show results panel
        - prefix-first matching (startsWith on name)
        - show top 10 matches; allow "Next 10" paging
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

    // State for paging
    const PAGE_SIZE = 10;
    let page = 1;

    function setSearching(on) {
      document.body.classList.toggle("is-searching", on);
      resultsPanel.hidden = !on;

      // Identify card is also hidden by CSS when body.is-searching
      // but we keep it consistent at the DOM level, too.
      if (identifyCard) identifyCard.hidden = on;
    }

    function normalize(s) {
      return String(s || "")
        .toLowerCase()
        .trim();
    }

    function matchRow(row, qNorm) {
      // Name prefix match gets priority and inclusion
      const name = normalize(row.getAttribute("data-name") || "");
      if (name.startsWith(qNorm)) return { ok: true, score: 0 };

      // Fallback: search string contains query
      const hay = normalize(row.getAttribute("data-search") || "");
      if (hay.includes(qNorm)) return { ok: true, score: 1 };

      return { ok: false, score: 999 };
    }

    function updateUI() {
      const q = normalize(input.value);

      if (!q) {
        // Reset
        setSearching(false);
        page = 1;

        rows.forEach(r => { r.hidden = true; });
        if (toggleBtn) toggleBtn.hidden = true;
        if (countEl) countEl.textContent = "Start typing to see matches.";
        return;
      }

      setSearching(true);

      // Filter and sort matches by score then name
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

      // Pagination (Top 10, then Next 10...)
      const total = matches.length;
      const visibleCount = Math.min(total, page * PAGE_SIZE);

      // Hide all first
      rows.forEach(r => { r.hidden = true; });

      // Show the page slice
      matches.slice(0, visibleCount).forEach(m => { m.row.hidden = false; });

      // Update count text
      if (countEl) {
        const more = total - visibleCount;
        if (total === 0) {
          countEl.textContent = "No matches.";
        } else if (more > 0) {
          countEl.textContent = `${visibleCount} shown - ${more} more`;
        } else {
          countEl.textContent = `${total} shown`;
        }
      }

      // Toggle Next 10 button
      if (toggleBtn) {
        const more = total - visibleCount;
        toggleBtn.hidden = !(more > 0);
        toggleBtn.textContent = more > 0 ? `Next ${Math.min(PAGE_SIZE, more)}` : "Next 10";
      }
    }

    // Show none initially (keeps home clean until typing)
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

    // Run once (supports prefilled query param if you add it later)
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
