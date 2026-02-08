(() => {
  // =============================================================================
  // /src/js/scripts.js
  // -----------------------------------------------------------------------------
  // PURPOSE
  // - Site-wide interactions:
  //   - Hamburger menu
  //   - Homepage linked rotators (placeholder + icon)
  //   - Homepage search: prefix filtering + sort + paging
  //   - Identify page logic (only runs when identify DOM exists)
  //
  // IMPORTANT
  // - Homepage can also load /src/js/pasta-search.js (typeahead).
  // - This file writes table-filter status into #pasta-search-count to avoid
  //   overwriting #pasta-search-status (used by pasta-search.js).
  //
  // STYLE RULE
  // - All CSS must live in styles.css, not in templates or JS.
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

    const tpl = input.getAttribute("data-placeholder-template") || "Start typing - e.g., {example}";
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
  // Sortable tables
  // -----------------------------------------------------------------------------
  function initSortableTables() {
    const tables = Array.from(document.querySelectorAll(".js-sortable-table"));
    if (!tables.length) return;

    tables.forEach((table) => {
      const headers = Array.from(table.querySelectorAll("th[data-sort]"));
      if (!headers.length) return;

      headers.forEach((th) => {
        th.addEventListener("click", () => {
          const key = th.getAttribute("data-sort");
          if (!key) return;

          const current = th.getAttribute("aria-sort") || "none";
          const nextDir = current === "ascending" ? "descending" : "ascending";

          headers.forEach((h) => h.setAttribute("aria-sort", "none"));
          th.setAttribute("aria-sort", nextDir);

          table.dispatchEvent(
            new CustomEvent("table:sort", { detail: { key, dir: nextDir } })
          );
        });
      });
    });
  }

  // -----------------------------------------------------------------------------
  // Homepage search: prefix filtering + paging + respects current sort header state
  // -----------------------------------------------------------------------------
  function initSearchPage() {
    const input = $("#pasta-q");

    // This is the key: scripts.js writes to #pasta-search-count (not #pasta-search-status)
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

    function setSearchingUI(isSearching) {
      document.body.classList.toggle("is-searching", isSearching);

      if (resultsPanel) resultsPanel.hidden = !isSearching;

      // IMPORTANT:
      // Do NOT hide the Identify card while searching.
      // That was the source of the missing Identify link.
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

    function tokenize(s) {
      const n = normalize(s);
      if (!n) return [];
      return n.split(" ").map((x) => x.trim()).filter(Boolean);
    }

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
        tokens: tokenize(search),
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

      if (!list.length) {
        status.textContent = "No matches.";
      } else if (hasMore) {
        status.textContent = `${list.length} matches - showing ${visibleLimit}.`;
      } else {
        status.textContent = `${list.length} matches.`;
      }
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

      const matches = rows.filter((r) => {
        if (r.nameN.startsWith(q)) return true;
        for (const t of r.tokens) {
          if (t.startsWith(q)) return true;
        }
        return false;
      });

      matches.sort(compare);
      render(matches);
    }

    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        e.preventDefault();
        visibleLimit += PAGE_N;
        filterAndRender();
      });
    }

    table.addEventListener("table:sort", (e) => {
      const { key, dir } = (e.detail || {});
      if (key) sortKey = key;
      if (dir) sortDir = dir;

      visibleLimit = PAGE_N;
      filterAndRender();
    });

    input.addEventListener("input", () => {
      visibleLimit = PAGE_N;
      filterAndRender();
    });

    (function handleQueryParamOnLoad() {
      const params = new URLSearchParams(window.location.search);
      const q = params.get("q");
      if (!q) return;

      input.value = q;
      window.history.replaceState({}, "", window.location.pathname);

      visibleLimit = PAGE_N;
      filterAndRender();
    })();

    readSortStateFromHeaders();
    filterAndRender();
  }

  // -----------------------------------------------------------------------------
  // Identify page logic
  // -----------------------------------------------------------------------------
  function initIdentifyPage() {
    const root = $("#identify");
    if (!root) return;

    // Leaving your Identify logic untouched here, because the homepage issue
    // was caused by hiding the Identify card and clobbering the status line.
    // If you want me to sync this with your latest identify/index.njk, share it.
  }

  document.addEventListener("DOMContentLoaded", () => {
    initHamburgerMenu();
    initLinkedHomeRotators();
    initSortableTables();
    initSearchPage();
    initIdentifyPage();
  });
})();
