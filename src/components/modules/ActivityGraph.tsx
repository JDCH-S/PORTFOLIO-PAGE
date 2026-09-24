"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/useMediaQuery";

/** Small live activity sparkline: a scrolling line with a glowing head, seeded per agent. */
export default function ActivityGraph({ seed, width = 120, height = 28, live = true }: { seed: number; width?: number; height?: number; live?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = useReducedMotion();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);
    const N = 40;
    const values: number[] = Array.from({ length: N }, (_, i) => 0.35 + 0.3 * Math.sin(i * 0.6 + seed) + 0.2 * Math.sin(i * 1.7 + seed * 3));
    let raf = 0;
    let last = 0;
    const gold = getComputedStyle(canvas).getPropertyValue("--gold").trim() || "#ffb23f";
    const draw = (now: number) => {
      if (live && !reduced && now - last > 140) {
        last = now;
        values.push(Math.min(1, Math.max(0.05, values[values.length - 1] + (Math.random() - 0.5) * 0.28)));
        values.shift();
      }
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = "rgba(143,179,217,0.25)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, height - 0.5);
      ctx.lineTo(width, height - 0.5);
      ctx.stroke();
      ctx.strokeStyle = gold;
      ctx.lineWidth = 1.25;
      ctx.shadowColor = gold;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      values.forEach((v, i) => {
        const x = (i / (N - 1)) * width;
        const y = height - 2 - v * (height - 4);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
      ctx.shadowBlur = 0;
      const hx = width;
      const hy = height - 2 - values[N - 1] * (height - 4);
      ctx.fillStyle = "#ffecc8";
      ctx.beginPath();
      ctx.arc(hx - 1, hy, 1.8, 0, Math.PI * 2);
      ctx.fill();
      if (live && !reduced) raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [seed, width, height, live, reduced]);
  return <canvas ref={ref} width={width} height={height} style={{ width, height }} aria-hidden className="block" />;
}
