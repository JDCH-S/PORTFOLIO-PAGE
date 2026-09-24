/**
 * Builds a single self-contained HTML page of the Phase 1 sphere (no server needed),
 * for hosting as a private preview. Output: .preview/index.html (+ the poster next to it).
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

// 1. JS bundle (React + three + R3F + postprocessing + leva + the sphere)
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
  define: { "process.env.NODE_ENV": '"production"' },
});
const script = js.outputFiles[0].text.replace(/<\/script/gi, "<\\/script");

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
const size = fs.statSync(path.join(out, "index.html")).size;
console.log(`wrote .preview/index.html (${(size / 1024 / 1024).toFixed(2)} MB), js ${(script.length / 1024).toFixed(0)} KB, css ${(css.length / 1024).toFixed(0)} KB`);
