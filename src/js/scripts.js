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
    const nextBtn = $("#pasta-toggle-all"); // reuse existing button - now "Next 10"

    const PAGE_N = 10; // reveal size
    let visibleLimit = PAGE_N;

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

    // Collapses spaced-letter inputs like "p e n n e" -> "penne"
    function normalizeQuery(s) {
      const q = normalize(s);

      // spaced letters (IME/voice/assistive input)
      if (/^(?:[a-z0-9]\s+){2,}[a-z0-9]$/.test(q)) {
        return q.replace(/\s+/g, "");
      }

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
    // Ranking + ordering for direct matches
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

      // Ranking buckets - lower is better
      let bucket = 50;

      if (name && name.startsWith(q)) bucket = 0;
      else if (name && name.split(" ").some((t) => t.startsWith(q))) bucket = 1;
      else if (slug && slug.startsWith(q)) bucket = 2;
      else if (blob && blob.startsWith(q)) bucket = 3;
      else if (name && name.includes(q)) bucket = 4;
      else if (blob && blob.includes(q)) bucket = 5;

      // Earlier position is better for "includes"
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
    // UI helpers
    // -----------------------------------------------------------------------------
    function setStatus(matchCount, shownCount, q, mode) {
      if (!q) {
        status.textContent = "Type to filter - aliases included.";
        return;
      }

      if (mode === "fuzzy") {
        status.textContent = `0 direct matches - showing closest results (${shownCount})`;
        return;
      }

      status.textContent = `${shownCount} of ${matchCount} matches`;
    }

    function setNoteAndNext({ matchCount, shownCount }) {
      if (!note || !nextBtn) return;

      if (matchCount <= PAGE_N) {
        note.textContent = `Showing ${shownCount} of ${matchCount}`;
        nextBtn.hidden = true;
        return;
      }

      const remaining = Math.max(0, matchCount - shownCount);

      note.textContent = remaining
        ? `Showing ${shownCount} of ${matchCount} - ${remaining} more`
        : `Showing ${shownCount} of ${matchCount}`;

      if (remaining > 0) {
        const nextChunk = Math.min(PAGE_N, remaining);
        // Button acts as a link-like progressive reveal.
        nextBtn.textContent = `Next ${nextChunk} (${remaining} more)`;
        nextBtn.hidden = false;
      } else {
        nextBtn.hidden = true;
      }
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

    async function filter() {
      const raw = input.value || "";
      const q = normalizeQuery(raw);
      const total = cards.length;

      // When query changes, reset progressive reveal
      // (we also reset when query clears below)
      // NOTE: this is handled in input event by resetting visibleLimit

      // -----------------------------------------------------------
      // Query present - ranked, progressively revealed
      // -----------------------------------------------------------
      if (q) {
        // Direct matches
        let { matched, nonMatched } = directMatchSets(q);

        // If no direct matches and query contains spaces, retry ignoring spaces.
        // This fixes "spa ghe" -> "spaghe", without breaking legit multi-word queries
        // because we only do it when the spaced version yields 0 matches.
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

          const shown = Math.min(visibleLimit, matched.length);

          for (let i = 0; i < ranked.length; i++) {
            ranked[i].style.display = i < shown ? "" : "none";
          }
          for (const c of nonMatched) c.style.display = "none";

          setStatus(matched.length, shown, qUsed, "direct");
          setNoteAndNext({ matchCount: matched.length, shownCount: shown });
          return;
        }

        // -----------------------------------------------------------
        // Fuzzy fallback
        // -----------------------------------------------------------
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
            slugs = bestFuzzySlugs(cand, 50); // allow more so Next 10 is meaningful
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

          const shown = Math.min(visibleLimit, ordered.length);

          for (let i = 0; i < ordered.length; i++) {
            ordered[i].style.display = i < shown ? "" : "none";
          }
          for (const c of remaining) c.style.display = "none";

          setStatus(ordered.length, shown, q, "fuzzy");
          setNoteAndNext({ matchCount: ordered.length, shownCount: shown });
          return;
        }

        // No matches
        reorderCards(originalOrder);
        for (const c of cards) c.style.display = "none";
        setStatus(0, 0, q, "direct");
        setNoteAndNext({ matchCount: 0, shownCount: 0 });
        return;
      }

      // -----------------------------------------------------------
      // No query - restore original order + progressive reveal
      // -----------------------------------------------------------
      reorderCards(originalOrder);

      const shown = Math.min(visibleLimit, total);

      for (let i = 0; i < originalOrder.length; i++) {
        originalOrder[i].style.display = i < shown ? "" : "none";
      }

      setStatus(total, shown, q, "direct");
      setNoteAndNext({ matchCount: total, shownCount: shown });
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

    // Next 10 behavior
    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        e.preventDefault?.();
        visibleLimit += PAGE_N;
        filter();
      });
    }

    // Optional: support ?q= prefill
    try {
      const url = new URL(window.location.href);
      const qParam = url.searchParams.get("q");
      if (qParam) input.value = qParam;
    } catch (e) {}

    input.addEventListener(
      "input",
      () => {
        // On every new query, reset to Top 10
        visibleLimit = PAGE_N;
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

    // Initial render
    visibleLimit = PAGE_N;
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
    // No changes required for this update.
    // (Identify page logic lives elsewhere or is handled in its own script.)
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
