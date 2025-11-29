#!/bin/bash
set -e

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Source nvm to use modern Node version
source ~/.nvm/nvm.sh
nvm use node > /dev/null 2>&1

echo "Building mp4-muxer library for Mandelbrot..."

# Check if node_modules exists, if not run npm install
if [ ! -d "$ROOT_DIR/node_modules" ]; then
  echo "Installing dependencies..."
  (cd "$ROOT_DIR" && npm install)
fi

# Bundle and minify using esbuild
echo "Bundling and tree-shaking mp4-muxer..."
"$ROOT_DIR/node_modules/.bin/esbuild" "$SCRIPT_DIR/build-mp4-muxer.js" \
  --bundle \
  --minify \
  --format=iife \
  --line-limit=100 \
  --outfile="$SCRIPT_DIR/build-output.js"

# Extract the bundled code
BUNDLED_CODE=$(cat "$SCRIPT_DIR/build-output.js")

# Get the size
SIZE=$(wc -c < "$SCRIPT_DIR/build-output.js" | tr -d ' ')
echo "Bundled size: ${SIZE} bytes (~$((SIZE / 1024)) KB)"

# Use awk to replace content between sentinels, injecting the bundled code
awk -v size="$SIZE" -v buildout="$SCRIPT_DIR/build-output.js" '
  /<!-- BEGIN_MP4MUXER_LIBRARY -->/ {
    print "<!-- BEGIN_MP4MUXER_LIBRARY -->"
    print "<!-- mp4-muxer library (tree-shaken, " size " bytes) -->"
    print "<!-- Source: https://www.npmjs.com/package/mp4-muxer -->"
    print "<!-- Built with: ./build/build.sh -->"
    print "<script>"
    system("cat " buildout)
    print "</script>"
    print "<!-- END_MP4MUXER_LIBRARY -->"
    skip=1
    next
  }
  /<!-- END_MP4MUXER_LIBRARY -->/ {
    skip=0
    next
  }
  !skip
' "$ROOT_DIR/index.html" > "$ROOT_DIR/index.html.tmp"

# Replace the original file
mv "$ROOT_DIR/index.html.tmp" "$ROOT_DIR/index.html"

# Clean up
rm "$SCRIPT_DIR/build-output.js"

echo "Done! Library injected into index.html"
echo "Size: ${SIZE} bytes (~$((SIZE / 1024)) KB)"
