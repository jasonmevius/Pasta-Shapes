// src/js/pasta-search.js
(function () {
  const form = document.getElementById("pasta-search-form");
  const input = document.getElementById("pasta-q");
  const status = document.getElementById("pasta-search-status");
  const list = document.getElementById("pasta-search-suggestions");

  if (!form || !input || !status || !list) return;

  function normalize(s) {
    return (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, "and")
      .replace(/[’']/g, " ") // "d'angelo" -> "d angelo"
      .replace(/["]/g, " ")
      .replace(/[^a-z0-9\s-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function clearSuggestions() {
    list.innerHTML = "";
  }

  function setStatusText(text) {
    status.textContent = text;
  }

  function setMatchStatus(match) {
    status.innerHTML = "";
    const span = document.createElement("span");
    span.append("Match: ");
    const a = document.createElement("a");
    a.href = match.url;
    a.textContent = match.name;
    span.appendChild(a);
    status.appendChild(span);
  }

  // Track what we last rendered so submit can act intelligently
  let lastRendered = []; // [{ url, label, ... }]
  let lastRenderedType = ""; // "suggest" | "dym" | ""

  function renderSuggestions(items, { type = "suggest" } = {}) {
    clearSuggestions();

    lastRendered = Array.isArray(items) ? items.slice() : [];
    lastRenderedType = type || "";

    for (const it of items) {
      const li = document.createElement("li");

      const a = document.createElement("a");
      a.href = it.url;
      a.textContent = it.label;
      li.appendChild(a);

      // Optional: description (if present)
      if (it.description) {
        const div = document.createElement("div");
        div.style.marginTop = "0.15rem";
        div.style.fontSize = "0.9em";
        div.textContent = it.description;
        li.appendChild(div);
      }

      list.appendChild(li);
    }
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
        const val = Math.min(
          prev[j] + 1, // deletion
          cur[j - 1] + 1, // insertion
          prev[j - 1] + cost // substitution
        );
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

  function computeDidYouMean(queryKey, aliasKeys, limit = 5) {
    if (!queryKey || queryKey.length < 3) return [];

    // Slightly more tolerant for longer inputs
    const maxDist = Math.min(4, Math.max(2, Math.floor(queryKey.length / 6) + 2));

    const scored = [];
    for (const k of aliasKeys) {
      const d = levenshtein(queryKey, k, maxDist);
      if (d <= maxDist) scored.push({ k, d });
    }

    scored.sort((a, b) => a.d - b.d || a.k.length - b.k.length);
    return scored.slice(0, limit).map((s) => s.k);
  }

  let indexCache = null;

  let slugToEntry = null;
  let aliasList = null; // [{ key, slug, url, label }]
  let aliasKeys = null; // [key...]

  function buildLookupStructures(idx) {
    if (slugToEntry && aliasList && aliasKeys) return;

    slugToEntry = new Map();
    for (const e of idx.entries || []) slugToEntry.set(e.slug, e);

    aliasList = [];
    aliasKeys = [];

    const seen = new Set();
    const aliasToSlug = idx.aliasToSlug || {};

    for (const [aliasKey, slug] of Object.entries(aliasToSlug)) {
      const entry = slugToEntry.get(slug);
      const url = entry?.url || `/pasta/${slug}/`;
      const label = entry?.name || slug;

      const dedupeKey = `${aliasKey}::${slug}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      aliasList.push({ key: aliasKey, slug, url, label });
      aliasKeys.push(aliasKey);
    }
  }

  async function getIndex() {
    if (indexCache) return indexCache;

    setStatusText("Loading...");
    try {
      const res = await fetch("/api/pasta-index.json", { cache: "force-cache" });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      indexCache = await res.json();
      buildLookupStructures(indexCache);
      setStatusText("");
      return indexCache;
    } catch (e) {
      setStatusText("Search unavailable right now.");
      return null;
    }
  }

  function findMatch(idx, query) {
    const key = normalize(query);
    if (!key) return null;

    const slug = idx.aliasToSlug?.[key];
    if (!slug) return null;

    const entry = slugToEntry?.get(slug);
    return entry || { slug, url: `/pasta/${slug}/`, name: slug };
  }

  function suggest(idx, query, limit = 10) {
    const q = normalize(query);
    if (!q) return [];

    const starts = [];
    const includes = [];

    for (const a of aliasList || []) {
      if (a.key.startsWith(q)) starts.push(a);
      else if (a.key.includes(q)) includes.push(a);
    }

    const combined = [...starts, ...includes];

    // De-dupe by slug so variants don’t flood the list
    const out = [];
    const usedSlugs = new Set();

    for (const a of combined) {
      if (usedSlugs.has(a.slug)) continue;
      usedSlugs.add(a.slug);

      const entry = slugToEntry?.get(a.slug);
      out.push({
        url: a.url,
        label: a.label,
        description: entry?.description || "",
      });

      if (out.length >= limit) break;
    }

    return out;
  }

  function showDidYouMean(keys) {
    const suggestions = [];
    const usedSlugs = new Set();

    for (const k of keys) {
      const slug = indexCache?.aliasToSlug?.[k];
      if (!slug || usedSlugs.has(slug)) continue;
      usedSlugs.add(slug);

      const entry = slugToEntry?.get(slug);
      const url = entry?.url || `/pasta/${slug}/`;

      suggestions.push({
        url,
        label: entry?.name || slug,
        description: entry?.description || "",
      });
    }

    if (!suggestions.length) return false;

    setStatusText("No exact match. Did you mean:");
    renderSuggestions(suggestions, { type: "dym" });
    return true;
  }

  async function runSearch(
    query,
    { redirectIfFound } = { redirectIfFound: true }
  ) {
    const idx = await getIndex();
    if (!idx) return { redirected: false, suggestions: [] };

    const trimmed = (query || "").trim();
    if (!trimmed) {
      setStatusText("");
      clearSuggestions();
      lastRendered = [];
      lastRenderedType = "";
      return { redirected: false, suggestions: [] };
    }

    // Exact match -> optionally redirect
    const match = findMatch(idx, query);
    if (match && match.url) {
      setMatchStatus({ name: match.name, url: match.url });
      clearSuggestions();
      lastRendered = [];
      lastRenderedType = "";
      if (redirectIfFound) window.location.href = match.url;
      return { redirected: !!redirectIfFound, suggestions: [] };
    }

    // Partial suggestions
    const s = suggest(idx, query);

    if (s.length) {
      setStatusText("No exact match. Suggestions:");
      renderSuggestions(s, { type: "suggest" });
      return { redirected: false, suggestions: s };
    }

    // Fuzzy suggestions
    const qKey = normalize(query);
    const dym = computeDidYouMean(qKey, aliasKeys, 5);
    if (dym.length && showDidYouMean(dym)) {
      return { redirected: false, suggestions: lastRendered };
    }

    // Nothing
    setStatusText("No match found.");
    clearSuggestions();
    lastRendered = [];
    lastRenderedType = "";
    return { redirected: false, suggestions: [] };
  }

  // Live suggestions while typing (never auto-redirect)
  input.addEventListener("input", () => {
    runSearch(input.value, { redirectIfFound: false });
  });

  // Submit: if exact match, redirect. If not:
  // - 1 suggestion -> redirect to it
  // - multiple -> keep page, prompt user to click
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const result = await runSearch(input.value, { redirectIfFound: true });
    if (result.redirected) return;

    // No exact match - if we have exactly one suggestion, take the user there
    if (result.suggestions && result.suggestions.length === 1) {
      window.location.href = result.suggestions[0].url;
      return;
    }

    // Multiple suggestions - prompt user to click one (don’t guess)
    if (result.suggestions && result.suggestions.length > 1) {
      setStatusText(
        lastRenderedType === "dym"
          ? "No exact match. Did you mean:"
          : "No exact match. Suggestions:"
      );

      // Move focus to the first suggestion link (nice UX)
      const firstLink = list.querySelector("a");
      if (firstLink) firstLink.focus();
    }
  });

  // Handle /?q=... links
  (function handleQueryParamOnLoad() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (!q) return;

    input.value = q;
    window.history.replaceState({}, "", window.location.pathname);
    runSearch(q, { redirectIfFound: true });
  })();
})();
