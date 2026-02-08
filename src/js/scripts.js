(() => {
  // =============================================================================
  // /src/js/scripts.js
  // -----------------------------------------------------------------------------
  // PURPOSE
  // - Site-wide interactions:
  //   - Hamburger menu
  //   - Homepage linked rotators (placeholder + icon)
  //   - Homepage search: prefix filtering + sort + paging
  //
  // SEARCH TUNING (IMPORTANT)
  // - For 1-character queries, match only pasta names (reduces noise).
  // - For 2+ characters, allow synonym token prefix matches, but remove generic
  //   tokens like "pasta" so phrases like "alphabet pasta" don't match "p".
  //
  // STYLE RULE
  // - All CSS must live in styles.css (no inline styles here).
  // =============================================================================

  const $ = (sel, root = document) => root.querySelector(sel);

  // -----------------------------------------------------------------------------
  // Hamburger menu
  // -----------------------------------------------------------------------------
  function initHamburgerMenu() {
    const btn = $("#menu-toggle");
    const panel = $("#site-nav");
    if (!btn || !panel) return;

    btn.setAttribute("aria-expanded", "false");
    panel.setAttribute("data-open", "false");

    btn.addEventListener("click", () => {
      const isOpen = btn.getAttribute("aria-expanded") === "true";
      btn.setAttribute("aria-expanded", String(!isOpen));
      panel.setAttribute("data-open", String(!isOpen));
    });
  }

  // -----------------------------------------------------------------------------
  // Homepage linked rotators (placeholder + icon in sync)
  // -----------------------------------------------------------------------------
  function initLinkedHomeRotators() {
    const input = $("#pasta-q");
    const icon = $("#identify-icon-rotator");
    if (!input || !icon) return;

    const examplesRaw = input.getAttribute("data-placeholder-examples") || "";
    const examples = examplesRaw
      .split(",")
      .map((s) => String(s || "").trim())
      .filter(Boolean);

    const tpl =
      input.getAttribute("data-placeholder-template") ||
      "Start typing - e.g., {example}";
    const intervalMs = Number(input.getAttribute("data-rotate-interval") || 2500);

    const srcsRaw = icon.getAttribute("data-rotate-srcs") || "";
    const namesRaw = icon.getAttribute("data-rotate-names") || "";

    const srcs = srcsRaw
      .split(",")
      .map((s) => String(s || "").trim())
      .filter(Boolean);

    const names = namesRaw
      .split(",")
      .map((s) => String(s || "").trim())
      .filter(Boolean);

    const n = Math.min(examples.length, srcs.length, names.length);
    if (n <= 0) return;

    let i = 0;

    function tick() {
      i = (i + 1) % n;
      input.setAttribute("placeholder", tpl.replace("{example}", examples[i]));
      icon.setAttribute("src", srcs[i]);
    }

    let timer = window.setInterval(tick, intervalMs);

    input.addEventListener("focus", () => {
      if (timer) window.clearInterval(timer);
      timer = null;
    });

    input.addEventListener("blur", () => {
      if (!timer) timer = window.setInterval(tick, intervalMs);
    });
  }

  // -----------------------------------------------------------------------------
  // Homepage search: prefix filtering + paging + sortable headers
  // -----------------------------------------------------------------------------
  function initSearchPage() {
    const input = $("#pasta-q");
    const status = $("#pasta-search-count") || $("#pasta-search-status");
    const table = $("#pasta-results-table");
    const tbody = $("#pasta-results-body");

    if (!input || !status || !table || !tbody) return;

    const resultsPanel = $("#home-results-panel");
    const note = $("#pasta-results-note");
    const nextBtn = $("#pasta-toggle-all");

    const PAGE_N = 10;
    let visibleLimit = PAGE_N;

    let sortKey = "name";
    let sortDir = "ascending";

    // Tokens we should not allow synonym matching to trigger on.
    // This prevents "alphabet pasta" from matching "p" via the word "pasta".
    const STOP_TOKENS = new Set([
      "pasta",
      "noodle",
      "noodles",
      "shape",
      "shapes",
      "small",
      "large",
    ]);

    function setSearchingUI(isSearching) {
      document.body.classList.toggle("is-searching", isSearching);
      if (resultsPanel) resultsPanel.hidden = !isSearching;
      // IMPORTANT: Identify card remains visible (CSS must not hide it).
    }

    function setControlVisible(el, isVisible) {
      if (!el) return;
      el.hidden = !isVisible;
      el.setAttribute("aria-hidden", isVisible ? "false" : "true");
    }

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

    function maybeUnspaceLetters(q) {
      const t = String(q || "").trim();
      if (/^([a-z]\s+){2,}[a-z]$/i.test(t)) return t.replace(/\s+/g, "");
      return t;
    }

    function tokenizeSearchText(s) {
      const n = normalize(s);
      if (!n) return [];
      return n
        .split(" ")
        .map((x) => x.trim())
        .filter(Boolean)
        .filter((t) => !STOP_TOKENS.has(t));
    }

    // Cache initial rows (DOM - data objects)
    const rows = Array.from(tbody.querySelectorAll("tr.data-row")).map((tr) => {
      const name = tr.getAttribute("data-name") || "";
      const category = tr.getAttribute("data-category") || "";
      const search = tr.getAttribute("data-search") || "";

      return {
        tr,
        name,
        category,
        nameN: normalize(name),
        categoryN: normalize(category),
        tokens: tokenizeSearchText(search),
      };
    });

    function readSortStateFromHeaders() {
      const ths = Array.from(table.querySelectorAll("th[data-sort]"));
      for (const th of ths) {
        const aria = th.getAttribute("aria-sort");
        if (aria === "ascending" || aria === "descending") {
          sortKey = th.getAttribute("data-sort") || "name";
          sortDir = aria;
          return;
        }
      }
      sortKey = "name";
      sortDir = "ascending";
    }

    function setHeaderSortState(nextKey, nextDir) {
      const ths = Array.from(table.querySelectorAll("th[data-sort]"));
      ths.forEach((th) => {
        const k = th.getAttribute("data-sort");
        th.setAttribute("aria-sort", k === nextKey ? nextDir : "none");
      });
    }

    function compare(a, b) {
      const dir = sortDir === "descending" ? -1 : 1;

      if (sortKey === "category") {
        const c = a.categoryN.localeCompare(b.categoryN);
        if (c !== 0) return c * dir;
        return a.nameN.localeCompare(b.nameN) * dir;
      }

      return a.nameN.localeCompare(b.nameN) * dir;
    }

    function render(list) {
      tbody.innerHTML = "";

      const slice = list.slice(0, visibleLimit);
      slice.forEach((r) => tbody.appendChild(r.tr));

      const hasMore = list.length > visibleLimit;
      setControlVisible(nextBtn, hasMore);
      setControlVisible(note, list.length > 0);

      if (!list.length) status.textContent = "No matches.";
      else if (hasMore) status.textContent = `${list.length} matches - showing ${visibleLimit}.`;
      else status.textContent = `${list.length} matches.`;
    }

    function filterAndRender() {
      const raw = maybeUnspaceLetters(input.value);
      const q = normalize(raw);

      const isSearching = Boolean(q);
      setSearchingUI(isSearching);

      if (!isSearching) {
        if (resultsPanel) resultsPanel.hidden = true;
        status.textContent = "Start typing to see matches.";
        setControlVisible(nextBtn, false);
        setControlVisible(note, false);
        return;
      }

      // TUNING:
      // - 1 character: match ONLY by name prefix.
      // - 2+ characters: allow synonym token prefix matching (minus STOP_TOKENS).
      const allowSynonyms = q.length >= 2;

      const matches = rows.filter((r) => {
        if (r.nameN.startsWith(q)) return true;
        if (!allowSynonyms) return false;

        for (const t of r.tokens) {
          if (t.startsWith(q)) return true;
        }
        return false;
      });

      matches.sort(compare);
      render(matches);
    }

    // Paging
    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        e.preventDefault();
        visibleLimit += PAGE_N;
        filterAndRender();
      });
    }

    // Sorting - click delegation on header controls
    table.addEventListener("click", (e) => {
      const btn = e.target.closest(".js-sort");
      if (!btn) return;

      const key =
        btn.getAttribute("data-sort") ||
        btn.closest("th")?.getAttribute("data-sort") ||
        "";
      if (!key) return;

      const th = btn.closest("th");
      const current = th?.getAttribute("aria-sort") || "none";
      const nextDir = current === "ascending" ? "descending" : "ascending";

      sortKey = key;
      sortDir = nextDir;
      setHeaderSortState(sortKey, sortDir);

      visibleLimit = PAGE_N;
      filterAndRender();
    });

    // Input filtering
    input.addEventListener("input", () => {
      visibleLimit = PAGE_N;
      filterAndRender();
    });

    // Support /?q=... deep links
    (function handleQueryParamOnLoad() {
      const params = new URLSearchParams(window.location.search);
      const q = params.get("q");
      if (!q) return;

      input.value = q;
      window.history.replaceState({}, "", window.location.pathname);

      visibleLimit = PAGE_N;
      filterAndRender();
    })();

    // Init
    readSortStateFromHeaders();
    filterAndRender();
  }

  // =============================================================================
  // Boot
  // =============================================================================
  document.addEventListener("DOMContentLoaded", () => {
    initHamburgerMenu();
    initLinkedHomeRotators();
    initSearchPage();
  });
})();
