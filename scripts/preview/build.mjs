/**
 * Builds a single self-contained HTML page of the site (no Next.js server needed), for hosting as a
 * private preview. Output: .preview/index.html, the posters next to it and the hologram maps in
 * .preview/hologram/ (serve the folder from its root: the page fetches /hologram/... and /sphere-static*.webp).
 *
 *   node scripts/preview/build.mjs
 */
import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = path.join(root, ".preview");
fs.mkdirSync(out, { recursive: true });

// 1a. The hologram worker as its own bundle: esbuild does not follow `new Worker(new URL(...))`, so the page
// gets a createWorker module that starts this code from a Blob URL (hologram-worker-shim.ts)
const worker = await build({
  entryPoints: [path.join(root, "src/components/hologram/hologram.worker.ts")],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  write: false,
  logLevel: "warning",
});
const workerSource = worker.outputFiles[0].text;
const swapWorker = {
  name: "hologram-worker-shim",
  setup(b) {
    b.onResolve({ filter: /(^|\/)createWorker$/ }, (args) =>
      args.resolveDir.endsWith(path.join("components", "hologram")) ? { path: path.join(here, "hologram-worker-shim.ts") } : undefined,
    );
  },
};

// 1b. JS bundle (React + three + R3F + postprocessing + leva + the hologram)
const js = await build({
  entryPoints: [path.join(here, "entry.tsx")],
  bundle: true,
  minify: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  write: false,
  logLevel: "warning",
  alias: { "@": path.join(root, "src"), "next/dynamic": path.join(here, "next-dynamic-shim.tsx") },
  define: { "process.env.NODE_ENV": '"production"', "process.env.PREVIEW_DIAG": JSON.stringify(process.env.PREVIEW_DIAG ?? "0"), __HOLOGRAM_WORKER_SOURCE__: JSON.stringify(workerSource) },
  plugins: [swapWorker],
});
// The site serves its assets from the domain root ("/hologram/", "/sphere-static.webp"). A hosted preview may live in
// a sub-folder (the Claude app serves it under /<id>/), where root paths 404: no maps, no poster, an empty hero. The
// preview asks for them relative to the page instead (they are written next to index.html below).
const ROOT_ASSETS = [
  ['"/hologram/"', '"hologram/"', 1],
  ['"/sphere-static-600.webp 600w, /sphere-static.webp 1200w"', '"sphere-static-600.webp 600w, sphere-static.webp 1200w"', 1],
  ['"/sphere-static.webp"', '"sphere-static.webp"', 2],
];
let bundle = js.outputFiles[0].text;
for (const [from, to, n] of ROOT_ASSETS) {
  const parts = bundle.split(from);
  if (parts.length - 1 !== n) throw new Error(`preview: expected ${n} x ${from} in the bundle, found ${parts.length - 1}`);
  bundle = parts.join(to);
}
if (/["' ]\/(hologram\/|sphere-static)/.test(bundle)) throw new Error("preview: a root-relative asset path is left in the bundle");
const script = bundle.replace(/<\/script/gi, "<\\/script");

// 2. CSS: the app's own globals.css through Tailwind, scanning src/ for classes
const cssIn = fs.readFileSync(path.join(root, "src/app/globals.css"), "utf8");
const css = (await postcss([tailwind({ base: root })]).process(cssIn, { from: path.join(root, "src/app/globals.css") })).css;

// 3. Page
const html = `<title>Holographic Core</title>
<meta name="description" content="Preview of the portfolio: projects, agents and systems around a holographic core.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap">
<style>
${css}
:root { color-scheme: dark; --font-chakra: "Chakra Petch", system-ui, sans-serif; --font-geist-sans: "Geist", system-ui, sans-serif; --font-geist-mono: "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
html, body { height: 100%; margin: 0; background: var(--bg); color: var(--fg); }
#root { min-height: 100%; }
.h-dvh { height: 100vh; height: 100dvh; }
</style>
<div id="root"></div>
<script>${script}</script>
`;
fs.writeFileSync(path.join(out, "index.html"), html);
for (const f of ["sphere-static.webp", "sphere-static-600.webp"]) fs.copyFileSync(path.join(root, "public", f), path.join(out, f));
// the hologram maps (public/hologram, written by scripts/hologram/pack_maps.py)
const holoIn = path.join(root, "public", "hologram");
const holoOut = path.join(out, "hologram");
fs.rmSync(holoOut, { recursive: true, force: true });
fs.mkdirSync(holoOut, { recursive: true });
let holoBytes = 0;
for (const f of fs.readdirSync(holoIn)) {
  fs.copyFileSync(path.join(holoIn, f), path.join(holoOut, f));
  holoBytes += fs.statSync(path.join(holoIn, f)).size;
}
const size = fs.statSync(path.join(out, "index.html")).size;
console.log(
  `wrote .preview/index.html (${(size / 1024 / 1024).toFixed(2)} MB), js ${(script.length / 1024).toFixed(0)} KB (worker ${(workerSource.length / 1024).toFixed(0)} KB inlined), css ${(css.length / 1024).toFixed(0)} KB, hologram maps ${(holoBytes / 1024).toFixed(0)} KB`,
);
