#!/bin/bash
set -e

# Source nvm to use modern Node version
source ~/.nvm/nvm.sh
nvm use node > /dev/null 2>&1

echo "Building mp4-muxer library for Mandelbrot..."

# Check if node_modules exists, if not run npm install
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

# Bundle and minify using esbuild
echo "Bundling and tree-shaking mp4-muxer..."
./node_modules/.bin/esbuild build-mp4-muxer.js \
  --bundle \
  --minify \
  --format=iife \
  --outfile=build-output.js

# Extract the bundled code
BUNDLED_CODE=$(cat build-output.js)

# Get the size
SIZE=$(wc -c < build-output.js | tr -d ' ')
echo "Bundled size: ${SIZE} bytes (~$((SIZE / 1024)) KB)"

# Use awk to replace content between sentinels, injecting the bundled code
awk -v size="$SIZE" '
  /<!-- BEGIN_MP4MUXER_LIBRARY -->/ {
    print "<!-- BEGIN_MP4MUXER_LIBRARY -->"
    print "<!-- mp4-muxer library (tree-shaken, " size " bytes) -->"
    print "<!-- Source: https://www.npmjs.com/package/mp4-muxer -->"
    print "<!-- Built with: ./build.sh -->"
    print "<script>"
    system("cat build-output.js")
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
' index.html > index.html.tmp

# Replace the original file
mv index.html.tmp index.html

# Clean up
rm build-output.js

echo "Done! Library injected into index.html"
echo "Size: ${SIZE} bytes (~$((SIZE / 1024)) KB)"
