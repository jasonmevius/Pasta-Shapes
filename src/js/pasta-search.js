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

  function renderSuggestions(items) {
    clearSuggestions();

    for (const it of items) {
      const li = document.createElement("li");

      const a = document.createElement("a");
      a.href = it.url;
      a.textContent = it.label;
      li.appendChild(a);

      // Optional: alias hint (only if present)
      if (it.reason) {
        const hint = document.createElement("small");
        hint.style.marginLeft = "0.5rem";
        hint.textContent = `(${it.reason})`;
        li.appendChild(hint);
      }

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

    // Fast reject if length difference already exceeds maxDist
    if (Math.abs(al - bl) > maxDist) return maxDist + 1;

    // DP with two rows
    let prev = new Array(bl + 1);
    let cur = new Array(bl + 1);

    for (let j = 0; j <= bl; j++) prev[j] = j;

    for (let i = 1; i <= al; i++) {
      cur[0] = i;

      // Track min value in row for early exit
      let rowMin = cur[0];
      const ai = a.charCodeAt(i - 1);

      for (let j = 1; j <= bl; j++) {
        const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
        const val = Math.min(
          prev[j] + 1,       // deletion
          cur[j - 1] + 1,    // insertion
          prev[j - 1] + cost // substitution
        );
        cur[j] = val;
        if (val < rowMin) rowMin = val;
      }

      if (rowMin > maxDist) return maxDist + 1;

      // swap
      const tmp = prev;
      prev = cur;
      cur = tmp;
    }

    return prev[bl];
  }

  function computeDidYouMean(queryKey, aliasKeys, limit = 3) {
    if (!queryKey || queryKey.length < 3) return [];

    // Threshold scales a bit with length, but stays small
    // Example: "cappelli d angelo" can still find "capelli d angelo"
    const maxDist = Math.min(3, Math.floor(queryKey.length / 6) + 1);

    const scored = [];
    for (const k of aliasKeys) {
      const d = levenshtein(queryKey, k, maxDist);
      if (d <= maxDist) scored.push({ k, d });
    }

    scored.sort((a, b) => a.d - b.d || a.k.length - b.k.length);
    return scored.slice(0, limit).map((s) => s.k);
  }

  let indexCache = null;

  // Built once per page-load for suggestion + fuzzy matching
  let slugToEntry = null;
  let aliasList = null;     // [{ key, slug, url, label, reason }]
  let aliasKeys = null;     // [key, key, key...]

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

      const canonicalKey = normalize(label);
      const reason = aliasKey !== canonicalKey ? aliasKey : "";

      const dedupeKey = `${aliasKey}::${slug}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      aliasList.push({ key: aliasKey, slug, url, label, reason });
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
        reason: a.reason,
        description: entry?.description || "", // optional
      });

      if (out.length >= limit) break;
    }

    return out;
  }

  function showDidYouMean(keys) {
    // Keys are normalized alias keys; map them to canonical entries
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
        reason: `did you mean: ${k}`,
        description: entry?.description || "",
      });
    }

    if (!suggestions.length) return false;

    // Put the message in the status line, and render clickable options
    status.innerHTML = "";
    const span = document.createElement("span");
    span.textContent = "No exact match. Did you mean:";
    status.appendChild(span);

    renderSuggestions(suggestions);
    return true;
  }

  async function runSearch(query, { redirectIfFound } = { redirectIfFound: true }) {
    const idx = await getIndex();
    if (!idx) return;

    const match = findMatch(idx, query);
    if (match && match.url) {
      setMatchStatus({ name: match.name, url: match.url });
      clearSuggestions();
      if (redirectIfFound) window.location.href = match.url;
      return;
    }

    const s = suggest(idx, query);

    if (!query.trim()) {
      setStatusText("");
      clearSuggestions();
      return;
    }

    // If we have suggestions, show them (plus descriptions if present)
    if (s.length) {
      setStatusText("No exact match. Suggestions:");
      renderSuggestions(s);
      return;
    }

    // Otherwise, try fuzzy "did you mean"
    const qKey = normalize(query);
    const dym = computeDidYouMean(qKey, aliasKeys, 3);
    if (dym.length && showDidYouMean(dym)) return;

    // Nothing found at all
    setStatusText("No match found.");
    clearSuggestions();
  }

  // Live suggestions while typing (no redirect)
  input.addEventListener("input", () => {
    runSearch(input.value, { redirectIfFound: false });
  });

  // Submit redirects if found
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch(input.value, { redirectIfFound: true });
  });

  // Handle /?q=... (fallback for normal submits or shared links)
  (function handleQueryParamOnLoad() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (!q) return;

    input.value = q;
    window.history.replaceState({}, "", window.location.pathname);
    runSearch(q, { redirectIfFound: true });
  })();
})();
