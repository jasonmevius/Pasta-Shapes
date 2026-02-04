/* ------------------------------------------------------------
   /js/all-pastas.js

   Adds “Excel-ish” behavior to the /all/ pasta table:
   - Text search across all columns
   - Category dropdown filter (auto-populated from table rows)
   - Click-to-sort on table headers

   Safe to load globally:
   - No-ops unless it finds #allPastaTable
------------------------------------------------------------- */

(function () {
  const table = document.getElementById("allPastaTable");
  if (!table) return; // Not on /all/ page

  const tbody = table.querySelector("tbody");
  const rows = Array.from(tbody.querySelectorAll("tr.data-row"));

  const searchInput = document.getElementById("allPastaSearch");
  const categorySelect = document.getElementById("allPastaCategory");
  const clearBtn = document.getElementById("allPastaClear");
  const visibleCountEl = document.getElementById("allPastaVisibleCount");

  const sortState = {
    key: null, // "name" | "category" | "type" | "geometry"
    dir: "asc", // "asc" | "desc"
  };

  function normalize(str) {
    return String(str || "").trim().toLowerCase();
  }

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

  function sortBy(th) {
    const key = th.getAttribute("data-sort-key");
    if (!key) return;

    if (sortState.key === key) {
      sortState.dir = sortState.dir === "asc" ? "desc" : "asc";
    } else {
      sortState.key = key;
      sortState.dir = "asc";
    }

    const sorted = rows.slice().sort((a, b) => compareRows(a, b, key, sortState.dir));
    sorted.forEach((row) => tbody.appendChild(row));

    setAriaSort(th);
  }

  /* ------------------------------------------------------------
     Category dropdown auto-population
     - Reads each row's category text from the rendered cell
     - Stores unique categories as:
       value = lowercase normalized
       label = original display text
  ------------------------------------------------------------- */

  function populateCategoryDropdown() {
    if (!categorySelect) return;

    // If it already has more than the default option, don’t duplicate.
    if (categorySelect.options.length > 1) return;

    const map = new Map(); // key: normalized, value: display label

    rows.forEach((row) => {
      const key = normalize(row.dataset.category);
      if (!key) return;

      // Prefer the visible cell label so you preserve capitalization, etc.
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
     Wire up events
  ------------------------------------------------------------- */

  if (searchInput) searchInput.addEventListener("input", applyFilters);
  if (categorySelect) categorySelect.addEventListener("change", applyFilters);
  if (clearBtn) clearBtn.addEventListener("click", clearFilters);

  const sortableHeaders = table.querySelectorAll("th.data-table__sortable");
  sortableHeaders.forEach((th) => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => sortBy(th));
  });

  populateCategoryDropdown();
  updateVisibleCount();
})();
