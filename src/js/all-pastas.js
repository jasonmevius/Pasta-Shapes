/* ------------------------------------------------------------
   /js/all-pastas.js

   Adds “Excel-ish” behavior to the /all/ pasta table:
   - Text search across all columns
   - Category dropdown filter
   - Click-to-sort on table headers

   This script is defensive:
   - It does nothing unless it finds #allPastaTable on the page
------------------------------------------------------------- */

(function () {
  const table = document.getElementById("allPastaTable");
  if (!table) return; // Not on /all/ page - safe to load globally

  const tbody = table.querySelector("tbody");
  const rows = Array.from(tbody.querySelectorAll("tr.data-row"));

  const searchInput = document.getElementById("allPastaSearch");
  const categorySelect = document.getElementById("allPastaCategory");
  const clearBtn = document.getElementById("allPastaClear");
  const visibleCountEl = document.getElementById("allPastaVisibleCount");

  // Track current sort state
  const sortState = {
    key: null, // "name" | "category" | "type" | "geometry"
    dir: "asc", // "asc" | "desc"
  };

  /* -----------------------------------------
     Helpers
  ------------------------------------------ */

  function normalize(str) {
    return String(str || "").trim().toLowerCase();
  }

  // Build a “searchable” string for a row by concatenating key fields
  function rowSearchText(row) {
    const name = row.dataset.name || "";
    const category = row.dataset.category || "";
    const type = row.dataset.type || "";
    const geometry = row.dataset.geometry || "";
    return `${name} ${category} ${type} ${geometry}`.trim();
  }

  function updateVisibleCount() {
    const visible = rows.reduce((count, row) => count + (row.hidden ? 0 : 1), 0);
    if (visibleCountEl) visibleCountEl.textContent = String(visible);
  }

  function applyFilters() {
    const q = normalize(searchInput ? searchInput.value : "");
    const selectedCategory = normalize(categorySelect ? categorySelect.value : "");

    rows.forEach((row) => {
      // Category filter
      const rowCategory = normalize(row.dataset.category);
      const categoryPass = !selectedCategory || rowCategory === selectedCategory;

      // Text search filter
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

    // Locale compare gives nicer alphabetical ordering
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

  function sortBy(th) {
    const key = th.getAttribute("data-sort-key");
    if (!key) return;

    // Toggle direction if sorting same column; otherwise default to ascending
    if (sortState.key === key) {
      sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
    } else {
      sortState.key = key;
      sortState.dir = "asc";
    }

    // Sort only currently-rendered rows; keep hidden status as-is
    const sorted = rows.slice().sort((a, b) => compareRows(a, b, key, sortState.dir));

    // Re-append in sorted order (this updates DOM order)
    sorted.forEach((row) => tbody.appendChild(row));

    // Update aria-sort for accessibility
    setAriaSort(th);
  }

  /* -----------------------------------------
     Wire up events
  ------------------------------------------ */

  if (searchInput) {
    searchInput.addEventListener("input", applyFilters);
  }

  if (categorySelect) {
    categorySelect.addEventListener("change", applyFilters);
  }

  if (clearBtn) {
    clearBtn.addEventListener("click", clearFilters);
  }

  // Click-to-sort on sortable headers
  const sortableHeaders = table.querySelectorAll("th.data-table__sortable");
  sortableHeaders.forEach((th) => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => sortBy(th));
  });

  // Initial count
  updateVisibleCount();
})();
