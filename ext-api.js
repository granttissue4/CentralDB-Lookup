'use strict';
/** Prefer Firefox `browser` (native promises); fall back to Chromium `chrome`. */
globalThis.ext = globalThis.browser ?? globalThis.chrome;
