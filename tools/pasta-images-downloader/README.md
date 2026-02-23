# Pasta Shapes - Image Bulk Download Bundle

This bundle is designed to download every image URL referenced in your tracking spreadsheet, and save them into a consistent folder structure:

- `uncooked/<slug>.<ext>`
- `cooked/<slug>.<ext>`

It also builds `pasta-images.zip` so you can move the entire set around as one artifact.

## Included files

- `manifest.csv` - machine-friendly URL list + intended output paths
- `download_images.js` - Node.js downloader (recommended)
- `download_images.py` - Python downloader

## Run (recommended: Node)

```bash
node download_images.js
```

## Run (Python)

```bash
pip install requests
python download_images.py
```

## Resume-safe

Both scripts skip files that already exist and are non-empty, so you can re-run safely.
