"use client";

import { useSiteStore } from "@/store/siteStore";

/** Fixed background: perspective floor grid, faint scanlines, vignette. Fades in with the intro. */
export default function Grid() {
  const step = useSiteStore((s) => s.step);
  const on = step >= 1;
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden transition-opacity duration-[900ms] ease-[var(--ease-out)]"
      style={{ opacity: on ? 1 : 0 }}
    >
      {/* perspective floor */}
      <div
        className="absolute left-1/2 top-[52%] h-[140vh] w-[260vw] -translate-x-1/2"
        style={{
          transform: "translateX(-50%) perspective(900px) rotateX(74deg)",
          transformOrigin: "50% 0%",
          backgroundImage: "linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          maskImage: "linear-gradient(to bottom, rgba(0,0,0,0.9), rgba(0,0,0,0) 85%)",
          WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,0.9), rgba(0,0,0,0) 85%)",
        }}
      />
      {/* ceiling grid, fainter */}
      <div
        className="absolute left-1/2 top-[-40vh] h-[90vh] w-[260vw] -translate-x-1/2"
        style={{
          transform: "translateX(-50%) perspective(900px) rotateX(-74deg)",
          transformOrigin: "50% 100%",
          backgroundImage: "linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px)",
          backgroundSize: "64px 64px",
          opacity: 0.5,
          maskImage: "linear-gradient(to top, rgba(0,0,0,0.8), rgba(0,0,0,0) 85%)",
          WebkitMaskImage: "linear-gradient(to top, rgba(0,0,0,0.8), rgba(0,0,0,0) 85%)",
        }}
      />
      {/* scanlines */}
      <div className="absolute inset-0" style={{ backgroundImage: "repeating-linear-gradient(0deg, var(--scan) 0 1px, transparent 1px 3px)" }} />
      {/* vignette */}
      <div className="absolute inset-0" style={{ background: "radial-gradient(ellipse at 50% 45%, rgba(4,6,15,0) 40%, rgba(4,6,15,0.7) 100%)" }} />
    </div>
  );
}
