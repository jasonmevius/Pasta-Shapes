// src/_data/pasta.js
// =============================================================================
// PURPOSE
// - Provide the master `data.pasta` dataset used by Eleventy templates.
// - Detail pages paginate over `data: pasta`, so this file must load the CSV
//   that contains your newest columns (HistoryBlurb, BestFor, etc.).
//
// WHY THIS CHANGE
// - Your previous version hard-coded `pasta.csv` only.
// - If you committed a generated file (e.g., pasta.populated.csv), Eleventy would
//   keep building from the older CSV and your new fields would never show up.
//
// CSV DISCOVERY STRATEGY (in priority order)
// 1) pasta.csv            (canonical "source of truth" filename)
// 2) pasta.populated.csv  (generated, auto-filled version)
// 3) pasta.updated.csv    (schema-updated version)
//
// NOTE
// - This file expects the CSV to live in the SAME folder as this JS file:
//     /src/_data/
//   If you store your CSV elsewhere, update `candidatePaths` accordingly.
//
// =============================================================================

const fs = require("fs");
const path = require("path");
const Papa = require("papaparse");

function findFirstExisting(paths) {
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

module.exports = () => {
  // ---------------------------------------------------------------------------
  // 1) Locate the best CSV file to use (first match wins)
  // ---------------------------------------------------------------------------
  const dataDir = __dirname;

  const candidatePaths = [
    path.join(dataDir, "pasta.csv"),
    path.join(dataDir, "pasta.populated.csv"),
    path.join(dataDir, "pasta.updated.csv"),
  ];

  const csvPath = findFirstExisting(candidatePaths);

  if (!csvPath) {
    // Fail loudly with a helpful message in Netlify logs
    throw new Error(
      [
        "pasta.js: Could not find a pasta CSV file in /src/_data/.",
        "Tried:",
        ...candidatePaths.map((p) => `- ${p}`),
        "",
        "Fix:",
        "- Ensure one of these files exists in /src/_data/, OR",
        "- Update candidatePaths in /src/_data/pasta.js to the correct location.",
      ].join("\n")
    );
  }

  // Helpful signal in Netlify build logs so we can confirm the right file loaded
  console.log(
    `pasta.js: Loading pasta data from ${path.relative(process.cwd(), csvPath)}`
  );

  // ---------------------------------------------------------------------------
  // 2) Parse CSV -> array of row objects (keys = headers)
  // ---------------------------------------------------------------------------
  const csv = fs.readFileSync(csvPath, "utf8");

  const parsed = Papa.parse(csv, {
    header: true,
    skipEmptyLines: true,
  });

  // If there are parse errors, surface a little signal in Netlify logs
  if (parsed.errors && parsed.errors.length) {
    console.warn("pasta.js: CSV parse errors (first 3):", parsed.errors.slice(0, 3));
  }

  // ---------------------------------------------------------------------------
  // 3) Return the dataset Eleventy will expose as `data.pasta`
  // ---------------------------------------------------------------------------
  return parsed.data;
};
