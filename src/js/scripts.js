// src/js/scripts.js
// ============================================================================
// Global site behaviors:
//
// 1) Recently Viewed (localStorage)
//
// 2) Homepage Search Filtering (Option B: show nothing until typing)
//
// IMPORTANT UX RULES (restaurant-friendly):
// - 0 chars: show nothing
// - 1 char: show nothing (too noisy) BUT show "keep typing" status
// - 2+ chars: show matches immediately (includes aliases via data-search)
//
// WHY THIS UPDATE
// - You observed "r / ra / ravio -> nothing" then "raviol -> 1 result".
// - That feels broken to users.
// - This version makes the short-query behavior explicit and consistent,
//   and ensures 2+ chars always filters correctly.
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
    const MIN_CHARS = 2; // <-- Restaurant-friendly: avoids 1-letter noise
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
    // Normalization helpers
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
    // Ranking helpers (name-first ordering, then blob)
    // -------------------------------------------------------------------------
    function cardNameNorm(card) {
      const el = card.querySelector(".result-name");
      return normalize(el ? el.textContent : "");
    }

    function cardBlobNorm(card) {
      // data-search should include name + aliases + type bits
      return normalize(card.getAttribute("data-search") || "");
    }

    function cardSlugNorm(card) {
      return normalize(card.getAttribute("data-slug") || "");
    }

    function scoreCard(card, q) {
      const name = cardNameNorm(card);
      const slug = cardSlugNorm(card);
      const blob = cardBlobNorm(card);

      // Lower bucket = better match
      let bucket = 50;

      if (name && name.startsWith(q)) bucket = 0;
      else if (name && name.split(" ").some((t) => t.startsWith(q))) bucket = 1;
      else if (slug && slug.startsWith(q)) bucket = 2;
      else if (blob && blob.startsWith(q)) bucket = 3;
      else if (name && name.includes(q)) bucket = 4;
      else if (blob && blob.includes(q)) bucket = 5;

      // Tie-breakers: earlier position and shorter name wins
      let pos = 9999;
      if (bucket <= 3) pos = 0;
      else if (bucket === 4) pos = name.indexOf(q);
      else if (bucket === 5) pos = blob.indexOf(q);

      const len = name ? name.length : 9999;
      return { bucket, pos, len, name };
    }

    function reorderCards(order) {
      for (const card of order) list.appendChild(card);
    }

    // -------------------------------------------------------------------------
    // UI helpers
    // -------------------------------------------------------------------------
    function setStatusText(text) {
      status.textContent = text || "";
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

    function countShown(arr) {
      let n = 0;
      for (const el of arr) if (!el.hidden) n++;
      return n;
    }

    // -------------------------------------------------------------------------
    // Core filter
    // -------------------------------------------------------------------------
    function filterNow() {
      const raw = input.value || "";
      const q = normalizeQuery(raw);

      // Option B: 0 chars -> show nothing
      if (!q) {
        reorderCards(originalOrder);
        hideAllCards();
        setStatusText("Start typing to see matches (aliases included).");
        if (note) note.textContent = "";
        if (nextBtn) {
          nextBtn.textContent = "";
          hideEl(nextBtn);
        }
        visibleLimit = PAGE_N;
        return;
      }

      // Restaurant UX: 1 char is too broad/noisy -> show nothing, but explain
      if (q.length < MIN_CHARS) {
        reorderCards(originalOrder);
        hideAllCards();
        setStatusText(`Keep typing - enter at least ${MIN_CHARS} characters.`);
        if (note) note.textContent = "";
        if (nextBtn) {
          nextBtn.textContent = "";
          hideEl(nextBtn);
        }
        visibleLimit = PAGE_N;
        return;
      }

      // Direct match: scan data-search blob
      const matched = [];
      const nonMatched = [];

      for (const card of originalOrder) {
        const blob = cardBlobNorm(card);
        if (blob.includes(q)) matched.push(card);
        else nonMatched.push(card);
      }

      if (!matched.length) {
        reorderCards(originalOrder);
        hideAllCards();
        setStatusText("No matches found.");
        if (note) note.textContent = "";
        if (nextBtn) {
          nextBtn.textContent = "";
          hideEl(nextBtn);
        }
        return;
      }

      // Rank (name-first)
      const ranked = matched
        .map((c) => ({ c, s: scoreCard(c, q) }))
        .sort((a, b) => {
          if (a.s.bucket !== b.s.bucket) return a.s.bucket - b.s.bucket;
          if (a.s.pos !== b.s.pos) return a.s.pos - b.s.pos;
          if (a.s.len !== b.s.len) return a.s.len - b.s.len;
          return a.s.name.localeCompare(b.s.name);
        })
        .map((x) => x.c);

      reorderCards(ranked.concat(nonMatched));

      // Show first PAGE_N (or expanded via Next)
      const requestedShown = Math.min(visibleLimit, ranked.length);

      for (let i = 0; i < ranked.length; i++) ranked[i].hidden = i >= requestedShown;
      for (const c of nonMatched) c.hidden = true;

      const actualShown = countShown(ranked);
      setStatusText(`${actualShown} of ${ranked.length} matches`);
      setNoteAndNext(ranked.length, actualShown);
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

      const bySlug = new Map(cards.map((c) => [c.getAttribute("data-slug"), c]));
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
    reorderCards(originalOrder);
    hideAllCards();
    setStatusText("Start typing to see matches (aliases included).");
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
