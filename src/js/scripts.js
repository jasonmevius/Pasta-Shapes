// src/js/scripts.js
// ============================================================================
// Global site behaviors:
//
// 1) Recently Viewed (localStorage)
//
// 2) Homepage Search (restaurant-first UX)
//
// KEY UX RULES
// - 0 chars: show nothing
// - 1+ chars: show pasta names that START with the query (name-prefix match)
// - If 0 name-prefix matches: fallback to alias/metadata includes
//
// THUMBNAIL FIX
// - On initial page load, we hide all cards (Option B).
// - Thumbnails use <img loading="lazy">.
// - Some browsers won't reliably kick off lazy-load when elements are revealed
//   later, so you see grey boxes.
// - We "prime" thumbnails for visible cards by setting loading="eager" and
//   re-assigning src once.
//
// IMPORTANT
// - No inline CSS.
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

    if (!input || !status || !list) return;

    // Prevent double-init
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
    // Build a per-card search cache from the DOM
    // - nameNorm: normalized visible name (primary)
    // - aliasNorm: normalized "Also:" line + data-search + description + slug
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
    // Thumbnail priming (fixes grey boxes after reveal)
    // -------------------------------------------------------------------------
    function primeThumbs(items, max = 12) {
      // We only need to prime a handful (visible results).
      const n = Math.min(max, items.length);
      for (let i = 0; i < n; i++) {
        const card = items[i].card;
        const img = card.querySelector(".thumb img");
        if (!img) continue;

        // If the image was hidden at load, native lazy-loading can be flaky.
        // Force visible results to load immediately.
        try {
          img.loading = "eager";

          // If the browser hasn't started fetching yet, re-assign src.
          // This is a safe no-op if it already loaded.
          if (!img.complete || img.naturalWidth === 0) {
            const src = img.getAttribute("src");
            if (src) img.src = src;
          }
        } catch {
          // ignore
        }
      }
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
      const nameMatches = [];
      const nonNameMatches = [];

      for (const it of cache) {
        if (it.nameNorm && it.nameNorm.startsWith(q)) nameMatches.push(it);
        else nonNameMatches.push(it);
      }

      if (nameMatches.length) {
        // Shorter name wins, then alpha
        nameMatches.sort(
          (a, b) => a.nameNorm.length - b.nameNorm.length || a.nameNorm.localeCompare(b.nameNorm)
        );

        reorderCards(nameMatches.concat(nonNameMatches));

        const requestedShown = Math.min(visibleLimit, nameMatches.length);
        for (let i = 0; i < nameMatches.length; i++) nameMatches[i].card.hidden = i >= requestedShown;
        for (const it of nonNameMatches) it.card.hidden = true;

        const actualShown = countShown(nameMatches);

        // Prime thumbs for visible results
        primeThumbs(nameMatches);

        setStatusText(`${actualShown} of ${nameMatches.length} matches (name starts with "${q}")`);
        setNoteAndNext(nameMatches.length, actualShown);
        return;
      }

      // STEP 2 (fallback): Alias/metadata includes
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

      aliasMatches.sort(
        (a, b) => a.aliasNorm.length - b.aliasNorm.length || a.nameNorm.localeCompare(b.nameNorm)
      );

      reorderCards(aliasMatches.concat(nonAliasMatches));

      const requestedShown = Math.min(visibleLimit, aliasMatches.length);
      for (let i = 0; i < aliasMatches.length; i++) aliasMatches[i].card.hidden = i >= requestedShown;
      for (const it of nonAliasMatches) it.card.hidden = true;

      const actualShown = countShown(aliasMatches);

      // Prime thumbs for visible results
      primeThumbs(aliasMatches);

      setStatusText(`${actualShown} of ${aliasMatches.length} matches (aliases and metadata)`);
      setNoteAndNext(aliasMatches.length, actualShown);
    }

    // -------------------------------------------------------------------------
    // Throttle filtering (keeps typing snappy)
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
