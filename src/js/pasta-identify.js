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

  const MAX_SHOW = 30;

  // Order matters: Type is fixed first, then we will pick the next best dynamically from these.
  // The "key" is the JSON field name.
  const QUESTION_DEFS = [
    { key: "isHollow", el: elHollow, label: "Hollow" },
    { key: "isRidged", el: elRidged, label: "Ridged" },
    { key: "isTwisted", el: elTwisted, label: "Twisted" },
    { key: "isCurved", el: elCurved, label: "Curved" },
    { key: "sizeClass", el: elSize, label: "Size" },
  ];

  function normVal(v) {
    return String(v || "").trim().toLowerCase();
  }

  function getLabelEl(selectEl) {
    // Prefer labels inside the component root, but fall back to document if needed
    return (
      root.querySelector(`label[for="${selectEl.id}"]`) ||
      document.querySelector(`label[for="${selectEl.id}"]`)
    );
  }

  function setFieldVisible(selectEl, visible) {
    const label = getLabelEl(selectEl);

    // If the label wraps the select, hiding label hides both cleanly.
    if (label && label.contains(selectEl)) {
      label.style.display = visible ? "" : "none";
      return;
    }

    if (label) label.style.display = visible ? "" : "none";
    selectEl.style.display = visible ? "" : "none";
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

  // Filter matching for yes/no/unknown fields.
  function matchesFilter(entry, key, selected) {
    if (!selected) return true; // Any
    const val = normVal(entry[key]);
    if (!val) return selected === "unknown"; // blank treated as unknown
    return val === selected;
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

  function applyAllFilters(baseList, filters) {
    return baseList.filter((e) => {
      if (filters.type && normVal(e.type) !== filters.type) return false;
      if (!matchesFilter(e, "isHollow", filters.isHollow)) return false;
      if (!matchesFilter(e, "isRidged", filters.isRidged)) return false;
      if (!matchesFilter(e, "isTwisted", filters.isTwisted)) return false;
      if (!matchesFilter(e, "isCurved", filters.isCurved)) return false;

      // sizeClass is special: allow blank values when selecting unknown
      if (filters.sizeClass) {
        const v = normVal(e.sizeClass);
        if (v !== filters.sizeClass) {
          if (!(filters.sizeClass === "unknown" && !v)) return false;
        }
      }

      return true;
    });
  }

  // --- Picking the next best question ---

  function entropyFromCounts(counts) {
    // counts: number[]
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) return 0;
    let h = 0;
    for (const c of counts) {
      if (!c) continue;
      const p = c / total;
      h -= p * Math.log2(p);
    }
    return h;
  }

  function getValueBucket(entry, key) {
    const v = normVal(entry[key]);
    return v || "unknown";
  }

  function scoreQuestion(candidateEntries, key) {
    // Score is information gain-ish: H(before) - sum(p_i * H(after_i))
    // But here "after" groups are terminal (no further split), so we just want a balanced split.
    // Using entropy of the distribution itself works well:
    // - If all entries share one value -> entropy 0 (bad question)
    // - If entries split across values -> higher entropy (good question)
    const buckets = new Map();
    for (const e of candidateEntries) {
      const b = getValueBucket(e, key);
      buckets.set(b, (buckets.get(b) || 0) + 1);
    }

    // Remove buckets that don't help (all unknown is not helpful)
    // But if there is a mix of known + unknown, unknown can still be informative.
    const counts = Array.from(buckets.values());
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) return -1;

    // If everything is unknown, don't ask this.
    if (buckets.size === 1 && buckets.has("unknown")) return -1;

    // If essentially constant (one bucket dominates), treat as low value.
    const maxCount = Math.max(...counts);
    const dominance = maxCount / total; // 1.0 means constant
    if (dominance >= 0.92) return 0; // near-useless in this subset

    // Entropy prefers more even splits
    const h = entropyFromCounts(counts);

    // Slight penalty for questions with too many categories (not likely here),
    // and for heavy "unknown" since it tends to frustrate users.
    const unknownFrac = (buckets.get("unknown") || 0) / total;
    const penalty = unknownFrac * 0.35 + Math.max(0, buckets.size - 3) * 0.1;

    return h - penalty;
  }

  function pickNextQuestion(candidateEntries, answeredKeys) {
    // Stop if we are already very narrow
    if (candidateEntries.length <= 1) return null;

    let best = null;
    let bestScore = -1;

    for (const q of QUESTION_DEFS) {
      if (answeredKeys.has(q.key)) continue;

      // If user hasn't chosen a Type, don't pick anything (Type is always first)
      // (Handled outside, but keeping it safe)
      const s = scoreQuestion(candidateEntries, q.key);
      if (s > bestScore) {
        bestScore = s;
        best = q;
      }
    }

    // If nothing has a meaningful score, don't show additional questions
    if (!best || bestScore <= 0) return null;

    return best;
  }

  // --- Progressive reveal logic ---

  function getAnsweredKeys() {
    const answered = new Set();
    for (const q of QUESTION_DEFS) {
      if (normVal(q.el.value)) answered.add(q.key);
    }
    return answered;
  }

  function hideAllNonTypeFields() {
    for (const q of QUESTION_DEFS) setFieldVisible(q.el, false);
  }

  function showAnsweredAndNext(nextQ) {
    const answered = getAnsweredKeys();

    // Show answered ones so user can revise
    for (const q of QUESTION_DEFS) {
      if (answered.has(q.key)) setFieldVisible(q.el, true);
      else setFieldVisible(q.el, false);
    }

    // Show the next recommended question
    if (nextQ) setFieldVisible(nextQ.el, true);
  }

  function clearFieldsAfter(changedEl) {
    // If the user changes an earlier answer, clear everything after it
    const all = [elType, ...QUESTION_DEFS.map((q) => q.el)];
    const idx = all.indexOf(changedEl);
    if (idx === -1) return;

    for (let i = idx + 1; i < all.length; i++) {
      all[i].value = "";
    }
  }

  function updateUI(fromEl) {
    if (!loaded) return;

    // Enforce: Type first
    const filters = getFilterState();

    if (!filters.type) {
      // No type selected yet: hide everything else and clear results
      hideAllNonTypeFields();
      setStatus(`Choose a Type to start narrowing down from ${entries.length} shapes.`);
      clearResults();
      return;
    }

    // Apply filters (including any answered fields)
    const results = applyAllFilters(entries, filters);

    if (!results.length) {
      setStatus("No matches with those answers. Try changing your last selection.");
      clearResults();
      // Still show answered fields so user can back out
      showAnsweredAndNext(null);
      return;
    }

    // Determine next question based on the current remaining results
    const answeredKeys = getAnsweredKeys();
    const nextQ = pickNextQuestion(results, answeredKeys);

    // Status and results
    setStatus(`${results.length} match${results.length === 1 ? "" : "es"}.`);
    render(results);

    // Progressive reveal: show already-answered questions + the single next best question
    showAnsweredAndNext(nextQ);
  }

  function reset() {
    elType.value = "";
    for (const q of QUESTION_DEFS) q.el.value = "";
    hideAllNonTypeFields();
    setStatus("Choose a Type to start.");
    clearResults();
  }

  async function init() {
    setStatus("Loading feature index...");
    hideAllNonTypeFields();

    try {
      const res = await fetch("/api/pasta-features.json", { cache: "force-cache" });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const json = await res.json();

      entries = Array.isArray(json.entries) ? json.entries : [];
      loaded = true;

      setStatus(`Choose a Type to start narrowing down from ${entries.length} shapes.`);
    } catch (e) {
      setStatus("Identify-by-shape is unavailable right now.");
      loaded = false;
    }
  }

  // Events
  elType.addEventListener("change", () => {
    clearFieldsAfter(elType);
    updateUI(elType);
  });

  for (const q of QUESTION_DEFS) {
    q.el.addEventListener("change", () => {
      clearFieldsAfter(q.el);
      updateUI(q.el);
    });
  }

  elReset.addEventListener("click", reset);

  init();
})();
