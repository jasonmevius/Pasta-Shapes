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
  // Search page behavior
  // =============================================================================

  function initSearchPage() {
    const input = $("#pasta-q");
    const status = $("#pasta-search-status");
    const list = $("#pasta-results");

    // Only run on the search page
    if (!input || !status || !list) return;

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
      // Hide all first, then reveal the matches in order.
      hideAll();
      for (const c of listToShow) c.hidden = false;
    }

    function countShown() {
      let n = 0;
      for (const c of cards) if (!c.hidden) n++;
      return n;
    }

    function updateFooter(matchCount, shownCount) {
      if (!note || !nextBtn) return;

      const remaining = Math.max(0, matchCount - shownCount);

      // Nothing to show or nothing remaining - hide the button entirely.
      if (matchCount === 0 || remaining === 0) {
        note.textContent = matchCount ? `Showing ${shownCount} of ${matchCount}` : "";
        setControlVisible(nextBtn, false);
        return;
      }

      // Otherwise show the paging button and a helpful note.
      note.textContent = `Showing ${shownCount} of ${matchCount} - ${remaining} more`;
      const nextChunk = Math.min(PAGE_N, remaining);
      nextBtn.textContent = `Next ${nextChunk} (${remaining} more)`;
      setControlVisible(nextBtn, true);
    }

    // -----------------------------------------------------------------------------
    // Name-prefix search (your restaurant behavior)
    // - Typing "r" returns names that start with "r".
    // - If that yields 0 results, we fall back to alias/metadata search.
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

    // -----------------------------------------------------------------------------
    // Core filter function
    // -----------------------------------------------------------------------------
    async function applyFilter() {
      const q = normalizeQuery(input.value || "");

      // Option B: show nothing until typing begins
      if (!q) {
        hideAll();
        status.textContent = "Start typing to see matches.";
        updateFooter(0, 0);
        setControlVisible(nextBtn, false);
        return;
      }

      // 1) Primary pass: name-prefix only
      const nameMatches = [];
      const nonName = [];

      for (const it of cached) {
        if (it.nameNorm && it.nameNorm.startsWith(q)) nameMatches.push(it);
        else nonName.push(it);
      }

      // If we have name-prefix matches, show them (paged)
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

      // 2) Fallback: alias/metadata search (includes)
      const aliasMatches = [];
      const nonAlias = [];

      for (const it of cached) {
        if (it.aliasNorm && it.aliasNorm.includes(q)) aliasMatches.push(it);
        else nonAlias.push(it);
      }

      // 3) Optional fuzzy match (only if alias/metadata is empty AND query is long enough)
      // This keeps things fast and avoids "magic" on short queries.
      if (!aliasMatches.length && q.length >= 4) {
        await loadIndexIfNeeded();

        if (stopKeyToSlugs) {
          const qStop = stripStopwords(q);

          // Small max distance: conservative fuzziness
          const maxDist = qStop.length <= 6 ? 1 : 2;

          const hits = new Set();
          for (const [stopKey, slugs] of stopKeyToSlugs.entries()) {
            // Cheap early check
            if (Math.abs(stopKey.length - qStop.length) > maxDist) continue;

            const d = levenshtein(qStop, stopKey, maxDist);
            if (d <= maxDist) {
              for (const s of slugs) hits.add(s);
              if (hits.size >= 25) break; // cap to avoid crazy lists
            }
          }

          // Convert fuzzy slugs to cards
          const fuzzyCards = [];
          for (const slug of hits) {
            const card = cardBySlug.get(slug);
            if (card) fuzzyCards.push(card);
          }

          if (fuzzyCards.length) {
            // Keep existing DOM order for fuzzy results (simple, predictable)
            showOnly(fuzzyCards.slice(0, visibleLimit));
            status.textContent = `${Math.min(visibleLimit, fuzzyCards.length)} of ${fuzzyCards.length} matches (fuzzy)`;
            updateFooter(fuzzyCards.length, Math.min(visibleLimit, fuzzyCards.length));
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
    status.textContent = "Start typing to see matches.";
    setControlVisible(nextBtn, false);
    if (note) note.textContent = "";
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
  // Identify page behavior hook (kept for compatibility with your existing setup)
  // =============================================================================

  function initIdentifyPage() {
    // If Identify has its own inline JS, this can remain a no-op.
    // Keeping this function prevents errors if other code expects it.
    return;
  }

  // =============================================================================
  // Mobile Bottom Nav: swipe-to-switch between Search and Identify
  // =============================================================================
  function initSwipeBottomNav() {
    // ---------------------------------------------------------------------------
    // PURPOSE
    // - Enable a fast "app-like" gesture on mobile:
    //     - Swipe LEFT on the bottom nav to go from Search -> Identify
    //     - Swipe RIGHT on the bottom nav to go from Identify -> Search
    //
    // WHY WE DO IT THIS WAY
    // - We keep the bottom nav links as normal <a> tags for accessibility.
    // - Swipe is progressive enhancement: if it fails, taps still work.
    // - We only attach handlers on small screens and only on the nav itself
    //   so we do NOT interfere with normal page scrolling.
    // ---------------------------------------------------------------------------

    const nav = document.querySelector(".bottom-nav[data-swipe-nav='1']");
    if (!nav) return;

    // Only enable on mobile-sized viewports. This should align with the CSS rule
    // that shows the bottom nav.
    const isMobile = window.matchMedia && window.matchMedia("(max-width: 719px)").matches;
    if (!isMobile) return;

    // Avoid double-initialization (safe on bfcache restores).
    if (nav.__swipeInit) return;
    nav.__swipeInit = true;

    // Tuning constants (feel free to tweak later)
    const MIN_DX = 60; // minimum horizontal distance (px) to count as swipe
    const MAX_DT = 650; // maximum swipe time (ms)
    const MAX_SLOPE = 1.2; // require |dx| > |dy| * MAX_SLOPE to avoid vertical scroll conflicts

    let startX = 0;
    let startY = 0;
    let startT = 0;

    function pageMode() {
      const p = window.location && window.location.pathname ? window.location.pathname : "/";
      return p.startsWith("/identify") ? "identify" : "search";
    }

    function goTo(mode) {
      // Keep URLs canonical as you’re using trailing slash for identify.
      const target = mode === "identify" ? "/identify/" : "/";
      if (window.location.pathname === target) return;
      window.location.href = target;
    }

    nav.addEventListener(
      "touchstart",
      (e) => {
        // Only single-finger swipes.
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

        // If the gesture took too long, treat it as a normal interaction.
        if (dt > MAX_DT) return;

        const t = (e.changedTouches && e.changedTouches[0]) || null;
        if (!t) return;

        const dx = t.clientX - startX;
        const dy = t.clientY - startY;

        // Horizontal intent check: big dx and not too much vertical movement.
        if (Math.abs(dx) < MIN_DX) return;
        if (Math.abs(dx) <= Math.abs(dy) * MAX_SLOPE) return;

        const mode = pageMode();

        // Swipe left = "next" (Search -> Identify)
        if (dx < 0 && mode === "search") {
          goTo("identify");
          return;
        }

        // Swipe right = "previous" (Identify -> Search)
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
