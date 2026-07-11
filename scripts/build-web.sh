#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEBAPP_DIR="$ROOT_DIR/webapp"
CONTENT_DIR="$ROOT_DIR/csb_msmd001"
DIST_DIR="$ROOT_DIR/dist"

rm -rf "$DIST_DIR"
python3 "$ROOT_DIR/scripts/gen_manifest.py"

mkdir -p "$DIST_DIR"
cp -R "$WEBAPP_DIR/." "$DIST_DIR/"

mkdir -p "$DIST_DIR/content/csb_msmd001"
for level_dir in "$CONTENT_DIR"/csb*; do
  [[ -d "$level_dir" ]] || continue
  level_name="$(basename "$level_dir")"
  mkdir -p "$DIST_DIR/content/csb_msmd001/$level_name"
  find "$level_dir" -maxdepth 1 -type f \( -name '*.png' -o -name '*.mp3' -o -name '*.wav' \) \
    -exec cp {} "$DIST_DIR/content/csb_msmd001/$level_name/" \;
done

echo "Built $DIST_DIR"
