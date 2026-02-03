// src/js/scripts.js
// ============================================================================
// Global site behaviors:
//
// 1) Recently Viewed (localStorage)
//    - Stores last visited pasta detail slugs in localStorage.
//    - Renders up to 5 recent items as a comma-delimited link list.
//
// 2) Search Results Filtering (Home page)
//    - Filters pre-rendered result cards (<li data-search ...>).
//    - Ranks matches (name-first).
//    - Progressive reveal / paging:
//        "Top 10 + X more" -> Next 10 button
//
// IMPORTANT UX CHANGE (Option B)
// - Show NOTHING until the user starts typing.
// - Once typing begins, show matches (Top 10) + "Next 10" pagination.
//
// IMPORTANT CONSTRAINTS
// - No inline styles (all styling belongs in /src/css/styles.css).
// - Script should fail safely if page doesn't have expected elements.
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
      // If storage is blocked/full, silently ignore.
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

    // Recently viewed (container + target element)
    const recentWrap = $("#recently-viewed-wrap");
    const recentTarget = $("#recently-viewed"); // now a <p> in your templates

    // "Top 10 + X more"
    const note = $("#pasta-results-note");
    const nextBtn = $("#pasta-toggle-all");

    const PAGE_N = 10;
    let visibleLimit = PAGE_N;

    // -----------------------------------------------------------------------------
    // Visibility helpers (we avoid inline style - use hidden attribute)
    // -----------------------------------------------------------------------------
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

    // -----------------------------------------------------------------------------
    // Normalization helpers (consistent with your index normalization)
    // -----------------------------------------------------------------------------
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
    // (We use it only if direct matching finds nothing.)
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

    // Bounded Levenshtein used for fuzzy fallback
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

    // -----------------------------------------------------------------------------
    // Ranking helpers (name-first ordering)
    // -----------------------------------------------------------------------------
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

      // Lower bucket = better
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

    // -----------------------------------------------------------------------------
    // UI text helpers
    // -----------------------------------------------------------------------------
    function setStatusText(text) {
      status.textContent = text || "";
    }

    function setNoteAndNext(matchCount, shownCount) {
      if (!note || !nextBtn) return;

      const remaining = Math.max(0, matchCount - shownCount);

      if (matchCount === 0) {
        note.textContent = "";
        hideEl(nextBtn);
        return;
      }

      if (remaining === 0) {
        note.textContent = `Showing ${shownCount} of ${matchCount}`;
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

    // -----------------------------------------------------------------------------
    // Direct match set: "blob includes query"
    // -----------------------------------------------------------------------------
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

    // -----------------------------------------------------------------------------
    // Main filter routine (Option B: show nothing until typing)
    // -----------------------------------------------------------------------------
    async function filter() {
      const raw = input.value || "";
      const q = normalizeQuery(raw);

      // -----------------------------------------------------------------------
      // OPTION B behavior:
      // - If there's NO query, show nothing.
      // - This keeps the homepage minimal and avoids a "wall of results."
      // -----------------------------------------------------------------------
      if (!q) {
        // Preserve original DOM order (helps predictable future filtering)
        reorderCards(originalOrder);

        // Hide every card until typing begins
        hideAllCards();

        // UI guidance
        setStatusText("Start typing to see matches (aliases included).");

        // Hide paging UI
        if (note) note.textContent = "";
        hideEl(nextBtn);

        // Reset paging limit so first keystroke starts at Top 10
        visibleLimit = PAGE_N;
        return;
      }

      // From here on, we are actively searching/filtering.
      let { matched, nonMatched } = directMatchSets(q);

      // If no direct matches and query contains spaces, retry ignoring spaces
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

      // Direct matches found ---------------------------------------------------
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

        // Show matched up to visibleLimit, hide the rest
        for (let i = 0; i < ranked.length; i++) ranked[i].hidden = i >= requestedShown;

        // Hide non-matched completely
        for (const c of nonMatched) c.hidden = true;

        const actualShown = countShown(ranked);

        setStatusText(`${actualShown} of ${ranked.length} matches`);
        setNoteAndNext(ranked.length, actualShown);
        return;
      }

      // Fuzzy fallback ---------------------------------------------------------
      await loadIndexIfNeeded();

      const candidates = [q];
      if (q.includes(" ")) {
        const qNoSpaces = q.replace(/\s+/g, "");
        if (qNoSpaces && qNoSpaces !== q) candidates.push(qNoSpaces);
      }

      let slugs = [];

      // Try exact aliasToSlug for candidate variants
      if (index && index.aliasToSlug) {
        for (const cand of candidates) {
          const exactSlug = index.aliasToSlug[cand];
          if (exactSlug) {
            slugs = [exactSlug];
            break;
          }
        }

        // Safe stopword-based exact match (unique slug only)
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

      // If still nothing, use bounded fuzzy
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

        const remaining = originalOrder.filter((c) => !slugSet.has(c.getAttribute("data-slug")));
        reorderCards(ordered.concat(remaining));

        const requestedShown = Math.min(visibleLimit, ordered.length);

        for (let i = 0; i < ordered.length; i++) ordered[i].hidden = i >= requestedShown;
        for (const c of remaining) c.hidden = true;

        const actualShown = countShown(ordered);

        setStatusText(`0 direct matches - showing closest results (${actualShown})`);
        setNoteAndNext(ordered.length, actualShown);
        return;
      }

      // No matches at all ------------------------------------------------------
      reorderCards(originalOrder);
      hideAllCards();
      setStatusText("No matches found.");
      if (note) note.textContent = "";
      hideEl(nextBtn);
    }

    // -----------------------------------------------------------------------------
    // Recently viewed: render as comma-delimited links into a <p> (or UL fallback)
    // -----------------------------------------------------------------------------
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
        .slice(0, 5); // max 5

      if (!items.length) {
        recentWrap.hidden = true;
        return;
      }

      fillRecentsTarget(recentTarget, items);
      recentWrap.hidden = false;
    }

    function fillRecentsTarget(targetEl, cardItems) {
      const tag = (targetEl.tagName || "").toUpperCase();

      targetEl.innerHTML = "";

      // Preferred: <p> container (comma-delimited links)
      if (tag === "P" || tag === "DIV" || tag === "SPAN") {
        const frag = document.createDocumentFragment();

        cardItems.forEach((card, idx) => {
          const link = card.querySelector("a[href]");
          const name = card.querySelector(".result-name");
          if (!link) return;

          if (idx > 0) frag.appendChild(document.createTextNode(", "));

          const a = document.createElement("a");
          a.href = link.getAttribute("href");
          a.textContent = name ? name.textContent.trim() : a.href;

          frag.appendChild(a);
        });

        targetEl.appendChild(frag);
        return;
      }

      // Fallback if you ever swap markup back to a UL/OL
      if (tag === "UL" || tag === "OL") {
        const li = document.createElement("li");
        li.className = "recent-inline";

        cardItems.forEach((card, idx) => {
          const link = card.querySelector("a[href]");
          const name = card.querySelector(".result-name");
          if (!link) return;

          if (idx > 0) li.appendChild(document.createTextNode(", "));

          const a = document.createElement("a");
          a.href = link.getAttribute("href");
          a.textContent = name ? name.textContent.trim() : a.href;

          li.appendChild(a);
        });

        targetEl.appendChild(li);
      }
    }

    // -----------------------------------------------------------------------------
    // Record recents on click (from result cards)
    // -----------------------------------------------------------------------------
    list.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-recent]");
      if (!a) return;

      const href = a.getAttribute("href") || "";
      const m = href.match(/\/pasta\/([^\/]+)\//);
      if (m && m[1]) addRecent(m[1]);
    });

    // Paging: Next 10
    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        if (typeof e.preventDefault === "function") e.preventDefault();
        visibleLimit += PAGE_N;
        filter();
      });

      hideEl(nextBtn);
    }

    // Improve responsiveness: pre-load fuzzy index on focus (optional)
    input.addEventListener(
      "focus",
      () => {
        loadIndexIfNeeded();
      },
      { once: true, passive: true }
    );

    // When typing begins, start fresh at Top 10
    input.addEventListener(
      "input",
      () => {
        visibleLimit = PAGE_N;
        filter();
      },
      { passive: true }
    );

    // Initial state for Option B
    // - Hide all cards immediately (so the page loads clean)
    // - Provide instruction text
    // - Render recents (if present)
    hideAllCards();
    setStatusText("Start typing to see matches (aliases included).");
    if (note) note.textContent = "";
    hideEl(nextBtn);

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
  // Init
  // =============================================================================
  document.addEventListener(
    "DOMContentLoaded",
    () => {
      initSearchPage();
      initDetailPage();
    },
    { once: true }
  );
})();
