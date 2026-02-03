// src/js/scripts.js
// ============================================================================
// Global site behaviors:
//
// 1) Recently Viewed (localStorage)
//
// 2) Homepage Search (restaurant-first UX)
//
// KEY UX RULE (per your request)
// - Typing "r" should show pasta names that START with "r".
// - We do NOT show everything containing "r" because that's too noisy.
// - We only fall back to alias/metadata searching if name-prefix produces 0 hits.
//
// WHY THIS VERSION
// - Your results showed "ra" and "raviol" returning "No matches found".
// - That indicates our dependency on data-search/searchBlob is unreliable.
// - This version searches from the DOM (visible name) first, so it cannot drift.
// ============================================================================
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  // =============================================================================
  // Recently viewed helpers (localStorage)
  // =============================================================================
  function readRecents() {
    try {
      return JSON.parse(localStorage.getItem("pasta:recent") || "[]");
    } catch {
      return [];
    }
  }

  function writeRecents(arr) {
    try {
      localStorage.setItem("pasta:recent", JSON.stringify(arr.slice(0, 12)));
    } catch {
      // ignore
    }
  }

  function addRecent(slug) {
    if (!slug) return;
    const cur = readRecents().filter((x) => x !== slug);
    cur.unshift(slug);
    writeRecents(cur);
  }

  // =============================================================================
  // Search page behavior (Homepage)
  // =============================================================================
  function initSearchPage() {
    const input = $("#pasta-q");
    const status = $("#pasta-search-status");
    const list = $("#pasta-results");

    // Only run on pages that have the search + results list.
    if (!input || !status || !list) return;

    // Prevent double-init (safe on bfcache restore)
    if (window.__pastaSearchInit) return;
    window.__pastaSearchInit = true;

    const cards = Array.from(list.querySelectorAll("[data-search]"));
    const originalOrder = cards.slice();

    const recentWrap = $("#recently-viewed-wrap");
    const recentTarget = $("#recently-viewed");

    const note = $("#pasta-results-note");
    const nextBtn = $("#pasta-toggle-all");

    const PAGE_N = 10;
    let visibleLimit = PAGE_N;

    // -------------------------------------------------------------------------
    // Visibility helpers
    // -------------------------------------------------------------------------
    function showEl(el) {
      if (!el) return;
      el.hidden = false;
      el.setAttribute("aria-hidden", "false");
    }

    function hideEl(el) {
      if (!el) return;
      el.hidden = true;
      el.setAttribute("aria-hidden", "true");
    }

    function hideAllCards() {
      for (const c of cards) c.hidden = true;
    }

    // -------------------------------------------------------------------------
    // Normalization
    // -------------------------------------------------------------------------
    function normalize(s) {
      return String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/&/g, "and")
        .replace(/[’']/g, " ")
        .replace(/[^a-z0-9\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function normalizeQuery(s) {
      const q = normalize(s);
      // Collapses spaced-letter inputs like "p e n n e" -> "penne"
      if (/^(?:[a-z0-9]\s+){2,}[a-z0-9]$/.test(q)) return q.replace(/\s+/g, "");
      return q;
    }

    // -------------------------------------------------------------------------
    // Build a reliable per-card search cache from the DOM
    // - nameNorm: normalized visible name (primary)
    // - aliasNorm: normalized "Also:" line + data-search (secondary)
    //
    // This avoids issues where data-search/searchBlob might be missing or stale.
    // -------------------------------------------------------------------------
    const cache = cards.map((card) => {
      const nameEl = card.querySelector(".result-name");
      const alsoEl = card.querySelector(".result-also");
      const descEl = card.querySelector(".result-desc");

      const nameText = nameEl ? nameEl.textContent : "";
      const alsoText = alsoEl ? alsoEl.textContent : "";
      const descText = descEl ? descEl.textContent : "";

      const dataSearch = card.getAttribute("data-search") || "";
      const slug = card.getAttribute("data-slug") || "";

      const nameNorm = normalize(nameText);
      const aliasNorm = normalize([alsoText, descText, dataSearch, slug].join(" "));

      return { card, nameNorm, aliasNorm, nameText };
    });

    function reorderCards(order) {
      for (const item of order) list.appendChild(item.card);
    }

    function setStatusText(text) {
      status.textContent = text || "";
    }

    function countShown(items) {
      let n = 0;
      for (const it of items) if (!it.card.hidden) n++;
      return n;
    }

    function setNoteAndNext(matchCount, shownCount) {
      if (!note || !nextBtn) return;

      const remaining = Math.max(0, matchCount - shownCount);

      if (matchCount === 0) {
        note.textContent = "";
        nextBtn.textContent = "";
        hideEl(nextBtn);
        return;
      }

      if (remaining <= 0) {
        note.textContent = `Showing ${shownCount} of ${matchCount}`;
        nextBtn.textContent = "";
        hideEl(nextBtn);
        return;
      }

      note.textContent = `Showing ${shownCount} of ${matchCount} - ${remaining} more`;

      const nextChunk = Math.min(PAGE_N, remaining);
      nextBtn.textContent = `Next ${nextChunk} (${remaining} more)`;
      showEl(nextBtn);
    }

    // -------------------------------------------------------------------------
    // Core matching
    // -------------------------------------------------------------------------
    function filterNow() {
      const raw = input.value || "";
      const q = normalizeQuery(raw);

      // Option B: 0 chars -> show nothing
      if (!q) {
        reorderCards(cache);
        hideAllCards();
        setStatusText("Start typing to see matches.");
        if (note) note.textContent = "";
        if (nextBtn) {
          nextBtn.textContent = "";
          hideEl(nextBtn);
        }
        visibleLimit = PAGE_N;
        return;
      }

      // STEP 1 (primary): Name-prefix match ONLY
      // - This is the restaurant-friendly behavior you want.
      // - "r" shows only names starting with r.
      const nameMatches = [];
      const nonNameMatches = [];

      for (const it of cache) {
        if (it.nameNorm && it.nameNorm.startsWith(q)) nameMatches.push(it);
        else nonNameMatches.push(it);
      }

      // If we have name-prefix matches, show ONLY those (sorted by shortest name first)
      if (nameMatches.length) {
        nameMatches.sort((a, b) => a.nameNorm.length - b.nameNorm.length || a.nameNorm.localeCompare(b.nameNorm));

        reorderCards(nameMatches.concat(nonNameMatches));

        const requestedShown = Math.min(visibleLimit, nameMatches.length);
        for (let i = 0; i < nameMatches.length; i++) nameMatches[i].card.hidden = i >= requestedShown;
        for (const it of nonNameMatches) it.card.hidden = true;

        const actualShown = countShown(nameMatches);

        setStatusText(`${actualShown} of ${nameMatches.length} matches (name starts with "${q}")`);
        setNoteAndNext(nameMatches.length, actualShown);
        return;
      }

      // STEP 2 (fallback): Alias/metadata includes
      // - This catches cases like misspellings, synonyms, or alternate names.
      const aliasMatches = [];
      const nonAliasMatches = [];

      for (const it of cache) {
        if (it.aliasNorm && it.aliasNorm.includes(q)) aliasMatches.push(it);
        else nonAliasMatches.push(it);
      }

      if (!aliasMatches.length) {
        reorderCards(cache);
        hideAllCards();
        setStatusText("No matches found.");
        if (note) note.textContent = "";
        if (nextBtn) {
          nextBtn.textContent = "";
          hideEl(nextBtn);
        }
        return;
      }

      aliasMatches.sort((a, b) => a.aliasNorm.length - b.aliasNorm.length || a.nameNorm.localeCompare(b.nameNorm));
      reorderCards(aliasMatches.concat(nonAliasMatches));

      const requestedShown = Math.min(visibleLimit, aliasMatches.length);
      for (let i = 0; i < aliasMatches.length; i++) aliasMatches[i].card.hidden = i >= requestedShown;
      for (const it of nonAliasMatches) it.card.hidden = true;

      const actualShown = countShown(aliasMatches);

      setStatusText(`${actualShown} of ${aliasMatches.length} matches (aliases and metadata)`);
      setNoteAndNext(aliasMatches.length, actualShown);
    }

    // -------------------------------------------------------------------------
    // Throttle filtering to animation frames (keeps typing snappy)
    // -------------------------------------------------------------------------
    let rafPending = false;
    function requestFilter() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        try {
          filterNow();
        } catch (err) {
          setStatusText(`Search error: ${err && err.message ? err.message : String(err)}`);
        }
      });
    }

    // Paging button
    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        e.preventDefault();
        visibleLimit += PAGE_N;
        requestFilter();
      });

      nextBtn.textContent = "";
      hideEl(nextBtn);
    }

    // Attach input listener
    input.addEventListener("input", () => {
      visibleLimit = PAGE_N;
      requestFilter();
    });

    // Record recents on click
    list.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-recent]");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      const m = href.match(/\/pasta\/([^\/]+)\//);
      if (m && m[1]) addRecent(m[1]);
    });

    // Render recents as comma-delimited links
    function renderRecents() {
      if (!recentWrap || !recentTarget) return;

      const slugs = readRecents();
      if (!slugs.length) {
        recentWrap.hidden = true;
        return;
      }

      // Build a map from slug to card for reliable linking
      const bySlug = new Map(cache.map((it) => [it.card.getAttribute("data-slug"), it.card]));
      const items = slugs
        .map((s) => bySlug.get(s))
        .filter(Boolean)
        .slice(0, 5);

      if (!items.length) {
        recentWrap.hidden = true;
        return;
      }

      recentTarget.innerHTML = "";
      const frag = document.createDocumentFragment();

      items.forEach((card, idx) => {
        const link = card.querySelector("a[href]");
        const name = card.querySelector(".result-name");
        if (!link) return;

        if (idx > 0) frag.appendChild(document.createTextNode(", "));

        const a = document.createElement("a");
        a.href = link.getAttribute("href");
        a.textContent = name ? name.textContent.trim() : a.href;
        frag.appendChild(a);
      });

      recentTarget.appendChild(frag);
      recentWrap.hidden = false;
    }

    // Initial state
    reorderCards(cache);
    hideAllCards();
    setStatusText("Start typing to see matches.");
    if (note) note.textContent = "";
    if (nextBtn) {
      nextBtn.textContent = "";
      hideEl(nextBtn);
    }
    renderRecents();
  }

  // =============================================================================
  // Detail page: store recent on load
  // =============================================================================
  function initDetailPage() {
    const path = window.location.pathname || "";
    const m = path.match(/^\/pasta\/([^\/]+)\/?$/);
    if (m && m[1]) addRecent(m[1]);
  }

  // =============================================================================
  // Init (robust)
  // =============================================================================
  function initAll() {
    initSearchPage();
    initDetailPage();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAll, { once: true });
  } else {
    initAll();
  }

  window.addEventListener("pageshow", (e) => {
    if (e && e.persisted) initAll();
  });
})();
