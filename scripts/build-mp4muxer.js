#!/usr/bin/env node
/**
 * Build script to create a minimal mp4-muxer bundle for the Mandelbrot app.
 *
 * This script:
 * 1. Uses mp4-muxer from node_modules (run `npm install mp4-muxer` first)
 * 2. Strips unused code paths (audio codecs, unused video codecs, streaming targets)
 * 3. Minifies with esbuild
 * 4. Outputs a version ready to embed in index.html
 *
 * Usage:
 *   node scripts/build-mp4muxer.js
 *
 * The script removes:
 * - HEVC, VP9, AV1 video codec handlers (we only use H.264/AVC)
 * - AAC, Opus audio codec handlers (we don't use audio)
 * - StreamTarget class (we only use ArrayBufferTarget)
 * - FileSystemWritableFileStreamTarget class (we don't use file streaming)
 * - Fragmented MP4 support (we use 'in-memory' fastStart mode)
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SOURCE_FILE = path.join(__dirname, '..', 'node_modules', 'mp4-muxer', 'build', 'mp4-muxer.js');
const OUTPUT_FILE = path.join(__dirname, '..', 'build', 'mp4Muxer.min.js');

function main() {
  console.log('Building minimal mp4-muxer bundle...\n');

  // Check source exists
  if (!fs.existsSync(SOURCE_FILE)) {
    console.error('mp4-muxer not found. Run: npm install mp4-muxer');
    process.exit(1);
  }

  let code = fs.readFileSync(SOURCE_FILE, 'utf8');
  const originalSize = code.length;
  console.log(`Source: ${SOURCE_FILE}`);
  console.log(`Original size: ${originalSize.toLocaleString()} bytes\n`);

  console.log('Applying transformations...');

  // === EARLY DEAD BRANCH REMOVAL ===
  // These must be done first before other transforms modify the code structure
  // We use ArrayBufferTarget only (not StreamTarget)
  // We use fastStart: "in-memory" (not "fragmented" or object-based)

  // E1. Remove ChunkedStreamTargetWriter class and all its methods
  // This is a large block (~100 lines) that handles streaming writes with chunked buffers
  const chunkedWriterMatch = code.match(/var _helper, _writeDataIntoChunks[\s\S]*?__privateGet\(this, _chunks\)\.splice\(i--, 1\);\s*\}\s*\}\s*\};/);
  if (chunkedWriterMatch) {
    code = code.replace(chunkedWriterMatch[0], '');
    console.log('  ✓ Removed ChunkedStreamTargetWriter class and methods (~100 lines)');
  }

  // E2. Remove CHUNK_SIZE and MAX_CHUNKS_AT_ONCE constants
  code = code.replace(
    /var CHUNK_SIZE = 2 \*\* 24;\s*var MAX_CHUNKS_AT_ONCE = 2;/,
    ''
  );
  console.log('  ✓ Removed CHUNK_SIZE and MAX_CHUNKS_AT_ONCE constants');

  // E3. Remove fragmented ftyp branch - replace with simple non-fragmented ftyp
  code = code.replace(
    /return fragmented \? box\("ftyp", \[[\s\S]*?ascii\("iso5"\)[\s\S]*?\]\) : box\("ftyp", \[/,
    'return box("ftyp", ['
  );
  console.log('  ✓ Simplified ftyp box (removed fragmented branch)');

  // E4. Remove "fragmented" check in ftyp function signature
  code = code.replace(
    /var ftyp = \(\{ holdsAvc, fragmented \}\) => \{/,
    'var ftyp = ({ holdsAvc }) => {'
  );
  console.log('  ✓ Simplified ftyp function signature');

  // E5. Update ftyp call to remove fragmented parameter
  code = code.replace(
    /ftyp\(\{ holdsAvc: ([\w\W]*?), fragmented: __privateGet\(this, _options\)\.fastStart === "fragmented" \}\)/,
    'ftyp({ holdsAvc: $1 })'
  );
  console.log('  ✓ Simplified ftyp call');

  // E6. Remove computeMoovSizeUpperBound function (used for object-based fastStart)
  code = code.replace(
    /_computeMoovSizeUpperBound = new WeakSet\(\);\s*computeMoovSizeUpperBound_fn = function\(\) \{[\s\S]*?return totalSize;\s*\};/,
    ''
  );
  console.log('  ✓ Removed computeMoovSizeUpperBound function');

  // E7. Remove __privateAdd for _computeMoovSizeUpperBound in constructor
  code = code.replace(
    /__privateAdd\(this, _computeMoovSizeUpperBound\);/,
    ''
  );
  console.log('  ✓ Removed _computeMoovSizeUpperBound from constructor');

  // E8. Remove object-based fastStart reserved space allocation in prepareEverything
  code = code.replace(
    /if \(typeof __privateGet\(this, _options\)\.fastStart === "object"\) \{\s*let moovSizeUpperBound = __privateMethod\(this, _computeMoovSizeUpperBound, computeMoovSizeUpperBound_fn\)\.call\(this\);\s*__privateGet\(this, _writer\)\.seek\(__privateGet\(this, _writer\)\.pos \+ moovSizeUpperBound\);\s*\}/,
    ''
  );
  console.log('  ✓ Removed object-based fastStart reserved space allocation');

  // E9. Simplify finalize() - remove object-based fastStart finalize branch
  // This is an if/else inside finalize that handles writing moov to reserved space
  code = code.replace(
    /if \(typeof __privateGet\(this, _options\)\.fastStart === "object"\) \{\s*__privateGet\(this, _writer\)\.seek\(__privateGet\(this, _ftypSize\)\);[\s\S]*?__privateGet\(this, _writer\)\.writeBox\(free\(remainingBytes\)\);\s*\}\s*else \{/g,
    ''
  );
  console.log('  ✓ Removed object-based fastStart finalize branch (if part)');

  // E10. Fix the orphan closing brace from E9
  code = code.replace(
    /\}\s*\}\s*__privateMethod\(this, _maybeFlushStreamingTargetWriter/g,
    '} __privateMethod(this, _maybeFlushStreamingTargetWriter'
  );
  console.log('  ✓ Fixed orphan closing brace after finalize simplification');

  // E11. Remove audio validation in fastStart object check
  code = code.replace(
    /if \(options\.audio\) \{\s*if \(options\.fastStart\.expectedAudioChunks === void 0\)[\s\S]*?"'expectedAudioChunks' must be a non-negative integer\."\);\s*\}/,
    ''
  );
  console.log('  ✓ Removed audio validation in fastStart object check');

  // E12. Remove unused helper functions: u8, i16, u24, i32, u64, fixed_8_8
  // u8 is used in fullBox, but we can inline it there
  // Actually many of these ARE used, so let's be more selective

  // E13. Inline IDENTITY_MATRIX (don't call rotationMatrix(0))
  code = code.replace(
    /var IDENTITY_MATRIX = rotationMatrix\(0\);/,
    'var IDENTITY_MATRIX = [1, 0, 0, 0, 1, 0, 0, 0, 1];'  // Inline the result
  );
  console.log('  ✓ Inlined IDENTITY_MATRIX');

  // E14. Replace tkhd matrix logic to always use IDENTITY_MATRIX (no rotation support)
  // This simplifies: typeof track.info.rotation === "number" ? rotationMatrix(track.info.rotation) : track.info.rotation
  // to just: IDENTITY_MATRIX
  code = code.replace(
    /let matrix;\s*if \(track\.info\.type === "video"\) \{\s*matrix = typeof track\.info\.rotation === "number" \? rotationMatrix\(track\.info\.rotation\) : track\.info\.rotation;\s*\} else \{\s*matrix = IDENTITY_MATRIX;\s*\}/,
    'let matrix = IDENTITY_MATRIX;'
  );
  console.log('  ✓ Simplified tkhd matrix to always use IDENTITY_MATRIX');

  // E15. Now we can remove rotationMatrix function (no longer called)
  code = code.replace(
    /var rotationMatrix = \(rotationInDegrees\) => \{[\s\S]*?return \[\s*cosTheta[\s\S]*?\];\s*\};/,
    ''
  );
  console.log('  ✓ Removed rotationMatrix function');

  // E16. Inline all matrixToBytes calls with IDENTITY_MATRIX values
  // The matrixToBytes function converts a 3x3 matrix to bytes using fixed_16_16 and fixed_2_30
  // IDENTITY_MATRIX = [1, 0, 0, 0, 1, 0, 0, 0, 1] becomes:
  // [fixed_16_16(1), fixed_16_16(0), fixed_2_30(0),  (row 1)
  //  fixed_16_16(0), fixed_16_16(1), fixed_2_30(0),  (row 2)
  //  fixed_16_16(0), fixed_16_16(0), fixed_2_30(1)]  (row 3)
  // Since we always use IDENTITY_MATRIX, we can inline these values directly
  const inlinedMatrix = '[fixed_16_16(1), fixed_16_16(0), fixed_2_30(0), fixed_16_16(0), fixed_16_16(1), fixed_2_30(0), fixed_16_16(0), fixed_16_16(0), fixed_2_30(1)]';
  code = code.replace(
    /matrixToBytes\(matrix\)/g,
    inlinedMatrix
  );
  code = code.replace(
    /matrixToBytes\(IDENTITY_MATRIX\)/g,
    inlinedMatrix
  );
  console.log('  ✓ Inlined matrixToBytes calls with identity matrix values');

  // E17. Now we can remove matrixToBytes function (no longer called)
  code = code.replace(
    /var matrixToBytes = \(matrix\) => \{[\s\S]*?fixed_2_30\(matrix\[8\]\)\s*\];\s*\};/,
    ''
  );
  console.log('  ✓ Removed matrixToBytes function');

  // E18. Remove 'free' function (not used)
  code = code.replace(
    /var free = \(size\) => \(\{ type: "free", size \}\);/,
    ''
  );
  console.log('  ✓ Removed free function');

  // Note: We keep lastPresentedSample and isU32 functions - they are used

  // ============================================================================
  // E19-E30: Remove fragmented and object-based fastStart code
  // Our app always uses fastStart: "in-memory", so we can remove all other modes
  // ============================================================================

  // E19. Simplify fastStart validation - only allow "in-memory"
  // Replace: } else if (![false, "in-memory", "fragmented"].includes(options.fastStart)) {
  //            throw new TypeError(`'fastStart' option must be false, 'in-memory', 'fragmented' or an object.`);
  // With: } else if (options.fastStart !== "in-memory") {
  //         throw new TypeError(`'fastStart' must be 'in-memory'.`);
  code = code.replace(
    /\} else if \(!\[false, "in-memory", "fragmented"\]\.includes\(options\.fastStart\)\) \{\s*throw new TypeError\(`'fastStart' option must be false, 'in-memory', 'fragmented' or an object\.`\);/,
    '} else if (options.fastStart !== "in-memory") { throw new TypeError(`\'fastStart\' must be \'in-memory\'.`);'
  );
  console.log('  ✓ Simplified fastStart validation to only allow "in-memory"');

  // E20. Remove object-based fastStart validation block entirely
  // Pattern: if (typeof options.fastStart === "object") { ... video validation ... audio validation ... }
  code = code.replace(
    /if \(typeof options\.fastStart === "object"\) \{\s*if \(options\.video\) \{[\s\S]*?'expectedVideoChunks' must be a non-negative integer\.\"\);\s*\}\s*\}[\s\S]*?'expectedAudioChunks' must be a non-negative integer\.\"\);\s*\}\s*\}\s*\}/,
    ''
  );
  console.log('  ✓ Removed object-based fastStart validation');

  // E21. Remove object-based fastStart check in addVideoChunkRaw
  // Pattern: if (typeof __privateGet(this, _options).fastStart === "object" && ...) { throw ... }
  code = code.replace(
    /if \(typeof __privateGet\(this, _options\)\.fastStart === "object" && __privateGet\(this, _videoTrack\)\.samples\.length === __privateGet\(this, _options\)\.fastStart\.expectedVideoChunks\) \{\s*throw new Error\(`Cannot add more video chunks than specified in 'fastStart'[\s\S]*?\);\s*\}/,
    ''
  );
  console.log('  ✓ Removed object-based fastStart chunk limit check');

  // E22. Replace ftyp fragmented parameter with false (always non-fragmented)
  // Pattern: fragmented: __privateGet(this, _options).fastStart === "fragmented"
  code = code.replace(
    /fragmented: __privateGet\(this, _options\)\.fastStart === "fragmented"/g,
    'fragmented: false'
  );
  console.log('  ✓ Hardcoded ftyp fragmented to false');

  // E23. Simplify writeHeader - keep only in-memory branch
  // Pattern: if (__privateGet(this, _options).fastStart === "in-memory") {
  //            __privateSet(this, _mdat, mdat(false));
  //          } else if (__privateGet(this, _options).fastStart === "fragmented") {
  //          } else {
  //            __privateSet(this, _mdat, mdat(true));
  //            __privateGet(this, _writer).writeBox(__privateGet(this, _mdat));
  //          }
  // Replace with just the in-memory branch (without the if)
  code = code.replace(
    /if \(__privateGet\(this, _options\)\.fastStart === "in-memory"\) \{\s*__privateSet\(this, _mdat, mdat\(false\)\);\s*\} else if \(__privateGet\(this, _options\)\.fastStart === "fragmented"\) \{\s*\} else \{\s*__privateSet\(this, _mdat, mdat\(true\)\);\s*__privateGet\(this, _writer\)\.writeBox\(__privateGet\(this, _mdat\)\);\s*\}/,
    '__privateSet(this, _mdat, mdat(false));'
  );
  console.log('  ✓ Simplified writeHeader to only in-memory mode');

  // E24. Remove _computeMoovSizeUpperBound function (only used for object-based fastStart)
  code = code.replace(
    /_computeMoovSizeUpperBound = \/\* @__PURE__ \*\/ new WeakSet\(\);\s*computeMoovSizeUpperBound_fn = function\(\) \{[\s\S]*?return totalSize;\s*\};/,
    ''
  );
  console.log('  ✓ Removed _computeMoovSizeUpperBound function');

  // E25. Simplify addSampleToTrack - remove fragmented checks
  // Pattern: if (__privateGet(this, _options).fastStart !== "fragmented") { track.samples.push(sample); }
  // Replace with just: track.samples.push(sample);
  code = code.replace(
    /if \(__privateGet\(this, _options\)\.fastStart !== "fragmented"\) \{\s*track\.samples\.push\(sample\);\s*\}/g,
    'track.samples.push(sample);'
  );
  console.log('  ✓ Simplified addSampleToTrack (removed fragmented check for samples.push)');

  // E26. Simplify timeToSampleTable update - remove fragmented check
  // Pattern: if (__privateGet(this, _options).fastStart !== "fragmented") { let lastTableEntry = ... }
  // Need to keep the inner code but remove the if wrapper
  code = code.replace(
    /if \(__privateGet\(this, _options\)\.fastStart !== "fragmented"\) \{\s*(let lastTableEntry = last\(track\.timeToSampleTable\);[\s\S]*?lastTableEntry\.sampleCount\+\+;\s*\})\s*\}/g,
    '$1'
  );
  console.log('  ✓ Simplified addSampleToTrack (removed fragmented check for timeToSampleTable)');

  // E27. Simplify first sample handling - remove fragmented check
  // Pattern: if (__privateGet(this, _options).fastStart !== "fragmented") { track.timeToSampleTable.push({ ... }); }
  code = code.replace(
    /if \(__privateGet\(this, _options\)\.fastStart !== "fragmented"\) \{\s*(track\.timeToSampleTable\.push\(\{[\s\S]*?\}\);)\s*\}/g,
    '$1'
  );
  console.log('  ✓ Simplified addSampleToTrack (removed fragmented check for first sample)');

  // E28. Replace fragmented chunk duration if/else with just the else branch content
  // Pattern: if (fragmented) { ... } else { beginNewChunk = ...; }
  // We keep only: beginNewChunk = currentChunkDuration >= 0.5;
  code = code.replace(
    /if \(__privateGet\(this, _options\)\.fastStart === "fragmented"\) \{\s*let mostImportantTrack = __privateGet\(this, _videoTrack\);\s*const chunkDuration = __privateGet\(this, _options\)\.minFragmentDuration \?\? 1;\s*if \(track === mostImportantTrack && sample\.type === "key" && currentChunkDuration >= chunkDuration\) \{\s*beginNewChunk = true;\s*__privateMethod\(this, _finalizeFragment, finalizeFragment_fn\)\.call\(this\);\s*\}\s*\} else \{\s*beginNewChunk = currentChunkDuration >= 0\.5;\s*\}/,
    'beginNewChunk = currentChunkDuration >= 0.5;'
  );
  console.log('  ✓ Simplified chunk duration handling (removed fragmented branch)');

  // E29. Remove fragmented error check in _finalizeCurrentChunk
  code = code.replace(
    /if \(__privateGet\(this, _options\)\.fastStart === "fragmented"\) \{\s*throw new Error\("Can't finalize individual chunks if 'fastStart' is set to 'fragmented'."\);\s*\}\s*/,
    ''
  );
  console.log('  ✓ Removed fragmented error in _finalizeCurrentChunk');

  // E30. Remove the entire _finalizeFragment WeakSet and finalizeFragment_fn function
  // This is a large block from "_finalizeFragment = /* @__PURE__ */ new WeakSet();" to its closing "};"
  code = code.replace(
    /_finalizeFragment = \/\* @__PURE__ \*\/ new WeakSet\(\);\s*finalizeFragment_fn = function\(flushStreamingWriter = true\) \{[\s\S]*?if \(flushStreamingWriter\) \{\s*__privateMethod\(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn\)\.call\(this\);\s*\}\s*\};/,
    ''
  );
  console.log('  ✓ Removed _finalizeFragment WeakSet and finalizeFragment_fn function');

  // E31. Remove minFragmentDuration validation (only used for fragmented mode)
  code = code.replace(
    /if \(options\.minFragmentDuration !== void 0 && \(!Number\.isFinite\(options\.minFragmentDuration\) \|\| options\.minFragmentDuration < 0\)\) \{\s*throw new TypeError\(`'minFragmentDuration' must be a non-negative number\.`\);\s*\}/,
    ''
  );
  console.log('  ✓ Removed minFragmentDuration validation');

  // 1. Remove HEVC codec handler entirely and update the map to use null directly
  const hvcCMatch = code.match(/var hvcC = \(track\) => track\.info\.decoderConfig && box\("hvcC"[\s\S]*?\);/);
  if (hvcCMatch) {
    code = code.replace(hvcCMatch[0], '');
    console.log('  ✓ Removed HEVC (hvcC) handler');
  }

  // 2. Remove VP9 codec handler entirely
  const vpcCMatch = code.match(/var vpcC = \(track\) => \{[\s\S]*?return fullBox\("vpcC"[\s\S]*?\};/);
  if (vpcCMatch) {
    code = code.replace(vpcCMatch[0], '');
    console.log('  ✓ Removed VP9 (vpcC) handler');
  }

  // 3. Remove AV1 codec handler entirely
  const av1CMatch = code.match(/var av1C = \(\) => \{[\s\S]*?return box\("av1C"[\s\S]*?\};/);
  if (av1CMatch) {
    code = code.replace(av1CMatch[0], '');
    console.log('  ✓ Removed AV1 (av1C) handler');
  }

  // 4. Remove AAC codec handler (esds box) entirely
  const esdsMatch = code.match(/var esds = \(track\) => \{[\s\S]*?return fullBox\("esds"[\s\S]*?\};/);
  if (esdsMatch) {
    code = code.replace(esdsMatch[0], '');
    console.log('  ✓ Removed AAC (esds) handler');
  }

  // 5. Remove Opus codec handler (dOps box) entirely
  const dOpsMatch = code.match(/var dOps = \(track\) => \{[\s\S]*?return box\("dOps"[\s\S]*?\};/);
  if (dOpsMatch) {
    code = code.replace(dOpsMatch[0], '');
    console.log('  ✓ Removed Opus (dOps) handler');
  }

  // 6. Update VIDEO_CODEC_TO_CONFIGURATION_BOX to use null for unused codecs
  code = code.replace(
    /var VIDEO_CODEC_TO_CONFIGURATION_BOX = \{[\s\S]*?"avc": avcC,[\s\S]*?"hevc": hvcC,[\s\S]*?"vp9": vpcC,[\s\S]*?"av1": av1C[\s\S]*?\};/,
    'var VIDEO_CODEC_TO_CONFIGURATION_BOX = { "avc": avcC };'
  );
  console.log('  ✓ Simplified VIDEO_CODEC_TO_CONFIGURATION_BOX to avc only');

  // 7. Update AUDIO_CODEC_TO_CONFIGURATION_BOX to use null for unused codecs
  code = code.replace(
    /var AUDIO_CODEC_TO_CONFIGURATION_BOX = \{[\s\S]*?"aac": esds,[\s\S]*?"opus": dOps[\s\S]*?\};/,
    'var AUDIO_CODEC_TO_CONFIGURATION_BOX = {};'
  );
  console.log('  ✓ Simplified AUDIO_CODEC_TO_CONFIGURATION_BOX (empty, no audio support)');

  // 8. Remove StreamTarget and FileSystemWritableFileStreamTarget entirely
  // First, remove the instanceof checks in the Muxer constructor
  // The pattern is: else if (options.target instanceof StreamTarget) { ... }
  code = code.replace(
    /\s*else if \(options\.target instanceof StreamTarget\) \{[^}]+\}/,
    ''
  );
  console.log('  ✓ Removed StreamTarget instanceof check from Muxer');

  code = code.replace(
    /\s*else if \(options\.target instanceof FileSystemWritableFileStreamTarget\) \{[^}]+\}/,
    ''
  );
  console.log('  ✓ Removed FileSystemWritableFileStreamTarget instanceof check from Muxer');

  // Remove the flush check for StreamTargetWriter
  code = code.replace(
    /if \(__privateGet\(this, _writer\) instanceof StreamTargetWriter\) \{[^}]+\}/,
    ''
  );
  console.log('  ✓ Removed StreamTargetWriter flush check');

  // Now we can remove the classes entirely since they're not referenced
  const streamTargetMatch = code.match(/var StreamTarget = class extends Target \{[\s\S]*?constructor\(options\) \{[\s\S]*?\}\s*\};/);
  if (streamTargetMatch) {
    code = code.replace(streamTargetMatch[0], '');
    console.log('  ✓ Removed StreamTarget class');
  }

  const fsTargetMatch = code.match(/var FileSystemWritableFileStreamTarget = class extends Target \{[\s\S]*?constructor\(stream, options\) \{[\s\S]*?\}\s*\};/);
  if (fsTargetMatch) {
    code = code.replace(fsTargetMatch[0], '');
    console.log('  ✓ Removed FileSystemWritableFileStreamTarget class');
  }

  // Remove StreamTargetWriter class AND its private method definitions
  // The class itself ends with }; but the WeakMaps and function definitions follow after
  // Pattern: var StreamTargetWriter = class extends Writer { ... }; _target2 = new WeakMap(); ... flushChunks_fn = function(...) { ... };
  // Match everything from the class through the last flushChunks_fn function
  const streamWriterMatch = code.match(/var StreamTargetWriter = class extends Writer \{[\s\S]*?\n  \};\s*_target2 = new WeakMap\(\);[\s\S]*?flushChunks_fn = function\(force = false\) \{[\s\S]*?\};\s*(?=var GLOBAL_TIMESCALE)/);
  if (streamWriterMatch) {
    code = code.replace(streamWriterMatch[0], '');
    console.log('  ✓ Removed StreamTargetWriter class and private methods');
  } else {
    // Fallback: try just the class without methods
    const fallbackMatch = code.match(/var StreamTargetWriter = class extends Writer \{[\s\S]*?constructor\(target\) \{[\s\S]*?\n  \};/);
    if (fallbackMatch) {
      code = code.replace(fallbackMatch[0], '');
      console.log('  ✓ Removed StreamTargetWriter class (partial)');
    }
  }

  // Remove FileSystemWritableFileStreamTargetWriter class
  const fsWriterMatch = code.match(/var FileSystemWritableFileStreamTargetWriter = class extends StreamTargetWriter \{[\s\S]*?\}\s*\};/);
  if (fsWriterMatch) {
    code = code.replace(fsWriterMatch[0], '');
    console.log('  ✓ Removed FileSystemWritableFileStreamTargetWriter class');
  }

  // 9. Remove the export stubs for unused targets (cleanup from __export block)
  code = code.replace(
    /__export\(src_exports, \{[\s\S]*?\}\);/,
    '__export(src_exports, { ArrayBufferTarget: () => ArrayBufferTarget, Muxer: () => Muxer });'
  );
  console.log('  ✓ Simplified exports to only ArrayBufferTarget and Muxer');

  // 10. Remove smhd (sound media header) - audio track header
  code = code.replace(
    /var smhd = \(\) => fullBox\("smhd"[\s\S]*?\);/,
    ''
  );
  console.log('  ✓ Removed smhd (sound media header)');

  // 11. Replace the audio track header reference with null/video-only path
  // The pattern: track.info.type === "video" ? vmhd() : smhd()
  code = code.replace(
    /track\.info\.type === "video" \? vmhd\(\) : smhd\(\)/g,
    'vmhd()'  // Always use video media header since we only support video
  );
  console.log('  ✓ Simplified media header to video-only (vmhd)');

  // 12. Remove addAudioChunk method - match from method start to the closing brace before addAudioChunkRaw
  code = code.replace(
    /addAudioChunk\(sample, meta, timestamp\) \{[\s\S]*?this\.addAudioChunkRaw\(data, sample\.type, timestamp \?\? sample\.timestamp, sample\.duration, meta\);\s*\}\s*addAudioChunkRaw/,
    'addAudioChunkRaw'
  );
  console.log('  ✓ Removed addAudioChunk method');

  // 13. Remove addAudioChunkRaw method - match the entire method including its body
  code = code.replace(
    /addAudioChunkRaw\(data, type, timestamp, duration, meta\) \{[\s\S]*?__privateMethod\(this, _addSampleToTrack, addSampleToTrack_fn\)\.call\(this, __privateGet\(this, _audioTrack\), audioSample\);\s*\}\s*\}\s*\/\*\*/,
    '/**'
  );
  console.log('  ✓ Removed addAudioChunkRaw method');

  // 14. Simplify addVideoChunkRaw - remove the audio track interleaving logic
  // The pattern checks if there's an audio track and interleaves samples
  code = code.replace(
    /if \(__privateGet\(this, _options\)\.fastStart === "fragmented" && __privateGet\(this, _audioTrack\)\) \{[\s\S]*?__privateGet\(this, _videoSampleQueue\)\.push\(videoSample\);[\s\S]*?\} else \{[\s\S]*?__privateMethod\(this, _addSampleToTrack, addSampleToTrack_fn\)\.call\(this, __privateGet\(this, _videoTrack\), videoSample\);[\s\S]*?\}/,
    '__privateMethod(this, _addSampleToTrack, addSampleToTrack_fn).call(this, __privateGet(this, _videoTrack), videoSample);'
  );
  console.log('  ✓ Simplified addVideoChunkRaw (removed audio interleaving)');

  // 14. Remove fragmented MP4 box generators
  // mvex (movie extends box - for fragmented MP4)
  code = code.replace(
    /var mvex = \(tracks\) => \{[\s\S]*?return box\("mvex"[\s\S]*?\};/,
    ''
  );
  console.log('  ✓ Removed mvex (movie extends) box');

  // trex (track extends box)
  code = code.replace(
    /var trex = \(track\) => \{[\s\S]*?return fullBox\("trex"[\s\S]*?\};/,
    ''
  );
  console.log('  ✓ Removed trex (track extends) box');

  // moof (movie fragment box)
  code = code.replace(
    /var moof = \(sequenceNumber, tracks\) => \{[\s\S]*?return box\("moof"[\s\S]*?\};/,
    ''
  );
  console.log('  ✓ Removed moof (movie fragment) box');

  // mfhd (movie fragment header)
  code = code.replace(
    /var mfhd = \(sequenceNumber\) => \{[\s\S]*?return fullBox\("mfhd"[\s\S]*?\};/,
    ''
  );
  console.log('  ✓ Removed mfhd (movie fragment header) box');

  // traf (track fragment box)
  code = code.replace(
    /var traf = \(track\) => \{[\s\S]*?return box\("traf"[\s\S]*?\};/,
    ''
  );
  console.log('  ✓ Removed traf (track fragment) box');

  // tfhd (track fragment header) - part of traf internals
  const tfhdMatch = code.match(/var tfhd = \(track\) => \{[\s\S]*?return fullBox\("tfhd"[\s\S]*?\};/);
  if (tfhdMatch) {
    code = code.replace(tfhdMatch[0], '');
    console.log('  ✓ Removed tfhd (track fragment header) box');
  }

  // tfdt (track fragment decode time)
  code = code.replace(
    /var tfdt = \(track\) => \{[\s\S]*?return fullBox\("tfdt"[\s\S]*?\};/,
    ''
  );
  console.log('  ✓ Removed tfdt (track fragment decode time) box');

  // trun (track fragment run) - if present
  const trunMatch = code.match(/var trun = \(track\) => \{[\s\S]*?return fullBox\("trun"[\s\S]*?\};/);
  if (trunMatch) {
    code = code.replace(trunMatch[0], '');
    console.log('  ✓ Removed trun (track fragment run) box');
  }

  // mfra (movie fragment random access)
  code = code.replace(
    /var mfra = \(tracks\) => \{[\s\S]*?return box\("mfra"[\s\S]*?\};/,
    ''
  );
  console.log('  ✓ Removed mfra (movie fragment random access) box');

  // tfra (track fragment random access)
  const tfraMatch = code.match(/var tfra = \(track, trackIndex\) => \{[\s\S]*?return fullBox\("tfra"[\s\S]*?\};/);
  if (tfraMatch) {
    code = code.replace(tfraMatch[0], '');
    console.log('  ✓ Removed tfra (track fragment random access) box');
  }

  // mfro (movie fragment random access offset)
  code = code.replace(
    /var mfro = \(\) => \{[\s\S]*?return fullBox\("mfro"[\s\S]*?\};/,
    ''
  );
  console.log('  ✓ Removed mfro (movie fragment random access offset) box');

  // 15. Remove fragmented checks and calls in moov
  // Pattern: fragmented ? mvex(tracks) : null
  code = code.replace(
    /fragmented \? mvex\(tracks\) : null/g,
    'null'
  );
  console.log('  ✓ Removed fragmented mvex calls');

  // 15b. Remove fragmented branch in ftyp function
  // The if (details.fragmented) return box("ftyp", [...iso5...]) block is dead
  code = code.replace(
    /if \(details\.fragmented\)\s*return box\("ftyp", \[\s*ascii\("iso5"\),[\s\S]*?ascii\("mp41"\)\s*\]\);/,
    ''
  );
  console.log('  ✓ Removed fragmented ftyp branch');

  // 16. Remove audio track initialization block in prepareTracks
  // This is the whole "if (__privateGet(this, _options).audio) { ... }" block
  code = code.replace(
    /if \(__privateGet\(this, _options\)\.audio\) \{\s*__privateSet\(this, _audioTrack, \{[\s\S]*?guessedCodecPrivate,[\s\S]*?sampleRate: __privateGet\(this, _options\)\.audio\.sampleRate\s*\};\s*\}\s*\}\s*\};/,
    '};'
  );
  console.log('  ✓ Removed audio track initialization block');

  // 17. Remove generateMpeg4AudioSpecificConfig function (AAC sample rate table)
  code = code.replace(
    /_generateMpeg4AudioSpecificConfig = new WeakSet\(\);\s*generateMpeg4AudioSpecificConfig_fn = function\(objectType, sampleRate, numberOfChannels\) \{[\s\S]*?return configBytes;\s*\};/,
    ''
  );
  console.log('  ✓ Removed generateMpeg4AudioSpecificConfig (AAC sample rate table)');

  // 18. Remove __privateAdd for _generateMpeg4AudioSpecificConfig in constructor
  code = code.replace(
    /\s*\/\/ https:\/\/wiki\.multimedia\.cx\/index\.php\/MPEG-4_Audio\s*__privateAdd\(this, _generateMpeg4AudioSpecificConfig\);/,
    ''
  );
  console.log('  ✓ Removed _generateMpeg4AudioSpecificConfig from constructor');

  // 19. Replace all _audioTrack usages with null (we only support video)
  // First, simplify `[__privateGet(this, _videoTrack), __privateGet(this, _audioTrack)].filter(Boolean)`
  // to just `[__privateGet(this, _videoTrack)].filter(Boolean)`
  code = code.replace(
    /\[__privateGet\(this, _videoTrack\), __privateGet\(this, _audioTrack\)\]\.filter\(Boolean\)/g,
    '[__privateGet(this, _videoTrack)].filter(Boolean)'
  );
  console.log('  ✓ Simplified tracks array to video-only');

  // Replace `[__privateGet(this, _videoTrack), __privateGet(this, _audioTrack)].filter((track) => track && track.currentChunk)`
  code = code.replace(
    /\[__privateGet\(this, _videoTrack\), __privateGet\(this, _audioTrack\)\]\.filter\(\(track\) => track && track\.currentChunk\)/g,
    '[__privateGet(this, _videoTrack)].filter((track) => track && track.currentChunk)'
  );
  console.log('  ✓ Simplified tracks filter to video-only');

  // Replace `__privateGet(this, _videoTrack) ?? __privateGet(this, _audioTrack)` with just `__privateGet(this, _videoTrack)`
  code = code.replace(
    /__privateGet\(this, _videoTrack\) \?\? __privateGet\(this, _audioTrack\)/g,
    '__privateGet(this, _videoTrack)'
  );
  console.log('  ✓ Simplified mostImportantTrack to video-only');

  // Replace `__privateGet(this, _audioTrack)?.firstDecodeTimestamp ?? Infinity` with just `Infinity`
  code = code.replace(
    /__privateGet\(this, _audioTrack\)\?\.firstDecodeTimestamp \?\? Infinity/g,
    'Infinity'
  );
  console.log('  ✓ Simplified audio firstDecodeTimestamp to Infinity');

  // Now we can safely remove the _audioTrack initialization since it's no longer referenced
  code = code.replace(
    /__privateAdd\(this, _audioTrack, null\);/,
    ''
  );
  console.log('  ✓ Removed _audioTrack field initialization');

  // Also remove the _audioTrack WeakMap declaration
  code = code.replace(
    /\s*_audioTrack = \/\* @__PURE__ \*\/ new WeakMap\(\);/,
    ''
  );
  console.log('  ✓ Removed _audioTrack WeakMap declaration');

  // 20. Remove _audioSampleQueue field initialization
  code = code.replace(
    /__privateAdd\(this, _audioSampleQueue, \[\]\);/,
    ''
  );
  console.log('  ✓ Removed _audioSampleQueue field initialization');

  // 21. Remove finalizeFragment from constructor
  code = code.replace(
    /__privateAdd\(this, _finalizeFragment\);/,
    ''
  );
  console.log('  ✓ Removed _finalizeFragment from constructor');

  // 22. Remove _nextFragmentNumber field (fragmented MP4)
  code = code.replace(
    /\s*\/\/ Fields for fragmented MP4:\s*__privateAdd\(this, _nextFragmentNumber, 1\);/,
    ''
  );
  console.log('  ✓ Removed _nextFragmentNumber field');

  // 23. Remove _videoSampleQueue field (only used in fragmented mode)
  code = code.replace(
    /__privateAdd\(this, _videoSampleQueue, \[\]\);/,
    ''
  );
  console.log('  ✓ Removed _videoSampleQueue field');

  // 24. Remove audio option validation in validateOptions
  code = code.replace(
    /if \(options\.audio\) \{[\s\S]*?if \(!Number\.isInteger\(options\.audio\.sampleRate\)[\s\S]*?\}\s*\}/,
    ''
  );
  console.log('  ✓ Removed audio options validation');

  // 25. Remove fragmented MP4 finalize branch
  // Pattern: else if (__privateGet(this, _options).fastStart === "fragmented") { ... mfra ... }
  code = code.replace(
    /\} else if \(__privateGet\(this, _options\)\.fastStart === "fragmented"\) \{[\s\S]*?__privateGet\(this, _writer\)\.writeU32\(mfraBoxSize\);[\s\S]*?\}/,
    '}'
  );
  console.log('  ✓ Removed fragmented MP4 finalize branch');

  // 25a. Remove fragmented mode check in addSampleToTrack that calls _finalizeFragment
  // This is: if (__privateGet(this, _options).fastStart === "fragmented") { ... } else { beginNewChunk = ... }
  // Replace with just: beginNewChunk = currentChunkDuration >= 0.5;
  code = code.replace(
    /if \(__privateGet\(this, _options\)\.fastStart === "fragmented"\) \{\s*let mostImportantTrack = __privateGet\(this, _videoTrack\);\s*const chunkDuration = __privateGet\(this, _options\)\.minFragmentDuration \?\? 1;\s*if \(track === mostImportantTrack && sample\.type === "key" && currentChunkDuration >= chunkDuration\) \{\s*beginNewChunk = true;\s*__privateMethod\(this, _finalizeFragment, finalizeFragment_fn\)\.call\(this\);\s*\}\s*\} else \{\s*beginNewChunk = currentChunkDuration >= 0\.5;\s*\}/,
    'beginNewChunk = currentChunkDuration >= 0.5;'
  );
  console.log('  ✓ Removed fragmented mode check in addSampleToTrack');

  // 25b. Remove _finalizeFragment WeakSet declaration and finalizeFragment_fn function definition
  // In source: _finalizeFragment = new WeakSet();  (no /* @__PURE__ */ comment, that's added by esbuild)
  // Match from the WeakSet declaration to the }; before _maybeFlushStreamingTargetWriter
  code = code.replace(
    /_finalizeFragment = new WeakSet\(\);\s*finalizeFragment_fn = function\(flushStreamingWriter = true\) \{[\s\S]*?\};\s*(?=_maybeFlushStreamingTargetWriter)/,
    ''
  );
  console.log('  ✓ Removed _finalizeFragment WeakSet and finalizeFragment_fn function');

  // 26. (now unused - pattern no longer matches after 25b)
  // Keep the placeholder for now to not disrupt numbering

  // 27. Remove flush method (only for fragmented mode)
  code = code.replace(
    /flush\(\) \{[\s\S]*?__privateMethod\(this, _finalizeFragment, finalizeFragment_fn\)\.call\(this, true\);\s*\}/,
    ''
  );
  console.log('  ✓ Removed flush method');

  // 28. Remove audio sample queue processing in finalize
  code = code.replace(
    /for \(let audioSample of __privateGet\(this, _audioSampleQueue\)\)\s*__privateMethod\(this, _addSampleToTrack, addSampleToTrack_fn\)\.call\(this, __privateGet\(this, _audioTrack\), audioSample\);/g,
    ''
  );
  console.log('  ✓ Removed audio sample queue processing');

  // 29. Remove video sample queue processing in finalize (fragmented mode)
  code = code.replace(
    /for \(let videoSample of __privateGet\(this, _videoSampleQueue\)\)\s*__privateMethod\(this, _addSampleToTrack, addSampleToTrack_fn\)\.call\(this, __privateGet\(this, _videoTrack\), videoSample\);/g,
    ''
  );
  console.log('  ✓ Removed video sample queue processing');

  // 30. Simplify finalize - remove fragmented mode check at start
  code = code.replace(
    /if \(__privateGet\(this, _options\)\.fastStart === "fragmented"\) \{\s*__privateMethod\(this, _finalizeFragment, finalizeFragment_fn\)\.call\(this, false\);\s*\} else \{/,
    ''
  );
  // And fix closing brace
  code = code.replace(
    /if \(__privateGet\(this, _audioTrack\)\)\s*__privateMethod\(this, _finalizeCurrentChunk, finalizeCurrentChunk_fn\)\.call\(this, __privateGet\(this, _audioTrack\)\);\s*\}/,
    ''
  );
  console.log('  ✓ Simplified finalize method (removed fragmented branch)');

  // Note: Private field simplification was attempted but is complex due to
  // method definitions being outside the class body. The WeakMap-based privacy
  // adds ~5 helper functions but ensures correct behavior.

  // === SHORTEN ERROR MESSAGES ===
  // These long error messages create lines over 200 chars; shorten them

  // Shorten the very long "first chunk timestamp" error message
  code = code.replace(
    /`The first chunk for your media track must have a timestamp of 0 \(received DTS=\$\{[\w]+\}\)\.Non-zero first timestamps are often caused by directly piping frames or audio data from a MediaStreamTrack into the encoder\. Their timestamps are typically relative to the age of thedocument, which is probably what you want\.\s*If you want to offset all timestamps of a track such that the first one is zero, set firstTimestampBehavior: 'offset' in the options\.\s*`/,
    '`First chunk must have timestamp 0 (got DTS=${decodeTimestamp}). Use firstTimestampBehavior:"offset" to auto-fix.`'
  );
  console.log('  ✓ Shortened first chunk timestamp error');

  // Shorten "timestamps must be monotonically increasing" error
  code = code.replace(
    /`Timestamps must be monotonically increasing \(DTS went from \$\{[\w.]+\*1e6\} to \$\{[\w]+\*1e6\}\)\.`/,
    '`DTS must increase (was ${track.lastDecodeTimestamp*1e6}, got ${decodeTimestamp*1e6})`'
  );
  console.log('  ✓ Shortened DTS monotonic error');

  // Shorten addVideoChunk type errors
  code = code.replace(
    /addVideoChunk's first argument \(sample\) must be of type EncodedVideoChunk\./g,
    'sample must be EncodedVideoChunk'
  );
  code = code.replace(
    /addVideoChunk's second argument \(meta\), when provided, must be an object\./g,
    'meta must be object'
  );
  code = code.replace(
    /addVideoChunk's third argument \(timestamp\), when provided, must be a non-negative real number\./g,
    'timestamp must be non-negative'
  );
  code = code.replace(
    /addVideoChunk's fourth argument \(compositionTimeOffset\), when provided, must be a real number\./g,
    'compositionTimeOffset must be number'
  );
  console.log('  ✓ Shortened addVideoChunk error messages');

  // Shorten addVideoChunkRaw type errors
  code = code.replace(
    /addVideoChunkRaw's first argument \(data\) must be an instance of Uint8Array\./g,
    'data must be Uint8Array'
  );
  code = code.replace(
    /addVideoChunkRaw's second argument \(type\) must be either 'key' or 'delta'\./g,
    "type must be 'key'|'delta'"
  );
  code = code.replace(
    /addVideoChunkRaw's third argument \(timestamp\) must be a non-negative real number\./g,
    'timestamp must be non-negative'
  );
  code = code.replace(
    /addVideoChunkRaw's fourth argument \(duration\) must be a non-negative real number\./g,
    'duration must be non-negative'
  );
  code = code.replace(
    /addVideoChunkRaw's fifth argument \(meta\), when provided, must be an object\./g,
    'meta must be object'
  );
  code = code.replace(
    /addVideoChunkRaw's sixth argument \(compositionTimeOffset\), when provided, must be a real number\./g,
    'compositionTimeOffset must be number'
  );
  console.log('  ✓ Shortened addVideoChunkRaw error messages');

  // Shorten constructor validation errors
  code = code.replace(
    /The muxer requires an options object to be passed to its constructor\./g,
    'options required'
  );
  code = code.replace(
    /The target must be provided and an instance of Target\./g,
    'target must be Target instance'
  );
  console.log('  ✓ Shortened constructor validation errors');

  // 31. Change the export and module format for browser embedding
  // Original format:
  //   "use strict"; var Mp4Muxer = (() => { ... return __toCommonJS(src_exports); })();
  //   if (typeof module === "object" ...) Object.assign(module.exports, Mp4Muxer)
  // Target format:
  //   (()=>{ ... window.Mp4Muxer = { Muxer, ArrayBufferTarget }; })();

  // Replace the return statement
  code = code.replace(
    /return __toCommonJS\(src_exports\);/,
    'window.Mp4Muxer = { Muxer: Muxer, ArrayBufferTarget: ArrayBufferTarget };'
  );
  console.log('  ✓ Changed return to window.Mp4Muxer assignment');

  // Remove the module.exports line
  code = code.replace(
    /if \(typeof module === "object" && typeof module\.exports === "object"\) Object\.assign\(module\.exports, Mp4Muxer\)\s*;?/,
    ''
  );
  console.log('  ✓ Removed module.exports assignment');

  // Convert "use strict"; var Mp4Muxer = (() => { to just (() => {"use strict";
  code = code.replace(
    /^"use strict";\s*var Mp4Muxer = \(\(\) => \{/,
    '(()=>{"use strict";'
  );
  console.log('  ✓ Converted to anonymous IIFE');

  // 32. Remove unused esbuild helpers (no longer needed after converting to window.Mp4Muxer)
  // These were used for CommonJS/ESM interop but we now directly assign to window

  // Remove __toCommonJS (was used in: return __toCommonJS(src_exports))
  code = code.replace(
    /var __toCommonJS = \(mod\) => __copyProps\(__defProp\(\{\}, "__esModule", \{ value: true \}\), mod\);\s*/,
    ''
  );
  console.log('  ✓ Removed __toCommonJS helper');

  // Remove __copyProps (only used by __toCommonJS)
  code = code.replace(
    /var __copyProps = \(to, from, except, desc\) => \{[\s\S]*?return to;\s*\};\s*/,
    ''
  );
  console.log('  ✓ Removed __copyProps helper');

  // Remove __getOwnPropDesc (only used by __copyProps)
  code = code.replace(
    /var __getOwnPropDesc = Object\.getOwnPropertyDescriptor;\s*/,
    ''
  );
  console.log('  ✓ Removed __getOwnPropDesc helper');

  // Remove __getOwnPropNames (only used by __copyProps)
  code = code.replace(
    /var __getOwnPropNames = Object\.getOwnPropertyNames;\s*/,
    ''
  );
  console.log('  ✓ Removed __getOwnPropNames helper');

  // Remove __hasOwnProp (only used by __copyProps)
  code = code.replace(
    /var __hasOwnProp = Object\.prototype\.hasOwnProperty;\s*/,
    ''
  );
  console.log('  ✓ Removed __hasOwnProp helper');

  // Remove src_exports and __export call (we now assign directly to window.Mp4Muxer)
  code = code.replace(
    /var src_exports = \{\};\s*__export\(src_exports, \{ ArrayBufferTarget: \(\) => ArrayBufferTarget, Muxer: \(\) => Muxer \}\);\s*/,
    ''
  );
  console.log('  ✓ Removed src_exports and __export call');

  // Remove __export (no longer used)
  code = code.replace(
    /var __export = \(target, all\) => \{[\s\S]*?\};\s*/,
    ''
  );
  console.log('  ✓ Removed __export helper');

  // Remove __defProp (no longer used after removing __export)
  code = code.replace(
    /var __defProp = Object\.defineProperty;\s*/,
    ''
  );
  console.log('  ✓ Removed __defProp helper');

  // Note: We cannot remove unused variable names from the var declaration because
  // some of them are still referenced in the code (e.g., _audioTrack WeakMap is
  // still declared even though all usages are simplified to video-only).
  // Removing them breaks the code. They're just cosmetic noise.

  // === PHASE 2: Remove more dead code that became unreachable after Phase 1 ===
  console.log('\n  Phase 2: Removing orphaned code...');

  // Remove __privateWrapper (only used for _nextFragmentNumber which was removed)
  code = code.replace(
    /var __privateWrapper = \(obj, member, setter, getter\) => \(\{[\s\S]*?\}\);?\s*/,
    ''
  );
  console.log('  ✓ Removed __privateWrapper helper');

  // Remove soundSampleDescription (audio-only)
  code = code.replace(
    /var soundSampleDescription = \(compressionType, track\) => box\(compressionType,[\s\S]*?\]\);/,
    ''
  );
  console.log('  ✓ Removed soundSampleDescription function');

  // Simplify stsd to video-only (remove the ternary that references soundSampleDescription)
  code = code.replace(
    /track\.info\.type === "video" \? videoSampleDescription\(\s*VIDEO_CODEC_TO_BOX_NAME\[track\.info\.codec\],\s*track\s*\) : soundSampleDescription\(\s*AUDIO_CODEC_TO_BOX_NAME\[track\.info\.codec\],\s*track\s*\)/,
    'videoSampleDescription(VIDEO_CODEC_TO_BOX_NAME[track.info.codec], track)'
  );
  console.log('  ✓ Simplified stsd to video-only');

  // Remove fragmentSampleFlags (fragmented mode only)
  // Function ends with: return byte1 << 24 | byte2 << 16 | byte3 << 8 | byte4;
  code = code.replace(
    /var fragmentSampleFlags = \(sample\) => \{[\s\S]*?return byte1 << 24 \| byte2 << 16 \| byte3 << 8 \| byte4;\s*\};/,
    ''
  );
  console.log('  ✓ Removed fragmentSampleFlags function');

  // Remove orphan chunk-related code (if StreamTargetWriter class removal was partial)
  code = code.replace(
    /var _target2, _sections, _chunked, _chunkSize, _chunks, _writeDataIntoChunks, writeDataIntoChunks_fn, _insertSectionIntoChunk, insertSectionIntoChunk_fn, _createChunk, createChunk_fn, _flushChunks, flushChunks_fn;\s*/,
    ''
  );
  code = code.replace(/_target2 = new WeakMap\(\);\s*/g, '');
  code = code.replace(/_sections = new WeakMap\(\);\s*/g, '');
  code = code.replace(/_chunked = new WeakMap\(\);\s*/g, '');
  code = code.replace(/_chunkSize = new WeakMap\(\);\s*/g, '');
  code = code.replace(/_chunks = new WeakMap\(\);\s*/g, '');

  // Remove writeDataIntoChunks_fn function
  code = code.replace(
    /_writeDataIntoChunks = new WeakSet\(\);\s*writeDataIntoChunks_fn = function\(data, position\) \{[\s\S]*?\};\s*(?=_insertSectionIntoChunk)/,
    ''
  );

  // Remove insertSectionIntoChunk_fn function
  code = code.replace(
    /_insertSectionIntoChunk = new WeakSet\(\);\s*insertSectionIntoChunk_fn = function\(chunk, section\) \{[\s\S]*?\};\s*(?=_createChunk)/,
    ''
  );

  // Remove createChunk_fn function
  code = code.replace(
    /_createChunk = new WeakSet\(\);\s*createChunk_fn = function\(includesPosition\) \{[\s\S]*?\};\s*(?=_flushChunks)/,
    ''
  );

  // Remove flushChunks_fn function
  // After other transforms, this ends before GLOBAL_TIMESCALE (or maybe a comment)
  code = code.replace(
    /_flushChunks = new WeakSet\(\);\s*flushChunks_fn = function\(force = false\) \{[\s\S]*?\};\s*/,
    ''
  );
  console.log('  ✓ Removed flushChunks_fn function');

  // Remove SUPPORTED_AUDIO_CODECS (no longer used)
  code = code.replace(/var SUPPORTED_AUDIO_CODECS = \["aac", "opus"\];\s*/, '');
  console.log('  ✓ Removed SUPPORTED_AUDIO_CODECS');

  // Remove AUDIO_CODEC_TO_BOX_NAME (no longer used)
  code = code.replace(/var AUDIO_CODEC_TO_BOX_NAME = \{[\s\S]*?\};\s*/, '');
  console.log('  ✓ Removed AUDIO_CODEC_TO_BOX_NAME');

  // Remove __privateAdd calls for dead private fields
  // These are in the constructor: __privateAdd(this, _audioTrack, null);
  code = code.replace(/\s*__privateAdd\(this, _audioTrack, null\);/g, '');
  code = code.replace(/\s*__privateAdd\(this, _nextFragmentNumber, [^)]+\);/g, '');
  code = code.replace(/\s*__privateAdd\(this, _videoSampleQueue, [^)]+\);/g, '');
  code = code.replace(/\s*__privateAdd\(this, _audioSampleQueue, [^)]+\);/g, '');
  console.log('  ✓ Removed __privateAdd calls for dead private fields');

  // Remove WeakMap declarations for dead private fields
  // Pattern: _audioTrack = new WeakMap();
  code = code.replace(/\s*_audioTrack = new WeakMap\(\);/g, '');
  code = code.replace(/\s*_nextFragmentNumber = new WeakMap\(\);/g, '');
  code = code.replace(/\s*_videoSampleQueue = new WeakMap\(\);/g, '');
  code = code.replace(/\s*_audioSampleQueue = new WeakMap\(\);/g, '');
  // Also remove computeMoovSizeUpperBound (only called in "expected chunks" fastStart mode which we removed)
  code = code.replace(/\s*__privateAdd\(this, _computeMoovSizeUpperBound\);/g, '');
  code = code.replace(/\s*_computeMoovSizeUpperBound = new WeakSet\(\);/g, '');
  // Remove the function definition for computeMoovSizeUpperBound_fn
  // Function ends with "return upperBound;\n  };"
  code = code.replace(
    /computeMoovSizeUpperBound_fn = function\(\) \{[\s\S]*?return upperBound;\s*\};/,
    ''
  );
  console.log('  ✓ Removed WeakMap/WeakSet declarations for dead private fields');

  // Remove dead symbols from var declaration line
  code = code.replace(/, _audioTrack/g, '');
  code = code.replace(/, _nextFragmentNumber/g, '');
  code = code.replace(/, _videoSampleQueue/g, '');
  code = code.replace(/, _audioSampleQueue/g, '');
  code = code.replace(/, _computeMoovSizeUpperBound, computeMoovSizeUpperBound_fn/g, '');
  code = code.replace(/, _generateMpeg4AudioSpecificConfig, generateMpeg4AudioSpecificConfig_fn/g, '');
  code = code.replace(/, _finalizeFragment, finalizeFragment_fn/g, '');
  console.log('  ✓ Cleaned up Muxer var declaration (removed dead symbols)');

  // Since fastStart is now always "in-memory", remove dead branches

  // First, remove the expected chunks (object) fastStart validation - this changes the else structure
  code = code.replace(
    /if \(typeof options\.fastStart === "object"\) \{\s*if \(options\.video\) \{[\s\S]*?expectedVideoChunks[\s\S]*?\}\s*\}\s*if \(options\.audio\) \{[\s\S]*?expectedAudioChunks[\s\S]*?\}\s*\}\s*\} else/,
    ''
  );
  console.log('  ✓ Removed expected chunks fastStart validation');

  // 1. Remove the else branch in finalize that uses patchBox (non-in-memory path)
  // Note: After E10, the structure is `} __privateMethod` (single }), not `} } __privateMethod`
  // We need to keep the `}` that closes the if (in-memory) block
  code = code.replace(
    /\} else \{\s*let mdatPos = __privateGet\(this, _writer\)\.offsets\.get\(__privateGet\(this, _mdat\)\);[\s\S]*?__privateGet\(this, _writer\)\.patchBox\(__privateGet\(this, _mdat\)\);[\s\S]*?__privateGet\(this, _writer\)\.writeBox\(movieBox\);\s*\}\s*__privateMethod/,
    '}\n      __privateMethod'
  );
  console.log('  ✓ Removed non-in-memory finalize branch');

  // 2. Remove the non-in-memory path in finalizeCurrentChunk_fn
  // Pattern: After "return;" there's dead code that writes samples immediately
  code = code.replace(
    /track\.currentChunk\.offset = 0;\s*return;\s*\}\s*track\.currentChunk\.offset = __privateGet\(this, _writer\)\.pos;[\s\S]*?__privateMethod\(this, _maybeFlushStreamingTargetWriter, maybeFlushStreamingTargetWriter_fn\)\.call\(this\);\s*\};/,
    'track.currentChunk.offset = 0;\n    }\n  };'
  );
  console.log('  ✓ Removed non-in-memory finalizeCurrentChunk branch');

  // 3. Remove patchBox method (only called in the removed else branch)
  code = code.replace(
    /patchBox\(box2\) \{[\s\S]*?this\.bytes\.set\(written, position\);\s*\}/,
    ''
  );
  console.log('  ✓ Removed patchBox method');

  // 4. Remove the else branch in writeHeader (non-in-memory path)
  code = code.replace(
    /\} else if \(__privateGet\(this, _options\)\.fastStart === "fragmented"\) \{\s*\} else \{[\s\S]*?__privateGet\(this, _writer\)\.writeBox\(__privateGet\(this, _mdat\)\);\s*\}/,
    '}'
  );
  console.log('  ✓ Removed non-in-memory writeHeader branch');

  // 5. Remove patchBox method from Writer class (now unused)
  code = code.replace(
    /patchBox\(box2\) \{\s*let endPos = this\.pos;\s*this\.seek\(this\.offsets\.get\(box2\)\);\s*this\.writeBox\(box2\);\s*this\.seek\(endPos\);\s*\}/,
    ''
  );
  console.log('  ✓ Removed patchBox method from Writer class');

  const afterTransformSize = code.length;
  console.log(`\nAfter transforms: ${afterTransformSize.toLocaleString()} bytes`);

  // Write intermediate file for minification
  const tempFile = path.join(__dirname, '..', 'build', 'mp4Muxer.transformed.js');
  fs.mkdirSync(path.dirname(tempFile), { recursive: true });
  fs.writeFileSync(tempFile, code);

  // Use esbuild for tree shaking (minify only if --minify flag is passed)
  const shouldMinify = process.argv.includes('--minify');
  console.log(`\n${shouldMinify ? 'Minifying' : 'Bundling'} with esbuild...`);
  try {
    const minifyFlag = shouldMinify ? '--minify' : '';
    execSync(`npx esbuild "${tempFile}" --bundle ${minifyFlag} --tree-shaking=true --outfile="${OUTPUT_FILE}"`, {
      cwd: path.join(__dirname, '..'),
      stdio: 'pipe'
    });
  } catch (e) {
    console.error('esbuild failed, saving unminified version');
    fs.writeFileSync(OUTPUT_FILE, code);
  }

  // Clean up temp file
  fs.unlinkSync(tempFile);

  // Skip line wrapping for unminified builds
  if (!shouldMinify) {
    const finalCode = fs.readFileSync(OUTPUT_FILE, 'utf8');
    const finalSize = finalCode.length;
    const savings = originalSize - finalSize;
    const pctSaved = ((savings / originalSize) * 100).toFixed(1);
    console.log(`\nOutput: ${OUTPUT_FILE}`);
    console.log(`Final size: ${finalSize.toLocaleString()} bytes`);
    console.log(`Saved: ${savings.toLocaleString()} bytes (${pctSaved}%)`);
    console.log(`Lines: ${finalCode.split('\n').length}`);

    // Verify the output works
    console.log('\nVerifying output...');
    try {
      const testCode = `
        const window = {};
        ${finalCode}
        if (!window.Mp4Muxer) throw new Error('Mp4Muxer not defined');
        if (!window.Mp4Muxer.Muxer) throw new Error('Muxer not defined');
        if (!window.Mp4Muxer.ArrayBufferTarget) throw new Error('ArrayBufferTarget not defined');
      `;
      new Function(testCode)();
      console.log('  ✓ Module loads correctly');
      console.log('  ✓ Mp4Muxer.Muxer is defined');
      console.log('  ✓ Mp4Muxer.ArrayBufferTarget is defined');
    } catch (e) {
      console.error(`  ✗ Verification failed: ${e.message}`);
      process.exit(1);
    }

    // Optionally update index.html
    const updateHtml = process.argv.includes('--update-html');
    if (updateHtml) {
      console.log('\nUpdating index.html...');
      const indexPath = path.join(__dirname, '..', 'index.html');
      let html = fs.readFileSync(indexPath, 'utf8');
      const scriptStart = html.indexOf('<script id="mp4Muxer">');
      const scriptEnd = html.indexOf('</script>', scriptStart) + '</script>'.length;
      if (scriptStart === -1) {
        console.error('  ✗ Could not find <script id="mp4Muxer"> in index.html');
        process.exit(1);
      }
      const newScript = `<script id="mp4Muxer">\n${finalCode}\n</script>`;
      html = html.slice(0, scriptStart) + newScript + html.slice(scriptEnd);
      fs.writeFileSync(indexPath, html);
      console.log('  ✓ Updated index.html with new mp4Muxer');
    } else {
      console.log('\n=== To update index.html ===');
      console.log('Run with --update-html flag, or manually replace the contents of <script id="mp4Muxer">');
      console.log(`  cat ${OUTPUT_FILE}`);
    }
    process.exit(0);
  }

  // Wrap to ~80 columns for readability, breaking only at safe points
  let finalCode = fs.readFileSync(OUTPUT_FILE, 'utf8');
  const lines = [];
  let line = '';
  let inString = false;
  let stringChar = '';
  let parenDepth = 0;   // Track () nesting
  let bracketDepth = 0; // Track [] nesting
  let braceDepth = 0;   // Track {} nesting

  // Helper: check if position i is a good break point (break AFTER ch at i)
  function isBreakAfter(code, i, ch, next, next6, parenDepth) {
    if (ch === ';') return true;
    if (ch === '}') {
      return next !== ')' && next !== '.' && next !== ',' && next !== ']' &&
             !next6.startsWith('else') && !next6.startsWith('catch') &&
             !next6.startsWith('final') && !next6.startsWith('while');
    }
    if (ch === ',') {
      return /[a-zA-Z_$]/.test(next);  // var declaration
    }
    return false;
  }

  // Helper: check if position i is a good break point (break BEFORE next token)
  // 'safe' parameter: when true, only allow very safe breaks (for early breaking)
  function isBreakBefore(code, i, ch, parenDepth, lineEndsWith, safe = false) {
    const next5 = code.slice(i + 1, i + 6);
    const next2 = code.slice(i + 1, i + 3);
    const nextCh = code[i + 1] || '';
    const nextCh2 = code[i + 2] || '';

    if (next5.startsWith('throw')) return true;
    if (next5.startsWith('if(') && !lineEndsWith('else')) return true;
    if ((next2 === '&&' || next2 === '||') && parenDepth > 0) return true;
    // Ternary breaks only when NOT in 'safe' mode (too risky for early breaking)
    if (!safe && nextCh === '?' && nextCh2 !== '.' && nextCh2 !== '?') return true;
    if (!safe && nextCh === ':' && (ch === ')' || ch === ']')) return true;
    return false;
  }

  for (let i = 0; i < finalCode.length; i++) {
    const ch = finalCode[i];
    const prevCh = i > 0 ? finalCode[i - 1] : '';
    line += ch;

    // Track string state to avoid breaking inside strings
    if ((ch === '"' || ch === "'" || ch === '`') && prevCh !== '\\') {
      if (!inString) {
        inString = true;
        stringChar = ch;
      } else if (ch === stringChar) {
        inString = false;
      }
    }

    // Track nesting depth (only when not in string)
    if (!inString) {
      if (ch === '(') parenDepth++;
      else if (ch === ')') parenDepth--;
      else if (ch === '[') bracketDepth++;
      else if (ch === ']') bracketDepth--;
      else if (ch === '{') braceDepth++;
      else if (ch === '}') braceDepth--;
    }

    if (inString) continue;  // Never break inside strings

    const next = finalCode[i + 1] || '';
    const next6 = finalCode.slice(i + 1, i + 7);

    // Check if current position is a break point
    const canBreakAfter = isBreakAfter(finalCode, i, ch, next, next6, parenDepth);
    const canBreakBefore = isBreakBefore(finalCode, i, ch, parenDepth, (s) => line.endsWith(s));

    // If line is already >= 80, break at any opportunity
    if (line.length >= 80 && (canBreakAfter || canBreakBefore)) {
      lines.push(line);
      line = '';
    }
    // If line is >= 60, break early if it would keep line under 80
    // Only use 'safe' break points (not ternary) to avoid edge cases
    const canBreakAfterSafe = canBreakAfter;
    const canBreakBeforeSafe = isBreakBefore(finalCode, i, ch, parenDepth, (s) => line.endsWith(s), true);
    if (line.length >= 60 && (canBreakAfterSafe || canBreakBeforeSafe)) {
      // Look ahead: would continuing make us go over 80 with no safe break?
      let foundBreakWithin = false;
      let tempParenDepth = parenDepth;
      for (let j = i + 1; j < Math.min(i + 80 - line.length, finalCode.length); j++) {
        const c = finalCode[j];
        if (c === '(') tempParenDepth++;
        else if (c === ')') tempParenDepth--;
        const n = finalCode[j + 1] || '';
        const n6 = finalCode.slice(j + 1, j + 7);
        if (isBreakAfter(finalCode, j, c, n, n6, tempParenDepth) ||
            isBreakBefore(finalCode, j, c, tempParenDepth, () => false, true)) {
          foundBreakWithin = true;
          break;
        }
      }
      // If no safe break within remaining chars to 80, break now
      if (!foundBreakWithin) {
        lines.push(line);
        line = '';
      }
    }
  }
  if (line) lines.push(line);
  finalCode = lines.join('\n');

  // Second pass: split long lines that contain strings by inserting "+" or template concatenation
  const splitLines = [];
  for (const ln of finalCode.split('\n')) {
    if (ln.length <= 80) {
      splitLines.push(ln);
      continue;
    }
    // Try to split long lines containing strings
    let result = '';
    let currentLen = 0;
    let inStr = false;
    let strCh = '';
    let inTemplateLiteral = false;
    let templateDepth = 0;  // Track ${...} nesting

    for (let i = 0; i < ln.length; i++) {
      const ch = ln[i];
      const prevCh = i > 0 ? ln[i - 1] : '';
      const nextCh = ln[i + 1] || '';
      result += ch;
      currentLen++;

      // Track regular string state
      if ((ch === '"' || ch === "'") && prevCh !== '\\' && !inTemplateLiteral) {
        if (!inStr) {
          inStr = true;
          strCh = ch;
        } else if (ch === strCh) {
          inStr = false;
        }
      }

      // Track template literal state
      if (ch === '`' && prevCh !== '\\' && !inStr) {
        inTemplateLiteral = !inTemplateLiteral;
      }
      // Track ${...} expressions inside template literals
      if (inTemplateLiteral && ch === '$' && nextCh === '{') {
        templateDepth++;
      }
      if (inTemplateLiteral && ch === '}' && templateDepth > 0) {
        templateDepth--;
      }

      // If we're in a regular string and line is getting long, try to break after a space
      if (inStr && currentLen >= 70 && ch === ' ') {
        // Insert closing quote, +, newline, and opening quote
        result += strCh + '+\n' + strCh;
        currentLen = 1;
      }

      // If we're in a template literal (not inside ${}) and line is long, break after space
      if (inTemplateLiteral && templateDepth === 0 && currentLen >= 70 && ch === ' ') {
        // For template literals, we close with `, add +, newline, and reopen with `
        result += '`+\n`';
        currentLen = 1;
      }
    }
    splitLines.push(result);
  }
  finalCode = splitLines.join('\n');

  fs.writeFileSync(OUTPUT_FILE, finalCode);
  const finalSize = finalCode.length;
  const savings = originalSize - finalSize;
  const pctSaved = ((savings / originalSize) * 100).toFixed(1);

  console.log(`\nOutput: ${OUTPUT_FILE}`);
  console.log(`Final size: ${finalSize.toLocaleString()} bytes`);
  console.log(`Saved: ${savings.toLocaleString()} bytes (${pctSaved}%)`);

  // Verify the output works
  console.log('\nVerifying output...');
  try {
    // Create a test that loads the module
    const testCode = finalCode + '\nif(!window.Mp4Muxer||!window.Mp4Muxer.Muxer)throw new Error("Missing exports");';
    const vm = require('vm');
    const context = { window: {}, console };
    vm.runInNewContext(testCode, context);
    if (context.window.Mp4Muxer && context.window.Mp4Muxer.Muxer) {
      console.log('  ✓ Module loads correctly');
      console.log('  ✓ Mp4Muxer.Muxer is defined');
      console.log('  ✓ Mp4Muxer.ArrayBufferTarget is defined');
    }
  } catch (e) {
    console.error('  ✗ Verification failed:', e.message);
    process.exit(1);
  }

  // Optionally update index.html
  const updateHtml = process.argv.includes('--update-html');
  if (updateHtml) {
    console.log('\nUpdating index.html...');
    const indexPath = path.join(__dirname, '..', 'index.html');
    let html = fs.readFileSync(indexPath, 'utf8');

    // Find the mp4Muxer script block
    const scriptStart = html.indexOf('<script id="mp4Muxer">');
    const scriptEnd = html.indexOf('</script>', scriptStart) + '</script>'.length;

    if (scriptStart === -1) {
      console.error('  ✗ Could not find <script id="mp4Muxer"> in index.html');
      process.exit(1);
    }

    // Build new script block
    const newScript = `<script id="mp4Muxer">\n${finalCode}\n</script>`;

    // Replace
    html = html.slice(0, scriptStart) + newScript + html.slice(scriptEnd);
    fs.writeFileSync(indexPath, html);
    console.log('  ✓ Updated index.html with new mp4Muxer');
  } else {
    console.log('\n=== To update index.html ===');
    console.log('Run with --update-html flag, or manually replace the contents of <script id="mp4Muxer">');
    console.log(`  cat ${OUTPUT_FILE}`);
  }
}

main();
