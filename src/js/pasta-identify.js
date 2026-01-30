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

  // Prefer “structural” questions first; Size is a tie-breaker.
  const QUESTION_DEFS = [
    { key: "isHollow", el: elHollow, label: "Hollow", kind: "structural" },
    { key: "isRidged", el: elRidged, label: "Ridged", kind: "structural" },
    { key: "isTwisted", el: elTwisted, label: "Twisted", kind: "structural" },
    { key: "isCurved", el: elCurved, label: "Curved", kind: "structural" },
    { key: "sizeClass", el: elSize, label: "Size", kind: "size" },
  ];

  function normVal(v) {
    return String(v || "").trim().toLowerCase();
  }

  function getLabelEl(selectEl) {
    return (
      root.querySelector(`label[for="${selectEl.id}"]`) ||
      document.querySelector(`label[for="${selectEl.id}"]`)
    );
  }

  function setFieldVisible(selectEl, visible) {
    const label = getLabelEl(selectEl);

    // If the label wraps the select, hiding the label hides both.
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

      // sizeClass: allow blank values when selecting unknown
      if (filters.sizeClass) {
        const v = normVal(e.sizeClass);
        if (v !== filters.sizeClass) {
          if (!(filters.sizeClass === "unknown" && !v)) return false;
        }
      }

      return true;
    });
  }

  // ---------- scoring / next-question selection ----------

  function entropyFromCounts(counts) {
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
    const buckets = new Map();
    for (const e of candidateEntries) {
      const b = getValueBucket(e, key);
      buckets.set(b, (buckets.get(b) || 0) + 1);
    }

    const counts = Array.from(buckets.values());
    const total = counts.reduce((a, b) => a + b, 0);
    if (!total) return -1;

    // If everything is unknown, don't ask this.
    if (buckets.size === 1 && buckets.has("unknown")) return -1;

    // If essentially constant, very low value.
    const maxCount = Math.max(...counts);
    const dominance = maxCount / total;
    if (dominance >= 0.92) return 0;

    const h = entropyFromCounts(counts);

    // Penalize unknown-heavy splits
    const unknownFrac = (buckets.get("unknown") || 0) / total;
    const penalty = unknownFrac * 0.35 + Math.max(0, buckets.size - 3) * 0.1;

    return h - penalty;
  }

  function getAnsweredKeys() {
    const answered = new Set();
    for (const q of QUESTION_DEFS) {
      if (normVal(q.el.value)) answered.add(q.key);
    }
    return answered;
  }

  function countAnsweredStructural(answeredKeys) {
    let n = 0;
    for (const q of QUESTION_DEFS) {
      if (q.kind === "structural" && answeredKeys.has(q.key)) n++;
    }
    return n;
  }

  function pickNextQuestion(candidateEntries, answeredKeys) {
    if (candidateEntries.length <= 1) return null;

    const answeredStructural = countAnsweredStructural(answeredKeys);

    // Compute scores for all unanswered questions.
    const scored = [];
    for (const q of QUESTION_DEFS) {
      if (answeredKeys.has(q.key)) continue;
      const s = scoreQuestion(candidateEntries, q.key);
      if (s > 0) scored.push({ q, s });
    }

    if (!scored.length) return null;

    scored.sort((a, b) => b.s - a.s);

    // Strong UX rule: do not show Size as the next question early unless it is clearly dominant.
    // - If we have <2 structural answers, we strongly prefer a structural question.
    // - Size is allowed if it beats the best structural by a margin, or if no structural is viable.
    const bestOverall = scored[0];

    const structural = scored.filter((x) => x.q.kind === "structural");
    const bestStructural = structural.length ? structural[0] : null;

    // If size is best, decide if we should still pick structural.
    if (bestOverall.q.kind === "size") {
      // Allow size if:
      // - user already answered 2+ structural questions, OR
      // - there is no structural option with positive score, OR
      // - size beats best structural by a clear margin.
      const MARGIN = 0.35; // tweakable
      const sizeWinsHard =
        !bestStructural || bestOverall.s >= bestStructural.s + MARGIN;

      if (answeredStructural >= 2 || sizeWinsHard) return bestOverall.q;

      // Otherwise choose the best structural if available.
      if (bestStructural) return bestStructural.q;

      return bestOverall.q;
    }

    // If a structural question is best overall, use it.
    return bestOverall.q;
  }

  // ---------- progressive reveal logic ----------

  function hideAllNonTypeFields() {
    for (const q of QUESTION_DEFS) setFieldVisible(q.el, false);
  }

  function showAnsweredAndNext(nextQ) {
    const answered = getAnsweredKeys();

    for (const q of QUESTION_DEFS) {
      if (answered.has(q.key)) setFieldVisible(q.el, true);
      else setFieldVisible(q.el, false);
    }

    if (nextQ) setFieldVisible(nextQ.el, true);
  }

  function clearFieldsAfter(changedEl) {
    const all = [elType, ...QUESTION_DEFS.map((q) => q.el)];
    const idx = all.indexOf(changedEl);
    if (idx === -1) return;

    for (let i = idx + 1; i < all.length; i++) {
      all[i].value = "";
    }
  }

  function removeBlankTypeOptions() {
    // Removes options that have no matching entries (e.g., "Other" if empty)
    const typeCounts = new Map();
    for (const e of entries) {
      const t = normVal(e.type);
      if (!t) continue;
      typeCounts.set(t, (typeCounts.get(t) || 0) + 1);
    }

    const opts = Array.from(elType.options || []);
    for (const opt of opts) {
      const v = normVal(opt.value);
      if (!v) continue; // keep placeholder
      if (!typeCounts.get(v)) {
        // remove empty category option
        opt.remove();
      }
    }
  }

  function updateUI() {
    if (!loaded) return;

    const filters = getFilterState();

    // Enforce: Type first
    if (!filters.type) {
      hideAllNonTypeFields();
      setStatus(`Choose a Type to start narrowing down from ${entries.length} shapes.`);
      clearResults();
      return;
    }

    const results = applyAllFilters(entries, filters);

    if (!results.length) {
      setStatus("No matches with those answers. Try changing your last selection.");
      clearResults();
      showAnsweredAndNext(null);
      return;
    }

    const answeredKeys = getAnsweredKeys();
    const nextQ = pickNextQuestion(results, answeredKeys);

    setStatus(`${results.length} match${results.length === 1 ? "" : "es"}.`);
    render(results);

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

      // Remove empty Type options like "Other" (if it has no entries)
      removeBlankTypeOptions();

      setStatus(`Choose a Type to start narrowing down from ${entries.length} shapes.`);
    } catch (e) {
      setStatus("Identify-by-shape is unavailable right now.");
      loaded = false;
    }
  }

  // Events
  elType.addEventListener("change", () => {
    clearFieldsAfter(elType);
    updateUI();
  });

  for (const q of QUESTION_DEFS) {
    q.el.addEventListener("change", () => {
      clearFieldsAfter(q.el);
      updateUI();
    });
  }

  elReset.addEventListener("click", reset);

  init();
})();
