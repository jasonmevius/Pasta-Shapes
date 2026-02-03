// src/js/scripts.js
// ============================================================================
// DEBUG-INSTRUMENTED VERSION
// ---------------------------------------------------------------------------
// Why this exists:
// - You confirmed scripts.js loads (200), and the DOM elements exist,
//   yet typing in the search box produces no visible changes.
// - This version uses the on-page status line to prove, in order:
//     1) initSearchPage() ran
//     2) the input listener is firing
//     3) filter() is executing (or if not, what error occurs)
//
// After we diagnose the issue, we can remove the debug messages.
// ============================================================================
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  // =============================================================================
  // Recently viewed helpers (localStorage)
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
    } catch (e) {
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
  // Search page behavior (Home page filtering)
  // =============================================================================
  function initSearchPage() {
    const input = $("#pasta-q");
    const status = $("#pasta-search-status");
    const list = $("#pasta-results");

    // Only run on pages that have the search + results list.
    if (!input || !status || !list) return;

    const cards = Array.from(list.querySelectorAll("[data-search]"));
    const originalOrder = cards.slice();

    const recentWrap = $("#recently-viewed-wrap");
    const recentTarget = $("#recently-viewed");

    const note = $("#pasta-results-note");
    const nextBtn = $("#pasta-toggle-all");

    const PAGE_N = 10;
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
    const STOPWORDS = new Set([
      "a","ad","al","alla","alle","allo","ai","agli","all",
      "da","de","dei","degli","della","delle","del","di",
      "e","ed","in","con","per","su","lo","la","le","il",
      "un","una","uno",
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

    function bestFuzzySlugs(qKey, limit = 50) {
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

    // -------------------------------------------------------------------------
    // Ranking helpers
    // -------------------------------------------------------------------------
    function cardNameNorm(card) {
      const el = card.querySelector(".result-name");
      return normalize(el ? el.textContent : "");
    }
    function cardBlobNorm(card) {
      return normalize(card.getAttribute("data-search") || "");
    }
    function cardSlugNorm(card) {
      return normalize(card.getAttribute("data-slug") || "");
    }

    function scoreCard(card, q) {
      const name = cardNameNorm(card);
      const slug = cardSlugNorm(card);
      const blob = cardBlobNorm(card);

      let bucket = 50;

      if (name && name.startsWith(q)) bucket = 0;
      else if (name && name.split(" ").some((t) => t.startsWith(q))) bucket = 1;
      else if (slug && slug.startsWith(q)) bucket = 2;
      else if (blob && blob.startsWith(q)) bucket = 3;
      else if (name && name.includes(q)) bucket = 4;
      else if (blob && blob.includes(q)) bucket = 5;

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

    function directMatchSets(q) {
      const matched = [];
      const nonMatched = [];

      for (const card of originalOrder) {
        const blob = cardBlobNorm(card);
        if (blob.includes(q)) matched.push(card);
        else nonMatched.push(card);
      }

      return { matched, nonMatched };
    }

    // -------------------------------------------------------------------------
    // Main filter routine (Option B)
    // -------------------------------------------------------------------------
    async function filter() {
      const raw = input.value || "";
      const q = normalizeQuery(raw);

      if (!q) {
        reorderCards(originalOrder);
        hideAllCards();
        setStatusText("Search ready - start typing to see matches.");
        if (note) note.textContent = "";
        if (nextBtn) {
          nextBtn.textContent = "";
          hideEl(nextBtn);
        }
        visibleLimit = PAGE_N;
        return;
      }

      let { matched, nonMatched } = directMatchSets(q);

      let qUsed = q;
      if (!matched.length && q.includes(" ")) {
        const qNoSpaces = q.replace(/\s+/g, "");
        if (qNoSpaces && qNoSpaces !== q) {
          const retry = directMatchSets(qNoSpaces);
          if (retry.matched.length) {
            matched = retry.matched;
            nonMatched = retry.nonMatched;
            qUsed = qNoSpaces;
          }
        }
      }

      if (matched.length) {
        const ranked = matched
          .map((c) => ({ c, s: scoreCard(c, qUsed) }))
          .sort((a, b) => {
            if (a.s.bucket !== b.s.bucket) return a.s.bucket - b.s.bucket;
            if (a.s.pos !== b.s.pos) return a.s.pos - b.s.pos;
            if (a.s.len !== b.s.len) return a.s.len - b.s.len;
            return a.s.name.localeCompare(b.s.name);
          })
          .map((x) => x.c);

        reorderCards(ranked.concat(nonMatched));

        const requestedShown = Math.min(visibleLimit, ranked.length);

        for (let i = 0; i < ranked.length; i++) ranked[i].hidden = i >= requestedShown;
        for (const c of nonMatched) c.hidden = true;

        const actualShown = countShown(ranked);

        setStatusText(`${actualShown} of ${ranked.length} matches`);
        setNoteAndNext(ranked.length, actualShown);
        return;
      }

      // Fuzzy fallback
      await loadIndexIfNeeded();

      const candidates = [q];
      if (q.includes(" ")) {
        const qNoSpaces = q.replace(/\s+/g, "");
        if (qNoSpaces && qNoSpaces !== q) candidates.push(qNoSpaces);
      }

      let slugs = [];

      if (index && index.aliasToSlug) {
        for (const cand of candidates) {
          const exactSlug = index.aliasToSlug[cand];
          if (exactSlug) {
            slugs = [exactSlug];
            break;
          }
        }

        if (!slugs.length && stopKeyToSlugs) {
          for (const cand of candidates) {
            const stopKey = stripStopwords(cand);
            const set = stopKeyToSlugs.get(stopKey);
            if (set && set.size === 1) {
              slugs = [Array.from(set)[0]];
              break;
            }
          }
        }
      }

      if (!slugs.length) {
        for (const cand of candidates) {
          slugs = bestFuzzySlugs(cand, 50);
          if (slugs.length) break;
        }
      }

      if (slugs.length) {
        const slugSet = new Set(slugs);

        const ordered = [];
        for (const slug of slugs) {
          const c = cardBySlug.get(slug);
          if (c) ordered.push(c);
        }

        const remaining = originalOrder.filter(
          (c) => !slugSet.has(c.getAttribute("data-slug"))
        );
        reorderCards(ordered.concat(remaining));

        const requestedShown = Math.min(visibleLimit, ordered.length);

        for (let i = 0; i < ordered.length; i++) ordered[i].hidden = i >= requestedShown;
        for (const c of remaining) c.hidden = true;

        const actualShown = countShown(ordered);

        setStatusText(`0 direct matches - showing closest results (${actualShown})`);
        setNoteAndNext(ordered.length, actualShown);
        return;
      }

      reorderCards(originalOrder);
      hideAllCards();
      setStatusText("No matches found.");
      if (note) note.textContent = "";
      if (nextBtn) {
        nextBtn.textContent = "";
        hideEl(nextBtn);
      }
    }

    // -------------------------------------------------------------------------
    // Recently viewed rendering
    // -------------------------------------------------------------------------
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

    // Record recents on click
    list.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-recent]");
      if (!a) return;

      const href = a.getAttribute("href") || "";
      const m = href.match(/\/pasta\/([^\/]+)\//);
      if (m && m[1]) addRecent(m[1]);
    });

    // Paging button
    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        e.preventDefault();
        visibleLimit += PAGE_N;
        safeFilter();
      });

      nextBtn.textContent = "";
      hideEl(nextBtn);
    }

    // Wrap filter in try/catch so errors show up on the page
    async function safeFilter() {
      try {
        await filter();
      } catch (err) {
        setStatusText(`Search error: ${err && err.message ? err.message : String(err)}`);
      }
    }

    // Instrumented input handler:
    // - Updates status on every keystroke so we know the event is firing.
    input.addEventListener("input", () => {
      setStatusText(`Typing: ${(input.value || "").trim()}`);
      visibleLimit = PAGE_N;
      safeFilter();
    });

    // Optional pre-load index
    input.addEventListener(
      "focus",
      () => {
        loadIndexIfNeeded();
      },
      { once: true }
    );

    // Initial state - proves init ran
    reorderCards(originalOrder);
    hideAllCards();
    setStatusText("Search ready - start typing to see matches.");
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
  // Robust init (not only DOMContentLoaded)
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

  // Re-init on bfcache restore
  window.addEventListener("pageshow", (e) => {
    if (e && e.persisted) initAll();
  });
})();
