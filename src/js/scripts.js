(() => {
  // =============================================================================
  // Tiny selector helper
  // =============================================================================
  const $ = (sel, root = document) => root.querySelector(sel);

  // =============================================================================
  // Mobile hamburger menu
  // - Closed by default
  // - Toggle open/close
  // - Close on outside click, ESC, or link click
  // =============================================================================
  function initHamburgerMenu() {
    const btn = $("#nav-toggle");
    const drawer = $("#nav-drawer");
    if (!btn || !drawer) return;

    // Safe initial state on every load.
    btn.setAttribute("aria-expanded", "false");
    drawer.hidden = true;

    function closeMenu() {
      btn.setAttribute("aria-expanded", "false");
      drawer.hidden = true;
    }

    function openMenu() {
      btn.setAttribute("aria-expanded", "true");
      drawer.hidden = false;
    }

    function toggleMenu() {
      const isOpen = btn.getAttribute("aria-expanded") === "true";
      if (isOpen) closeMenu();
      else openMenu();
    }

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      toggleMenu();
    });

    // Click a link - close.
    drawer.addEventListener("click", (e) => {
      const a = e.target.closest("a[href]");
      if (a) closeMenu();
    });

    // ESC - close.
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });

    // Click outside - close.
    document.addEventListener("click", (e) => {
      const isOpen = btn.getAttribute("aria-expanded") === "true";
      if (!isOpen) return;

      const insideToggle = e.target.closest("#nav-toggle");
      const insideDrawer = e.target.closest("#nav-drawer");
      if (insideToggle || insideDrawer) return;

      closeMenu();
    });
  }

  // =============================================================================
  // Recently viewed (localStorage)
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
  // Linked home rotator (Homepage)
  // - Syncs Identify icon rotation with Search placeholder examples
  // - Purpose: reinforce the connection between "name" and "shape"
  //
  // Behavior / guardrails:
  // - Runs only when:
  //    - input is empty
  //    - input is not focused
  //    - user does NOT prefer reduced motion
  // - Pauses when user focuses the input or starts typing.
  // - Uses a single shared index and interval for both icon + placeholder.
  //
  // Markup requirements (index.njk):
  // - Identify <img id="identify-icon-rotator" data-rotator-group="homeHero"
  //     data-rotate-srcs="url1,url2,..." data-rotate-names="penne,..."
  //     data-rotate-interval="2500" data-rotate-fade="240">
  // - Search <input id="pasta-q" data-rotator-group="homeHero"
  //     data-placeholder-rotate="1"
  //     data-placeholder-template="Start typing - e.g., {example}"
  //     data-placeholder-examples="penne,ravioli,..."
  //     data-rotate-interval="2500">
  // =============================================================================
  function initLinkedHomeRotators() {
    const input = $("#pasta-q");
    const img = $("#identify-icon-rotator");

    // Only run on the homepage layout where both exist.
    if (!input || !img) return;

    // Reduced motion: keep everything static.
    const reduceMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    // Make sure these belong to the same group.
    const groupA = input.getAttribute("data-rotator-group") || "";
    const groupB = img.getAttribute("data-rotator-group") || "";
    if (!groupA || groupA !== groupB) return;

    // Parse icon srcs
    const rawSrcs = img.getAttribute("data-rotate-srcs") || "";
    const iconSrcs = rawSrcs.split(",").map((s) => s.trim()).filter(Boolean);

    // Parse names for the placeholder
    const rawNames = input.getAttribute("data-placeholder-examples")
      || img.getAttribute("data-rotate-names")
      || "";
    const names = rawNames.split(",").map((s) => s.trim()).filter(Boolean);

    // Must have at least 2 to rotate; also keep arrays aligned by using the min length.
    const N = Math.min(iconSrcs.length, names.length);
    if (N < 2) return;

    // Timing knobs
    const intervalMs = Math.max(
      1200,
      parseInt(input.getAttribute("data-rotate-interval") || img.getAttribute("data-rotate-interval") || "2500", 10)
    );
    const fadeMs = Math.max(
      120,
      parseInt(img.getAttribute("data-rotate-fade") || "240", 10)
    );

    // Keep CSS transition in sync with fadeMs.
    img.style.transitionDuration = `${fadeMs}ms`;

    // Placeholder template, defaults to your original style.
    const tpl = input.getAttribute("data-placeholder-template") || "Start typing - e.g., {example}";

    // Preload icons to minimize flicker.
    try {
      for (let i = 0; i < N; i++) {
        const pre = new Image();
        pre.decoding = "async";
        pre.src = iconSrcs[i];
      }
    } catch (e) {}

    // Start index: try to match current icon src; otherwise 0.
    const currentSrc = img.getAttribute("src") || "";
    let idx = Math.max(0, iconSrcs.indexOf(currentSrc));
    if (idx >= N) idx = 0;

    // Ensure the placeholder matches initial index.
    function setPlaceholder(i) {
      const ex = names[i] || names[0] || "penne";
      input.setAttribute("placeholder", tpl.replace("{example}", ex));
    }
    setPlaceholder(idx);

    let timer = null;
    let swapping = false;

    function shouldRun() {
      // Only rotate when the input is empty and NOT focused.
      const hasText = Boolean(String(input.value || "").trim());
      const isFocused = document.activeElement === input;
      return !hasText && !isFocused;
    }

    function fadeSwapIcon(newSrc) {
      if (swapping) return;
      swapping = true;

      // Fade out
      img.classList.add("is-fading");

      window.setTimeout(() => {
        img.src = newSrc;

        // Fade back in next frame
        requestAnimationFrame(() => {
          img.classList.remove("is-fading");
          window.setTimeout(() => {
            swapping = false;
          }, Math.max(0, Math.floor(fadeMs / 2)));
        });
      }, fadeMs);
    }

    function tick() {
      if (!shouldRun()) return;
      idx = (idx + 1) % N;

      setPlaceholder(idx);
      fadeSwapIcon(iconSrcs[idx]);
    }

    function start() {
      if (timer) return;
      timer = window.setInterval(tick, intervalMs);
    }

    function stop() {
      if (!timer) return;
      window.clearInterval(timer);
      timer = null;
    }

    // Start immediately if allowed.
    if (shouldRun()) start();

    // Pause/resume based on user interaction.
    input.addEventListener("focus", () => stop(), { passive: true });
    input.addEventListener("input", () => {
      if (shouldRun()) start();
      else stop();
    });
    input.addEventListener("blur", () => {
      // If the user leaves the field empty, resume.
      if (shouldRun()) start();
    }, { passive: true });

    // Pause when the tab is hidden, resume when visible (if allowed).
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else if (shouldRun()) start();
    });
  }

// =============================================================================
  // Home/Search page behavior
  // =============================================================================
  function initSearchPage() {
    const input = $("#pasta-q");
    const status = $("#pasta-search-status");
    const list = $("#pasta-results");

    // Only run on pages with the search UI.
    if (!input || !status || !list) return;

    const resultsPanel = $("#home-results-panel");
    const identifyCard = $("#home-identify-card");

    // -------------------------------------------------------------------------
    // Home UI state toggles:
    // - Idle: Identify card shown, Results panel hidden
    // - Typing: Identify card hidden, Results panel shown
    // CSS handles the layout via body.is-searching.
    // -------------------------------------------------------------------------
    function setSearchingUI(isSearching) {
      document.body.classList.toggle("is-searching", isSearching);

      if (resultsPanel) resultsPanel.hidden = !isSearching;

      // Keep accessibility clean: the Identify card is visually removed by CSS,
      // but we also set aria-hidden when searching.
      if (identifyCard) {
        identifyCard.setAttribute("aria-hidden", isSearching ? "true" : "false");
      }
    }

    // Initial UI state
    setSearchingUI(Boolean(String(input.value || "").trim()));

    // -------------------------------------------------------------------------
    // Existing search logic
    // -------------------------------------------------------------------------
    const cards = Array.from(list.querySelectorAll("[data-search]"));
    const recentWrap = $("#recently-viewed-wrap");
    const recentList = $("#recently-viewed");

    const note = $("#pasta-results-note");
    const nextBtn = $("#pasta-toggle-all");

    const PAGE_N = 10;
    let visibleLimit = PAGE_N;

    function setControlVisible(el, isVisible) {
      if (!el) return;
      el.hidden = !isVisible;
      el.style.display = isVisible ? "" : "none";
      el.setAttribute("aria-hidden", isVisible ? "false" : "true");
    }

    // -------------------------------------------------------------------------
    // Normalization helpers
    // -------------------------------------------------------------------------
    const STOPWORDS = new Set([
      "a","ad","al","alla","alle","allo","ai","agli","all",
      "da","de","dei","degli","della","delle","del","di",
      "e","ed","in","con","per","su","lo","la","le","il","un","una","uno",
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

    // -------------------------------------------------------------------------
    // Optional fuzzy support using /api/pasta-index.json
    // -------------------------------------------------------------------------
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

    // Bounded Levenshtein for lightweight fuzzy matching
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

    // -------------------------------------------------------------------------
    // Result show/hide helpers
    // -------------------------------------------------------------------------
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

    // Cache normalized values from DOM
    const cached = cards.map((card) => {
      const nameEl = card.querySelector(".result-name");
      const alsoEl = card.querySelector(".result-also");
      const descEl = card.querySelector(".result-desc");

      const nameText = nameEl ? nameEl.textContent : "";
      const alsoText = alsoEl ? alsoEl.textContent : "";
      const descText = descEl ? descEl.textContent : "";

      const nameNorm = normalize(nameText);
      const aliasNorm = normalize([alsoText, descText, card.getAttribute("data-search") || ""].join(" "));

      return { card, nameNorm, aliasNorm };
    });

    function reorder(newOrder) {
      for (const it of newOrder) list.appendChild(it.card);
    }

    // -------------------------------------------------------------------------
    // Main filter function
    // -------------------------------------------------------------------------
    async function applyFilter() {
      const q = normalizeQuery(input.value || "");
      const hasQuery = Boolean(q);

      setSearchingUI(hasQuery);

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

      // 2) Alias/metadata matches (includes)
      const aliasMatches = [];
      const nonAlias = [];

      for (const it of cached) {
        if (it.aliasNorm && it.aliasNorm.includes(q)) aliasMatches.push(it);
        else nonAlias.push(it);
      }

      // 3) Optional fuzzy match fallback
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

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
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
    requestFilter();
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
  // Identify page hook (kept for compatibility)
  // =============================================================================
  function initIdentifyPage() {
    return;
  }

  // =============================================================================
  // Mobile bottom nav: swipe to switch Search <-> Identify
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
      initHamburgerMenu();
      initLinkedHomeRotators();
      initSearchPage();
      initDetailPage();
      initIdentifyPage();
      initSwipeBottomNav();
    },
    { once: true }
  );
})();
