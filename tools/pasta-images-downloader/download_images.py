#!/usr/bin/env python3
# =====================================================================
# Pasta Shapes - Bulk Image Downloader (Python)
# =====================================================================
#
# This script:
#   1) Reads ./manifest.csv (generated from your tracking spreadsheet)
#   2) Downloads every URL to its intended path:
#        ./uncooked/<slug>.<ext>
#        ./cooked/<slug>.<ext>
#   3) Builds ./pasta-images.zip containing both folders.
#
# Design goals:
#   - Resume-safe: skips files that already exist and are non-empty
#   - Robust: follows redirects (Wikimedia links often redirect)
#   - Memory-safe: streams downloads to disk (supports large files)
#
# Usage:
#   python download_images.py
#
# Requirements:
#   pip install requests
#
# =====================================================================

import csv
import os
import time
import zipfile
from pathlib import Path
from urllib.parse import urlparse

import requests

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "manifest.csv"
OUT_UNCOOKED = ROOT / "uncooked"
OUT_COOKED = ROOT / "cooked"
ZIP_OUT = ROOT / "pasta-images.zip"

# Network behavior
TIMEOUT_S = 60
USER_AGENT = "PastaShapesImageDownloader/1.0 (+https://homecharg.ing/)"

# Content-Type -> extension (fallback when URL has no extension)
CONTENT_TYPE_EXT = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
    "image/tiff": ".tif",
    "image/bmp": ".bmp",
}

def ensure_dirs() -> None:
    """Create output folders if they don't exist."""
    OUT_UNCOOKED.mkdir(parents=True, exist_ok=True)
    OUT_COOKED.mkdir(parents=True, exist_ok=True)

def infer_ext_from_url(url: str) -> str:
    """Best-effort extension inference from URL path."""
    base = os.path.basename(urlparse(url).path)
    if "." in base:
        ext = "." + base.split(".")[-1].lower()
        if ext in [".jpg", ".jpeg", ".png", ".webp", ".gif", ".tif", ".tiff", ".bmp"]:
            return ".jpg" if ext == ".jpeg" else ext
    return ""

def infer_ext_from_content_type(content_type: str) -> str:
    """Map HTTP Content-Type header -> extension."""
    ct = (content_type or "").split(";")[0].strip().lower()
    return CONTENT_TYPE_EXT.get(ct, "")

def download_one(url: str, out_path: Path) -> tuple[bool, str]:
    """Download a single file (streaming) and return (did_download, message)."""
    if out_path.exists() and out_path.stat().st_size > 0:
        return (False, f"SKIP (exists) {out_path.relative_to(ROOT)}")

    headers = {"User-Agent": USER_AGENT}

    try:
        with requests.get(url, headers=headers, stream=True, timeout=TIMEOUT_S, allow_redirects=True) as r:
            r.raise_for_status()

            # If manifest path has no suffix, infer it now using final URL or Content-Type.
            if out_path.suffix == "":
                inferred = infer_ext_from_url(r.url) or infer_ext_from_content_type(r.headers.get("Content-Type", ""))
                if inferred:
                    out_path = out_path.with_suffix(inferred)

            out_path.parent.mkdir(parents=True, exist_ok=True)

            tmp_path = out_path.with_suffix(out_path.suffix + ".part")
            with open(tmp_path, "wb") as f:
                for chunk in r.iter_content(chunk_size=1024 * 256):
                    if chunk:
                        f.write(chunk)

            os.replace(tmp_path, out_path)

        return (True, f"OK {out_path.relative_to(ROOT)}")
    except Exception as e:
        return (False, f"ERROR {url} -> {out_path.relative_to(ROOT)}: {e}")

def build_zip(zip_path: Path) -> None:
    """Create a zip containing uncooked/ and cooked/."""
    if zip_path.exists():
        zip_path.unlink()

    with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as z:
        for folder in [OUT_UNCOOKED, OUT_COOKED]:
            for p in folder.rglob("*"):
                if p.is_file():
                    z.write(p, arcname=str(p.relative_to(ROOT)))

def main() -> int:
    ensure_dirs()

    if not MANIFEST.exists():
        print(f"Missing manifest.csv at: {MANIFEST}")
        return 2

    jobs: list[tuple[str, Path]] = []
    with open(MANIFEST, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            url = row["url"].strip()
            rel = row["relative_output_path"].strip()
            jobs.append((url, ROOT / rel))

    downloaded = 0
    errors = 0
    start = time.time()

    for idx, (url, out_path) in enumerate(jobs, start=1):
        ok, msg = download_one(url, out_path)
        print(f"[{idx}/{len(jobs)}] {msg}")
        if msg.startswith("ERROR"):
            errors += 1
        elif ok:
            downloaded += 1

    build_zip(ZIP_OUT)

    elapsed = time.time() - start
    print("\nDone.")
    print(f"Downloaded this run: {downloaded}")
    print(f"Errors: {errors}")
    print(f"ZIP created: {ZIP_OUT}")
    print(f"Elapsed: {elapsed:.1f}s")

    return 1 if errors else 0

if __name__ == "__main__":
    raise SystemExit(main())
