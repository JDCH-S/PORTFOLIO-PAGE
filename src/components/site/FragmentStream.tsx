"use client";

import { useEffect, useRef, useState } from "react";
import { m, AnimatePresence } from "framer-motion";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { useReducedMotion } from "@/lib/useMediaQuery";
import { openItem } from "@/lib/nav";
import { sectionOfItem } from "@/content/content";

interface Stream {
  id: string;
  from: { x: number; y: number };
  to: { x: number; y: number; rot: number; len: number }[];
}

const COUNT = 26;

/**
 * On item click: a burst of gold fragments flies from the sphere to the item, then the
 * detail view opens. Listens for the `core:open-item` event dispatched by ItemButton.
 */
export default function FragmentStream() {
  const [stream, setStream] = useState<Stream | null>(null);
  const reduced = useReducedMotion();
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const onOpen = (e: Event) => {
      const { id, rect } = (e as CustomEvent<{ id: string; rect: DOMRect }>).detail;
      const sphere = useSphereStore.getState();
      const f = sphere.frame;
      const from = f ? { x: f.x, y: f.y } : { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      const dx = rect.left + rect.width / 2 - from.x;
      const dy = rect.top + rect.height / 2 - from.y;
      const len = Math.hypot(dx, dy) || 1;
      sphere.pulseToward(dx / len, dy / len, 1);
      if (reduced) {
        if (useSiteStore.getState().phase === "idle") openItem(id);
        return;
      }
      const to = Array.from({ length: COUNT }, () => ({
        x: rect.left + 8 + Math.random() * Math.max(1, rect.width - 16),
        y: rect.top + 6 + Math.random() * Math.max(1, rect.height - 12),
        rot: (Math.atan2(dy, dx) * 180) / Math.PI + (Math.random() - 0.5) * 30,
        len: 6 + Math.random() * 16,
      }));
      setStream({ id, from, to });
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [
        window.setTimeout(() => {
          // the item is opened through nav, so it gets its own history entry; any move made
          // during the burst (another section, Esc) wins and the open is dropped
          const s = useSiteStore.getState();
          if (s.phase === "idle" && s.view === "module" && s.activeModule === sectionOfItem(id)) openItem(id);
          timers.current.push(window.setTimeout(() => setStream(null), 200));
        }, 260),
      ];
    };
    // Back during the burst cancels the open
    const onBack = () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current = [];
      setStream(null);
    };
    window.addEventListener("core:open-item", onOpen);
    window.addEventListener("popstate", onBack);
    return () => {
      window.removeEventListener("core:open-item", onOpen);
      window.removeEventListener("popstate", onBack);
    };
  }, [reduced]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60]">
      <AnimatePresence>
        {stream
          ? stream.to.map((t, i) => (
              <m.span
                key={`${stream.id}-${i}`}
                className="absolute left-0 top-0 h-[2px] rounded-full bg-gold-hot"
                style={{ width: t.len, boxShadow: "0 0 6px var(--gold), 0 0 14px var(--gold-glow)" }}
                initial={{ x: stream.from.x, y: stream.from.y, rotate: t.rot, opacity: 0, scaleX: 0.4 }}
                animate={{ x: t.x, y: t.y, rotate: t.rot, opacity: [0, 1, 1, 0], scaleX: [0.4, 1, 1, 0.6] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.34, delay: i * 0.006, ease: [0.2, 0.8, 0.2, 1] }}
              />
            ))
          : null}
      </AnimatePresence>
    </div>
  );
}
