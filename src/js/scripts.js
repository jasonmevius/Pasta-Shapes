(() => {
  // =============================================================================
  // /src/js/scripts.js
  // -----------------------------------------------------------------------------
  // PURPOSE
  // - One JS bundle for site interactions:
  //   - Mobile hamburger menu
  //   - Homepage linked rotators (search placeholder + icon)
  //   - Homepage search behavior (prefix matching) + table rendering
  //   - Identify page behavior (guided narrowing UI)
  //
  // IMPORTANT
  // - The homepage may also include /src/js/pasta-search.js for typeahead
  //   suggestions + redirect logic.
  // - To avoid both scripts overwriting the same status line, this file writes
  //   table-filter counts into #pasta-search-count (falling back to
  //   #pasta-search-status only if needed).
  //
  // STYLE GUIDELINES
  // - All CSS belongs in styles.css (no inline <style> blocks).
  // - JS may toggle attributes/classes, but should avoid authoring CSS rules.
  // =============================================================================

  // -----------------------------------------------------------------------------
  // Tiny DOM helper
  // -----------------------------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);

  // -----------------------------------------------------------------------------
  // Hamburger menu
  // -----------------------------------------------------------------------------
  function initHamburgerMenu() {
    const btn = $("#menu-toggle");
    const panel = $("#site-nav");
    if (!btn || !panel) return;

    // Ensure closed by default
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

    // If the homepage structure changes, fail gracefully.
    if (!input || !icon) return;

    // Data attributes live on the input/icon for flexibility.
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

    // Defensive - keep arrays aligned by smallest length.
    const n = Math.min(examples.length, srcs.length, names.length);
    if (n <= 0) return;

    let i = 0;

    function tick() {
      i = (i + 1) % n;

      // Update placeholder
      const example = examples[i];
      input.setAttribute("placeholder", tpl.replace("{example}", example));

      // Update icon
      icon.setAttribute("src", srcs[i]);

      // We intentionally keep icon alt="" because it's decorative on homepage.
      // Names are still available in data attributes if needed later.
    }

    // Start rotating only when user is not actively typing.
    let timer = window.setInterval(tick, intervalMs);

    input.addEventListener("focus", () => {
      // Pause rotation while focused (reduces distraction).
      if (timer) window.clearInterval(timer);
      timer = null;
    });

    input.addEventListener("blur", () => {
      // Resume rotation after focus leaves input.
      if (!timer) timer = window.setInterval(tick, intervalMs);
    });
  }

  // -----------------------------------------------------------------------------
  // Sortable tables - reads data-sort headers and aria-sort state
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

          // Determine current direction
          const current = th.getAttribute("aria-sort") || "none";
          const nextDir = current === "ascending" ? "descending" : "ascending";

          // Reset all
          headers.forEach((h) => h.setAttribute("aria-sort", "none"));
          th.setAttribute("aria-sort", nextDir);

          // Emit a custom event so other parts (search) can respond.
          table.dispatchEvent(
            new CustomEvent("table:sort", { detail: { key, dir: nextDir } })
          );
        });
      });
    });
  }

  // -----------------------------------------------------------------------------
  // Homepage search - prefix matching + paging + respects current sort header state
  // -----------------------------------------------------------------------------
  function initSearchPage() {
    const input = $("#pasta-q");

    // Search status elements:
    // - #pasta-search-status is used by pasta-search.js (typeahead messaging)
    // - #pasta-search-count is used by this file (table filter counts)
    const status = $("#pasta-search-count") || $("#pasta-search-status");

    const table = $("#pasta-results-table");
    const tbody = $("#pasta-results-body");
    if (!input || !status || !table || !tbody) return;

    const resultsPanel = $("#home-results-panel");
    const note = $("#pasta-results-note");
    const nextBtn = $("#pasta-toggle-all");

    const PAGE_N = 10;
    let visibleLimit = PAGE_N;

    // Current sort state (driven by aria-sort on header cells)
    let sortKey = "name";
    let sortDir = "ascending";

    function setSearchingUI(isSearching) {
      // Toggle a body class so CSS can adjust layout when results are visible.
      // IMPORTANT: We do NOT hide the Identify card here. Users should always be
      // able to click "Identify by Shape" even after they start typing.
      document.body.classList.toggle("is-searching", isSearching);
      if (resultsPanel) resultsPanel.hidden = !isSearching;
    }

    function setControlVisible(el, isVisible) {
      if (!el) return;
      el.hidden = !isVisible;
      el.setAttribute("aria-hidden", isVisible ? "false" : "true");
    }

    // Normalization helpers
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

    // Treat "p e n n e" like "penne"
    function maybeUnspaceLetters(q) {
      const t = String(q || "").trim();
      // If it looks like spaced letters, remove spaces (but keep normal words alone)
      if (/^([a-z]\s+){2,}[a-z]$/i.test(t)) return t.replace(/\s+/g, "");
      return t;
    }

    function tokenize(s) {
      const n = normalize(s);
      if (!n) return [];
      return n.split(" ").map((x) => x.trim()).filter(Boolean);
    }

    // Cache initial rows (DOM -> data objects)
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

    // Read initial sort state from table headers (aria-sort)
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
      // Default if nothing marked
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
      // Default: name
      return a.nameN.localeCompare(b.nameN) * dir;
    }

    // Render subset (after filter + sort)
    function render(list) {
      tbody.innerHTML = "";
      const slice = list.slice(0, visibleLimit);
      slice.forEach((r) => tbody.appendChild(r.tr));

      // Paging controls
      const hasMore = list.length > visibleLimit;
      setControlVisible(nextBtn, hasMore);

      // Note visibility
      setControlVisible(note, list.length > 0);

      // Count status (this file owns #pasta-search-count)
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
        // When empty, hide results panel and show a friendly prompt
        if (resultsPanel) resultsPanel.hidden = true;
        status.textContent = "Start typing to see matches.";
        setControlVisible(nextBtn, false);
        setControlVisible(note, false);
        return;
      }

      // Prefix match - name startsWith OR any token startsWith
      const matches = rows.filter((r) => {
        if (r.nameN.startsWith(q)) return true;
        for (const t of r.tokens) {
          if (t.startsWith(q)) return true;
        }
        return false;
      });

      // Sort, then render
      matches.sort(compare);
      render(matches);
    }

    // Hook up next paging
    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        e.preventDefault();
        visibleLimit += PAGE_N;
        filterAndRender();
      });
    }

    // Watch sort changes emitted by initSortableTables()
    table.addEventListener("table:sort", (e) => {
      const { key, dir } = (e.detail || {});
      if (key) sortKey = key;
      if (dir) sortDir = dir;
      // Reset paging on sort for a predictable UX
      visibleLimit = PAGE_N;
      filterAndRender();
    });

    // Input listener
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
      // Clean the URL (optional but nice)
      window.history.replaceState({}, "", window.location.pathname);

      visibleLimit = PAGE_N;
      filterAndRender();
    })();

    // Init
    readSortStateFromHeaders();
    filterAndRender();
  }

  // -----------------------------------------------------------------------------
  // Identify page behavior (kept as-is - depends on identify page DOM existing)
  // -----------------------------------------------------------------------------
  function initIdentifyPage() {
    const root = $("#identify");
    if (!root) return;

    // This site has a dedicated Identify page. The logic here is expected to
    // be robust to missing elements and should only run when #identify exists.

    // NOTE: Your Identify logic is large and project-specific. We keep the
    // current implementation intact by leaving it unchanged from your file.
    // If you want, we can also harden it similarly, but it’s unrelated to the
    // homepage breakage you reported.

    // ---- BEGIN original Identify logic (from your file) -----------------------
    // (Kept verbatim to avoid regressions)
    // --------------------------------------------------------------------------

    const els = {
      questionCard: $("#identify-question-card"),
      questionTitle: $("#identify-question-title"),
      answers: $("#identify-answers"),
      backBtn: $("#identify-back"),
      resetBtn: $("#identify-reset"),
      progress: $("#identify-progress"),
      resultsCard: $("#identify-results-card"),
      resultsList: $("#identify-results-list"),
      resultsCount: $("#identify-results-count"),
      btnToggleResults: $("#identify-toggle-results"),
      note: $("#identify-note"),
    };

    // If the identify page markup doesn't match, bail safely.
    if (!els.questionCard || !els.questionTitle || !els.answers || !els.resultsList) return;

    // Read dataset from embedded JSON script tag
    const dataEl = $("#identify-data");
    let data = null;
    try {
      data = dataEl ? JSON.parse(dataEl.textContent || "{}") : null;
    } catch {
      data = null;
    }
    if (!data || !Array.isArray(data.items) || !Array.isArray(data.questions)) return;

    const items = data.items;
    const questions = data.questions;

    // State
    let stepIndex = 0;
    const history = []; // { stepIndex, answerKey, remainingSlugs[] }
    let remaining = items.map((x) => x.slug);

    // Helpers
    function slugToItem(slug) {
      return items.find((x) => x.slug === slug);
    }

    function intersect(a, b) {
      const setB = new Set(b);
      return a.filter((x) => setB.has(x));
    }

    function computeRemaining(q, answerKey, fromSlugs) {
      // question schema expected: { key, property, choices: [{ key, label, matches: [...] }] }
      const choice = (q.choices || []).find((c) => c.key === answerKey);
      if (!choice) return fromSlugs;

      // If choice has explicit matches list, use it
      if (Array.isArray(choice.matches) && choice.matches.length) {
        return intersect(fromSlugs, choice.matches);
      }

      // Otherwise, attempt property match (boolean or categorical)
      if (q.property) {
        return fromSlugs.filter((slug) => {
          const it = slugToItem(slug);
          if (!it) return false;
          const val = it[q.property];

          if (typeof val === "boolean") {
            if (answerKey === "yes") return val === true;
            if (answerKey === "no") return val === false;
            return true; // notsure
          }

          if (typeof val === "string") {
            return normalize(val) === normalize(answerKey);
          }

          return true;
        });
      }

      return fromSlugs;
    }

    function setText(el, txt) {
      if (el) el.textContent = txt || "";
    }

    function renderResults(slugs) {
      els.resultsList.innerHTML = "";
      const sorted = slugs
        .slice()
        .map((s) => slugToItem(s))
        .filter(Boolean)
        .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));

      for (const it of sorted) {
        const li = document.createElement("li");
        li.className = "identify-result";

        const a = document.createElement("a");
        a.href = it.url || `/pasta/${it.slug}/`;
        a.textContent = it.name || it.slug;
        li.appendChild(a);

        els.resultsList.appendChild(li);
      }

      setText(els.resultsCount, `${slugs.length} match${slugs.length === 1 ? "" : "es"}`);
    }

    function updateProgress() {
      const pct = Math.round((stepIndex / questions.length) * 100);
      if (els.progress) els.progress.style.setProperty("--progress", `${pct}%`);
    }

    function renderQuestion() {
      const q = questions[stepIndex];
      if (!q) return;

      setText(els.questionTitle, q.question || "");

      els.answers.innerHTML = "";
      (q.choices || []).forEach((c) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "identify-answer";
        btn.setAttribute("data-answer", c.key);

        // If the choice is Y/N/? style, your CSS can render it appropriately.
        // We keep label text as given in data.
        btn.textContent = c.label || c.key;

        btn.addEventListener("click", () => {
          history.push({ stepIndex, answerKey: c.key, remaining: remaining.slice() });

          remaining = computeRemaining(q, c.key, remaining);
          stepIndex = Math.min(stepIndex + 1, questions.length);

          renderResults(remaining);
          updateProgress();

          // If we reached the end, show results card
          if (stepIndex >= questions.length) {
            if (els.questionCard) els.questionCard.hidden = true;
            if (els.resultsCard) els.resultsCard.hidden = false;
          } else {
            renderQuestion();
          }
        });

        els.answers.appendChild(btn);
      });

      // Buttons
      if (els.backBtn) {
        els.backBtn.hidden = history.length === 0;
        els.backBtn.onclick = () => {
          const prev = history.pop();
          if (!prev) return;

          stepIndex = prev.stepIndex;
          remaining = prev.remaining;

          if (els.questionCard) els.questionCard.hidden = false;
          if (els.resultsCard) els.resultsCard.hidden = false;

          renderResults(remaining);
          updateProgress();
          renderQuestion();
        };
      }

      if (els.resetBtn) {
        els.resetBtn.onclick = () => {
          stepIndex = 0;
          history.length = 0;
          remaining = items.map((x) => x.slug);

          if (els.questionCard) els.questionCard.hidden = false;
          if (els.resultsCard) els.resultsCard.hidden = false;

          renderResults(remaining);
          updateProgress();
          renderQuestion();
        };
      }

      // Initial results view
      renderResults(remaining);
      updateProgress();
    }

    // Boot identify
    if (els.questionCard) els.questionCard.hidden = false;
    if (els.resultsCard) els.resultsCard.hidden = false;
    renderQuestion();

    // ---- END original Identify logic -----------------------------------------
  }

  // =============================================================================
  // Boot
  // =============================================================================
  document.addEventListener("DOMContentLoaded", () => {
    initHamburgerMenu();
    initLinkedHomeRotators();
    initSortableTables(); // must run before initSearchPage reads aria-sort
    initSearchPage();
    initIdentifyPage();
  });
})();
