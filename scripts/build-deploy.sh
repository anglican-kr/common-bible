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
  style.css \
  sw.js \
  search-worker.js \
  manifest.webmanifest \
  robots.txt \
  sitemap.xml \
  static/ \
  data/bible/ \
  data/books.json \
  data/book_mappings.json \
  data/search-index.json \
  -x "*.DS_Store" "*.gitkeep"

echo "Done: $OUTPUT_FILE"
echo "Size: $(du -sh "$OUTPUT_FILE" | cut -f1)"
