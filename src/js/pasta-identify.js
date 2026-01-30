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

  function normVal(v) {
    return String(v || "").trim().toLowerCase();
  }

  function matchesFilter(entry, key, selected) {
    if (!selected) return true; // Any
    const val = normVal(entry[key]);
    if (!val) return selected === "unknown"; // if data blank, treat as unknown
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

    const maxShow = 30;
    const show = results.slice(0, maxShow);

    for (const r of show) {
      const li = document.createElement("li");

      const a = document.createElement("a");
      a.href = r.url;
      a.textContent = r.name;
      li.appendChild(a);

      // Optional details to help scanning
      const meta = [];
      if (r.category) meta.push(r.category);
      if (r.primaryGeometry) meta.push(r.primaryGeometry);

      if (meta.length) {
        const small = document.createElement("small");
        small.style.marginLeft = "0.5rem";
        small.textContent = `(${meta.join(" - ")})`;
        li.appendChild(small);
      }

      if (r.description) {
        const div = document.createElement("div");
        div.style.marginTop = "0.2rem";
        div.style.fontSize = "0.95em";
        div.textContent = r.description;
        li.appendChild(div);
      }

      elResults.appendChild(li);
    }

    if (results.length > maxShow) {
      const li = document.createElement("li");
      li.textContent = `Showing ${maxShow} of ${results.length}. Add more answers to narrow it down.`;
      elResults.appendChild(li);
    }
  }

  function applyFilters() {
    if (!loaded) return;

    const f = {
      type: normVal(elType.value),
      isHollow: normVal(elHollow.value),
      isRidged: normVal(elRidged.value),
      isTwisted: normVal(elTwisted.value),
      isCurved: normVal(elCurved.value),
      sizeClass: normVal(elSize.value),
    };

    const results = entries.filter((e) => {
      if (f.type && normVal(e.type) !== f.type) return false;
      if (!matchesFilter(e, "isHollow", f.isHollow)) return false;
      if (!matchesFilter(e, "isRidged", f.isRidged)) return false;
      if (!matchesFilter(e, "isTwisted", f.isTwisted)) return false;
      if (!matchesFilter(e, "isCurved", f.isCurved)) return false;
      if (f.sizeClass && normVal(e.sizeClass) !== f.sizeClass) {
        // Allow unknown selection to include blank
        if (!(f.sizeClass === "unknown" && !normVal(e.sizeClass))) return false;
      }
      return true;
    });

    if (!f.type && !f.isHollow && !f.isRidged && !f.isTwisted && !f.isCurved && !f.sizeClass) {
      setStatus(`Choose a few options to narrow down from ${entries.length} shapes.`);
      clearResults();
      return;
    }

    if (!results.length) {
      setStatus("No matches with those filters. Try loosening one option.");
      clearResults();
      return;
    }

    setStatus(`${results.length} match${results.length === 1 ? "" : "es"}.`);
    render(results);
  }

  function reset() {
    elType.value = "";
    elHollow.value = "";
    elRidged.value = "";
    elTwisted.value = "";
    elCurved.value = "";
    elSize.value = "";
    applyFilters();
  }

  async function init() {
    setStatus("Loading feature index...");
    try {
      const res = await fetch("/api/pasta-features.json", { cache: "force-cache" });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const json = await res.json();

      entries = Array.isArray(json.entries) ? json.entries : [];
      loaded = true;

      setStatus(`Choose a few options to narrow down from ${entries.length} shapes.`);
    } catch (e) {
      setStatus("Identify-by-shape is unavailable right now.");
      loaded = false;
    }
  }

  // Events
  elType.addEventListener("change", applyFilters);
  elHollow.addEventListener("change", applyFilters);
  elRidged.addEventListener("change", applyFilters);
  elTwisted.addEventListener("change", applyFilters);
  elCurved.addEventListener("change", applyFilters);
  elSize.addEventListener("change", applyFilters);
  elReset.addEventListener("click", reset);

  init();
})();
