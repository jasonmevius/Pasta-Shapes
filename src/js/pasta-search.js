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

  function renderSuggestions(items) {
    clearSuggestions();
    for (const it of items) {
      const li = document.createElement("li");
      const a = document.createElement("a");
      a.href = it.url;
      a.textContent = it.label;
      li.appendChild(a);

      // Optional: show alias hint if it’s not the canonical name
      if (it.reason && it.reason !== it.label) {
        const small = document.createElement("small");
        small.style.marginLeft = "0.5rem";
        small.textContent = `(${it.reason})`;
        li.appendChild(small);
      }

      list.appendChild(li);
    }
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

  let indexCache = null;

  // These are built once for better suggestions:
  // - slugToEntry: slug -> entry
  // - aliasList: [{ key, slug, url, label, reason }]
  let slugToEntry = null;
  let aliasList = null;

  function buildLookupStructures(idx) {
    if (slugToEntry && aliasList) return;

    slugToEntry = new Map();
    for (const e of idx.entries || []) slugToEntry.set(e.slug, e);

    // Build a list of aliases from aliasToSlug map
    // Each alias points to the canonical entry
    const seen = new Set();
    aliasList = [];

    const aliasToSlug = idx.aliasToSlug || {};
    for (const [aliasKey, slug] of Object.entries(aliasToSlug)) {
      const entry = slugToEntry.get(slug);
      const url = entry?.url || `/pasta/${slug}/`;
      const label = entry?.name || slug;

      // Keep the aliasKey (already normalized in your index) as our search key
      const key = aliasKey;

      // Avoid duplicates (same key + slug)
      const dedupeKey = `${key}::${slug}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      // If aliasKey is exactly the canonical normalized name, reason is blank
      const canonicalKey = normalize(label);
      const reason = key !== canonicalKey ? key : "";

      aliasList.push({ key, slug, url, label, reason });
    }
  }

  async function getIndex() {
    if (indexCache) return indexCache;

    status.textContent = "Loading...";
    try {
      const res = await fetch("/api/pasta-index.json", { cache: "force-cache" });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      indexCache = await res.json();
      buildLookupStructures(indexCache);
      status.textContent = "";
      return indexCache;
    } catch (e) {
      status.textContent = "Search unavailable right now.";
      return null;
    }
  }

  function findMatch(idx, query) {
    const key = normalize(query);
    if (!key) return null;

    const slug = idx.aliasToSlug?.[key];
    if (!slug) return null;

    const entry = (idx.entries || []).find((e) => e.slug === slug);
    return entry || { slug, url: `/pasta/${slug}/`, name: slug };
  }

  function suggest(idx, query, limit = 10) {
    const q = normalize(query);
    if (!q) return [];

    // Prefer alias-based suggestions so synonyms work (including partials)
    // Strategy:
    // 1) alias startsWith q
    // 2) alias includes q
    // De-dupe by slug so you don’t get 10 variants of the same pasta
    const starts = [];
    const includes = [];

    for (const a of aliasList || []) {
      if (a.key.startsWith(q)) starts.push(a);
      else if (a.key.includes(q)) includes.push(a);
    }

    const combined = [...starts, ...includes];

    const out = [];
    const usedSlugs = new Set();

    for (const a of combined) {
      if (usedSlugs.has(a.slug)) continue;
      usedSlugs.add(a.slug);

      out.push({
        url: a.url,
        label: a.label,
        reason: a.reason, // shows which alias matched (optional display)
      });

      if (out.length >= limit) break;
    }

    return out;
  }

  async function runSearch(query, { redirectIfFound } = { redirectIfFound: true }) {
    const idx = await getIndex();
    if (!idx) return;

    const match = findMatch(idx, query);
    if (match && match.url) {
      setMatchStatus(match);
      clearSuggestions();
      if (redirectIfFound) window.location.href = match.url;
      return;
    }

    const s = suggest(idx, query);

    if (!query.trim()) {
      status.textContent = "";
      clearSuggestions();
      return;
    }

    status.textContent = s.length ? "No exact match. Suggestions:" : "No match found.";
    renderSuggestions(s);
  }

  input.addEventListener("input", () => {
    runSearch(input.value, { redirectIfFound: false });
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runSearch(input.value, { redirectIfFound: true });
  });

  (function handleQueryParamOnLoad() {
    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (!q) return;

    input.value = q;
    window.history.replaceState({}, "", window.location.pathname);
    runSearch(q, { redirectIfFound: true });
  })();
})();
