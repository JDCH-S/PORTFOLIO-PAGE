"use client";

import { useEffect, useRef } from "react";
import { useReducedMotion } from "@/lib/useMediaQuery";

const STEP_MS = 140;

/**
 * Small live activity sparkline: a scrolling line with a glowing head, seeded per agent.
 * The line advances every 140ms and paints only then, and only while the canvas is on screen.
 */
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
    const gold = getComputedStyle(canvas).getPropertyValue("--gold").trim() || "#ffb23f";
    const paint = () => {
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
      const hy = height - 2 - values[N - 1] * (height - 4);
      ctx.fillStyle = "#ffecc8";
      ctx.beginPath();
      ctx.arc(width - 1, hy, 1.8, 0, Math.PI * 2);
      ctx.fill();
    };
    paint();
    if (!live || reduced) return;

    let timer = 0;
    let visible = false;
    const tick = () => {
      values.push(Math.min(1, Math.max(0.05, values[values.length - 1] + (Math.random() - 0.5) * 0.28)));
      values.shift();
      paint();
    };
    const start = () => {
      if (!timer && visible && !document.hidden) timer = window.setInterval(tick, STEP_MS);
    };
    const stop = () => {
      window.clearInterval(timer);
      timer = 0;
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    });
    io.observe(canvas);
    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [seed, width, height, live, reduced]);
  return <canvas ref={ref} width={width} height={height} style={{ width, height }} aria-hidden className="block" />;
}
