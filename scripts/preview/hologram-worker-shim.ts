/*
 * Preview build only (scripts/preview/build.mjs swaps src/components/hologram/createWorker.ts for this file):
 * esbuild does not bundle `new Worker(new URL(...))`, so the worker is built as its own IIFE bundle, inlined
 * as a string and started from a Blob URL. The page passes absolute data URLs, so the Blob origin is fine.
 */
declare const __HOLOGRAM_WORKER_SOURCE__: string;

export function createHologramWorker(): Worker {
  const url = URL.createObjectURL(new Blob([__HOLOGRAM_WORKER_SOURCE__], { type: "text/javascript" }));
  const worker = new Worker(url, { name: "hologram" });
  // the script is fetched asynchronously: keep the URL alive until the worker has surely loaded it
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return worker;
}
