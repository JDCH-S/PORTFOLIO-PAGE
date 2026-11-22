/*
 * Preview-only diagnostics: a small readout at the bottom of the page with what the device's browser reports (WebGL,
 * the head's build, errors). Used to debug devices we cannot run here (iOS Safari / the Claude app's web view).
 * Tap it to expand or collapse. Not part of the site.
 */
import { useEffect, useState } from "react";

type Entry = { t: number; kind: string; msg: string };
const log: Entry[] = [];
const t0 = performance.now();

function text(v: unknown): string {
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function push(kind: string, args: unknown[]) {
  log.push({ t: Math.round(performance.now() - t0), kind, msg: args.map(text).join(" ").slice(0, 1200) });
  if (log.length > 40) log.shift();
}

/** call before the app renders, so its first errors are caught */
export function installDiagHooks() {
  for (const k of ["error", "warn"] as const) {
    const orig = console[k].bind(console);
    console[k] = (...args: unknown[]) => {
      push(k, args);
      orig(...args);
    };
  }
  window.addEventListener("error", (e) => push("onerror", [e.message, e.filename ? `${e.filename}:${e.lineno}` : ""]));
  window.addEventListener("unhandledrejection", (e) => push("rejection", [e.reason]));
}

function glInfo(): string {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (!gl) return "WebGL2: NOT AVAILABLE";
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    const p = (n: number) => gl.getParameter(n);
    const out = [
      `GPU ${r}`,
      `maxTex ${p(gl.MAX_TEXTURE_SIZE)} · varyings ${p(gl.MAX_VARYING_VECTORS)} · vUniforms ${p(gl.MAX_VERTEX_UNIFORM_VECTORS)} · fUniforms ${p(gl.MAX_FRAGMENT_UNIFORM_VECTORS)} · vTex ${p(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS)}`,
      `float RT ${gl.getExtension("EXT_color_buffer_float") ? "yes" : "no"} · half RT ${gl.getExtension("EXT_color_buffer_half_float") ? "yes" : "no"} · parallel compile ${gl.getExtension("KHR_parallel_shader_compile") ? "yes" : "no"}`,
    ];
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return out.join("\n");
  } catch (e) {
    return "WebGL probe failed: " + text(e);
  }
}

function snapshot(gpu: string): string[] {
  const w = window as Window & { __sphereReady?: boolean; __sphereStats?: Record<string, unknown>; __sphereShaderError?: unknown; __sphereStore?: { getState: () => Record<string, unknown> } };
  const poster = document.querySelector<HTMLImageElement>("[data-sphere-static] img");
  const canvas = document.querySelector("canvas");
  const st = w.__sphereStore?.getState();
  return [
    `DIAG ${Math.round((performance.now() - t0) / 1000)}s · ${navigator.userAgent.replace(/Mozilla\/5.0 /, "").slice(0, 140)}`,
    `page ${location.href.slice(0, 160)}`,
    `screen ${innerWidth}x${innerHeight} @${devicePixelRatio} · Worker ${typeof Worker !== "undefined"} · OffscreenCanvas ${typeof OffscreenCanvas !== "undefined"} · createImageBitmap ${typeof createImageBitmap !== "undefined"}`,
    gpu,
    `poster ${poster ? `${poster.complete ? "complete" : "loading"} ${poster.naturalWidth}px ${poster.currentSrc.split("/").pop()} display:${poster.style.display || "-"}` : "none in DOM"} · canvas ${canvas ? `${canvas.width}x${canvas.height}` : "none"}`,
    `store tier ${String(st?.tier)} · ready ${String(st?.ready)} · building ${String(st?.building)} · __sphereReady ${String(w.__sphereReady)}`,
    `stats ${text(w.__sphereStats ?? "none")}`,
    w.__sphereShaderError ? `SHADER ERROR ${text(w.__sphereShaderError)}` : "shader errors: none",
    `log (${log.length}):`,
    ...log.map((e) => `  ${e.t}ms ${e.kind}: ${e.msg}`),
  ];
}

export default function Diag() {
  const [open, setOpen] = useState(true);
  const [gpu] = useState(glInfo);
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    const read = () => setLines(snapshot(gpu));
    read();
    const id = setInterval(read, 700);
    return () => clearInterval(id);
  }, [gpu]);
  return (
    <div
      onClick={() => setOpen((o) => !o)}
      style={{
        position: "fixed",
        left: 4,
        right: 4,
        bottom: 4,
        zIndex: 2147483647,
        maxHeight: open ? "48vh" : 22,
        overflow: open ? "auto" : "hidden",
        background: "rgba(0,0,0,0.82)",
        color: "#9fe",
        border: "1px solid #375",
        borderRadius: 6,
        padding: "4px 6px",
        font: "10px/1.35 ui-monospace, Menlo, monospace",
        whiteSpace: "pre-wrap",
        wordBreak: "break-all",
        pointerEvents: "auto",
      }}
    >
      {open ? lines.join("\n") : "DIAG (tap to open)"}
    </div>
  );
}
