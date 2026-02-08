(() => {
  // =============================================================================
  // scripts.js
  // -----------------------------------------------------------------------------
  // PURPOSE
  // - One JS bundle for site interactions:
  //   - Mobile hamburger menu
  //   - Homepage linked rotators (search placeholder + icon)
  //   - Homepage search behavior (prefix matching) + table rendering
  //   - Identify page behavior (guided narrowing UI)  [Identify table pass next]
  //
  // IMPORTANT SEARCH DECISIONS
  // - Typing "P" returns pasta shapes that START WITH "P".
  // - Synonyms/aliases also match via STARTS WITH (token-based).
  // - "Previously searched / Recently viewed" remains removed.
  //
  // NOTE ABOUT SORTING
  // - Homepage results are now in an All-Pastas-style table.
  // - Clicking sortable headers updates aria-sort and triggers re-render
  //   using the current query + current sort.
  // =============================================================================

  const $ = (sel, root = document) => root.querySelector(sel);

  // =============================================================================
  // Mobile hamburger menu
  // =============================================================================
  function initHamburgerMenu() {
    const btn = $("#nav-toggle");
    const drawer = $("#nav-drawer");
    if (!btn || !drawer) return;

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

    drawer.addEventListener("click", (e) => {
      const a = e.target.closest("a[href]");
      if (a) closeMenu();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });

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
  // Linked home rotator (Homepage)
  // =============================================================================
  function initLinkedHomeRotators() {
    const input = $("#pasta-q");
    const img = $("#identify-icon-rotator");
    if (!input || !img) return;

    const reduceMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const groupA = input.getAttribute("data-rotator-group") || "";
    const groupB = img.getAttribute("data-rotator-group") || "";
    if (!groupA || groupA !== groupB) return;

    const rawSrcs = img.getAttribute("data-rotate-srcs") || "";
    const iconSrcs = rawSrcs.split(",").map((s) => s.trim()).filter(Boolean);

    const rawNames =
      input.getAttribute("data-placeholder-examples") ||
      img.getAttribute("data-rotate-names") ||
      "";
    const names = rawNames.split(",").map((s) => s.trim()).filter(Boolean);

    const N = Math.min(iconSrcs.length, names.length);
    if (N < 2) return;

    const intervalMs = Math.max(
      1200,
      parseInt(
        input.getAttribute("data-rotate-interval") ||
          img.getAttribute("data-rotate-interval") ||
          "2500",
        10
      )
    );
    const fadeMs = Math.max(120, parseInt(img.getAttribute("data-rotate-fade") || "240", 10));

    img.style.transitionDuration = `${fadeMs}ms`;

    const tpl = input.getAttribute("data-placeholder-template") || "Start typing - e.g., {example}";

    // Preload icons so the swap feels instant.
    try {
      for (let i = 0; i < N; i++) {
        const pre = new Image();
        pre.decoding = "async";
        pre.src = iconSrcs[i];
      }
    } catch (e) {}

    const currentSrc = img.getAttribute("src") || "";
    let idx = Math.max(0, iconSrcs.indexOf(currentSrc));
    if (idx >= N) idx = 0;

    function setPlaceholder(i) {
      const ex = names[i] || names[0] || "penne";
      input.setAttribute("placeholder", tpl.replace("{example}", ex));
    }
    setPlaceholder(idx);

    let timer = null;
    let swapping = false;

    function shouldRun() {
      const hasText = Boolean(String(input.value || "").trim());
      const isFocused = document.activeElement === input;
      return !hasText && !isFocused;
    }

    function fadeSwapIcon(newSrc) {
      if (swapping) return;
      swapping = true;

      img.classList.add("is-fading");
      window.setTimeout(() => {
        img.src = newSrc;
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

    if (shouldRun()) start();

    input.addEventListener("focus", () => stop(), { passive: true });
    input.addEventListener("input", () => {
      if (shouldRun()) start();
      else stop();
    });
    input.addEventListener("blur", () => {
      if (shouldRun()) start();
    });

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else if (shouldRun()) start();
    });
  }

  // =============================================================================
  // Generic sortable table helper
  // -----------------------------------------------------------------------------
  // EXPECTED MARKUP
  // - <table class="js-sortable-table">
  // - Sortable headers: <th data-sort="name" aria-sort="...">
  // - Rows provide:
  //     data-name, data-category  (and optional others)
  //
  // BEHAVIOR
  // - Toggle aria-sort among: none -> ascending -> descending
  // - Emits a CustomEvent on the table:
  //     "pasta:table-sort" { detail: { key, dir } }
  // =============================================================================
  function initSortableTables() {
    const tables = Array.from(document.querySelectorAll("table.js-sortable-table"));
    if (!tables.length) return;

    for (const table of tables) {
      const headers = Array.from(table.querySelectorAll("thead th[data-sort]"));
      if (!headers.length) continue;

      function setSortState(activeKey, dir) {
        for (const th of headers) {
          const key = th.getAttribute("data-sort");
          if (key === activeKey) th.setAttribute("aria-sort", dir);
          else th.setAttribute("aria-sort", "none");
        }
      }

      function currentSort() {
        const active = headers.find((th) => th.getAttribute("aria-sort") !== "none");
        if (!active) return { key: headers[0].getAttribute("data-sort"), dir: "ascending" };
        return {
          key: active.getAttribute("data-sort"),
          dir: active.getAttribute("aria-sort"),
        };
      }

      function toggle(th) {
        const key = th.getAttribute("data-sort");
        const cur = th.getAttribute("aria-sort") || "none";

        // Cycle: none -> ascending -> descending -> ascending ...
        let next = "ascending";
        if (cur === "ascending") next = "descending";
        if (cur === "descending") next = "ascending";

        setSortState(key, next);

        table.dispatchEvent(
          new CustomEvent("pasta:table-sort", {
            bubbles: true,
            detail: { key, dir: next },
          })
        );
      }

      // Click and keyboard activation
      for (const th of headers) {
        th.addEventListener("click", () => toggle(th));
        th.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle(th);
          }
        });
      }

      // Ensure there is always a sane initial state:
      // If no header has aria-sort != none, set first to ascending.
      const s = currentSort();
      setSortState(s.key, s.dir);
    }
  }

  // =============================================================================
  // Home/Search page behavior (PREFIX matching) + table row filtering
  // =============================================================================
  function initSearchPage() {
    const input = $("#pasta-q");
    const status = $("#pasta-search-status");
    const table = $("#pasta-results-table");
    const tbody = $("#pasta-results-body");
    if (!input || !status || !table || !tbody) return;

    const resultsPanel = $("#home-results-panel");
    const identifyCard = $("#home-identify-card");

    const note = $("#pasta-results-note");
    const nextBtn = $("#pasta-toggle-all");

    const PAGE_N = 10;
    let visibleLimit = PAGE_N;

    // Current sort state (driven by aria-sort on header cells)
    let sortKey = "name";
    let sortDir = "ascending";

    function setSearchingUI(isSearching) {
      document.body.classList.toggle("is-searching", isSearching);
      if (resultsPanel) resultsPanel.hidden = !isSearching;
      if (identifyCard) identifyCard.setAttribute("aria-hidden", isSearching ? "true" : "false");
    }

    function setControlVisible(el, isVisible) {
      if (!el) return;
      el.hidden = !isVisible;
      el.style.display = isVisible ? "" : "none";
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

    function normalizeQuery(s) {
      const q = normalize(s);
      if (/^(?:[a-z0-9]\s+){2,}[a-z0-9]$/.test(q)) return q.replace(/\s+/g, "");
      return q;
    }

    // Cache table rows once
    const rows = Array.from(tbody.querySelectorAll("tr[data-slug]"));

    const cache = rows.map((tr) => {
      const name = tr.getAttribute("data-name") || "";
      const category = tr.getAttribute("data-category") || "";
      const search = tr.getAttribute("data-search") || "";

      const nameN = normalize(name);
      const categoryN = normalize(category);
      const searchN = normalize(search);

      // Tokenize aliases for token-based prefix hits
      const tokens = searchN.split(" ").filter(Boolean);

      return { tr, name, category, nameN, categoryN, tokens };
    });

    function getSortStateFromHeaders() {
      const thName = table.querySelector('thead th[data-sort="name"]');
      const thCat = table.querySelector('thead th[data-sort="category"]');

      const all = [thName, thCat].filter(Boolean);
      const active = all.find((th) => th.getAttribute("aria-sort") !== "none");

      if (!active) return { key: "name", dir: "ascending" };
      return { key: active.getAttribute("data-sort"), dir: active.getAttribute("aria-sort") };
    }

    function compare(a, b, key, dir) {
      let av = "";
      let bv = "";

      if (key === "category") {
        av = a.categoryN;
        bv = b.categoryN;
      } else {
        // default to name
        av = a.nameN;
        bv = b.nameN;
      }

      const cmp = av.localeCompare(bv, "en", { sensitivity: "base" });
      return dir === "descending" ? -cmp : cmp;
    }

    function computeMatches(qN) {
      const matches = [];

      for (const row of cache) {
        if (!row.nameN) continue;

        // Primary: name startsWith
        if (row.nameN.startsWith(qN)) {
          matches.push(row);
          continue;
        }

        // Secondary: any token startsWith (aliases/synonyms)
        for (const t of row.tokens) {
          if (t.startsWith(qN)) {
            matches.push(row);
            break;
          }
        }
      }

      // Apply current sort
      matches.sort((a, b) => compare(a, b, sortKey, sortDir));

      return matches;
    }

    function renderRows(visibleRows, totalCount) {
      for (const r of rows) r.hidden = true;
      for (const row of visibleRows) row.tr.hidden = false;

      const count = totalCount ?? visibleRows.length;
      status.textContent = count === 0 ? "No matches" : `${count} match${count === 1 ? "" : "es"}`;

      const canShowMore = count > visibleLimit;
      setControlVisible(nextBtn, canShowMore);
      if (nextBtn) nextBtn.textContent = canShowMore ? "Next 10" : "Showing all";

      setControlVisible(note, Boolean(String(input.value || "").trim()));
    }

    function showAllRows() {
      for (const r of rows) r.hidden = false;
      setControlVisible(note, false);
      setControlVisible(nextBtn, false);
    }

    function runSearch(resetPaging = true) {
      const qN = normalizeQuery(input.value || "");
      const isSearching = Boolean(String(qN || "").trim());
      setSearchingUI(isSearching);

      if (resetPaging) visibleLimit = PAGE_N;

      // Refresh sort state (headers drive truth)
      const s = getSortStateFromHeaders();
      sortKey = s.key;
      sortDir = s.dir;

      if (!qN) {
        status.textContent = "Start typing to see matches.";
        showAllRows();
        return;
      }

      const matches = computeMatches(qN);
      const page = matches.slice(0, visibleLimit);
      renderRows(page, matches.length);
    }

    // Input-driven searching
    input.addEventListener("input", () => runSearch(true));

    // Paging
    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        e.preventDefault();
        visibleLimit += PAGE_N;
        runSearch(false);
      });
    }

    // React to table header sort toggles
    table.addEventListener("pasta:table-sort", () => {
      runSearch(false);
    });

    // Initial run (supports prefilled q=)
    runSearch(true);
  }

  // =============================================================================
  // Identify page behavior (unchanged for now)
  // - Next step: convert Identify results to the same table UI.
  // =============================================================================
  function initIdentifyPage() {
    const app = $("#identify-app");
    const dataScript = $("#identify-data");
    if (!app || !dataScript) return;

    // Prevent double-init if the template still has the embedded script.
    if (window.__pastaIdentifyInit) return;
    window.__pastaIdentifyInit = true;

    const els = {
      app,
      title: $("#identify-title"),
      kicker: $("#identify-kicker"),
      help: $("#identify-help"),
      answers: $("#identify-answers"),
      count: $("#identify-count"),
      resultsCard: $("#identify-results"),
      resultsCount: $("#identify-results-count"),
      resultsList: $("#identify-results-list"),
      btnBack: $("#identify-back"),
      btnReset: $("#identify-reset"),
      btnToggleResults: $("#identify-toggle-results"),
    };

    const IK_THUMBS_BASE = "https://ik.imagekit.io/mevius/pasta/thumbs/";
    const IK_IDENTIFY_BASE = "https://ik.imagekit.io/mevius/pasta/identify/";
    const FALLBACK_THUMB = "pending.png";

    const AUTO_SHOW_RESULTS_THRESHOLD = 10;

    const DEFAULT_RESULTS_LIMIT = 60;
    const RESULTS_PAGE_SIZE = 60;

    const isUrl = (s) => /^https?:\/\//i.test(String(s || "").trim());

    const fileNameOnly = (s) => {
      const str = String(s || "").trim();
      if (!str) return "";
      const clean = str.split("#")[0].split("?")[0];
      const parts = clean.split("/");
      return parts[parts.length - 1] || "";
    };

    const thumbUrlFor = (thumbRaw) => {
      if (isUrl(thumbRaw)) return String(thumbRaw).trim();
      const fn = fileNameOnly(thumbRaw);
      return IK_THUMBS_BASE + (fn || FALLBACK_THUMB);
    };

    const identifyIconUrlFor = (file) => IK_IDENTIFY_BASE + file;

    const answerIconFor = (questionKey, value) => {
      if (value === "__ns__") return identifyIconUrlFor(`${questionKey}-notsure.png`);
      return identifyIconUrlFor(`${questionKey}-${value}.png`);
    };

    let raw = [];
    try {
      raw = JSON.parse(dataScript.textContent || "[]");
    } catch (e) {
      console.error("Identify: failed to parse identify-data JSON", e);
      if (els.title) els.title.textContent = "Error loading data";
      if (els.help) els.help.textContent = "Could not parse pasta data on this page.";
      return;
    }

    const normalize = (v) => String(v || "").trim().toLowerCase();

    const TYPE_LABELS = {
      strand: "Strand",
      tube: "Tube",
      ribbon: "Ribbon",
      sheet: "Sheet",
      short: "Short cut",
      stuffed: "Stuffed",
      soup: "Soup (Pastina)",
      ring: "Ring",
      dumpling: "Dumpling",
    };

    const TYPE_DESCS = {
      strand: "Long, thin noodles (round or slightly flattened).",
      tube: "Hollow pasta designed to hold sauce inside.",
      ribbon: "Long, flat strips like fettuccine-style cuts.",
      sheet: "Sheets used for layering or cutting (lasagna-style).",
      short: "Short shapes that scoop, trap, or cling to sauce.",
      stuffed: "Filled pasta (pockets, pillows, or sealed edges).",
      soup: "Tiny pasta made for spoons and brothy soups.",
      ring: "Rings that catch sauce in openings.",
      dumpling: "Pasta-like dumplings (often irregular or rustic).",
    };

    const QUESTION_DEFS = [
      {
        key: "type",
        title: "What general type is it?",
        help: "Start broad - this narrows the list quickly.",
        kind: "enum",
        values: Object.keys(TYPE_LABELS),
        label: (v) => TYPE_LABELS[v] || v,
        desc: (v) => TYPE_DESCS[v] || "",
        icon: (v) => identifyIconUrlFor(`${v}.png`),
      },
      {
        key: "hollow",
        title: "Is it hollow?",
        help: "Hollow pasta has a visible tube or cavity.",
        kind: "bool",
        descYes: "You can see a tube or opening through the shape.",
        descNo: "Solid pasta - no tube or cavity.",
      },
      {
        key: "ridged",
        title: "Does it have ridges?",
        help: "Ridges (rigate) help grip sauce.",
        kind: "bool",
        descYes: "Noticeable grooves or ridges on the surface.",
        descNo: "Mostly smooth surface.",
      },
      {
        key: "twisted",
        title: "Is it twisted?",
        help: "Twisted shapes include spirals and corkscrews.",
        kind: "bool",
        descYes: "Spiraled or corkscrew-like geometry.",
        descNo: "Not spiraled or twisted.",
      },
      {
        key: "curved",
        title: "Is it curved?",
        help: "Curved shapes include elbows, crescents, and arcs.",
        kind: "bool",
        descYes: "Bent or arced rather than straight.",
        descNo: "Straight rather than bent.",
      },
      {
        key: "size",
        title: "What size is it?",
        help: "If you’re unsure, pick “Not sure” - size is often the least reliable.",
        kind: "enum",
        values: ["tiny", "small", "medium", "large"],
        label: (v) => v,
        icon: (v) => identifyIconUrlFor(`size-${v}.png`),
      },
    ];

    const initial = raw.map((r) => ({
      slug: r.slug,
      name: r.name,
      type: normalize(r.type),
      size: normalize(r.size),
      hollow: normalize(r.hollow),
      ridged: normalize(r.ridged),
      twisted: normalize(r.twisted),
      curved: normalize(r.curved),
      stuffed: normalize(r.stuffed),
      also: String(r.also || ""),
      thumb: String(r.thumb || ""),
    }));

    let working = initial.slice();
    let history = [];
    let resultsPanelPreference = "auto";
    let resultsLimit = DEFAULT_RESULTS_LIMIT;

    const setText = (el, txt) => { if (el) el.textContent = txt; };

    const sortWorking = () => {
      working.sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "en", { sensitivity: "base" })
      );
    };

    const renderMatchesCount = () => setText(els.count, `Matching: ${working.length}`);

    const showResultsPanel = (show) => {
      if (!els.resultsCard || !els.btnToggleResults) return;
      els.resultsCard.hidden = !show;
      els.btnToggleResults.hidden = false;

      if (!show) els.btnToggleResults.textContent = "Show all";
      else {
        els.btnToggleResults.textContent =
          resultsLimit >= working.length ? "Hide list" : "Show all";
      }
    };

    const shouldShowResultsPanel = () => {
      if (resultsPanelPreference === "show") return true;
      if (resultsPanelPreference === "hide") return false;
      return working.length <= AUTO_SHOW_RESULTS_THRESHOLD;
    };

    const renderResultsList = () => {
      if (!els.resultsList) return;

      els.resultsList.innerHTML = "";

      const n = Math.min(working.length, resultsLimit);

      for (const item of working.slice(0, n)) {
        const li = document.createElement("li");
        li.className = "result-card";

        const a = document.createElement("a");
        a.className = "result-link";
        a.href = `/pasta/${item.slug}/`;

        const thumb = document.createElement("div");
        thumb.className = "thumb";

        const img = document.createElement("img");
        img.width = 56;
        img.height = 56;
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = "";
        img.src = thumbUrlFor(item.thumb);

        thumb.appendChild(img);

        const body = document.createElement("div");
        body.className = "result-body";

        const titleRow = document.createElement("div");
        titleRow.className = "result-title-row";

        const strong = document.createElement("strong");
        strong.className = "result-name";
        strong.textContent = item.name;

        titleRow.appendChild(strong);
        body.appendChild(titleRow);

        a.appendChild(thumb);
        a.appendChild(body);
        li.appendChild(a);
        els.resultsList.appendChild(li);
      }

      setText(els.resultsCount, `${working.length} match${working.length === 1 ? "" : "es"}`);

      if (!els.resultsCard.hidden && resultsLimit < working.length) {
        const li = document.createElement("li");
        li.className = "result-card";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn secondary";
        btn.textContent = `Show more (${Math.min(working.length - resultsLimit, RESULTS_PAGE_SIZE)})`;
        btn.addEventListener("click", () => {
          resultsLimit = Math.min(working.length, resultsLimit + RESULTS_PAGE_SIZE);
          renderResultsList();
          if (els.btnToggleResults) {
            els.btnToggleResults.textContent =
              resultsLimit >= working.length ? "Hide list" : "Show all";
          }
        });

        li.appendChild(btn);
        els.resultsList.appendChild(li);
      }
    };

    const questionAlreadyAnswered = (key) => history.some((h) => h.key === key);

    const nextQuestion = () => {
      if (!questionAlreadyAnswered("type")) return QUESTION_DEFS.find((q) => q.key === "type");
      for (const q of QUESTION_DEFS) if (!questionAlreadyAnswered(q.key)) return q;
      return null;
    };

    const applyFilter = (key, value) => {
      const prev = working.slice();

      const normalizeBool = (v) => {
        if (v === "__ns__") return "__ns__";
        return String(v || "").toLowerCase();
      };

      working = working.filter((p) => {
        if (value === "__ns__") return true;
        const v = normalizeBool(value);
        const pv = normalizeBool(p[key]);
        return pv === v;
      });

      history.push({ key, value, prevWorking: prev });
      sortWorking();
    };

    const goBack = () => {
      const last = history.pop();
      if (!last) return;
      working = last.prevWorking.slice();
      sortWorking();
    };

    const resetAll = () => {
      history = [];
      working = initial.slice();
      resultsLimit = DEFAULT_RESULTS_LIMIT;
      resultsPanelPreference = "auto";
      sortWorking();
    };

    const renderQuestion = () => {
      const q = nextQuestion();

      renderMatchesCount();

      if (!q) {
        setText(els.title, "Done");
        setText(els.kicker, "Here are your matches.");
        setText(els.help, "Use Back to change your last answer, or Reset to start over.");
        if (els.answers) els.answers.innerHTML = "";
        showResultsPanel(true);
        renderResultsList();
        return;
      }

      setText(els.title, q.title);
      setText(els.kicker, `Step ${history.length + 1}`);
      setText(els.help, q.help || "");

      if (els.btnBack) els.btnBack.hidden = history.length === 0;
      if (els.btnReset) els.btnReset.hidden = history.length === 0;

      showResultsPanel(shouldShowResultsPanel());
      renderResultsList();

      if (!els.answers) return;
      els.answers.innerHTML = "";
      els.answers.setAttribute("data-kind", q.kind);
      els.answers.setAttribute("data-key", q.key);

      const makeAnswer = (value, label, desc, iconUrl) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "identify-answer";

        if (q.kind === "bool") {
          const glyph = document.createElement("span");
          glyph.className = "identify-answer-glyph";
          glyph.textContent = value === "yes" ? "Y" : value === "no" ? "N" : "?";
          btn.appendChild(glyph);
        } else {
          const img = document.createElement("img");
          img.alt = "";
          img.loading = "lazy";
          img.decoding = "async";
          img.width = 56;
          img.height = 56;
          img.src = iconUrl || "";
          btn.appendChild(img);
        }

        const meta = document.createElement("span");
        meta.className = "identify-answer-meta";

        const title = document.createElement("span");
        title.className = "identify-answer-title";
        title.textContent = label;
        meta.appendChild(title);

        if (desc) {
          const d = document.createElement("span");
          d.className = "identify-answer-desc";
          d.textContent = desc;
          meta.appendChild(d);
        }

        btn.appendChild(meta);

        btn.addEventListener("click", () => {
          applyFilter(q.key, value);
          renderQuestion();
        });

        return btn;
      };

      if (q.kind === "enum") {
        for (const v of q.values) {
          els.answers.appendChild(
            makeAnswer(
              v,
              q.label ? q.label(v) : String(v),
              q.desc ? q.desc(v) : "",
              q.icon ? q.icon(v) : ""
            )
          );
        }

        els.answers.appendChild(
          makeAnswer("__ns__", "Not sure", "Skip this question.", q.icon ? q.icon("__ns__") : "")
        );
      }

      if (q.kind === "bool") {
        els.answers.appendChild(makeAnswer("yes", "Yes", q.descYes || "", answerIconFor(q.key, "yes")));
        els.answers.appendChild(makeAnswer("no", "No", q.descNo || "", answerIconFor(q.key, "no")));
        els.answers.appendChild(makeAnswer("__ns__", "Not sure", "Skip this question.", answerIconFor(q.key, "__ns__")));
      }

      if (q.kind === "single") {
        els.answers.appendChild(makeAnswer("__ns__", "Continue", "", ""));
      }
    };

    if (els.btnBack) els.btnBack.addEventListener("click", () => { goBack(); renderQuestion(); });
    if (els.btnReset) els.btnReset.addEventListener("click", () => { resetAll(); renderQuestion(); });

    if (els.btnToggleResults) {
      els.btnToggleResults.addEventListener("click", () => {
        const currentlyHidden = Boolean(els.resultsCard && els.resultsCard.hidden);

        if (currentlyHidden) {
          resultsPanelPreference = "show";
          if (els.resultsCard) els.resultsCard.hidden = false;
          resultsLimit = working.length;
          renderResultsList();
          els.btnToggleResults.textContent = "Hide list";
        } else {
          resultsPanelPreference = "hide";
          if (els.resultsCard) els.resultsCard.hidden = true;
          els.btnToggleResults.textContent = "Show all";
        }
      });
    }

    sortWorking();
    renderQuestion();
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
