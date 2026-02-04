/* ------------------------------------------------------------
   /js/all-pastas.js

   Enhances the /all/ table:
   - Default sort by Name (A-Z) on load
   - Text search (Name + Category)
   - Category dropdown filter (auto-populated)
   - Click-to-sort on Name + Category headers
   - Thumbnail fallback (keeps <img>, swaps src on error)

   Safe to load globally:
   - No-ops unless it finds #allPastaTable
------------------------------------------------------------- */

(function () {
  const table = document.getElementById("allPastaTable");
  if (!table) return;

  const tbody = table.querySelector("tbody");
  const rows = Array.from(tbody.querySelectorAll("tr.data-row"));

  const searchInput = document.getElementById("allPastaSearch");
  const categorySelect = document.getElementById("allPastaCategory");
  const clearBtn = document.getElementById("allPastaClear");
  const visibleCountEl = document.getElementById("allPastaVisibleCount");

  const sortState = {
    key: "name", // default
    dir: "asc",  // default A-Z
  };

  function normalize(str) {
    return String(str || "").trim().toLowerCase();
  }

  function rowSearchText(row) {
    const name = row.dataset.name || "";
    const category = row.dataset.category || "";
    return `${name} ${category}`.trim();
  }

  function updateVisibleCount() {
    const visible = rows.reduce((count, row) => count + (row.hidden ? 0 : 1), 0);
    if (visibleCountEl) visibleCountEl.textContent = String(visible);
  }

  function applyFilters() {
    const q = normalize(searchInput ? searchInput.value : "");
    const selectedCategory = normalize(categorySelect ? categorySelect.value : "");

    rows.forEach((row) => {
      const rowCategory = normalize(row.dataset.category);
      const categoryPass = !selectedCategory || rowCategory === selectedCategory;

      const text = rowSearchText(row);
      const searchPass = !q || text.includes(q);

      row.hidden = !(categoryPass && searchPass);
    });

    updateVisibleCount();
  }

  function clearFilters() {
    if (searchInput) searchInput.value = "";
    if (categorySelect) categorySelect.value = "";
    applyFilters();
  }

  function compareRows(a, b, key, dir) {
    const av = normalize(a.dataset[key]);
    const bv = normalize(b.dataset[key]);
    const cmp = av.localeCompare(bv, undefined, { sensitivity: "base" });
    return dir === "asc" ? cmp : -cmp;
  }

  function setAriaSort(activeTh) {
    const headers = table.querySelectorAll("th.data-table__sortable");
    headers.forEach((th) => {
      if (th === activeTh) {
        th.setAttribute("aria-sort", sortState.dir === "asc" ? "ascending" : "descending");
      } else {
        th.setAttribute("aria-sort", "none");
      }
    });
  }

  function sortByKey(key, dir, thForAria) {
    sortState.key = key;
    sortState.dir = dir;

    const sorted = rows.slice().sort((a, b) => compareRows(a, b, key, dir));
    sorted.forEach((row) => tbody.appendChild(row));

    if (thForAria) setAriaSort(thForAria);
  }

  function sortByHeader(th) {
    const key = th.getAttribute("data-sort-key");
    if (key !== "name" && key !== "category") return;

    if (sortState.key === key) {
      sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
    } else {
      sortState.key = key;
      sortState.dir = "asc";
    }

    sortByKey(sortState.key, sortState.dir, th);
  }

  function populateCategoryDropdown() {
    if (!categorySelect) return;
    if (categorySelect.options.length > 1) return;

    const map = new Map(); // normalized -> label

    rows.forEach((row) => {
      const key = normalize(row.dataset.category);
      if (!key) return;

      const cell = row.querySelector(".cell-category");
      const label = cell ? String(cell.textContent || "").trim() : key;

      if (!map.has(key)) map.set(key, label);
    });

    const keys = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
    keys.forEach((k) => {
      const opt = document.createElement("option");
      opt.value = k;
      opt.textContent = map.get(k);
      categorySelect.appendChild(opt);
    });
  }

  /* ------------------------------------------------------------
     Thumbnail fallback handling
     - If ImageKit thumb is missing, show a simple inline SVG placeholder
     - We do NOT remove the <img> because that makes debugging harder
  ------------------------------------------------------------- */

  function wireThumbFallbacks() {
    const imgs = table.querySelectorAll(".thumb img");
    if (!imgs.length) return;

    // Tiny grey placeholder SVG (data URI), sized to 56x56
    const fallbackSvg =
      "data:image/svg+xml;charset=utf-8," +
      encodeURIComponent(
        '<svg xmlns="http://www.w3.org/2000/svg" width="56" height="56">' +
          '<rect width="56" height="56" fill="rgba(0,0,0,0.06)"/>' +
        "</svg>"
      );

    imgs.forEach((img) => {
      img.addEventListener("error", () => {
        const wrap = img.closest(".thumb");
        if (wrap) wrap.classList.add("thumb--placeholder");

        // Prevent infinite loop if fallback also errors
        img.onerror = null;

        img.src = fallbackSvg;
      });
    });
  }

  /* ------------------------------------------------------------
     Events
  ------------------------------------------------------------- */

  if (searchInput) searchInput.addEventListener("input", applyFilters);
  if (categorySelect) categorySelect.addEventListener("change", applyFilters);
  if (clearBtn) clearBtn.addEventListener("click", clearFilters);

  const sortableHeaders = table.querySelectorAll("th.data-table__sortable");
  sortableHeaders.forEach((th) => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => sortByHeader(th));
  });

  populateCategoryDropdown();
  wireThumbFallbacks();

  // Default sort: Name A-Z
  // We also align aria-sort by locating the Name header.
  const nameHeader = table.querySelector('th.data-table__sortable[data-sort-key="name"]');
  sortByKey("name", "asc", nameHeader);

  applyFilters(); // sets visible count correctly after initial sort
})();
