"use client";

import { useEffect, useRef } from "react";
import { useSiteStore } from "@/store/siteStore";

/**
 * Fixed background: a perspective floor and a fainter ceiling grid drawn once per resize
 * on a canvas (explicit vanishing-point maths, no CSS 3D), plus scanlines and a vignette.
 * Fades in with the intro.
 */
export default function Grid() {
  const step = useSiteStore((s) => s.step);
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const W = window.innerWidth;
      const H = window.innerHeight;
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const color = getComputedStyle(canvas).getPropertyValue("--grid").trim() || "rgba(143,179,217,0.1)";
      const horizon = H * 0.5;
      const vpx = W / 2;
      const plane = (dir: 1 | -1, alpha: number) => {
        // dir 1 = floor (below the horizon), -1 = ceiling
        const edge = dir === 1 ? H : 0;
        const span = Math.abs(edge - horizon);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;
        // depth lines: dense near the horizon, sparse near the viewer
        for (let i = 0; i < 18; i++) {
          const y = horizon + dir * (span / (1 + i * 0.55));
          const t = 1 - i / 18;
          ctx.globalAlpha = alpha * (0.35 + 0.65 * t);
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(W, y);
          ctx.stroke();
        }
        // converging lines from the vanishing point through evenly spaced points on the near edge
        const pitch = 96;
        const count = Math.ceil(W / pitch) + 6;
        for (let k = -count; k <= count; k++) {
          const xEdge = vpx + k * pitch;
          const yStart = horizon + dir * span * 0.06; // keep clear of the horizon itself
          const xStart = vpx + (xEdge - vpx) * 0.06;
          ctx.globalAlpha = alpha * 0.8;
          ctx.beginPath();
          ctx.moveTo(xStart, yStart);
          ctx.lineTo(xEdge, edge);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      };
      plane(1, 1);
      plane(-1, 0.45);
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden transition-opacity duration-[900ms] ease-[var(--ease-out)]"
      style={{ opacity: step >= 1 ? 1 : 0 }}
    >
      <canvas
        ref={ref}
        className="absolute inset-0"
        style={{
          maskImage: "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,1) 30%, rgba(0,0,0,0.35) 70%, rgba(0,0,0,0) 100%)",
          WebkitMaskImage: "radial-gradient(ellipse at 50% 50%, rgba(0,0,0,1) 30%, rgba(0,0,0,0.35) 70%, rgba(0,0,0,0) 100%)",
        }}
      />
      {/* scanlines */}
      <div className="absolute inset-0" style={{ backgroundImage: "repeating-linear-gradient(0deg, var(--scan) 0 1px, transparent 1px 3px)" }} />
      {/* vignette */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(4,6,15,0) 45%, rgba(4,6,15,0.65) 100%)" }} />
    </div>
  );
}
