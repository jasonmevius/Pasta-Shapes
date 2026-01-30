// src/js/pasta-identify.js
(function () {
  const root = document.getElementById("pasta-identify");
  if (!root) return;

  const elType = document.getElementById("id-type");
  const elHollow = document.getElementById("id-hollow");
  const elRidged = document.getElementById("id-ridged");
  const elTwisted = document.getElementById("id-twisted");
  const elCurved = document.getElementById("id-curved");
  const elSize = document.getElementById("id-size");
  const elReset = document.getElementById("id-reset");
  const elStatus = document.getElementById("id-status");
  const elResults = document.getElementById("id-results");

  if (
    !elType ||
    !elHollow ||
    !elRidged ||
    !elTwisted ||
    !elCurved ||
    !elSize ||
    !elReset ||
    !elStatus ||
    !elResults
  ) return;

  let entries = [];
  let loaded = false;

  // Tuneables
  const MAX_SHOW = 30;

  // "Size is relative" - hide/disable size until it would actually help.
  // If we still have > this many matches after other filters, enable size.
  const ENABLE_SIZE_WHEN_MATCHES_GT = 25;

  function normVal(v) {
    return String(v || "").trim().toLowerCase();
  }

  function matchesFilter(entry, key, selected) {
    if (!selected) return true; // Any
    const val = normVal(entry[key]);
    if (!val) return selected === "unknown"; // blank data treated as unknown
    return val === selected;
  }

  function clearResults() {
    elResults.innerHTML = "";
  }

  function setStatus(text) {
    elStatus.textContent = text;
  }

  function render(results) {
    clearResults();

    const show = results.slice(0, MAX_SHOW);

    for (const r of show) {
      const li = document.createElement("li");

      const a = document.createElement("a");
      a.href = r.url;
      a.textContent = r.name;
      li.appendChild(a);

      // Removed meta line entirely (category/geometry/type repeats what the user filtered by)
      // Keep description for scanability
      if (r.description) {
        const div = document.createElement("div");
        div.style.marginTop = "0.2rem";
        div.style.fontSize = "0.95em";
        div.textContent = r.description;
        li.appendChild(div);
      }

      elResults.appendChild(li);
    }

    if (results.length > MAX_SHOW) {
      const li = document.createElement("li");
      li.textContent = `Showing ${MAX_SHOW} of ${results.length}. Add more answers to narrow it down.`;
      elResults.appendChild(li);
    }
  }

  function getFilterState() {
    return {
      type: normVal(elType.value),
      isHollow: normVal(elHollow.value),
      isRidged: normVal(elRidged.value),
      isTwisted: normVal(elTwisted.value),
      isCurved: normVal(elCurved.value),
      sizeClass: normVal(elSize.value),
    };
  }

  function isAnyFilterSelected(f) {
    return !!(f.type || f.isHollow || f.isRidged || f.isTwisted || f.isCurved || f.sizeClass);
  }

  function applyFilters({ fromEvent = "" } = {}) {
    if (!loaded) return;

    const f = getFilterState();

    // First pass: apply everything EXCEPT size, so we can decide whether size is useful.
    const resultsNoSize = entries.filter((e) => {
      if (f.type && normVal(e.type) !== f.type) return false;
      if (!matchesFilter(e, "isHollow", f.isHollow)) return false;
      if (!matchesFilter(e, "isRidged", f.isRidged)) return false;
      if (!matchesFilter(e, "isTwisted", f.isTwisted)) return false;
      if (!matchesFilter(e, "isCurved", f.isCurved)) return false;
      return true;
    });

    // Decide whether to enable Size
    // - If user already picked a size, keep it enabled
    // - Else, enable only when there are still a lot of matches
    const shouldEnableSize = !!f.sizeClass || resultsNoSize.length > ENABLE_SIZE_WHEN_MATCHES_GT;

    // If size isn't useful right now, disable it and clear selection (unless user explicitly changed size)
    if (!shouldEnableSize) {
      elSize.disabled = true;

      // Only clear size if the change didn't originate from size itself
      if (fromEvent !== "size" && elSize.value) elSize.value = "";
    } else {
      elSize.disabled = false;
    }

    // Now apply size too (if selected)
    const results = resultsNoSize.filter((e) => {
      if (f.sizeClass && normVal(e.sizeClass) !== f.sizeClass) {
        // allow "unknown" to include blank
        if (!(f.sizeClass === "unknown" && !normVal(e.sizeClass))) return false;
      }
      return true;
    });

    // No filters at all
    if (!isAnyFilterSelected(f)) {
      setStatus(`Choose a few options to narrow down from ${entries.length} shapes.`);
      clearResults();
      return;
    }

    // No matches
    if (!results.length) {
      // If size is selected and seems to be the culprit, make that obvious
      if (f.sizeClass) {
        setStatus("No matches. Try changing Size back to Any (or loosening another option).");
      } else {
        setStatus("No matches with those filters. Try loosening one option.");
      }
      clearResults();
      return;
    }

    // Matches found
    let statusText = `${results.length} match${results.length === 1 ? "" : "es"}.`;

    // Gentle hint about size only when it's disabled and results are still large
    if (elSize.disabled && resultsNoSize.length > ENABLE_SIZE_WHEN_MATCHES_GT) {
      // This situation shouldn't happen because we enable size in that case,
      // but leaving this as a safe fallback.
      statusText += " Size may help narrow this down.";
    } else if (!elSize.disabled && !f.sizeClass && resultsNoSize.length > ENABLE_SIZE_WHEN_MATCHES_GT) {
      statusText += " Tip: Size can help narrow this down.";
    }

    setStatus(statusText);
    render(results);
  }

  function reset() {
    elType.value = "";
    elHollow.value = "";
    elRidged.value = "";
    elTwisted.value = "";
    elCurved.value = "";
    elSize.value = "";
    elSize.disabled = true;
    applyFilters({ fromEvent: "reset" });
  }

  async function init() {
    setStatus("Loading feature index...");
    try {
      const res = await fetch("/api/pasta-features.json", { cache: "force-cache" });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const json = await res.json();

      entries = Array.isArray(json.entries) ? json.entries : [];
      loaded = true;

      // Start with size disabled (since it's the trickiest input)
      elSize.disabled = true;

      setStatus(`Choose a few options to narrow down from ${entries.length} shapes.`);
    } catch (e) {
      setStatus("Identify-by-shape is unavailable right now.");
      loaded = false;
    }
  }

  // Events
  elType.addEventListener("change", () => applyFilters({ fromEvent: "type" }));
  elHollow.addEventListener("change", () => applyFilters({ fromEvent: "hollow" }));
  elRidged.addEventListener("change", () => applyFilters({ fromEvent: "ridged" }));
  elTwisted.addEventListener("change", () => applyFilters({ fromEvent: "twisted" }));
  elCurved.addEventListener("change", () => applyFilters({ fromEvent: "curved" }));
  elSize.addEventListener("change", () => applyFilters({ fromEvent: "size" }));
  elReset.addEventListener("click", reset);

  init();
})();
