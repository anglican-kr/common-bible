#!/usr/bin/env bash
# build-deploy.sh — Create a deployment zip for server upload.
# Excludes: data/audio, data/source, output, src, docs, tests, and dev config files.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUTPUT_FILE="${PROJECT_ROOT}/deploy-${TIMESTAMP}.zip"

cd "$PROJECT_ROOT"

echo "Building deployment package..."

zip -r "$OUTPUT_FILE" \
  index.html \
  app.js \
  gtag-init.js \
  style.css \
  sw.js \
  search-worker.js \
  version.json \
  manifest.webmanifest \
  favicon.ico \
  skh-cross.svg \
  icon-192.png \
  icon-512.png \
  robots.txt \
  sitemap.xml \
  data/bible/ \
  data/books.json \
  data/book_mappings.json \
  data/search-meta.json \
  data/search-nt.json \
  data/search-dc.json \
  data/search-ot.json \
  -x "*.DS_Store" "*.gitkeep"

echo "Done: $OUTPUT_FILE"
echo "Size: $(du -sh "$OUTPUT_FILE" | cut -f1)"
