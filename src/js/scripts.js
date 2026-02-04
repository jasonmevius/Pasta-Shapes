(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  // =============================================================================
  // Recently viewed helpers
  // =============================================================================

  function readRecents() {
    try {
      return JSON.parse(localStorage.getItem("pasta:recent") || "[]");
    } catch (e) {
      return [];
    }
  }

  function writeRecents(arr) {
    try {
      localStorage.setItem("pasta:recent", JSON.stringify(arr.slice(0, 12)));
    } catch (e) {}
  }

  function addRecent(slug) {
    if (!slug) return;
    const cur = readRecents().filter((x) => x !== slug);
    cur.unshift(slug);
    writeRecents(cur);
  }

  // =============================================================================
  // Home/Search page behavior
  // =============================================================================

  function initSearchPage() {
    const input = $("#pasta-q");
    const status = $("#pasta-search-status");
    const list = $("#pasta-results");

    // Only run on pages that have the search UI
    if (!input || !status || !list) return;

    // -------------------------------------------------------------------------
    // NEW: Home UI state toggles (Identify card <-> Results panel)
    //
    // Your new homepage behavior:
    // - Idle (empty input): show Identify card, hide Results panel, search card expanded
    // - Typing (non-empty): hide Identify card, show Results panel, search card shrinks
    //
    // We implement this via a single body class:
    //   body.is-searching
    // CSS handles the actual layout changes.
    // -------------------------------------------------------------------------
    const resultsPanel = $("#home-results-panel");
    const identifyCard = $("#home-identify-card");

    function setSearchingUI(isSearching) {
      document.body.classList.toggle("is-searching", isSearching);

      // For robustness: also toggle [hidden] on the results panel if it exists.
      // This prevents “blank results card” flashes on initial load.
      if (resultsPanel) resultsPanel.hidden = !isSearching;
      // Identify card visibility is handled primarily by CSS, but we keep it safe.
      if (identifyCard) identifyCard.setAttribute("aria-hidden", isSearching ? "true" : "false");
    }

    // Default UI state on load (empty input)
    setSearchingUI(Boolean(String(input.value || "").trim()));

    // -------------------------------------------------------------------------
    // Existing search logic (kept)
    // -------------------------------------------------------------------------
    const cards = Array.from(list.querySelectorAll("[data-search]"));
    const originalOrder = cards.slice();

    const recentWrap = $("#recently-viewed-wrap");
    const recentList = $("#recently-viewed");

    const note = $("#pasta-results-note");
    const nextBtn = $("#pasta-toggle-all"); // reused - now "Next 10"

    const PAGE_N = 10;
    let visibleLimit = PAGE_N;

    function setControlVisible(el, isVisible) {
      if (!el) return;
      // Some CSS can override [hidden], so force display none as well.
      el.hidden = !isVisible;
      el.style.display = isVisible ? "" : "none";
      el.setAttribute("aria-hidden", isVisible ? "false" : "true");
    }

    // -----------------------------------------------------------------------------
    // Normalization
    // -----------------------------------------------------------------------------
    const STOPWORDS = new Set([
      "a",
      "ad",
      "al",
      "alla",
      "alle",
      "allo",
      "ai",
      "agli",
      "all",
      "da",
      "de",
      "dei",
      "degli",
      "della",
      "delle",
      "del",
      "di",
      "e",
      "ed",
      "in",
      "con",
      "per",
      "su",
      "lo",
      "la",
      "le",
      "il",
      "un",
      "una",
      "uno",
    ]);

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

    // Collapses spaced-letter inputs like "p e n n e" -> "penne"
    function normalizeQuery(s) {
      const q = normalize(s);
      if (/^(?:[a-z0-9]\s+){2,}[a-z0-9]$/.test(q)) return q.replace(/\s+/g, "");
      return q;
    }

    function stripStopwords(normalizedString) {
      const parts = (normalizedString || "")
        .split(" ")
        .map((t) => t.trim())
        .filter(Boolean)
        .filter((t) => !STOPWORDS.has(t));
      return parts.join(" ").trim();
    }

    // -----------------------------------------------------------------------------
    // Optional fuzzy support using /api/pasta-index.json
    // -----------------------------------------------------------------------------
    let indexLoaded = false;
    let index = null;
    let aliasKeys = null;
    let stopKeyToSlugs = null;
    const cardBySlug = new Map(cards.map((c) => [c.getAttribute("data-slug"), c]));

    async function loadIndexIfNeeded() {
      if (indexLoaded) return index;
      indexLoaded = true;

      try {
        const res = await fetch("/api/pasta-index.json", { cache: "force-cache" });
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
        index = await res.json();

        const a2s = index.aliasToSlug || {};
        aliasKeys = Object.keys(a2s);

        stopKeyToSlugs = new Map();
        for (const k of aliasKeys) {
          const stopKey = stripStopwords(k);
          if (!stopKey) continue;
          const slug = a2s[k];
          if (!slug) continue;
          if (!stopKeyToSlugs.has(stopKey)) stopKeyToSlugs.set(stopKey, new Set());
          stopKeyToSlugs.get(stopKey).add(slug);
        }
      } catch (e) {
        index = null;
        aliasKeys = null;
        stopKeyToSlugs = null;
      }

      return index;
    }

    function levenshtein(a, b, maxDist) {
      if (a === b) return 0;
      if (!a || !b) return Math.max(a.length, b.length);

      const al = a.length;
      const bl = b.length;

      if (Math.abs(al - bl) > maxDist) return maxDist + 1;

      let prev = new Array(bl + 1);
      let cur = new Array(bl + 1);

      for (let j = 0; j <= bl; j++) prev[j] = j;

      for (let i = 1; i <= al; i++) {
        cur[0] = i;

        let rowMin = cur[0];
        const ai = a.charCodeAt(i - 1);

        for (let j = 1; j <= bl; j++) {
          const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
          const val = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
          cur[j] = val;
          if (val < rowMin) rowMin = val;
        }

        if (rowMin > maxDist) return maxDist + 1;

        const tmp = prev;
        prev = cur;
        cur = tmp;
      }

      return prev[bl];
    }

    // -----------------------------------------------------------------------------
    // Result rendering helpers (show/hide)
    // -----------------------------------------------------------------------------
    function hideAll() {
      for (const c of cards) c.hidden = true;
    }

    function showOnly(listToShow) {
      hideAll();
      for (const c of listToShow) c.hidden = false;
    }

    function updateFooter(matchCount, shownCount) {
      if (!note || !nextBtn) return;

      const remaining = Math.max(0, matchCount - shownCount);

      if (matchCount === 0 || remaining === 0) {
        note.textContent = matchCount ? `Showing ${shownCount} of ${matchCount}` : "";
        setControlVisible(nextBtn, false);
        return;
      }

      note.textContent = `Showing ${shownCount} of ${matchCount} - ${remaining} more`;
      const nextChunk = Math.min(PAGE_N, remaining);
      nextBtn.textContent = `Next ${nextChunk} (${remaining} more)`;
      setControlVisible(nextBtn, true);
    }

    // -----------------------------------------------------------------------------
    // Name-prefix search + fallback alias search + optional fuzzy
    // -----------------------------------------------------------------------------
    const cached = cards.map((card) => {
      const nameEl = card.querySelector(".result-name");
      const alsoEl = card.querySelector(".result-also");
      const descEl = card.querySelector(".result-desc");

      const nameText = nameEl ? nameEl.textContent : "";
      const alsoText = alsoEl ? alsoEl.textContent : "";
      const descText = descEl ? descEl.textContent : "";

      const nameNorm = normalize(nameText);
      const aliasNorm = normalize([alsoText, descText, card.getAttribute("data-search") || ""].join(" "));

      return { card, nameNorm, aliasNorm, nameText };
    });

    function reorder(newOrder) {
      for (const it of newOrder) list.appendChild(it.card);
    }

    async function applyFilter() {
      const q = normalizeQuery(input.value || "");
      const hasQuery = Boolean(q);

      // NEW: Toggle the home UI based on whether user is typing
      setSearchingUI(hasQuery);

      // If empty: hide results (home shows Identify card instead)
      if (!hasQuery) {
        hideAll();
        status.textContent = "Start typing to see matches.";
        updateFooter(0, 0);
        setControlVisible(nextBtn, false);
        return;
      }

      // 1) Name-prefix matches
      const nameMatches = [];
      const nonName = [];

      for (const it of cached) {
        if (it.nameNorm && it.nameNorm.startsWith(q)) nameMatches.push(it);
        else nonName.push(it);
      }

      if (nameMatches.length) {
        nameMatches.sort(
          (a, b) => a.nameNorm.length - b.nameNorm.length || a.nameNorm.localeCompare(b.nameNorm)
        );

        reorder(nameMatches.concat(nonName));

        const limited = nameMatches.slice(0, visibleLimit).map((x) => x.card);
        showOnly(limited);

        const shown = limited.length;
        status.textContent = `${shown} of ${nameMatches.length} matches (name starts with "${q}")`;
        updateFooter(nameMatches.length, shown);
        return;
      }

      // 2) Alias/metadata search (includes)
      const aliasMatches = [];
      const nonAlias = [];

      for (const it of cached) {
        if (it.aliasNorm && it.aliasNorm.includes(q)) aliasMatches.push(it);
        else nonAlias.push(it);
      }

      // 3) Optional fuzzy match (only if alias/metadata is empty AND query long enough)
      if (!aliasMatches.length && q.length >= 4) {
        await loadIndexIfNeeded();

        if (stopKeyToSlugs) {
          const qStop = stripStopwords(q);
          const maxDist = qStop.length <= 6 ? 1 : 2;

          const hits = new Set();
          for (const [stopKey, slugs] of stopKeyToSlugs.entries()) {
            if (Math.abs(stopKey.length - qStop.length) > maxDist) continue;

            const d = levenshtein(qStop, stopKey, maxDist);
            if (d <= maxDist) {
              for (const s of slugs) hits.add(s);
              if (hits.size >= 25) break;
            }
          }

          const fuzzyCards = [];
          for (const slug of hits) {
            const card = cardBySlug.get(slug);
            if (card) fuzzyCards.push(card);
          }

          if (fuzzyCards.length) {
            const shownCards = fuzzyCards.slice(0, visibleLimit);
            showOnly(shownCards);
            status.textContent = `${Math.min(visibleLimit, fuzzyCards.length)} of ${fuzzyCards.length} matches (fuzzy)`;
            updateFooter(fuzzyCards.length, shownCards.length);
            return;
          }
        }
      }

      // Alias matches (paged)
      if (aliasMatches.length) {
        reorder(aliasMatches.concat(nonAlias));

        const limited = aliasMatches.slice(0, visibleLimit).map((x) => x.card);
        showOnly(limited);

        const shown = limited.length;
        status.textContent = `${shown} of ${aliasMatches.length} matches (aliases and metadata)`;
        updateFooter(aliasMatches.length, shown);
        return;
      }

      // Nothing found
      hideAll();
      status.textContent = "No matches found.";
      updateFooter(0, 0);
      setControlVisible(nextBtn, false);
    }

    // -----------------------------------------------------------------------------
    // Event wiring
    // -----------------------------------------------------------------------------
    let rafPending = false;
    function requestFilter() {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        applyFilter();
      });
    }

    input.addEventListener("input", () => {
      visibleLimit = PAGE_N;
      requestFilter();
    });

    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        e.preventDefault();
        visibleLimit += PAGE_N;
        requestFilter();
      });
    }

    // Recently viewed: render comma-separated list (max 5)
    function renderRecents() {
      if (!recentWrap || !recentList) return;

      const slugs = readRecents();
      if (!slugs.length) {
        setControlVisible(recentWrap, false);
        return;
      }

      const bySlug = new Map(cached.map((it) => [it.card.getAttribute("data-slug"), it.card]));
      const items = slugs
        .map((s) => bySlug.get(s))
        .filter(Boolean)
        .slice(0, 5);

      if (!items.length) {
        setControlVisible(recentWrap, false);
        return;
      }

      recentList.innerHTML = "";
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

      recentList.appendChild(frag);
      setControlVisible(recentWrap, true);
    }

    // Record recents on click (detail pages also record on load)
    list.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-recent]");
      if (!a) return;
      const href = a.getAttribute("href") || "";
      const m = href.match(/\/pasta\/([^\/]+)\//);
      if (m && m[1]) addRecent(m[1]);
    });

    // Initial state
    hideAll();
    renderRecents();
    requestFilter(); // ensures UI matches any prefilled query
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
  // Identify page behavior hook (kept for compatibility with your existing setup)
  // =============================================================================

  function initIdentifyPage() {
    return;
  }

  // =============================================================================
  // Mobile Bottom Nav: swipe-to-switch between Search and Identify
  // =============================================================================
  function initSwipeBottomNav() {
    const nav = document.querySelector(".bottom-nav[data-swipe-nav='1']");
    if (!nav) return;

    const isMobile = window.matchMedia && window.matchMedia("(max-width: 719px)").matches;
    if (!isMobile) return;

    if (nav.__swipeInit) return;
    nav.__swipeInit = true;

    const MIN_DX = 60;
    const MAX_DT = 650;
    const MAX_SLOPE = 1.2;

    let startX = 0;
    let startY = 0;
    let startT = 0;

    function pageMode() {
      const p = window.location && window.location.pathname ? window.location.pathname : "/";
      return p.startsWith("/identify") ? "identify" : "search";
    }

    function goTo(mode) {
      const target = mode === "identify" ? "/identify/" : "/";
      if (window.location.pathname === target) return;
      window.location.href = target;
    }

    nav.addEventListener(
      "touchstart",
      (e) => {
        if (!e.touches || e.touches.length !== 1) return;
        const t = e.touches[0];
        startX = t.clientX;
        startY = t.clientY;
        startT = Date.now();
      },
      { passive: true }
    );

    nav.addEventListener(
      "touchend",
      (e) => {
        if (!startT) return;

        const dt = Date.now() - startT;
        startT = 0;
        if (dt > MAX_DT) return;

        const t = (e.changedTouches && e.changedTouches[0]) || null;
        if (!t) return;

        const dx = t.clientX - startX;
        const dy = t.clientY - startY;

        if (Math.abs(dx) < MIN_DX) return;
        if (Math.abs(dx) <= Math.abs(dy) * MAX_SLOPE) return;

        const mode = pageMode();

        if (dx < 0 && mode === "search") {
          goTo("identify");
          return;
        }

        if (dx > 0 && mode === "identify") {
          goTo("search");
          return;
        }
      },
      { passive: true }
    );
  }

  // =============================================================================
  // Init
  // =============================================================================

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      initSearchPage();
      initDetailPage();
      initIdentifyPage();
      initSwipeBottomNav();
    },
    { once: true }
  );
})();
