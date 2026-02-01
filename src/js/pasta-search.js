// src/js/pasta-search.js
(function () {
  const form = document.getElementById("pasta-search-form");
  const input = document.getElementById("pasta-q");
  const status = document.getElementById("pasta-search-status");
  const list = document.getElementById("pasta-search-suggestions");

  if (!form || !input || !status || !list) return;

  // Common Italian “connector” words that often appear in menu names but get omitted in searches.
  // We only use this for a safe, secondary exact-match attempt (unique slug only).
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

  function stripStopwords(normalizedString) {
    const parts = (normalizedString || "")
      .split(" ")
      .map((t) => t.trim())
      .filter(Boolean)
      .filter((t) => !STOPWORDS.has(t));
    return parts.join(" ").trim();
  }

  function toArray(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v === "string") {
      return v
        .split(";")
        .map((s) => (s || "").trim())
        .filter(Boolean);
    }
    return [];
  }

  function clearSuggestions() {
    list.innerHTML = "";
  }

  function setStatusText(text) {
    status.textContent = text || "";
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

  function formatLabel(entryName, aliasDisplay) {
    const n1 = normalize(entryName);
    const n2 = normalize(aliasDisplay);
    if (!aliasDisplay || !n2 || n1 === n2) return entryName;
    return `${entryName} (commonly known as: ${aliasDisplay})`;
  }

  function renderSuggestions(items) {
    clearSuggestions();

    for (const it of items) {
      const li = document.createElement("li");

      const a = document.createElement("a");
      a.href = it.url;
      a.textContent = it.label;
      li.appendChild(a);

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

  function computeDidYouMean(queryKey, aliasKeys, limit = 5) {
    if (!queryKey || queryKey.length < 3) return [];

    // Slightly larger cap helps multi-word phrases while still staying bounded.
    const maxDist = Math.min(4, Math.floor(queryKey.length / 6) + 1);

    const scored = [];
    for (const k of aliasKeys) {
      const d = levenshtein(queryKey, k, maxDist);
      if (d <= maxDist) scored.push({ k, d });
    }

    scored.sort((a, b) => a.d - b.d || a.k.length - b.k.length);
    return scored.slice(0, limit).map((s) => s.k);
  }

  let indexCache = null;

  // Built once per page-load
  let slugToEntry = null;

  // aliasList holds all aliases (including canonical names), normalized
  // { key, slug, url, aliasDisplay }
  let aliasList = null;
  let aliasKeys = null;

  // Map normalized alias -> human display string (best effort)
  let aliasKeyToDisplay = null;

  // Stopword-stripped alias key -> Set of slugs that match it
  // Used only for a safe, secondary exact match (unique slug only).
  let stopKeyToSlugs = null;

  function buildLookupStructures(idx) {
    if (slugToEntry && aliasList && aliasKeys && aliasKeyToDisplay && stopKeyToSlugs) return;

    slugToEntry = new Map();
    for (const e of idx.entries || []) slugToEntry.set(e.slug, e);

    aliasKeyToDisplay = new Map();
    stopKeyToSlugs = new Map();

    // Seed display map with canonical names, synonyms, and searchAliases
    for (const e of idx.entries || []) {
      const nameKey = normalize(e.name);
      if (nameKey && !aliasKeyToDisplay.has(nameKey)) aliasKeyToDisplay.set(nameKey, e.name);

      for (const syn of toArray(e.synonyms)) {
        const synKey = normalize(syn);
        if (synKey && !aliasKeyToDisplay.has(synKey)) aliasKeyToDisplay.set(synKey, syn);
      }

      // If your /api/pasta-index.json includes searchAliases, use them for nicer labels
      for (const a of toArray(e.searchAliases || e.search_aliases || e.aliases)) {
        const aKey = normalize(a);
        if (aKey && !aliasKeyToDisplay.has(aKey)) aliasKeyToDisplay.set(aKey, a);
      }
    }

    aliasList = [];
    aliasKeys = [];

    const seen = new Set();
    const aliasToSlug = idx.aliasToSlug || {};

    for (const [aliasKey, slug] of Object.entries(aliasToSlug)) {
      const entry = slugToEntry.get(slug);
      const url = entry?.url || `/pasta/${slug}/`;

      const dedupeKey = `${aliasKey}::${slug}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const aliasDisplay =
        aliasKeyToDisplay.get(aliasKey) ||
        // Fallback - show the normalized alias as-is
        aliasKey;

      aliasList.push({ key: aliasKey, slug, url, aliasDisplay });
      aliasKeys.push(aliasKey);

      // Build stopword-stripped lookup
      const stopKey = stripStopwords(aliasKey);
      if (stopKey) {
        if (!stopKeyToSlugs.has(stopKey)) stopKeyToSlugs.set(stopKey, new Set());
        stopKeyToSlugs.get(stopKey).add(slug);
      }
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

  function findExactMatch(idx, query) {
    const key = normalize(query);
    if (!key) return null;

    // 1) Exact match against aliasToSlug (canonical, synonyms, searchAliases)
    let slug = idx.aliasToSlug?.[key];
    if (slug) {
      const entry = slugToEntry?.get(slug);
      return entry || { slug, url: `/pasta/${slug}/`, name: slug };
    }

    // 2) Safe fallback: stopword-stripped exact match, but only if it resolves uniquely
    const stopKey = stripStopwords(key);
    if (stopKey && stopKeyToSlugs?.has(stopKey)) {
      const slugs = stopKeyToSlugs.get(stopKey);
      if (slugs && slugs.size === 1) {
        slug = Array.from(slugs)[0];
        const entry = slugToEntry?.get(slug);
        return entry || { slug, url: `/pasta/${slug}/`, name: slug };
      }
    }

    return null;
  }

  function suggestFromAliases(query, limit = 10) {
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
      const name = entry?.name || a.slug;

      out.push({
        url: a.url,
        label: formatLabel(name, a.aliasDisplay),
        description: entry?.description || "",
      });

      if (out.length >= limit) break;
    }

    return out;
  }

  function didYouMeanSuggestions(query, limit = 5) {
    const qKey = normalize(query);
    const keys = computeDidYouMean(qKey, aliasKeys || [], limit);

    const suggestions = [];
    const usedSlugs = new Set();

    for (const k of keys) {
      const slug = indexCache?.aliasToSlug?.[k];
      if (!slug || usedSlugs.has(slug)) continue;
      usedSlugs.add(slug);

      const entry = slugToEntry?.get(slug);
      const url = entry?.url || `/pasta/${slug}/`;
      const name = entry?.name || slug;

      const aliasDisplay = aliasKeyToDisplay?.get(k) || k;

      suggestions.push({
        url,
        label: formatLabel(name, aliasDisplay),
        description: entry?.description || "",
      });
    }

    return suggestions;
  }

  async function runSearch(query, { redirectIfFound } = { redirectIfFound: false }) {
    const idx = await getIndex();
    if (!idx) return { match: null, suggestions: [], redirected: false };

    const raw = (query || "").trim();
    if (!raw) {
      setStatusText("");
      clearSuggestions();
      return { match: null, suggestions: [], redirected: false };
    }

    // 1) Exact match (canonical, synonyms, searchAliases, plus safe stopword-strip fallback)
    const match = findExactMatch(idx, raw);
    if (match && match.url) {
      setMatchStatus({ name: match.name, url: match.url });
      clearSuggestions();
      if (redirectIfFound) {
        window.location.href = match.url;
        return { match, suggestions: [], redirected: true };
      }
      return { match, suggestions: [], redirected: false };
    }

    // 2) Normal suggestions (prefix/includes)
    const s1 = suggestFromAliases(raw, 10);
    if (s1.length) {
      setStatusText("No exact match. Suggestions:");
      renderSuggestions(s1);
      return { match: null, suggestions: s1, redirected: false };
    }

    // 3) Fuzzy fallback
    const s2 = didYouMeanSuggestions(raw, 5);
    if (s2.length) {
      setStatusText("No exact match. Did you mean:");
      renderSuggestions(s2);
      return { match: null, suggestions: s2, redirected: false };
    }

    // 4) Nothing
    setStatusText("No match found.");
    clearSuggestions();
    return { match: null, suggestions: [], redirected: false };
  }

  // Live suggestions while typing (no redirect)
  input.addEventListener("input", () => {
    runSearch(input.value, { redirectIfFound: false });
  });

  // Submit behavior:
  // - Exact match redirects (handled in runSearch)
  // - If ONE suggestion remains, redirect to it
  // - If MULTIPLE suggestions, do not guess - force the user to choose
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const result = await runSearch(input.value, { redirectIfFound: true });
    if (result.redirected) return;

    const count = (result.suggestions || []).length;

    if (count === 1) {
      window.location.href = result.suggestions[0].url;
      return;
    }

    if (count > 1) {
      setStatusText("Multiple matches - please choose one:");
      const firstLink = list.querySelector("a");
      if (firstLink) firstLink.focus();
      return;
    }

    setStatusText("No match found.");
  });

  // Handle /?q=... (shared links)
  (function handleQueryParamOnLoad() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (!q) return;

    input.value = q;
    window.history.replaceState({}, "", window.location.pathname);

    (async () => {
      const result = await runSearch(q, { redirectIfFound: true });
      if (result.redirected) return;

      const count = (result.suggestions || []).length;
      if (count === 1) {
        window.location.href = result.suggestions[0].url;
        return;
      }
      if (count > 1) {
        setStatusText("Multiple matches - please choose one:");
        const firstLink = list.querySelector("a");
        if (firstLink) firstLink.focus();
      }
    })();
  })();
})();
