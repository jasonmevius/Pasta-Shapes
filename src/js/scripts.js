(() => {
  // =============================================================================
  // Tiny selector helper
  // =============================================================================
  const $ = (sel, root = document) => root.querySelector(sel);

  // =============================================================================
  // Mobile hamburger menu
  // =============================================================================
  function initHamburgerMenu() {
    const btn = $("#nav-toggle");
    const drawer = $("#nav-drawer");
    if (!btn || !drawer) return;

    btn.setAttribute("aria-expanded", "false");
    drawer.hidden = true;

    function closeMenu() {
      btn.setAttribute("aria-expanded", "false");
      drawer.hidden = true;
    }

    function openMenu() {
      btn.setAttribute("aria-expanded", "true");
      drawer.hidden = false;
    }

    function toggleMenu() {
      const isOpen = btn.getAttribute("aria-expanded") === "true";
      if (isOpen) closeMenu();
      else openMenu();
    }

    btn.addEventListener("click", (e) => {
      e.preventDefault();
      toggleMenu();
    });

    drawer.addEventListener("click", (e) => {
      const a = e.target.closest("a[href]");
      if (a) closeMenu();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeMenu();
    });

    document.addEventListener("click", (e) => {
      const isOpen = btn.getAttribute("aria-expanded") === "true";
      if (!isOpen) return;

      const insideToggle = e.target.closest("#nav-toggle");
      const insideDrawer = e.target.closest("#nav-drawer");
      if (insideToggle || insideDrawer) return;

      closeMenu();
    });
  }

  // =============================================================================
  // Recently viewed (localStorage)
  // =============================================================================
  function readRecents() {
    try {
      return JSON.parse(localStorage.getItem("pasta:recent") || "[]");
    } catch (e) {
      return [];
    }
  }

  function writeRecents(arr) {
    try {
      localStorage.setItem("pasta:recent", JSON.stringify(arr.slice(0, 12)));
    } catch (e) {}
  }

  function addRecent(slug) {
    if (!slug) return;
    const cur = readRecents().filter((x) => x !== slug);
    cur.unshift(slug);
    writeRecents(cur);
  }

  // =============================================================================
  // Linked home rotator (Homepage)
  // =============================================================================
  function initLinkedHomeRotators() {
    const input = $("#pasta-q");
    const img = $("#identify-icon-rotator");
    if (!input || !img) return;

    const reduceMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) return;

    const groupA = input.getAttribute("data-rotator-group") || "";
    const groupB = img.getAttribute("data-rotator-group") || "";
    if (!groupA || groupA !== groupB) return;

    const rawSrcs = img.getAttribute("data-rotate-srcs") || "";
    const iconSrcs = rawSrcs.split(",").map((s) => s.trim()).filter(Boolean);

    const rawNames =
      input.getAttribute("data-placeholder-examples") ||
      img.getAttribute("data-rotate-names") ||
      "";
    const names = rawNames.split(",").map((s) => s.trim()).filter(Boolean);

    const N = Math.min(iconSrcs.length, names.length);
    if (N < 2) return;

    const intervalMs = Math.max(
      1200,
      parseInt(
        input.getAttribute("data-rotate-interval") ||
          img.getAttribute("data-rotate-interval") ||
          "2500",
        10
      )
    );
    const fadeMs = Math.max(
      120,
      parseInt(img.getAttribute("data-rotate-fade") || "240", 10)
    );

    img.style.transitionDuration = `${fadeMs}ms`;

    const tpl =
      input.getAttribute("data-placeholder-template") ||
      "Start typing - e.g., {example}";

    try {
      for (let i = 0; i < N; i++) {
        const pre = new Image();
        pre.decoding = "async";
        pre.src = iconSrcs[i];
      }
    } catch (e) {}

    const currentSrc = img.getAttribute("src") || "";
    let idx = Math.max(0, iconSrcs.indexOf(currentSrc));
    if (idx >= N) idx = 0;

    function setPlaceholder(i) {
      const ex = names[i] || names[0] || "penne";
      input.setAttribute("placeholder", tpl.replace("{example}", ex));
    }
    setPlaceholder(idx);

    let timer = null;
    let swapping = false;

    function shouldRun() {
      const hasText = Boolean(String(input.value || "").trim());
      const isFocused = document.activeElement === input;
      return !hasText && !isFocused;
    }

    function fadeSwapIcon(newSrc) {
      if (swapping) return;
      swapping = true;

      img.classList.add("is-fading");
      window.setTimeout(() => {
        img.src = newSrc;
        requestAnimationFrame(() => {
          img.classList.remove("is-fading");
          window.setTimeout(() => {
            swapping = false;
          }, Math.max(0, Math.floor(fadeMs / 2)));
        });
      }, fadeMs);
    }

    function tick() {
      if (!shouldRun()) return;
      idx = (idx + 1) % N;
      setPlaceholder(idx);
      fadeSwapIcon(iconSrcs[idx]);
    }

    function start() {
      if (timer) return;
      timer = window.setInterval(tick, intervalMs);
    }

    function stop() {
      if (!timer) return;
      window.clearInterval(timer);
      timer = null;
    }

    if (shouldRun()) start();

    input.addEventListener("focus", () => stop(), { passive: true });
    input.addEventListener("input", () => {
      if (shouldRun()) start();
      else stop();
    });
    input.addEventListener(
      "blur",
      () => {
        if (shouldRun()) start();
      },
      { passive: true }
    );

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stop();
      else if (shouldRun()) start();
    });
  }

  // =============================================================================
  // Home/Search page behavior
  // =============================================================================
  function initSearchPage() {
    const input = $("#pasta-q");
    const status = $("#pasta-search-status");
    const list = $("#pasta-results");
    if (!input || !status || !list) return;

    const resultsPanel = $("#home-results-panel");
    const identifyCard = $("#home-identify-card");

    function setSearchingUI(isSearching) {
      document.body.classList.toggle("is-searching", isSearching);
      if (resultsPanel) resultsPanel.hidden = !isSearching;
      if (identifyCard) {
        identifyCard.setAttribute("aria-hidden", isSearching ? "true" : "false");
      }
    }

    setSearchingUI(Boolean(String(input.value || "").trim()));

    const cards = Array.from(list.querySelectorAll("[data-search]"));
    const recentWrap = $("#recently-viewed-wrap");
    const recentList = $("#recently-viewed");

    const note = $("#pasta-results-note");
    const nextBtn = $("#pasta-toggle-all");

    const PAGE_N = 10;
    let visibleLimit = PAGE_N;

    function setControlVisible(el, isVisible) {
      if (!el) return;
      el.hidden = !isVisible;
      el.style.display = isVisible ? "" : "none";
      el.setAttribute("aria-hidden", isVisible ? "false" : "true");
    }

    const STOPWORDS = new Set([
      "a","ad","al","alla","alle","allo","ai","agli","all",
      "da","de","dei","degli","della","delle","del","di",
      "e","ed","in","con","per","su","lo","la","le","il","un","una","uno",
    ]);

    function normalize(s) {
      return String(s || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/&/g, "and")
        .replace(/[’']/g, " ")
        .replace(/[^a-z0-9\s-]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    }

    function normalizeQuery(s) {
      const q = normalize(s);
      if (/^(?:[a-z0-9]\s+){2,}[a-z0-9]$/.test(q)) return q.replace(/\s+/g, "");
      return q;
    }

    function stripStopwords(normalizedString) {
      const parts = (normalizedString || "")
        .split(" ")
        .map((t) => t.trim())
        .filter(Boolean)
        .filter((t) => !STOPWORDS.has(t));
      return parts.join(" ").trim();
    }

    // Optional fuzzy support using /api/pasta-index.json
    let indexLoaded = false;
    let index = null;
    let aliasKeys = null;
    let stopKeyToSlugs = null;
    const cardBySlug = new Map(cards.map((c) => [c.getAttribute("data-slug"), c]));

    async function loadIndexIfNeeded() {
      if (indexLoaded) return index;
      indexLoaded = true;

      try {
        const res = await fetch("/api/pasta-index.json", { cache: "force-cache" });
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
        index = await res.json();

        const a2s = index.aliasToSlug || {};
        aliasKeys = Object.keys(a2s);

        stopKeyToSlugs = new Map();
        for (const k of aliasKeys) {
          const stopKey = stripStopwords(k);
          if (!stopKey) continue;

          const slug = a2s[k];
          if (!slug) continue;

          if (!stopKeyToSlugs.has(stopKey)) stopKeyToSlugs.set(stopKey, new Set());
          stopKeyToSlugs.get(stopKey).add(slug);
        }
      } catch (e) {
        index = null;
        aliasKeys = null;
        stopKeyToSlugs = null;
      }

      return index;
    }

    // Bounded Levenshtein for lightweight fuzzy matching
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

        let minRow = cur[0];
        const ai = a.charCodeAt(i - 1);

        for (let j = 1; j <= bl; j++) {
          const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
          const v = Math.min(
            prev[j] + 1,
            cur[j - 1] + 1,
            prev[j - 1] + cost
          );
          cur[j] = v;
          if (v < minRow) minRow = v;
        }

        if (minRow > maxDist) return maxDist + 1;

        const tmp = prev;
        prev = cur;
        cur = tmp;
      }

      return prev[bl];
    }

    function showRecents() {
      if (!recentWrap || !recentList) return;

      const recents = readRecents();
      if (!recents.length) {
        recentWrap.hidden = true;
        return;
      }

      const names = [];
      for (const slug of recents) {
        const card = cardBySlug.get(slug);
        if (!card) continue;
        const name = card.getAttribute("data-name") || slug;
        names.push({ slug, name });
      }

      if (!names.length) {
        recentWrap.hidden = true;
        return;
      }

      recentWrap.hidden = false;

      // Comma-delimited list (max 5), still linked
      const top5 = names.slice(0, 5);
      recentList.innerHTML = "";
      top5.forEach((it, i) => {
        const a = document.createElement("a");
        a.href = `/pasta/${it.slug}/`;
        a.textContent = it.name;
        a.setAttribute("data-recent", "pasta");
        recentList.appendChild(a);
        if (i < top5.length - 1) {
          recentList.appendChild(document.createTextNode(", "));
        }
      });
    }

    showRecents();

    function renderCards(listOfCards) {
      // Hide all first
      for (const c of cards) c.hidden = true;

      // Show only current
      for (const c of listOfCards) c.hidden = false;

      // Match count
      status.textContent =
        listOfCards.length === 0
          ? "No matches"
          : `${listOfCards.length} match${listOfCards.length === 1 ? "" : "es"}`;

      // Paging UI
      const canShowMore = listOfCards.length > visibleLimit;
      setControlVisible(nextBtn, canShowMore);
      if (nextBtn) nextBtn.textContent = canShowMore ? "Show more" : "Showing all";

      // Note
      setControlVisible(note, Boolean(String(input.value || "").trim()));
    }

    async function search() {
      const rawQ = input.value || "";
      const q = normalizeQuery(rawQ);
      const isSearching = Boolean(String(q || "").trim());
      setSearchingUI(isSearching);

      // Reset pagination on new query
      visibleLimit = PAGE_N;

      if (!q) {
        status.textContent = "Start typing to search pasta shapes";
        for (const c of cards) c.hidden = false;
        setControlVisible(note, false);
        setControlVisible(nextBtn, false);
        showRecents();
        return;
      }

      // Name match (simple)
      const nameMatches = [];
      for (const c of cards) {
        const hay = normalize(c.getAttribute("data-search") || "");
        if (hay.includes(q)) {
          nameMatches.push({ card: c, score: 0 });
        }
      }

      // If we have plenty of direct matches, show them.
      if (nameMatches.length) {
        const limited = nameMatches.slice(0, visibleLimit).map((x) => x.card);
        renderCards(limited);
        setControlVisible(nextBtn, nameMatches.length > visibleLimit);
        return;
      }

      // Fuzzy / alias search if index available
      await loadIndexIfNeeded();
      if (!index || !aliasKeys || !stopKeyToSlugs) {
        renderCards([]);
        return;
      }

      const stopQ = stripStopwords(q);

      // Stopword-aware exact-ish key matches first
      const aliasMatches = [];
      if (stopQ && stopKeyToSlugs.has(stopQ)) {
        for (const slug of stopKeyToSlugs.get(stopQ)) {
          const c = cardBySlug.get(slug);
          if (c) aliasMatches.push({ card: c, score: 0 });
        }
      }

      if (aliasMatches.length) {
        const limited = aliasMatches.slice(0, visibleLimit).map((x) => x.card);
        renderCards(limited);
        setControlVisible(nextBtn, aliasMatches.length > visibleLimit);
        return;
      }

      // Light fuzzy fallback
      const maxDist = Math.min(3, Math.floor((stopQ || q).length / 4));
      const fuzzy = [];
      for (const k of aliasKeys) {
        const stopK = stripStopwords(k);
        const dist = levenshtein(stopQ || q, stopK, maxDist);
        if (dist <= maxDist) {
          const slug = index.aliasToSlug[k];
          const c = cardBySlug.get(slug);
          if (c) fuzzy.push({ card: c, score: dist });
        }
      }

      fuzzy.sort((a, b) => a.score - b.score);

      if (fuzzy.length) {
        const shownCards = fuzzy.slice(0, visibleLimit).map((x) => x.card);
        renderCards(shownCards);
        setControlVisible(nextBtn, fuzzy.length > visibleLimit);
        return;
      }

      renderCards([]);
    }

    input.addEventListener("input", search);

    if (nextBtn) {
      nextBtn.addEventListener("click", (e) => {
        e.preventDefault();
        visibleLimit += PAGE_N;
        search();
      });
    }

    // Record a recent click (detail links should have data-recent="pasta")
    document.addEventListener("click", (e) => {
      const a = e.target.closest('a[data-recent="pasta"]');
      if (!a) return;
      const m = String(a.getAttribute("href") || "").match(/\/pasta\/([^/]+)\//);
      if (m && m[1]) addRecent(m[1]);
    });

    // Initial search (in case of prefilled value)
    search();
  }

  // =============================================================================
  // Identify page behavior (NEW - moves Identify JS out of the template)
  // =============================================================================
  function initIdentifyPage() {
    const app = $("#identify-app");
    const dataScript = $("#identify-data");
    if (!app || !dataScript) return;

    // Prevent double-init if the template still has the embedded script.
    if (window.__pastaIdentifyInit) return;
    window.__pastaIdentifyInit = true;

    const els = {
      app,
      title: $("#identify-title"),
      kicker: $("#identify-kicker"),
      help: $("#identify-help"),
      answers: $("#identify-answers"),
      count: $("#identify-count"),
      resultsCard: $("#identify-results"),
      resultsCount: $("#identify-results-count"),
      resultsList: $("#identify-results-list"),
      btnBack: $("#identify-back"),
      btnReset: $("#identify-reset"),
      btnToggleResults: $("#identify-toggle-results"),
    };

    const IK_THUMBS_BASE = "https://ik.imagekit.io/mevius/pasta/thumbs/";
    const IK_IDENTIFY_BASE = "https://ik.imagekit.io/mevius/pasta/identify/";
    const FALLBACK_THUMB = "pending.png";

    const AUTO_SHOW_RESULTS_THRESHOLD = 10;

    // When results are large, we default to a “Show more” feel.
    // Clicking “Show all” will truly show all results (fixes your Margherite cap issue).
    const DEFAULT_RESULTS_LIMIT = 60;
    const RESULTS_PAGE_SIZE = 60;

    const isUrl = (s) => /^https?:\/\//i.test(String(s || "").trim());

    const fileNameOnly = (s) => {
      const str = String(s || "").trim();
      if (!str) return "";
      const clean = str.split("#")[0].split("?")[0];
      const parts = clean.split("/");
      return parts[parts.length - 1] || "";
    };

    const thumbUrlFor = (thumbRaw) => {
      if (isUrl(thumbRaw)) return String(thumbRaw).trim();
      const fn = fileNameOnly(thumbRaw);
      return IK_THUMBS_BASE + (fn || FALLBACK_THUMB);
    };

    const identifyIconUrlFor = (file) => IK_IDENTIFY_BASE + file;

    const answerIconFor = (questionKey, value) => {
      if (value === "__ns__") return identifyIconUrlFor(`${questionKey}-notsure.png`);
      return identifyIconUrlFor(`${questionKey}-${value}.png`);
    };

    let raw = [];
    try {
      raw = JSON.parse(dataScript.textContent || "[]");
    } catch (e) {
      console.error("Identify: failed to parse identify-data JSON", e);
      if (els.title) els.title.textContent = "Error loading data";
      if (els.help) els.help.textContent = "Could not parse pasta data on this page.";
      return;
    }

    const normalize = (v) => String(v || "").trim().toLowerCase();

    const TYPE_LABELS = {
      strand: "Strand",
      tube: "Tube",
      ribbon: "Ribbon",
      sheet: "Sheet",
      short: "Short cut",
      stuffed: "Stuffed",
      soup: "Soup (Pastina)",
      ring: "Ring",
      dumpling: "Dumpling",
    };

    const TYPE_DESCS = {
      strand: "Long, thin noodles (round or slightly flattened).",
      tube: "Hollow pasta designed to hold sauce inside.",
      ribbon: "Long, flat strips like fettuccine-style cuts.",
      sheet: "Sheets used for layering or cutting (lasagna-style).",
      short: "Short shapes that scoop, trap, or cling to sauce.",
      stuffed: "Filled pasta (pockets, pillows, or sealed edges).",
      soup: "Tiny pasta made for spoons and brothy soups.",
      ring: "Rings that catch sauce in openings.",
      dumpling: "Pasta-like dumplings (often irregular or rustic).",
    };

    const QUESTION_DEFS = [
      {
        key: "type",
        title: "What general type is it?",
        help: "Start broad - this narrows the list quickly.",
        kind: "enum",
        values: Object.keys(TYPE_LABELS),
        label: (v) => TYPE_LABELS[v] || v,
        desc: (v) => TYPE_DESCS[v] || "",
        icon: (v) => identifyIconUrlFor(`${v}.png`),
      },
      {
        key: "hollow",
        title: "Is it hollow?",
        help: "Hollow pasta has a visible tube or cavity.",
        kind: "bool",
        descYes: "You can see a tube or opening through the shape.",
        descNo: "Solid pasta - no tube or cavity.",
      },
      {
        key: "ridged",
        title: "Does it have ridges?",
        help: "Ridges (rigate) help grip sauce.",
        kind: "bool",
        descYes: "Noticeable grooves or ridges on the surface.",
        descNo: "Mostly smooth surface.",
      },
      {
        key: "twisted",
        title: "Is it twisted?",
        help: "Twisted shapes include spirals and corkscrews.",
        kind: "bool",
        descYes: "Spiraled or corkscrew-like geometry.",
        descNo: "Not spiraled or twisted.",
      },
      {
        key: "curved",
        title: "Is it curved?",
        help: "Curved shapes include elbows, crescents, and arcs.",
        kind: "bool",
        descYes: "Bent or arced rather than straight.",
        descNo: "Straight rather than bent.",
      },
      {
        key: "size",
        title: "What size is it?",
        help: "If you’re unsure, pick “Not sure” - size is often the least reliable.",
        kind: "enum",
        values: ["tiny", "small", "medium", "large"],
        label: (v) => v,
        icon: (v) => identifyIconUrlFor(`size-${v}.png`),
      },
    ];

    const initial = raw.map((r) => ({
      slug: r.slug,
      name: r.name,
      type: normalize(r.type),
      size: normalize(r.size),
      hollow: normalize(r.hollow),
      ridged: normalize(r.ridged),
      twisted: normalize(r.twisted),
      curved: normalize(r.curved),
      stuffed: normalize(r.stuffed),
      also: String(r.also || ""),
      thumb: String(r.thumb || ""),
    }));

    let working = initial.slice();
    let history = []; // [{ key, value, prevWorking }]
    let resultsPanelPreference = "auto"; // auto | show | hide

    // results rendering limits
    let resultsLimit = DEFAULT_RESULTS_LIMIT;

    const setText = (el, txt) => { if (el) el.textContent = txt; };

    const sortWorking = () => {
      working.sort((a, b) =>
        String(a.name || "").localeCompare(String(b.name || ""), "en", { sensitivity: "base" })
      );
    };

    const renderMatchesCount = () => {
      setText(els.count, `Matching: ${working.length}`);
    };

    const showResultsPanel = (show) => {
      if (!els.resultsCard || !els.btnToggleResults) return;
      els.resultsCard.hidden = !show;
      els.btnToggleResults.hidden = false;

      // The button now means: expand the list to show all matches, or collapse it.
      if (!show) {
        els.btnToggleResults.textContent = "Show all";
      } else {
        // If we’re showing, label depends on whether we’re fully expanded or not.
        els.btnToggleResults.textContent =
          resultsLimit >= working.length ? "Hide list" : "Show all";
      }
    };

    const shouldShowResultsPanel = () => {
      if (resultsPanelPreference === "show") return true;
      if (resultsPanelPreference === "hide") return false;
      return working.length <= AUTO_SHOW_RESULTS_THRESHOLD;
    };

    const renderResultsList = () => {
      if (!els.resultsList) return;

      els.resultsList.innerHTML = "";

      // Decide how many to render based on current limit.
      const n = Math.min(working.length, resultsLimit);

      for (const item of working.slice(0, n)) {
        const li = document.createElement("li");
        li.className = "result-card";

        const a = document.createElement("a");
        a.className = "result-link";
        a.href = `/pasta/${item.slug}/`;
        a.setAttribute("data-recent", "pasta");

        const thumb = document.createElement("div");
        thumb.className = "thumb";

        const img = document.createElement("img");
        img.width = 56;
        img.height = 56;
        img.loading = "lazy";
        img.decoding = "async";
        img.alt = "";
        img.src = thumbUrlFor(item.thumb);

        thumb.appendChild(img);

        const body = document.createElement("div");
        body.className = "result-body";

        const titleRow = document.createElement("div");
        titleRow.className = "result-title-row";

        const strong = document.createElement("strong");
        strong.className = "result-name";
        strong.textContent = item.name;

        titleRow.appendChild(strong);
        body.appendChild(titleRow);

        a.appendChild(thumb);
        a.appendChild(body);
        li.appendChild(a);
        els.resultsList.appendChild(li);
      }

      setText(els.resultsCount, `${working.length} match${working.length === 1 ? "" : "es"}`);

      // If not all are shown, append a “Show more” row (only when list is visible).
      if (!els.resultsCard.hidden && resultsLimit < working.length) {
        const li = document.createElement("li");
        li.className = "result-card";

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn secondary";
        btn.textContent = `Show more (${Math.min(working.length - resultsLimit, RESULTS_PAGE_SIZE)})`;
        btn.addEventListener("click", () => {
          resultsLimit = Math.min(working.length, resultsLimit + RESULTS_PAGE_SIZE);
          renderResultsList();
          if (els.btnToggleResults) {
            els.btnToggleResults.textContent =
              resultsLimit >= working.length ? "Hide list" : "Show all";
          }
        });

        li.appendChild(btn);
        els.resultsList.appendChild(li);
      }
    };

    const questionAlreadyAnswered = (key) => history.some((h) => h.key === key);

    const nextQuestion = () => {
      if (!questionAlreadyAnswered("type")) return QUESTION_DEFS.find((q) => q.key === "type");

      const answered = new Set(history.map((h) => h.key));

      const scoreQuestion = (key) => {
        const counts = new Map();
        for (const item of working) {
          const v = String(item[key] || "").trim();
          if (!v) continue;
          counts.set(v, (counts.get(v) || 0) + 1);
        }
        if (counts.size < 2) return 0;

        const total = Array.from(counts.values()).reduce((a, b) => a + b, 0);
        if (!total) return 0;

        let sumSq = 0;
        for (const c of counts.values()) {
          const p = c / total;
          sumSq += p * p;
        }
        return 1 - sumSq;
      };

      const preferredOrder = ["hollow", "ridged", "twisted", "curved", "size"];

      const candidates = [];
      for (const key of preferredOrder) {
        if (answered.has(key)) continue;
        if (key === "size" && working.length <= 25) continue;
        const q = QUESTION_DEFS.find((d) => d.key === key);
        if (!q) continue;
        const s = scoreQuestion(key);
        if (s > 0) candidates.push({ q, s });
      }

      if (!candidates.length) return null;
      candidates.sort((a, b) => b.s - a.s);
      return candidates[0].q;
    };

    const countAfterAnswer = (key, value) => {
      if (value === "__ns__") return working.length;
      let count = 0;
      for (const item of working) {
        const itemVal = item[key];
        if (!itemVal) { count++; continue; }
        if (itemVal === value) count++;
      }
      return count;
    };

    const applyAnswer = (key, value) => {
      const prev = working;
      history.push({ key, value, prevWorking: prev });

      working = working.filter((item) => {
        const itemVal = item[key];
        if (!itemVal) return true;
        if (value === "__ns__") return true;
        return itemVal === value;
      });

      // Reset results limiting each step (so “Show more” stays sensible)
      resultsLimit = DEFAULT_RESULTS_LIMIT;
      render();
    };

    const goBack = () => {
      if (!history.length) return;
      const last = history.pop();
      working = last.prevWorking || initial.slice();
      resultsLimit = DEFAULT_RESULTS_LIMIT;
      render();
    };

    const reset = () => {
      working = initial.slice();
      history = [];
      resultsPanelPreference = "auto";
      resultsLimit = DEFAULT_RESULTS_LIMIT;
      render();
    };

    const renderAnswers = (q) => {
      if (!els.answers) return;
      els.answers.innerHTML = "";

      // Let CSS know what kind of question this is for layout tweaks.
      els.answers.setAttribute("data-kind", q.kind);

      const addButton = (label, value, desc, iconUrl) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "identify-answer";
        btn.addEventListener("click", () => applyAnswer(q.key, value));

        const img = document.createElement("img");
        img.alt = "";
        img.loading = "lazy";
        img.decoding = "async";
        img.width = 56;
        img.height = 56;

        if (q.kind === "bool") img.src = answerIconFor(q.key, value);
        else if (iconUrl) img.src = iconUrl;

        const meta = document.createElement("div");
        meta.className = "identify-answer-meta";

        const t = document.createElement("div");
        t.className = "identify-answer-title";

        const projected = countAfterAnswer(q.key, value);
        t.textContent = `${label} (${projected})`;

        const d = document.createElement("div");
        d.className = "identify-answer-desc muted";
        d.textContent = desc || "";

        meta.appendChild(t);
        if (desc) meta.appendChild(d);

        btn.appendChild(img);
        btn.appendChild(meta);

        els.answers.appendChild(btn);
      };

      if (q.kind === "bool") {
        addButton("Yes", "yes", q.descYes || "", null);
        addButton("No", "no", q.descNo || "", null);
        addButton("Not sure", "__ns__", "Keep all possibilities.", null);
        return;
      }

      // Sort enum answers by projected count (descending), but keep “Not sure” last.
      const values = q.values || [];
      const ranked = values
        .map((v) => ({ v, n: countAfterAnswer(q.key, v) }))
        .sort((a, b) => b.n - a.n)
        .map((x) => x.v);

      for (const v of ranked) {
        addButton(q.label(v), v, q.desc ? q.desc(v) : "", q.icon ? q.icon(v) : null);
      }
      addButton("Not sure", "__ns__", "Keep all possibilities.", null);
    };

    const render = () => {
      sortWorking();

      if (els.btnBack) els.btnBack.disabled = history.length === 0;

      const q = nextQuestion();

      // Single match confirmation state (no auto-redirect)
      if (working.length === 1) {
        const only = working[0];

        setText(els.kicker, "Result");
        setText(els.title, "Is this your pasta?");
        setText(
          els.help,
          `We narrowed it down to 1 match: ${only.name}. Tap “View details” to confirm, or use Back / Reset to revise your answers.`
        );

        if (els.answers) {
          els.answers.innerHTML = "";
          els.answers.setAttribute("data-kind", "single");

          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "btn";
          btn.textContent = "View details";
          btn.addEventListener("click", () => {
            window.location.href = `/pasta/${only.slug}/`;
          });

          els.answers.appendChild(btn);
        }

        renderMatchesCount();
        resultsPanelPreference = "show";
        resultsLimit = working.length; // show all
        showResultsPanel(true);
        renderResultsList();
        return;
      }

      // If no useful questions remain, show results
      if (!q) {
        setText(els.kicker, "Done");
        setText(els.title, "Here are your matches");
        setText(els.help, "You can refine by restarting or tapping a match.");

        if (els.answers) {
          els.answers.innerHTML = "";
          els.answers.removeAttribute("data-kind");
        }

        resultsPanelPreference = "show";
        showResultsPanel(true);

        renderMatchesCount();
        renderResultsList();
        return;
      }

      // Normal question flow
      setText(els.kicker, `Question ${history.length + 1}`);
      setText(els.title, q.title);
      setText(els.help, q.help || "");

      renderAnswers(q);
      renderMatchesCount();

      // Auto show list when small, or if user expanded it.
      const show = shouldShowResultsPanel();
      showResultsPanel(show);

      // If we’re showing results, default to a reasonable limit unless user expanded.
      if (show) {
        if (resultsPanelPreference === "show") resultsLimit = working.length;
        else resultsLimit = Math.min(DEFAULT_RESULTS_LIMIT, working.length);
      }

      renderResultsList();
    };

    // Controls
    if (els.btnBack) els.btnBack.addEventListener("click", goBack);
    if (els.btnReset) els.btnReset.addEventListener("click", reset);

    if (els.btnToggleResults) {
      els.btnToggleResults.addEventListener("click", () => {
        // If hidden -> show list (start with a reasonable chunk)
        if (els.resultsCard.hidden) {
          resultsPanelPreference = "show";
          resultsLimit = Math.min(DEFAULT_RESULTS_LIMIT, working.length);
          showResultsPanel(true);
          renderResultsList();
          return;
        }

        // If visible but not fully expanded -> expand to all
        if (resultsLimit < working.length) {
          resultsPanelPreference = "show";
          resultsLimit = working.length; // THIS is the “Show all” fix
          showResultsPanel(true);
          renderResultsList();
          return;
        }

        // Otherwise, hide list
        resultsPanelPreference = "hide";
        showResultsPanel(false);
      });
    }

    render();
  }

  // =============================================================================
  // Boot
  // =============================================================================
  initHamburgerMenu();
  initLinkedHomeRotators();
  initSearchPage();
  initIdentifyPage();
})();