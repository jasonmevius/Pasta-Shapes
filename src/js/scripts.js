(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  // --- Recently viewed helpers ---
  function readRecents() {
    try { return JSON.parse(localStorage.getItem("pasta:recent") || "[]"); }
    catch (e) { return []; }
  }

  function writeRecents(arr) {
    try { localStorage.setItem("pasta:recent", JSON.stringify(arr.slice(0, 12))); }
    catch (e) {}
  }

  function addRecent(slug) {
    if (!slug) return;
    const cur = readRecents().filter(x => x !== slug);
    cur.unshift(slug);
    writeRecents(cur);
  }

  // --- Search page behavior ---
  function initSearchPage() {
    const input = $("#pasta-q");
    const status = $("#pasta-search-status");
    const list = $("#pasta-results");
    if (!input || !status || !list) return;

    const cards = Array.from(list.querySelectorAll("[data-search]"));
    const recentWrap = $("#recently-viewed-wrap");
    const recentList = $("#recently-viewed");
    const norm = (s) => (s || "").toLowerCase().trim();

    function setStatus(visibleCount, totalCount, q) {
      if (!q) {
        status.textContent = "Type to filter - aliases included.";
        return;
      }
      status.textContent = `${visibleCount} of ${totalCount} matches`;
    }

    function filter() {
      const q = norm(input.value);
      const total = cards.length;
      let visible = 0;

      for (const card of cards) {
        const blob = norm(card.getAttribute("data-search"));
        const show = !q || blob.includes(q);
        card.style.display = show ? "" : "none";
        if (show) visible++;
      }
      setStatus(visible, total, q);
    }

    function renderRecents() {
      if (!recentWrap || !recentList) return;

      const slugs = readRecents();
      if (!slugs.length) {
        recentWrap.hidden = true;
        return;
      }

      const bySlug = new Map(cards.map(c => [c.getAttribute("data-slug"), c]));
      const items = slugs.map(s => bySlug.get(s)).filter(Boolean).slice(0, 8);

      if (!items.length) {
        recentWrap.hidden = true;
        return;
      }

      recentList.innerHTML = "";
      for (const card of items) {
        const link = card.querySelector("a[href]");
        const name = card.querySelector(".result-name");
        if (!link) continue;

        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = link.getAttribute("href");
        a.textContent = name ? name.textContent : a.href;
        li.appendChild(a);
        recentList.appendChild(li);
      }

      recentWrap.hidden = false;
    }

    // Record recents on click
    list.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-recent]");
      if (!a) return;

      const href = a.getAttribute("href") || "";
      const m = href.match(/\/pasta\/([^\/]+)\//);
      if (m && m[1]) addRecent(m[1]);
    });

    // Optional: support ?q= prefill
    try {
      const url = new URL(window.location.href);
      const q = url.searchParams.get("q");
      if (q) input.value = q;
    } catch (e) {}

    input.addEventListener("input", filter, { passive: true });

    filter();
    renderRecents();
  }

  // --- Detail page behavior (store recent on load) ---
  function initDetailPage() {
    const path = window.location.pathname || "";
    const m = path.match(/^\/pasta\/([^\/]+)\/?$/);
    if (m && m[1]) addRecent(m[1]);
  }

  // =============================================================================
  // Identify page behavior
  // =============================================================================

  function initIdentifyPage() {
    const app = $("#identify-app");
    const dataEl = $("#identify-data");
    if (!app || !dataEl) return;

    let items = [];
    try { items = JSON.parse(dataEl.textContent || "[]"); }
    catch (e) { items = []; }

    const kicker = $("#identify-kicker");
    const title = $("#identify-title");
    const help = $("#identify-help");
    const answers = $("#identify-answers");
    const count = $("#identify-count");

    const btnBack = $("#identify-back");
    const btnReset = $("#identify-reset");
    const btnView = $("#identify-view");

    const resultsWrap = $("#identify-results");
    const resultsCount = $("#identify-results-count");
    const resultsList = $("#identify-results-list");

    const QUESTION_ORDER = [
      "type",      // forced first
      "hollow",
      "stuffed",
      "ridged",
      "twisted",
      "curved",
      "size"
    ];

    const QUESTION_META = {
      type: {
        label: "What type is it?",
        help: "Pick the overall shape family.",
        pretty: (v) => ({
          strand: "Strand",
          tube: "Tube",
          ribbon: "Ribbon",
          sheet: "Sheet",
          short: "Short cut",
          stuffed: "Stuffed",
          soup: "Soup / pastina",
          ring: "Ring / wheel",
          dumpling: "Dumpling / pasta-like"
        }[v] || v)
      },
      hollow: { label: "Is it hollow?", help: "Does it have a hole or tunnel through it?", pretty: ynPretty },
      stuffed: { label: "Is it stuffed?", help: "Is there a filling inside?", pretty: ynPretty },
      ridged: { label: "Does it have ridges?", help: "Look for grooves or ruffles on the surface.", pretty: ynPretty },
      twisted: { label: "Is it twisted?", help: "Does it spiral or corkscrew?", pretty: ynPretty },
      curved: { label: "Is it curved?", help: "Is the shape bent or arched?", pretty: ynPretty },
      size: {
        label: "What size is it?",
        help: "Pick the closest size bucket.",
        pretty: (v) => v
      }
    };

    function ynPretty(v) {
      const s = (v || "").toLowerCase();
      if (s === "yes") return "Yes";
      if (s === "no") return "No";
      if (!s || s === "unknown") return "Unknown";
      return v;
    }

    function normVal(v) {
      const s = (v || "").toString().trim().toLowerCase();
      if (!s) return "unknown";
      return s;
    }

    function itemVal(item, key) {
      if (key === "type") return normVal(item.type);
      if (key === "size") return normVal(item.size);
      if (key === "hollow") return normVal(item.hollow);
      if (key === "ridged") return normVal(item.ridged);
      if (key === "twisted") return normVal(item.twisted);
      if (key === "curved") return normVal(item.curved);
      if (key === "stuffed") return normVal(item.stuffed);
      return "unknown";
    }

    const state = {
      selections: {},   // key -> value
      history: [],      // stack of { key, value }
      showResults: false
    };

    function applyFilters() {
      const keys = Object.keys(state.selections);
      if (!keys.length) return items.slice();

      return items.filter(it => {
        for (const k of keys) {
          const want = state.selections[k];
          const got = itemVal(it, k);
          if (want === "__any__") continue;
          if (got !== want) return false;
        }
        return true;
      });
    }

    function scoreQuestion(candidates, key) {
      // Ignore questions already answered
      if (state.selections[key] && state.selections[key] !== "__any__") return -1;

      const buckets = new Map();
      for (const it of candidates) {
        const v = itemVal(it, key);
        buckets.set(v, (buckets.get(v) || 0) + 1);
      }

      // Need at least 2 meaningful options to ask
      if (buckets.size < 2) return -1;

      // Score by how evenly it splits (Gini-like)
      const n = candidates.length || 1;
      let sumSq = 0;
      for (const c of buckets.values()) {
        const p = c / n;
        sumSq += p * p;
      }
      const gini = 1 - sumSq; // higher is better split
      return gini;
    }

    function pickNextQuestion(candidates) {
      // Force type first if not answered
      if (!state.selections.type) return "type";

      let bestKey = null;
      let bestScore = -1;

      for (const key of QUESTION_ORDER) {
        if (key === "type") continue;
        const s = scoreQuestion(candidates, key);
        if (s > bestScore) {
          bestScore = s;
          bestKey = key;
        }
      }

      // If nothing else splits, we end and show results
      return bestKey;
    }

    function buildOptions(candidates, key) {
      const buckets = new Map();
      for (const it of candidates) {
        const v = itemVal(it, key);
        buckets.set(v, (buckets.get(v) || 0) + 1);
      }

      // Sort options: common first, unknown last
      const entries = Array.from(buckets.entries()).sort((a, b) => {
        if (a[0] === "unknown") return 1;
        if (b[0] === "unknown") return -1;
        return b[1] - a[1];
      });

      // Turn into button models
      const pretty = QUESTION_META[key].pretty || ((x) => x);
      return entries.map(([value, n]) => ({
        value,
        label: pretty(value),
        count: n
      }));
    }

    function setQuestionUI(key, candidates) {
      const meta = QUESTION_META[key];

      kicker.textContent = "Question";
      title.textContent = meta.label;
      help.textContent = meta.help || "";

      const opts = buildOptions(candidates, key);

      answers.innerHTML = "";

      for (const opt of opts) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn secondary answer-btn";
        btn.setAttribute("data-q", key);
        btn.setAttribute("data-v", opt.value);
        btn.innerHTML = `<span>${escapeHtml(opt.label)}</span><span class="answer-right">${opt.count}</span>`;
        answers.appendChild(btn);
      }

      // Add Not sure (skip this question)
      const skip = document.createElement("button");
      skip.type = "button";
      skip.className = "btn secondary answer-btn";
      skip.setAttribute("data-q", key);
      skip.setAttribute("data-v", "__any__");
      skip.innerHTML = `<span>Not sure</span><span class="answer-right">keep options</span>`;
      answers.appendChild(skip);
    }

    function setResultsUI(candidates) {
      resultsCount.textContent = `${candidates.length} match${candidates.length === 1 ? "" : "es"}`;
      resultsList.innerHTML = "";

      for (const it of candidates.slice(0, 200)) {
        const li = document.createElement("li");
        li.className = "result-card";

        const a = document.createElement("a");
        a.className = "result-link";
        a.href = `/pasta/${it.slug}/`;
        a.setAttribute("data-recent", "pasta");

        const thumb = document.createElement("div");
        thumb.className = "thumb";

        if (it.thumb) {
          const img = document.createElement("img");
          img.src = it.thumb;
          img.alt = "";
          img.width = 56;
          img.height = 56;
          img.loading = "lazy";
          img.decoding = "async";
          thumb.appendChild(img);
        } else {
          const span = document.createElement("span");
          span.className = "thumb-na muted";
          span.textContent = "N/A";
          thumb.appendChild(span);
        }

        const body = document.createElement("div");
        body.className = "result-body";

        const titleRow = document.createElement("div");
        titleRow.className = "result-title-row";

        const strong = document.createElement("strong");
        strong.className = "result-name";
        strong.textContent = it.name;

        const type = document.createElement("span");
        type.className = "result-type muted";
        type.textContent = it.type ? QUESTION_META.type.pretty(it.type) : "";

        titleRow.appendChild(strong);
        if (type.textContent) titleRow.appendChild(type);

        const desc = document.createElement("div");
        desc.className = "result-desc muted";
        desc.textContent = compactDescriptor(it);

        body.appendChild(titleRow);
        body.appendChild(desc);

        a.appendChild(thumb);
        a.appendChild(body);
        li.appendChild(a);
        resultsList.appendChild(li);
      }
    }

    function compactDescriptor(it) {
      const parts = [];
      const size = normVal(it.size);
      if (size !== "unknown") parts.push(size);

      if (normVal(it.stuffed) === "yes") parts.push("stuffed");
      if (normVal(it.ridged) === "yes") parts.push("ridged");
      if (normVal(it.twisted) === "yes") parts.push("twisted");
      if (normVal(it.hollow) === "yes") parts.push("hollow");
      if (it.type) parts.push(it.type);
      if (normVal(it.curved) === "yes") parts.push("(curved)");

      return parts.join(" ").trim();
    }

    function render() {
      const candidates = applyFilters();

      // Bottom bar labels
      count.textContent = `Matches: ${candidates.length}`;
      btnView.textContent = `View matches (${candidates.length})`;
      btnBack.disabled = state.history.length === 0;

      // Results toggle
      resultsWrap.hidden = !state.showResults;
      if (state.showResults) {
        setResultsUI(candidates);
      }

      // Question view
      if (!state.showResults) {
        const nextQ = pickNextQuestion(candidates);
        if (!nextQ) {
          // No more useful questions - show results automatically
          state.showResults = true;
          render();
          return;
        }
        setQuestionUI(nextQ, candidates);
      }
    }

    function choose(key, value) {
      // Handle skip
      if (value === "__any__") {
        state.selections[key] = "__any__";
        state.history.push({ key, value: "__any__" });
        state.showResults = false;
        render();
        return;
      }

      // Save selection
      state.selections[key] = value;
      state.history.push({ key, value });
      state.showResults = false;

      // Zero-results protection: if this choice yields zero, undo and show message
      const after = applyFilters();
      if (after.length === 0) {
        // Undo
        state.history.pop();
        delete state.selections[key];

        // Simple feedback in helper line
        help.textContent = "That combination produced 0 matches - try a different answer or tap Not sure.";
      }

      render();
    }

    function back() {
      const last = state.history.pop();
      if (!last) return;

      // Remove selection; if there are multiple entries for same key, reapply earlier one
      delete state.selections[last.key];
      for (let i = state.history.length - 1; i >= 0; i--) {
        if (state.history[i].key === last.key) {
          state.selections[last.key] = state.history[i].value;
          break;
        }
      }

      state.showResults = false;
      render();
    }

    function reset() {
      state.selections = {};
      state.history = [];
      state.showResults = false;
      render();
    }

    function toggleResults() {
      state.showResults = !state.showResults;
      render();
    }

    // Events
    answers.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-q][data-v]");
      if (!btn) return;
      choose(btn.getAttribute("data-q"), btn.getAttribute("data-v"));
    });

    btnBack.addEventListener("click", back);
    btnReset.addEventListener("click", reset);
    btnView.addEventListener("click", toggleResults);

    // Record recents from Identify results clicks
    resultsList.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-recent]");
      if (!a) return;

      const href = a.getAttribute("href") || "";
      const m = href.match(/\/pasta\/([^\/]+)\//);
      if (m && m[1]) addRecent(m[1]);
    });

    // Initial render
    render();
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // Init
  document.addEventListener("DOMContentLoaded", () => {
    initSearchPage();
    initDetailPage();
    initIdentifyPage();
  }, { once: true });
})();
