"use client";

import { useEffect, useState } from "react";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { useSiteStore } from "@/store/siteStore";

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

/** Bottom telemetry bar: live fps, tier, fragments, uptime and a drifting coordinate. */
export default function Telemetry({ className = "" }: { className?: string }) {
  const fps = useSphereStore((s) => s.fps);
  const tier = useSphereStore((s) => s.tier);
  const fragments = useSphereStore((s) => s.fragments);
  const phase = useSiteStore((s) => s.phase);
  const [t, setT] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setT((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const lat = (51.4769 + Math.sin(t / 9) * 0.0021).toFixed(4);
  const lon = (-0.0005 + Math.cos(t / 7) * 0.0017).toFixed(4);
  return (
    <div className={`data flex flex-wrap items-center gap-x-6 gap-y-1 text-steel ${className}`} aria-live="off">
      <span>
        <span className="text-steel-dim">FPS</span> {fps || "--"}
      </span>
      <span>
        <span className="text-steel-dim">TIER</span> {tier.toUpperCase()}
      </span>
      <span>
        <span className="text-steel-dim">FRAG</span> {fragments.toLocaleString()}
      </span>
      <span>
        <span className="text-steel-dim">T+</span>
        {pad(Math.floor(t / 3600))}:{pad(Math.floor((t % 3600) / 60))}:{pad(t % 60)}
      </span>
      <span className="hidden sm:inline">
        <span className="text-steel-dim">POS</span> {lat}N {lon}W
      </span>
      <span>
        <span className="text-steel-dim">STATE</span> <span className="text-online">{phase === "detail" ? "FOCUS" : "ONLINE"}</span>
      </span>
    </div>
  );
}
