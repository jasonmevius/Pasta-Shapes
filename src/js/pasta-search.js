// src/js/pasta-search.js
// ============================================================================
// Pasta name "typeahead" search (suggestions + exact-match redirect).
//
// IMPORTANT
// - This script is intentionally scoped to the dedicated search page.
// - The homepage uses /src/js/scripts.js for table filtering.
// - Guarding by pathname prevents two different search systems from
//   competing for the same DOM on the homepage.
//
// Runs only if:
// - location.pathname starts with "/search"  (adjust if your route differs)
// - AND required DOM elements exist.
//
// Styling constraint:
// - Do NOT use inline styles here. All styling lives in /src/css/styles.css.
// ============================================================================

(function () {
  // --------------------------------------------------------------------------
  // HARD GUARD: only run on the dedicated search page
  // --------------------------------------------------------------------------
  const path = window.location.pathname || "/";
  if (!path.startsWith("/search")) return;

  const form = document.getElementById("pasta-search-form");
  const input = document.getElementById("pasta-q");
  const status = document.getElementById("pasta-search-status");
  const list = document.getElementById("pasta-search-suggestions");

  // If the page doesn't have these elements, do nothing.
  if (!form || !input || !status || !list) return;

  // Common Italian connector words that appear in many pasta dish names.
  // We only use these for a "safe fallback" exact-match - when the stripped key
  // maps uniquely to ONE slug.
  const STOPWORDS = new Set([
    "alla",
    "alle",
    "allo",
    "al",
    "ai",
    "con",
    "di",
    "del",
    "della",
    "delle",
    "dei",
    "da",
    "in",
    "e",
    "ed",
    "a",
    "ad",
    "la",
    "le",
    "lo",
    "il",
    "i",
    "gli",
    "un",
    "una",
    "uno",
  ]);

  // --------------------------------------------------------------------------
  // State & caches
  // --------------------------------------------------------------------------
  let indexCache = null;

  // Lookup structures (built once after index loads)
  let slugToEntry = null; // Map(slug -> {slug,name,url,description})
  let aliasList = null; // Array of {key, aliasDisplay, slug, url}
  let aliasKeys = null; // Array of normalized alias keys (for fuzzy)
  let aliasKeyToDisplay = null; // Map(normalizedKey -> preferred display alias)
  let stopKeyToSlugs = null; // Map(stopwordStrippedKey -> Set(slug))

  // --------------------------------------------------------------------------
  // Normalization helpers (keep consistent with scripts.js)
  // --------------------------------------------------------------------------
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
    // Accept arrays, semicolon-delimited strings, or empty.
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

  // --------------------------------------------------------------------------
  // Description helper
  // --------------------------------------------------------------------------
  function bestDescription(it) {
    // Prefer a short description if available (keeps suggestion list compact).
    // Falls back gracefully across legacy/new index keys.
    return (
      it?.descriptionShort ||
      it?.description_short ||
      it?.DescriptionShort ||
      it?.description ||
      it?.Description ||
      ""
    );
  }

  // --------------------------------------------------------------------------
  // DOM helpers (no inline CSS)
  // --------------------------------------------------------------------------
  function clearSuggestions() {
    list.innerHTML = "";
  }

  function setStatusText(text) {
    status.textContent = text || "";
  }

  function setMatchStatus(match) {
    // Keeps markup minimal; styling via CSS.
    status.innerHTML = "";

    const span = document.createElement("span");
    span.className = "search-match";
    span.textContent = `Match: ${match.name}`;
    status.appendChild(span);

    const a = document.createElement("a");
    a.href = match.url;
    a.className = "search-match-link";
    a.textContent = "View";
    status.appendChild(document.createTextNode(" "));
    status.appendChild(a);
  }

  function formatLabel(name, aliasDisplay) {
    // Example: "Spaghetti alla Chitarra (aka Chitarra)"
    if (!aliasDisplay) return name;
    const normName = normalize(name);
    const normAlias = normalize(aliasDisplay);
    if (!normAlias || normAlias === normName) return name;
    return `${name} (aka ${aliasDisplay})`;
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
        div.className = "suggestion-desc";
        div.textContent = it.description;
        li.appendChild(div);
      }

      list.appendChild(li);
    }
  }

  // --------------------------------------------------------------------------
  // Index loading + lookup structure builder
  // --------------------------------------------------------------------------
  function buildLookupStructures(idx) {
    slugToEntry = new Map();
    aliasList = [];
    aliasKeys = [];
    aliasKeyToDisplay = new Map();
    stopKeyToSlugs = new Map();

    // Expected shape of pasta-index.json:
    // {
    //   items: [{ slug, name, url, description, descriptionShort, aliases, searchAliases, synonyms, ... }],
    //   aliasToSlug: { "normalized alias": "slug" },
    //   aliasToDisplay: { "normalized alias": "Preferred Label" }   // optional
    // }
    const items = Array.isArray(idx?.items) ? idx.items : [];

    // Prevent repeated key/slug pairs from flooding aliasKeys for fuzzy matching.
    const seenKeySlug = new Set();

    for (const it of items) {
      if (!it) continue;

      const slug = it.slug || it.Slug;
      if (!slug) continue;

      const entry = {
        slug,
        name: it.name || it.ShapeName || slug,
        url: it.url || `/pasta/${slug}/`,
        description: bestDescription(it),
      };
      slugToEntry.set(slug, entry);

      // Build alias candidates from legacy + new (optional) fields.
      // NOTE: We do NOT include Synonyms_Display here on purpose - it often contains
      // region/context text that is great for display but noisy for matching.
      const aliases = [
        // Canonical
        entry.name,

        // Legacy index fields
        ...toArray(it.aliases),
        ...toArray(it.searchAliases),
        ...toArray(it.synonyms),

        // Newer / optional index fields (safe no-ops if missing)
        ...toArray(it.search_aliases),
        ...toArray(it.SearchAliases),

        ...toArray(it.synonymsSearch || it.synonyms_search || it.Synonyms_Search),

        ...toArray(it.synonymsTranslations || it.synonyms_translations || it.Synonyms_Translations),
        ...toArray(it.synonymsVariantTerms || it.synonyms_variant_terms || it.Synonyms_VariantTerms),

        ...toArray(it.translations || it.Translations),
        ...toArray(it.variantTerms || it.VariantTerms),
      ];

      for (const a of aliases) {
        const key = normalize(a);
        if (!key) continue;

        const keySlug = `${key}::${slug}`;
        if (seenKeySlug.has(keySlug)) continue;
        seenKeySlug.add(keySlug);

        aliasList.push({
          key,
          aliasDisplay: a,
          slug,
          url: entry.url,
        });

        aliasKeys.push(key);

        // First seen wins, but can be overridden later by idx.aliasToDisplay.
        if (!aliasKeyToDisplay.has(key)) aliasKeyToDisplay.set(key, a);

        // Stopword-stripped mapping (safe fallback only when unique)
        const stopKey = stripStopwords(key);
        if (stopKey) {
          if (!stopKeyToSlugs.has(stopKey)) stopKeyToSlugs.set(stopKey, new Set());
          stopKeyToSlugs.get(stopKey).add(slug);
        }
      }
    }

    // If the index provides a preferred display label per normalized alias key,
    // use it (e.g., a human-friendly alias label).
    if (idx && idx.aliasToDisplay && typeof idx.aliasToDisplay === "object") {
      for (const [k, v] of Object.entries(idx.aliasToDisplay)) {
        if (!k || !v) continue;
        // Keys are expected to already be normalized in the index builder.
        aliasKeyToDisplay.set(k, v);
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

  // --------------------------------------------------------------------------
  // Exact match + suggestions + fuzzy fallback
  // --------------------------------------------------------------------------
  function findExactMatch(idx, query) {
    const key = normalize(query);
    if (!key) return null;

    // 1) Exact match against aliasToSlug (canonical, synonyms, searchAliases)
    let slug = idx?.aliasToSlug?.[key];
    if (slug) {
      const entry = slugToEntry?.get(slug);
      return entry || { slug, url: `/pasta/${slug}/`, name: slug };
    }

    // 2) Safe fallback: stopword-stripped exact match, but only if unique
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

  // Bounded Levenshtein distance (small + fast; good enough for "did you mean")
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

  function computeDidYouMean(queryKey, keys, limit = 5) {
    if (!queryKey || queryKey.length < 3) return [];

    const maxDist = Math.min(4, Math.floor(queryKey.length / 6) + 1);

    const scored = [];
    for (const k of keys) {
      const d = levenshtein(queryKey, k, maxDist);
      if (d <= maxDist) scored.push({ k, d });
    }

    scored.sort((a, b) => a.d - b.d || a.k.localeCompare(b.k));
    return scored.slice(0, limit).map((x) => x.k);
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

      // Prefer a "pretty" label if the index provides one.
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

    // 1) Exact match
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

    // 2) Suggestions (prefix first, then includes)
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

  // Submit behavior (redirect if exact match)
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const result = await runSearch(input.value, { redirectIfFound: true });
    if (result.redirected) return;

    const count = (result.suggestions || []).length;
    if (!count) return;

    // If there are suggestions but no exact match, put focus on the list for accessibility.
    list.focus?.();
  });
})();
