/**
 * Pasta Shapes - Bulk Image Downloader (Node.js)
 * -----------------------------------------------------------------------------
 * Reads manifest.csv and downloads images into:
 *   ./uncooked/<slug>.<ext>
 *   ./cooked/<slug>.<ext>
 *
 * Then builds ./pasta-images.zip containing the two folders.
 *
 * WHY THIS EXISTS:
 *   - Your tracking spreadsheet contains direct image URLs.
 *   - This script lets you fetch everything via GitHub Actions (no local installs)
 *     and produce a consistent folder structure for your site.
 *
 * RESILIENCE IMPROVEMENTS (v1.1):
 *   - Normalizes URLs (strips quotes, encodes spaces, fixes " -> " artifacts)
 *   - Retries on Wikimedia throttling (HTTP 429) + transient 5xx
 *   - Exponential backoff + jitter
 *   - Lower default concurrency to avoid 429 storms
 *   - Still logs true 404s (bad filenames) so you can fix your manifest later
 *
 * USAGE:
 *   node download_images.js
 *
 * OUTPUTS:
 *   - ./uncooked/...
 *   - ./cooked/...
 *   - ./pasta-images.zip
 *
 * NOTE:
 *   - This script intentionally skips files that already exist (resume-safe).
 *   - If you re-run after a partial success, it will continue where it left off.
 * -----------------------------------------------------------------------------
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");
const { URL } = require("url");
const zlib = require("zlib");

// -------------------------------
// Config
// -------------------------------
const ROOT = __dirname;
const MANIFEST = path.join(ROOT, "manifest.csv");
const OUT_UNCOOKED = path.join(ROOT, "uncooked");
const OUT_COOKED = path.join(ROOT, "cooked");
const ZIP_OUT = path.join(ROOT, "pasta-images.zip");

const USER_AGENT = "PastaShapesImageDownloader/1.1 (+https://homecharg.ing/)";
const MAX_REDIRECTS = 8;

// IMPORTANT:
// Wikimedia will rate-limit aggressively if we hit it too hard.
// Start low. You can increase later if it stays stable.
const CONCURRENCY = 2;

// Retry/backoff settings for 429/5xx
const MAX_RETRIES = 6;
const BASE_BACKOFF_MS = 1500; // grows exponentially with retries
const REQUEST_TIMEOUT_MS = 60000;

// Content-Type -> extension (fallback when URL has no extension)
const CONTENT_TYPE_EXT = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/tiff": ".tif",
  "image/bmp": ".bmp",
};

// -------------------------------
// Helpers
// -------------------------------

/**
 * Ensure output directories exist.
 */
function ensureDir(p) {
  if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true });
}

/**
 * Return true if a file exists and is non-empty.
 * Used for resume-safe behavior.
 */
function existsNonEmpty(p) {
  try {
    return fs.existsSync(p) && fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

/**
 * Infer a file extension from the URL path.
 * Example: ".../Foo.jpg" -> ".jpg"
 */
function inferExtFromUrl(u) {
  const base = path.basename(new URL(u).pathname);
  const idx = base.lastIndexOf(".");
  if (idx !== -1) {
    const ext = base.slice(idx).toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff", ".bmp"].includes(ext)) {
      return ext === ".jpeg" ? ".jpg" : ext;
    }
  }
  return "";
}

/**
 * Infer a file extension from HTTP Content-Type (fallback).
 */
function inferExtFromContentType(ct) {
  if (!ct) return "";
  const norm = ct.split(";")[0].trim().toLowerCase();
  return CONTENT_TYPE_EXT[norm] || "";
}

/**
 * Normalize URLs from manifest.csv so Node's URL parser won’t choke.
 * - Strips wrapping quotes
 * - Fixes common “human text” artifacts (like " -> ")
 * - Encodes spaces safely
 *
 * IMPORTANT:
 * - This does NOT “guess” missing filenames. If the Commons file name is wrong,
 *   you’ll still get a 404 (which is good - it tells you the manifest needs fix).
 */
function normalizeUrl(raw) {
  let url = String(raw || "").trim();

  // Strip wrapping quotes if the CSV ever includes them
  url = url.replace(/^"+|"+$/g, "");

  // Some rows may have accidental " -> " artifacts from copy/paste notes
  // Convert to hyphen so it's at least a valid URL string.
  url = url.replace(/\s*->\s*/g, "-");

  // Spaces are not valid in URLs; encode them.
  url = url.replace(/ /g, "%20");

  return url;
}

/**
 * Sleep helper for backoff.
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry wrapper that backs off on Wikimedia throttling (429)
 * and on transient server errors (500-504).
 *
 * - 404s are not retried (bad filename / broken link).
 * - For other errors, we retry up to MAX_RETRIES.
 */
async function withRetries(fn, label) {
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (e) {
      attempt++;

      const msg = e && e.message ? e.message : String(e);

      const is404 = msg.includes("HTTP 404");
      const is429 = msg.includes("HTTP 429");
      const is5xx =
        msg.includes("HTTP 500") ||
        msg.includes("HTTP 502") ||
        msg.includes("HTTP 503") ||
        msg.includes("HTTP 504");

      // 404 = broken filename; don't waste time retrying
      if (is404) throw e;

      // If it's not a throttling or transient server error, don't loop forever
      if (!is429 && !is5xx && attempt >= 2) throw e;

      if (attempt > MAX_RETRIES) throw e;

      // Exponential backoff with jitter
      const backoff = Math.round(
        BASE_BACKOFF_MS * Math.pow(2, attempt - 1) * (0.85 + Math.random() * 0.3)
      );

      console.log(`RETRY ${label} (attempt ${attempt}/${MAX_RETRIES}) in ${backoff}ms - ${msg}`);
      await sleep(backoff);
    }
  }
}

/**
 * Read manifest.csv
 *
 * Expected columns:
 *   state, slug, url, relative_output_path
 *
 * Implementation note:
 * - This is a small CSV parser that assumes no embedded commas in values.
 * - If you ever add quoted values containing commas, we should swap to a real CSV parser.
 */
function readManifest() {
  if (!fs.existsSync(MANIFEST)) throw new Error(`Missing manifest.csv at ${MANIFEST}`);
  const lines = fs.readFileSync(MANIFEST, "utf8").split(/\r?\n/).filter(Boolean);

  const header = lines[0].split(",").map((s) => s.trim());
  const idxUrl = header.indexOf("url");
  const idxRel = header.indexOf("relative_output_path");

  if (idxUrl === -1 || idxRel === -1) {
    throw new Error("manifest.csv missing required columns: url, relative_output_path");
  }

  const jobs = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const url = (cols[idxUrl] || "").trim();
    const rel = (cols[idxRel] || "").trim();
    if (!url || !rel) continue;

    jobs.push({ url, outPath: path.join(ROOT, rel) });
  }

  return jobs;
}

// -------------------------------
// HTTP downloader with redirects
// -------------------------------

/**
 * Request a stream for a URL, following redirects up to MAX_REDIRECTS.
 * Returns:
 *   { res, contentType }
 */
function requestStream(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === "https:" ? https : http;

    const req = lib.request(
      {
        method: "GET",
        hostname: u.hostname,
        path: u.pathname + u.search,
        headers: { "User-Agent": USER_AGENT },
        timeout: REQUEST_TIMEOUT_MS,
      },
      (res) => {
        // Follow redirects
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          if (redirectsLeft <= 0) return reject(new Error(`Too many redirects: ${url}`));
          const next = new URL(res.headers.location, url).toString();
          res.resume(); // discard
          return resolve(requestStream(next, redirectsLeft - 1));
        }

        // Non-2xx => error
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }

        resolve({ res, contentType: res.headers["content-type"] || "" });
      }
    );

    req.on("timeout", () => req.destroy(new Error(`Timeout ${REQUEST_TIMEOUT_MS}ms for ${url}`)));
    req.on("error", reject);
    req.end();
  });
}

/**
 * Download one job:
 * - normalizes URL
 * - skips if file already exists and is non-empty
 * - streams to .part then renames
 * - infers extension when missing
 */
async function downloadOne(job) {
  const cleanUrl = normalizeUrl(job.url);
  let outPath = job.outPath;

  // Resume-safe skip
  if (existsNonEmpty(outPath)) {
    return { status: "skip", msg: `SKIP (exists) ${path.relative(ROOT, outPath)}` };
  }

  ensureDir(path.dirname(outPath));
  const partPath = outPath + ".part";

  // Request stream with retry/backoff for 429/5xx
  const { res, contentType } = await withRetries(
    () => requestStream(cleanUrl, MAX_REDIRECTS),
    cleanUrl
  );

  // If the manifest output path has no extension, infer it.
  if (path.extname(outPath) === "") {
    const ext = inferExtFromUrl(cleanUrl) || inferExtFromContentType(contentType);
    if (ext) outPath = outPath + ext;
  }

  // Stream to disk
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(partPath);
    res.pipe(file);
    res.on("error", reject);
    file.on("finish", resolve);
    file.on("error", reject);
  });

  fs.renameSync(partPath, outPath);
  return { status: "ok", msg: `OK ${path.relative(ROOT, outPath)}` };
}

// -------------------------------
// Minimal ZIP writer (no deps)
// -------------------------------

/**
 * CRC32 (needed for ZIP central directory)
 * Small implementation, fast enough for our purposes.
 */
function crc32(buf) {
  const table =
    crc32.table ||
    (crc32.table = (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c >>> 0;
      }
      return t;
    })());

  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Convert JS Date -> DOS date/time fields used by ZIP.
 */
function dosDateTime(date) {
  const dt = new Date(date);
  const year = dt.getFullYear();
  const month = dt.getMonth() + 1;
  const day = dt.getDate();
  const hour = dt.getHours();
  const min = dt.getMinutes();
  const sec = Math.floor(dt.getSeconds() / 2);

  const dosTime = (hour << 11) | (min << 5) | sec;
  const dosDate = (year - 1980 << 9) | (month << 5) | day;
  return { dosDate, dosTime };
}

/**
 * List files recursively (folders only).
 */
function listFilesRecursive(dir) {
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...listFilesRecursive(p));
    else if (ent.isFile()) out.push(p);
  }
  return out;
}

/**
 * Write a ZIP containing all files in the provided folders.
 * Zip content paths are relative to ROOT, which gives you:
 *   uncooked/...
 *   cooked/...
 */
function writeZip(zipPath, folders) {
  if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath);

  const files = [];
  for (const f of folders) if (fs.existsSync(f)) files.push(...listFilesRecursive(f));

  const fd = fs.openSync(zipPath, "w");
  let offset = 0;
  const central = [];

  for (const filePath of files) {
    const rel = path.relative(ROOT, filePath).replace(/\\/g, "/");
    const data = fs.readFileSync(filePath);
    const deflated = zlib.deflateRawSync(data);
    const crc = crc32(data);
    const { dosDate, dosTime } = dosDateTime(fs.statSync(filePath).mtime);

    // Local file header
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8); // deflate
    localHeader.writeUInt16LE(dosTime, 10);
    localHeader.writeUInt16LE(dosDate, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(deflated.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(Buffer.byteLength(rel), 26);
    localHeader.writeUInt16LE(0, 28);

    fs.writeSync(fd, localHeader);
    offset += localHeader.length;
    fs.writeSync(fd, Buffer.from(rel));
    offset += Buffer.byteLength(rel);
    fs.writeSync(fd, deflated);
    offset += deflated.length;

    // Central directory entry
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0, 8);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(dosTime, 12);
    c.writeUInt16LE(dosDate, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(deflated.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(Buffer.byteLength(rel), 28);
    c.writeUInt16LE(0, 30);
    c.writeUInt16LE(0, 32);
    c.writeUInt16LE(0, 34);
    c.writeUInt16LE(0, 36);
    c.writeUInt32LE(0, 38);
    c.writeUInt32LE(offset - (localHeader.length + Buffer.byteLength(rel) + deflated.length), 42);

    central.push({ header: c, name: rel });
  }

  const centralStart = offset;
  for (const entry of central) {
    fs.writeSync(fd, entry.header);
    offset += entry.header.length;
    fs.writeSync(fd, Buffer.from(entry.name));
    offset += Buffer.byteLength(entry.name);
  }
  const centralSize = offset - centralStart;

  // End of central directory
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);

  fs.writeSync(fd, end);
  fs.closeSync(fd);
}

// -------------------------------
// Worker pool runner
// -------------------------------

async function run() {
  ensureDir(OUT_UNCOOKED);
  ensureDir(OUT_COOKED);

  const jobs = readManifest();

  let i = 0;
  let ok = 0;
  let skip = 0;
  let err = 0;

  async function worker() {
    while (true) {
      const myIdx = i++;
      if (myIdx >= jobs.length) return;

      const job = jobs[myIdx];
      try {
        const res = await downloadOne(job);
        console.log(`[${myIdx + 1}/${jobs.length}] ${res.msg}`);
        if (res.status === "ok") ok++;
        else if (res.status === "skip") skip++;
      } catch (e) {
        err++;
        console.log(
          `[${myIdx + 1}/${jobs.length}] ERROR ${normalizeUrl(job.url)} -> ${path.relative(
            ROOT,
            job.outPath
          )}: ${e.message}`
        );
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  // Always build a zip of whatever succeeded.
  writeZip(ZIP_OUT, [OUT_UNCOOKED, OUT_COOKED]);

  console.log("\nDone.");
  console.log("Downloaded:", ok);
  console.log("Skipped:", skip);
  console.log("Errors:", err);
  console.log("ZIP created:", ZIP_OUT);

  // Exit non-zero if there were errors so CI can signal "not perfect".
  // If you prefer the job to always pass, change to: process.exit(0);
  process.exit(err ? 1 : 0);
}

run().catch((e) => {
  console.error("FATAL:", e);
  process.exit(2);
});
