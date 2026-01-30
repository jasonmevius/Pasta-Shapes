// src/js/pasta-search.js
(function () {
  const form = document.getElementById("pasta-search-form");
  const input = document.getElementById("pasta-q");
  const status = document.getElementById("pasta-search-status");
  const list = document.getElementById("pasta-search-suggestions");

  // Only run on pages that include the search UI
  if (!form || !input || !status || !list) return;

  function normalize(s) {
    return (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/&/g, "and")
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
      a.textContent = it.name;
      li.appendChild(a);
      list.appendChild(li);
    }
  }

  let indexCache = null;
  async function getIndex() {
    if (indexCache) return indexCache;

    status.textContent = "Loading...";
    try {
      const res = await fetch("/api/pasta-index.json", { cache: "force-cache" });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      indexCache = await res.json();
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

    // Find canonical entry to get URL/name
    const entry = (idx.entries || []).find((e) => e.slug === slug);
    return entry || { slug, url: `/pasta/${slug}/`, name: slug };
  }

  function suggest(idx, query, limit = 8) {
    const key = normalize(query);
    if (!key) return [];

    // simple "starts with" first, then "includes"
    const names = idx.normalizedNames || [];
    const starts = [];
    const includes = [];

    for (const n of names) {
      if (n.key.startsWith(key)) starts.push(n);
      else if (n.key.includes(key)) includes.push(n);
    }

    return [...starts, ...includes].slice(0, limit).map((n) => ({
      name: n.name,
      url: n.url,
    }));
  }

  // Live suggestions while typing (non-invasive)
  input.addEventListener("input", async () => {
    const idx = await getIndex();
    if (!idx) return;

    const q = input.value;

    const match = findMatch(idx, q);
    if (match) {
      status.textContent = `Match: ${match.name}`;
      clearSuggestions();
      return;
    }

    const s = suggest(idx, q);
    if (!q.trim()) {
      status.textContent = "";
      clearSuggestions();
      return;
    }

    status.textContent = s.length ? "Suggestions:" : "No match yet.";
    renderSuggestions(s);
  });

  // Submit redirects to the match if found
  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const idx = await getIndex();
    if (!idx) return;

    const q = input.value;
    const match = findMatch(idx, q);

    if (match && match.url) {
      window.location.href = match.url;
      return;
    }

    const s = suggest(idx, q);
    status.textContent = "No exact match. Try a suggestion below.";
    renderSuggestions(s);
  });
})();
