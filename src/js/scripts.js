(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  // =============================================================================
  // ImageKit helpers (CSV stores filenames only)
  // =============================================================================
  const IK_BASE = "https://ik.imagekit.io/mevius";
  const IK_THUMBS = `${IK_BASE}/pasta/thumbs/`;
  const IK_PENDING_THUMB = `${IK_THUMBS}pending.png`;

  function isAbsUrl(s) {
    return /^https?:\/\//i.test(String(s || "").trim());
  }

  function toThumbUrl(v) {
    const raw = String(v || "").trim();

    // Treat common placeholders as "missing"
    if (!raw) return IK_PENDING_THUMB;
    if (raw.toLowerCase() === "n/a") return IK_PENDING_THUMB;
    if (raw.toLowerCase() === "na") return IK_PENDING_THUMB;

    // Already absolute - use as-is
    if (isAbsUrl(raw)) return raw;

    // Back-compat: "<ImageKitPath>/..." -> replace with IK_BASE
    if (raw.includes("<ImageKitPath>")) {
      return raw.replace("<ImageKitPath>", IK_BASE);
    }

    // If they somehow pass "/pasta/thumbs/x.png" or "pasta/thumbs/x.png"
    if (raw.startsWith("/")) return IK_BASE + raw;
    if (raw.startsWith("pasta/")) return `${IK_BASE}/${raw}`;

    // If they pass "thumbs/x.png" or "pasta/thumbs/x.png" in some variant
    if (raw.includes("/")) {
      // If it already includes "pasta/thumb" somewhere, just prefix base.
      if (raw.includes("pasta/thumb")) return `${IK_BASE}/${raw.replace(/^\/+/, "")}`;
      // Otherwise assume it's relative to thumbs.
      return IK_THUMBS + raw.split("/").pop();
    }

    // Otherwise - assume filename only
    return IK_THUMBS + raw;
  }

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
    const recentWrap = $("#recently-viewed-wrap");
    const recentList = $("#recently-viewed");

    const note = $("#pasta-results-note");
    const toggleBtn = $("#pasta-toggle-all");

    const TOP_N = 10;
    let showAll = false;

    // -----------------------------------------------------------------------------
    // Normalization (match what we do in pasta-search.js / pastaIndex.js)
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

    function stripStopwords(normalizedString) {
      const parts = (normalizedString || "")
        .split(" ")
        .map((t) => t.trim())
        .filter(Boolean)
        .filter((t) => !STOPWORDS.has(t));
      return parts.join(" ").trim();
    }

    // -----------------------------------------------------------------------------
    // Optional fuzzy support for the "Results" list using /api/pasta-index.json
    // -----------------------------------------------------------------------------
    let indexLoaded = false;
    let index = null; // { aliasToSlug, entries }
    let aliasKeys = null; // normalized alias keys
    let stopKeyToSlugs = null; // stopword-stripped key -> Set(slugs)
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

    // Levenshtein distance with early exit (bounded)
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

    function bestFuzzySlugs(qKey, limit = 10) {
      if (!index || !aliasKeys || !qKey || qKey.length < 3) return [];

      const a2s = index.aliasToSlug || {};
      const maxDist = Math.min(3, Math.floor(qKey.length / 6) + 1);

      const scored = [];
      for (const k of aliasKeys) {
        const d = levenshtein(qKey, k, maxDist);
        if (d <= maxDist) scored.push({ k, d });
      }

      scored.sort((a, b) => a.d - b.d || a.k.length - b.k.length);

      const out = [];
      const used = new Set();

      for (const s of scored) {
        const slug = a2s[s.k];
        if (!slug || used.has(slug)) continue;
        used.add(slug);
        out.push(slug);
        if (out.length >= limit) break;
      }

      return out;
    }

    // -----------------------------------------------------------------------------
    // UI helpers
    // -----------------------------------------------------------------------------
    function setStatus(visibleCount, totalCount, q, mode) {
      if (!q) {
        status.textContent = "Type to filter - aliases included.";
        return;
      }

      if (mode === "fuzzy") {
        status.textContent = `0 direct matches - showing closest results (${visibleCount})`;
        return;
      }

      status.textContent = `${visibleCount} of ${totalCount} matches`;
    }

    function setNoteAndToggle({ q, total, limitedVisible }) {
      if (!note || !toggleBtn) return;

      // While searching, hide "show more"
      if (q) {
        note.textContent = "";
        toggleBtn.hidden = true;
        return;
      }

      if (total <= TOP_N) {
        note.textContent = `Showing ${total} of ${total}`;
        toggleBtn.hidden = true;
        return;
      }

      if (!showAll) {
        const remaining = total - limitedVisible;
        note.textContent = `Showing ${limitedVisible} of ${total} - ${remaining} more`;
        toggleBtn.textContent = `Show all (${remaining} more)`;
        toggleBtn.hidden = false;
        return;
      }

      note.textContent = `Showing ${total} of ${total}`;
      toggleBtn.textContent = `Show top ${TOP_N}`;
      toggleBtn.hidden = false;
    }

    async function filter() {
      const raw = input.value || "";
      const q = normalize(raw);
      const total = cards.length;

      const limitActive = !q && !showAll;

      // First-pass: direct substring match against each card's blob
      let visibleMatches = 0;
      let visibleShown = 0;

      let directFound = false;

      cards.forEach((card, idx) => {
        const blob = normalize(card.getAttribute("data-search"));
        const matches = !q || blob.includes(q);

        let show = matches;

        if (limitActive && matches) {
          show = idx < TOP_N;
        }

        card.style.display = show ? "" : "none";

        if (matches) visibleMatches++;
        if (show) visibleShown++;
        if (q && matches) directFound = true;
      });

      // If searching and we found direct matches, we're done
      if (q && directFound) {
        setStatus(visibleMatches, total, q, "direct");
        setNoteAndToggle({ q, total, limitedVisible: visibleShown });
        return;
      }

      // If searching and we did NOT find direct matches, try fuzzy using pasta index
      if (q) {
        await loadIndexIfNeeded();

        // Exact alias match first (includes SearchAliases)
        let slugs = [];
        if (index && index.aliasToSlug) {
          const exactSlug = index.aliasToSlug[q];
          if (exactSlug) slugs = [exactSlug];

          // Stopword-stripped exact match (only if unique)
          if (!slugs.length && stopKeyToSlugs) {
            const stopKey = stripStopwords(q);
            const set = stopKeyToSlugs.get(stopKey);
            if (set && set.size === 1) slugs = [Array.from(set)[0]];
          }
        }

        // If no exact slug, use fuzzy
        if (!slugs.length) slugs = bestFuzzySlugs(q, 10);

        if (slugs.length) {
          const slugSet = new Set(slugs);

          visibleShown = 0;
          cards.forEach((card) => {
            const slug = card.getAttribute("data-slug");
            const show = slugSet.has(slug);
            card.style.display = show ? "" : "none";
            if (show) visibleShown++;
          });

          setStatus(visibleShown, total, q, "fuzzy");
          setNoteAndToggle({ q, total, limitedVisible: visibleShown });
          return;
        }

        // If still nothing, keep the list empty and say 0 matches
        setStatus(0, total, q, "direct");
        setNoteAndToggle({ q, total, limitedVisible: 0 });
        return;
      }

      // No query: status + "Top N + X more"
      setStatus(limitActive ? visibleShown : visibleMatches, total, q, "direct");
      setNoteAndToggle({ q, total, limitedVisible: visibleShown });
    }

    function renderRecents() {
      if (!recentWrap || !recentList) return;

      const slugs = readRecents();
      if (!slugs.length) {
        recentWrap.hidden = true;
        return;
      }

      const bySlug = new Map(cards.map((c) => [c.getAttribute("data-slug"), c]));
      const items = slugs
        .map((s) => bySlug.get(s))
        .filter(Boolean)
        .slice(0, 8);

      if (!items.length) {
        recentWrap.hidden = true;
        return;
      }

      recentlyFillList(recentList, items);
      recentWrap.hidden = false;
    }

    function recentlyFillList(targetUl, cardItems) {
      targetUl.innerHTML = "";
      for (const card of cardItems) {
        const link = card.querySelector("a[href]");
        const name = card.querySelector(".result-name");
        if (!link) continue;

        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = link.getAttribute("href");
        a.textContent = name ? name.textContent : a.href;
        li.appendChild(a);
        targetUl.appendChild(li);
      }
    }

    // Record recents on click
    list.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-recent]");
      if (!a) return;

      const href = a.getAttribute("href") || "";
      const m = href.match(/\/pasta\/([^\/]+)\//);
      if (m && m[1]) addRecent(m[1]);
    });

    // Toggle show all / show top N
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        showAll = !showAll;
        filter();
      });
    }

    // Optional: support ?q= prefill
    try {
      const url = new URL(window.location.href);
      const q = url.searchParams.get("q");
      if (q) {
        input.value = q;
        showAll = true;
      }
    } catch (e) {}

    input.addEventListener(
      "input",
      () => {
        if (!normalize(input.value)) showAll = false;
        filter();
      },
      { passive: true }
    );

    input.addEventListener(
      "focus",
      () => {
        loadIndexIfNeeded();
      },
      { once: true, passive: true }
    );

    filter();
    renderRecents();
  }

  // =============================================================================
  // Detail page behavior (store recent on load)
  // =============================================================================

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
    try {
      items = JSON.parse(dataEl.textContent || "[]");
    } catch (e) {
      items = [];
    }

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

    if (
      !kicker ||
      !title ||
      !help ||
      !answers ||
      !count ||
      !btnBack ||
      !btnReset ||
      !btnView ||
      !resultsWrap ||
      !resultsCount ||
      !resultsList
    ) {
      return;
    }

    const QUESTION_ORDER = ["type", "hollow", "stuffed", "ridged", "twisted", "curved", "size"];

    function ynPretty(v) {
      const s = (v || "").toLowerCase();
      if (s === "yes") return "Yes";
      if (s === "no") return "No";
      if (!s || s === "unknown") return "Unknown";
      return v;
    }

    const QUESTION_META = {
      type: {
        label: "What type is it?",
        help: "Pick the overall shape family.",
        pretty: (v) =>
          (
            {
              strand: "Strand",
              tube: "Tube",
              ribbon: "Ribbon",
              sheet: "Sheet",
              short: "Short cut",
              stuffed: "Stuffed",
              soup: "Soup / pastina",
              ring: "Ring / wheel",
              dumpling: "Dumpling / pasta-like",
            }[v] || v
          ),
      },
      hollow: { label: "Is it hollow?", help: "Does it have a hole or tunnel through it?", pretty: ynPretty },
      stuffed: { label: "Is it stuffed?", help: "Is there a filling inside?", pretty: ynPretty },
      ridged: { label: "Does it have ridges?", help: "Look for grooves or ruffles on the surface.", pretty: ynPretty },
      twisted: { label: "Is it twisted?", help: "Does it spiral or corkscrew?", pretty: ynPretty },
      curved: { label: "Is it curved?", help: "Is the shape bent or arched?", pretty: ynPretty },
      size: { label: "What size is it?", help: "Pick the closest size bucket.", pretty: (v) => v },
    };

    function normVal(v) {
      const s = (v || "").toString().trim().toLowerCase();
      if (!s) return "unknown";
      return s;
    }

    function itemVal(item, key) {
      switch (key) {
        case "type":
          return normVal(item.type);
        case "size":
          return normVal(item.size);
        case "hollow":
          return normVal(item.hollow);
        case "ridged":
          return normVal(item.ridged);
        case "twisted":
          return normVal(item.twisted);
        case "curved":
          return normVal(item.curved);
        case "stuffed":
          return normVal(item.stuffed);
        default:
          return "unknown";
      }
    }

    const state = {
      selections: {},
      history: [],
      showResults: false,
    };

    function applyFilters() {
      const keys = Object.keys(state.selections);
      if (!keys.length) return items.slice();

      return items.filter((it) => {
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
      if (state.selections[key] && state.selections[key] !== "__any__") return -1;

      const buckets = new Map();
      for (const it of candidates) {
        const v = itemVal(it, key);
        buckets.set(v, (buckets.get(v) || 0) + 1);
      }

      if (buckets.size < 2) return -1;

      const n = candidates.length || 1;
      let sumSq = 0;
      for (const c of buckets.values()) {
        const p = c / n;
        sumSq += p * p;
      }
      const gini = 1 - sumSq;
      return gini;
    }

    function pickNextQuestion(candidates) {
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

      return bestKey;
    }

    function buildOptions(candidates, key) {
      const buckets = new Map();
      for (const it of candidates) {
        const v = itemVal(it, key);
        buckets.set(v, (buckets.get(v) || 0) + 1);
      }

      const entries = Array.from(buckets.entries()).sort((a, b) => {
        if (a[0] === "unknown") return 1;
        if (b[0] === "unknown") return -1;
        return b[1] - a[1];
      });

      const pretty = QUESTION_META[key].pretty || ((x) => x);

      return entries.map(([value, n]) => ({
        value,
        label: pretty(value),
        count: n,
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

      const skip = document.createElement("button");
      skip.type = "button";
      skip.className = "btn secondary answer-btn";
      skip.setAttribute("data-q", key);
      skip.setAttribute("data-v", "__any__");
      skip.innerHTML = `<span>Not sure</span><span class="answer-right">keep options</span>`;
      answers.appendChild(skip);
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

        // Always show an image - if missing, use pending
        const img = document.createElement("img");
        img.src = toThumbUrl(it.thumb);
        img.alt = "";
        img.width = 56;
        img.height = 56;
        img.loading = "lazy";
        img.decoding = "async";
        thumb.appendChild(img);

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

    function render() {
      const candidates = applyFilters();

      count.textContent = `Matches: ${candidates.length}`;
      btnView.textContent = `View matches (${candidates.length})`;
      btnBack.disabled = state.history.length === 0;

      resultsWrap.hidden = !state.showResults;
      if (state.showResults) {
        setResultsUI(candidates);
        return;
      }

      const nextQ = pickNextQuestion(candidates);
      if (!nextQ) {
        state.showResults = true;
        render();
        return;
      }

      setQuestionUI(nextQ, candidates);
    }

    function choose(key, value) {
      state.selections[key] = value;
      state.history.push({ key, value });
      state.showResults = false;

      const after = applyFilters();
      if (after.length === 0) {
        state.history.pop();
        delete state.selections[key];
        help.textContent = "That combination produced 0 matches - try a different answer or tap Not sure.";
      }

      render();
    }

    function back() {
      const last = state.history.pop();
      if (!last) return;

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

    answers.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-q][data-v]");
      if (!btn) return;
      choose(btn.getAttribute("data-q"), btn.getAttribute("data-v"));
    });

    btnBack.addEventListener("click", back);
    btnReset.addEventListener("click", reset);
    btnView.addEventListener("click", toggleResults);

    resultsList.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-recent]");
      if (!a) return;

      const href = a.getAttribute("href") || "";
      const m = href.match(/\/pasta\/([^\/]+)\//);
      if (m && m[1]) addRecent(m[1]);
    });

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

  // =============================================================================
  // Init
  // =============================================================================

  document.addEventListener(
    "DOMContentLoaded",
    () => {
      initSearchPage();
      initDetailPage();
      initIdentifyPage();
    },
    { once: true }
  );
})();
