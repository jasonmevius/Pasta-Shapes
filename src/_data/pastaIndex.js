// src/_data/pastaIndex.js
const fs = require("fs");
const path = require("path");

// Lightweight CSV parser without extra deps
function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const headers = splitCSVLine(lines.shift()).map((h) => h.trim());
  return lines.map((line) => {
    const cells = splitCSVLine(line);
    const row = {};
    headers.forEach((h, i) => (row[h] = (cells[i] ?? "").trim()));
    return row;
  });
}

function splitCSVLine(line) {
  // Handles quoted fields with commas
  const out = [];
  let cur = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];

    // Escaped quote inside a quoted field
    if (ch === '"' && line[i + 1] === '"') {
      cur += '"';
      i++;
      continue;
    }

    // Toggle quoted mode
    if (ch === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    // Comma delimiter (only when not inside quotes)
    if (ch === "," && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }

    cur += ch;
  }

  out.push(cur);
  return out;
}

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Slugify that should match your Nunjucks `| slug` behavior closely enough
function slugify(s) {
  return normalize(s)
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function splitSynonyms(value) {
  // Expecting something like: "macaroni; maccheroni; elbow macaroni"
  return (value || "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = () => {
  // Common patterns:
  // - src/_data/pasta.csv
  // - src/pasta.csv
  // - pasta.csv
  const csvPathCandidates = [
    path.join(process.cwd(), "src", "_data", "pasta.csv"),
    path.join(process.cwd(), "src", "pasta.csv"),
    path.join(process.cwd(), "pasta.csv"),
  ];

  const csvPath = csvPathCandidates.find((p) => fs.existsSync(p));
  if (!csvPath) {
    throw new Error(
      `pastaIndex.js could not find pasta.csv. Tried:\n${csvPathCandidates.join("\n")}`
    );
  }

  const csvText = fs.readFileSync(csvPath, "utf8");
  const rows = parseCSV(csvText);

  // Column names (match your CSV)
  const COL_NAME = "ShapeName";
  const COL_SLUG = "Slug"; // optional - if absent, we compute from ShapeName
  const COL_SYNONYMS = "Synonyms"; // optional; semicolon-separated list

  const entries = [];
  const aliasToSlug = {};

  for (const r of rows) {
    const name = r[COL_NAME];
    if (!name) continue;

    // Use Slug column if present, otherwise compute from name (matches your /pasta/{{ ShapeName | slug }}/)
    const slug =
      (r[COL_SLUG] && r[COL_SLUG].trim()) ||
      (r.slug && r.slug.trim()) ||
      slugify(name);

    if (!slug) continue;

    const url = `/pasta/${slug}/`;
    const synonyms = splitSynonyms(r[COL_SYNONYMS]);

    const allAliases = [name, ...synonyms];

    entries.push({
      name,
      slug,
      url,
      synonyms,
    });

    for (const a of allAliases) {
      const key = normalize(a);
      if (!key) continue;
      if (!aliasToSlug[key]) aliasToSlug[key] = slug;
    }
  }

  const normalizedNames = entries.map((e) => ({
    slug: e.slug,
    url: e.url,
    name: e.name,
    key: normalize(e.name),
  }));

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    entries,
    aliasToSlug,
    normalizedNames,
  };
};
