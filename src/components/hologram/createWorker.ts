/**
 * The hologram worker as a bundler-visible worker (Next / Turbopack emit it as its own chunk). The `type: "module"`
 * option is what the bundler recognises; Turbopack actually starts the chunk as a classic worker (importScripts
 * bootstrap), so module-worker support in the browser is not required.
 * The standalone preview build swaps this module for one that starts the worker from an inlined Blob URL
 * (scripts/preview/build.mjs), since esbuild does not bundle `new Worker(new URL(...))`.
 */
export function createHologramWorker(): Worker {
  return new Worker(new URL("./hologram.worker.ts", import.meta.url), { type: "module", name: "hologram" });
}
