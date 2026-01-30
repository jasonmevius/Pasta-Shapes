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

  // Fixed sequential order in the UI (always displayed in this order)
  const STEPS = [
    {
      key: "type",
      el: elType,
      title: "Type",
      desc: "Start with the overall form - long strands, tubes, sheets, stuffed, soup shapes, etc.",
    },
    {
      key: "isHollow",
      el: elHollow,
      title: "Hollow",
      desc: "Does it have a hole or tube running through it (like penne or rigatoni)?",
      kind: "structural",
    },
    {
      key: "isRidged",
      el: elRidged,
      title: "Ridged",
      desc: "Are there ridges or grooves on the surface (often used to grab sauce)?",
      kind: "structural",
    },
    {
      key: "isTwisted",
      el: elTwisted,
      title: "Twisted",
      desc: "Is the shape spiraled or twisted (like fusilli)?",
      kind: "structural",
    },
    {
      key: "isCurved",
      el: elCurved,
      title: "Curved",
      desc: "Is the shape notably curved (like elbows or shells)?",
      kind: "structural",
    },
    {
      key: "sizeClass",
      el: elSize,
      title: "Size",
      desc: "A rough bucket - small / medium / large. Helpful as a tie-breaker, but subjective.",
      kind: "size",
    },
  ];

  function normVal(v) {
    return String(v || "").trim().toLowerCase();
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

  // ----- Choose the next best question (adaptive), but reveal it in fixed order -----

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

    // If essentially constant, low value.
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
    if (normVal(elType.value)) answered.add("type");
    for (const s of STEPS) {
      if (s.key === "type") continue;
      if (normVal(s.el.value)) answered.add(s.key);
    }
    return answered;
  }

  function countAnsweredStructural(answeredKeys) {
    let n = 0;
    for (const s of STEPS) {
      if (s.kind === "structural" && answeredKeys.has(s.key)) n++;
    }
    return n;
  }

  function pickNextQuestion(candidateEntries, answeredKeys) {
    if (candidateEntries.length <= 1) return null;

    const answeredStructural = countAnsweredStructural(answeredKeys);

    // Candidate questions are the non-type ones not yet answered.
    const candidates = STEPS.filter(
      (s) => s.key !== "type" && !answeredKeys.has(s.key)
    );

    const scored = [];
    for (const s of candidates) {
      const sc = scoreQuestion(candidateEntries, s.key);
      if (sc > 0) scored.push({ step: s, score: sc });
    }

    if (!scored.length) return null;

    scored.sort((a, b) => b.score - a.score);

    const bestOverall = scored[0];
    const structural = scored.filter((x) => x.step.kind === "structural");
    const bestStructural = structural.length ? structural[0] : null;

    // Size is a tie-breaker: avoid showing it early unless clearly dominant.
    if (bestOverall.step.kind === "size") {
      const MARGIN = 0.35; // tweakable
      const sizeWinsHard =
        !bestStructural || bestOverall.score >= bestStructural.score + MARGIN;

      if (answeredStructural >= 2 || sizeWinsHard) return bestOverall.step;

      if (bestStructural) return bestStructural.step;
      return bestOverall.step;
    }

    return bestOverall.step;
  }

  // ----- UI: wrap each question into a "step card", sequential layout -----

  function getLabelFor(selectEl) {
    return (
      root.querySelector(`label[for="${selectEl.id}"]`) ||
      document.querySelector(`label[for="${selectEl.id}"]`)
    );
  }

  function injectIdentifyStylesOnce() {
    if (document.getElementById("pasta-identify-inline-styles")) return;

    const style = document.createElement("style");
    style.id = "pasta-identify-inline-styles";
    style.textContent = `
      .id-steps { display: grid; gap: 0.85rem; margin-top: 0.75rem; }
      .id-step { border: 1px solid rgba(0,0,0,0.12); border-radius: 10px; padding: 0.8rem; }
      .id-step[hidden] { display: none !important; }

      .id-step__top { display: grid; grid-template-columns: 64px 1fr; gap: 0.75rem; align-items: start; }
      .id-step__img {
        width: 64px; height: 64px; border-radius: 10px;
        border: 1px dashed rgba(0,0,0,0.25);
        display: grid; place-items: center;
        font-size: 0.72rem; line-height: 1.1;
        opacity: 0.8; user-select: none;
        text-align: center; padding: 0.35rem;
      }
      .id-step__title { font-weight: 700; margin: 0; }
      .id-step__desc { margin: 0.25rem 0 0; font-size: 0.95em; opacity: 0.85; }

      .id-step__control { margin-top: 0.65rem; }
      .id-step__control label { display: none !important; } /* we render our own title */
      .id-step__control select { width: 100%; max-width: 420px; }

      .id-step__hint { margin-top: 0.5rem; font-size: 0.9em; opacity: 0.8; }
    `;
    document.head.appendChild(style);
  }

  // Create a step card wrapper and move the existing label+select into it.
  function buildStepCard(step) {
    const selectEl = step.el;
    const labelEl = getLabelFor(selectEl);

    const card = document.createElement("section");
    card.className = "id-step";
    card.dataset.stepKey = step.key;

    const top = document.createElement("div");
    top.className = "id-step__top";

    const img = document.createElement("div");
    img.className = "id-step__img";
    img.setAttribute("aria-hidden", "true");
    img.textContent = "Image\nsoon";

    const text = document.createElement("div");
    const h = document.createElement("p");
    h.className = "id-step__title";
    h.textContent = step.title;

    const d = document.createElement("p");
    d.className = "id-step__desc";
    d.textContent = step.desc;

    text.appendChild(h);
    text.appendChild(d);

    top.appendChild(img);
    top.appendChild(text);

    const control = document.createElement("div");
    control.className = "id-step__control";

    // Move label+select (or just select) into the control block.
    // If label wraps the select, move the label (contains both).
    if (labelEl && labelEl.contains(selectEl)) {
      control.appendChild(labelEl);
    } else {
      if (labelEl) control.appendChild(labelEl);
      control.appendChild(selectEl);
    }

    card.appendChild(top);
    card.appendChild(control);

    return card;
  }

  // Replace the free-floating controls with an ordered steps container.
  let stepsContainer = null;
  let stepCardByKey = new Map();

  function buildStepsUI() {
    injectIdentifyStylesOnce();

    // If we already built it (hot reload or nav), don’t rebuild.
    if (root.querySelector(".id-steps")) {
      stepsContainer = root.querySelector(".id-steps");
      stepCardByKey = new Map();
      for (const el of stepsContainer.querySelectorAll(".id-step")) {
        stepCardByKey.set(el.dataset.stepKey, el);
      }
      return;
    }

    stepsContainer = document.createElement("div");
    stepsContainer.className = "id-steps";

    // Build in fixed sequential order.
    for (const step of STEPS) {
      const card = buildStepCard(step);
      stepsContainer.appendChild(card);
      stepCardByKey.set(step.key, card);
    }

    // Insert steps before status (or at end of root if not found)
    if (elStatus && elStatus.parentNode) {
      elStatus.parentNode.insertBefore(stepsContainer, elStatus);
    } else {
      root.appendChild(stepsContainer);
    }
  }

  function setStepVisible(key, visible) {
    const card = stepCardByKey.get(key);
    if (!card) return;
    if (visible) card.removeAttribute("hidden");
    else card.setAttribute("hidden", "hidden");
  }

  function hideAllStepsExceptType() {
    for (const s of STEPS) {
      setStepVisible(s.key, s.key === "type");
    }
  }

  function showAnsweredAndNextStep(nextStepKey) {
    const answered = getAnsweredKeys();

    for (const s of STEPS) {
      if (s.key === "type") {
        setStepVisible("type", true);
        continue;
      }
      setStepVisible(s.key, answered.has(s.key));
    }

    if (nextStepKey && !answered.has(nextStepKey)) {
      setStepVisible(nextStepKey, true);
    }
  }

  function clearFieldsAfter(changedKey) {
    const order = STEPS.map((s) => s.key);
    const idx = order.indexOf(changedKey);
    if (idx === -1) return;

    for (let i = idx + 1; i < order.length; i++) {
      const key = order[i];
      const step = STEPS.find((s) => s.key === key);
      if (step) step.el.value = "";
    }
  }

  function removeBlankTypeOptions() {
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
      if (!typeCounts.get(v)) opt.remove(); // remove empty types, e.g. Other if blank
    }
  }

  function updateUI() {
    if (!loaded) return;

    const filters = getFilterState();

    // Type first
    if (!filters.type) {
      hideAllStepsExceptType();
      setStatus(`Choose a Type to start narrowing down from ${entries.length} shapes.`);
      clearResults();
      return;
    }

    const results = applyAllFilters(entries, filters);

    if (!results.length) {
      setStatus("No matches with those answers. Try changing your last selection.");
      clearResults();

      // Still show the answered steps (so the user can back out), but no new step
      showAnsweredAndNextStep(null);
      return;
    }

    const answeredKeys = getAnsweredKeys();
    const nextStep = pickNextQuestion(results, answeredKeys);

    setStatus(`${results.length} match${results.length === 1 ? "" : "es"}.`);
    render(results);

    showAnsweredAndNextStep(nextStep ? nextStep.key : null);
  }

  function reset() {
    elType.value = "";
    for (const s of STEPS) {
      if (s.key === "type") continue;
      s.el.value = "";
    }
    hideAllStepsExceptType();
    setStatus("Choose a Type to start.");
    clearResults();
  }

  async function init() {
    setStatus("Loading feature index...");

    buildStepsUI();
    hideAllStepsExceptType();

    try {
      const res = await fetch("/api/pasta-features.json", { cache: "force-cache" });
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const json = await res.json();

      entries = Array.isArray(json.entries) ? json.entries : [];
      loaded = true;

      // Remove empty type options like "Other" if it has no entries
      removeBlankTypeOptions();

      setStatus(`Choose a Type to start narrowing down from ${entries.length} shapes.`);
    } catch (e) {
      setStatus("Identify-by-shape is unavailable right now.");
      loaded = false;
    }
  }

  // Events
  elType.addEventListener("change", () => {
    clearFieldsAfter("type");
    updateUI();
  });

  for (const s of STEPS) {
    if (s.key === "type") continue;
    s.el.addEventListener("change", () => {
      clearFieldsAfter(s.key);
      updateUI();
    });
  }

  elReset.addEventListener("click", reset);

  init();
})();
