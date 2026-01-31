(() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  // --- Recently viewed helpers ---
  function readRecents() {
    try { return JSON.parse(localStorage.getItem("pasta:recent") || "[]"); }
    catch (e) { return []; }
  }

  function writeRecents(arr) {
    try { localStorage.setItem("pasta:recent", JSON.stringify(arr.slice(0, 12))); }
    catch (e) {}
  }

  function addRecent(slug) {
    if (!slug) return;
    const cur = readRecents().filter(x => x !== slug);
    cur.unshift(slug);
    writeRecents(cur);
  }

  // --- Search page behavior ---
  function initSearchPage() {
    const input = $("#pasta-q");
    const status = $("#pasta-search-status");
    const list = $("#pasta-results");
    if (!input || !status || !list) return;

    const cards = Array.from(list.querySelectorAll("[data-search]"));

    const recentWrap = $("#recently-viewed-wrap");
    const recentList = $("#recently-viewed");

    const norm = (s) => (s || "").toLowerCase().trim();

    function setStatus(visibleCount, totalCount, q) {
      if (!q) {
        status.textContent = "Type to filter - aliases included.";
        return;
      }
      status.textContent = `${visibleCount} of ${totalCount} matches`;
    }

    function filter() {
      const q = norm(input.value);
      const total = cards.length;
      let visible = 0;

      for (const card of cards) {
        const blob = norm(card.getAttribute("data-search"));
        const show = !q || blob.includes(q);
        card.style.display = show ? "" : "none";
        if (show) visible++;
      }
      setStatus(visible, total, q);
    }

    function renderRecents() {
      if (!recentWrap || !recentList) return;

      const slugs = readRecents();
      if (!slugs.length) {
        recentWrap.hidden = true;
        return;
      }

      const bySlug = new Map(cards.map(c => [c.getAttribute("data-slug"), c]));
      const items = slugs.map(s => bySlug.get(s)).filter(Boolean).slice(0, 8);

      if (!items.length) {
        recentWrap.hidden = true;
        return;
      }

      recentList.innerHTML = "";
      for (const card of items) {
        const link = card.querySelector("a[href]");
        const name = card.querySelector(".result-name");
        if (!link) continue;

        const li = document.createElement("li");
        const a = document.createElement("a");
        a.href = link.getAttribute("href");
        a.textContent = name ? name.textContent : a.href;
        li.appendChild(a);
        recentList.appendChild(li);
      }

      recentWrap.hidden = false;
    }

    // Record recents on click
    list.addEventListener("click", (e) => {
      const a = e.target.closest("a[data-recent]");
      if (!a) return;

      const href = a.getAttribute("href") || "";
      const m = href.match(/\/pasta\/([^\/]+)\//);
      if (m && m[1]) addRecent(m[1]);
    });

    // Optional: support ?q= prefill
    try {
      const url = new URL(window.location.href);
      const q = url.searchParams.get("q");
      if (q) input.value = q;
    } catch (e) {}

    input.addEventListener("input", filter, { passive: true });

    filter();
    renderRecents();
  }

  // --- Detail page behavior (store recent on load) ---
  function initDetailPage() {
    // If we're on /pasta/<slug>/, store it as recent
    const path = window.location.pathname || "";
    const m = path.match(/^\/pasta\/([^\/]+)\/?$/);
    if (m && m[1]) addRecent(m[1]);
  }

  // Init
  document.addEventListener("DOMContentLoaded", () => {
    initSearchPage();
    initDetailPage();
  }, { once: true });
})();
