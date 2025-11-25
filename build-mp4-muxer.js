// Build entry point for tree-shaking mp4-muxer
// This file imports only what we need, so esbuild can tree-shake the rest

import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

// Export to global window object for use in index.html
window.Mp4Muxer = { Muxer, ArrayBufferTarget };
