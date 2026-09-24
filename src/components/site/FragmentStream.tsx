"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { useReducedMotion } from "@/lib/useMediaQuery";

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
  const openItem = useSiteStore((s) => s.openItem);
  const reduced = useReducedMotion();

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
        openItem(id);
        return;
      }
      const to = Array.from({ length: COUNT }, () => ({
        x: rect.left + 8 + Math.random() * Math.max(1, rect.width - 16),
        y: rect.top + 6 + Math.random() * Math.max(1, rect.height - 12),
        rot: (Math.atan2(dy, dx) * 180) / Math.PI + (Math.random() - 0.5) * 30,
        len: 6 + Math.random() * 16,
      }));
      setStream({ id, from, to });
      window.setTimeout(() => {
        openItem(id);
        window.setTimeout(() => setStream(null), 200);
      }, 260);
    };
    window.addEventListener("core:open-item", onOpen);
    return () => window.removeEventListener("core:open-item", onOpen);
  }, [openItem, reduced]);

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60]">
      <AnimatePresence>
        {stream
          ? stream.to.map((t, i) => (
              <motion.span
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
