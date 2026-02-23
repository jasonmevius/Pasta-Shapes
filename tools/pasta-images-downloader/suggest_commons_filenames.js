/**
 * suggest_commons_filenames.js
 * -----------------------------------------------------------------------------
 * PURPOSE
 * - Helps you fix 404 "Special:FilePath/<filename>" errors in bulk.
 * - Reads a list of failed filenames (one per line) and queries Wikimedia Commons
 *   to find the closest matching real filenames.
 *
 * INPUT
 * - ./failed-filenames.txt
 *   Example lines:
 *     Bucatini_all'amatriciana.jpg
 *     Spaghetti_raw.jpg
 *
 * OUTPUT
 * - ./suggestions.csv
 *   Columns:
 *     original, exists, best_title, best_filepath_url, candidates_json
 *
 * HOW IT WORKS
 * 1) Tries an exact check: "File:<original>"
 * 2) If missing, performs a search limited to FILE namespace (namespace 6)
 * 3) Returns top N matches so you can pick the best one
 *
 * WHY THIS IS NEEDED
 * - Commons filenames are exact; many "guessed" names don't exist.
 * - File names may differ by punctuation, capitalization, spacing, suffixes, etc.
 *
 * NOTE
 * - This script does NOT automatically rewrite your manifest.csv.
 *   It generates a suggestion list so you can make the changes confidently.
 * -----------------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = __dirname;
const INPUT_TXT = path.join(ROOT, "failed-filenames.txt");
const OUTPUT_CSV = path.join(ROOT, "suggestions.csv");

// Commons API endpoint (MediaWiki Action API)
const API = "https://commons.wikimedia.org/w/api.php";

// Search settings
const SEARCH_LIMIT = 8; // top candidates per failed filename

// Be polite
const USER_AGENT = "PastaShapesCommonsSuggest/1.0 (+https://homecharg.ing/)";
const REQUEST_TIMEOUT_MS = 30000;
const POLITE_DELAY_MS = 200;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Minimal HTTPS JSON fetch with query params.
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: "GET",
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "application/json",
        },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            const json = JSON.parse(data);
            resolve({ status: res.statusCode, json });
          } catch (e) {
            reject(new Error(`Failed to parse JSON. HTTP ${res.statusCode}. Body starts: ${data.slice(0, 200)}`));
          }
        });
      }
    );

    req.on("timeout", () => req.destroy(new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms`)));
    req.on("error", reject);
    req.end();
  });
}

/**
 * Build a Commons API URL with params.
 */
function apiUrl(params) {
  const u = new URL(API);
  // Always request JSON, and allow CORS-safe GET usage.
  u.searchParams.set("format", "json");
  u.searchParams.set("origin", "*");
  for (const [k, v] of Object.entries(params)) {
    u.searchParams.set(k, String(v));
  }
  return u.toString();
}

/**
 * Exact existence check: does File:<title> exist on Commons?
 */
async function fileExists(filename) {
  // MediaWiki uses "File:" namespace; "Image:" also works historically, but File: is standard.
  const title = filename.startsWith("File:") ? filename : `File:${filename}`;

  const url = apiUrl({
    action: "query",
    titles: title,
  });

  const { json } = await fetchJson(url);

  const pages = json?.query?.pages;
  if (!pages) return { exists: false };

  // pages is an object keyed by pageid; missing files show pageid = -1
  const page = Object.values(pages)[0];
  if (!page) return { exists: false };

  return { exists: page.pageid !== -1, title: page.title };
}

/**
 * Search Commons for candidate file pages in namespace 6 (File).
 * Uses list=search with srnamespace=6.
 */
async function searchCandidates(filename) {
  // Use a forgiving search string:
  // - strip extension
  // - replace underscores with spaces (Commons often uses spaces in file names)
  const base = filename.replace(/\.[a-z0-9]+$/i, "");
  const query = base.replace(/_/g, " ");

  const url = apiUrl({
    action: "query",
    list: "search",
    srnamespace: 6, // File namespace
    srsearch: query,
    srlimit: SEARCH_LIMIT,
  });

  const { json } = await fetchJson(url);
  const results = json?.query?.search || [];

  // Titles returned like "File:Whatever.jpg"
  return results.map((r) => r.title);
}

/**
 * Convert a Commons "File:XYZ" title to a Special:FilePath URL.
 */
function toFilePathUrl(fileTitle) {
  const name = fileTitle.replace(/^File:/i, "");
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}`;
}

/**
 * Very small CSV escape.
 */
function csvEscape(v) {
  const s = String(v ?? "");
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  if (!fs.existsSync(INPUT_TXT)) {
    console.error(`Missing input file: ${INPUT_TXT}`);
    process.exit(2);
  }

  const lines = fs
    .readFileSync(INPUT_TXT, "utf8")
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);

  const out = [];
  out.push(["original", "exists", "best_title", "best_filePath_url", "candidates_json"].join(","));

  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];

    // 1) Exact check
    let existsInfo;
    try {
      existsInfo = await fileExists(original);
    } catch (e) {
      // If the API fails, still write a row so you know it didn't process.
      out.push(
        [
          csvEscape(original),
          "api_error",
          "",
          "",
          csvEscape(JSON.stringify({ error: e.message })),
        ].join(",")
      );
      continue;
    }

    if (existsInfo.exists) {
      const bestTitle = existsInfo.title; // "File:..."
      out.push(
        [
          csvEscape(original),
          "yes",
          csvEscape(bestTitle),
          csvEscape(toFilePathUrl(bestTitle)),
          csvEscape(JSON.stringify([bestTitle])),
        ].join(",")
      );
      await sleep(POLITE_DELAY_MS);
      continue;
    }

    // 2) Search candidates
    const candidates = await searchCandidates(original);
    const bestTitle = candidates[0] || "";

    out.push(
      [
        csvEscape(original),
        "no",
        csvEscape(bestTitle),
        csvEscape(bestTitle ? toFilePathUrl(bestTitle) : ""),
        csvEscape(JSON.stringify(candidates)),
      ].join(",")
    );

    await sleep(POLITE_DELAY_MS);
  }

  fs.writeFileSync(OUTPUT_CSV, out.join("\n"), "utf8");
  console.log(`Wrote: ${OUTPUT_CSV}`);
}

main().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
