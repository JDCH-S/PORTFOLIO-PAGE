"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { detectCapabilities, tierOverrideFromUrl } from "@/lib/tier";
import StaticSphere from "./StaticSphere";
import { useSphereStore } from "./sphereStore";

// The 3D scene is client-only and lazy: the page is usable before it loads.
const SphereScene = dynamic(() => import("./SphereScene"), {
  ssr: false,
  loading: () => <StaticSphere loading />,
});

export interface SphereStageProps {
  /** Show the leva tweak panel (Phase 1 review). */
  debug?: boolean;
  className?: string;
  /** see SphereScene: screen-blend inside, or let the host layer blend */
  blend?: boolean;
  /** drag-to-rotate handled by the scene itself */
  spin?: boolean;
}

const noopSubscribe = () => () => {};

export default function SphereStage({ debug = false, className, blend = true, spin = false }: SphereStageProps) {
  // false during SSR and hydration, true once mounted on the client
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);

  const caps = useMemo(() => {
    if (!mounted) return null;
    const detected = detectCapabilities();
    const override = tierOverrideFromUrl();
    return override ? { ...detected, tier: override } : detected;
  }, [mounted]);

  // The renderer's bundle loads at idle time, after the poster and the name have painted:
  // on a slow phone that is the difference between a 1s and a 6s LCP.
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (!caps || caps.tier === "static") return;
    const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
    if (w.requestIdleCallback && w.cancelIdleCallback) {
      const id = w.requestIdleCallback(() => setIdle(true), { timeout: 600 });
      return () => w.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setIdle(true), 120);
    return () => window.clearTimeout(id);
  }, [caps]);

  const isStatic = caps?.tier === "static";
  useEffect(() => {
    if (isStatic) {
      const st = useSphereStore.getState();
      st.setTier("static");
      st.setReady(true);
    }
  }, [isStatic]);

  // Before hydration / detection: show the static emblem so there is never a blank hero.
  if (!caps) return <StaticSphere loading className={className} />;
  if (caps.tier === "static") return <StaticSphere className={className} />;
  if (!idle) return <StaticSphere loading className={className} />;

  return <SphereScene tier={caps.tier} coarsePointer={caps.coarsePointer} dpr={caps.dpr} debug={debug} className={className} blend={blend} spin={spin} />;
}
