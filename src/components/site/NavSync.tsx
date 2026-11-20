"use client";

import { useEffect } from "react";
import { useSiteStore } from "@/store/siteStore";
import { boot, onHistory } from "@/lib/nav";
import { routeWords } from "@/lib/route";

// Fast Refresh can run the effect twice; never attach the history listeners more than once
let attached = false;

/**
 * Keeps the view and the URL in step: Back, Forward and typed hashes drive the view,
 * and history is seeded once the load sequence is over. Screen readers hear each move from
 * Next's route announcer (every level has its own document title).
 */
export default function NavSync() {
  const phase = useSiteStore((s) => s.phase);

  useEffect(() => {
    if (attached) return;
    attached = true;
    window.addEventListener("popstate", onHistory);
    window.addEventListener("hashchange", onHistory);
    return () => {
      attached = false;
      window.removeEventListener("popstate", onHistory);
      window.removeEventListener("hashchange", onHistory);
    };
  }, []);

  useEffect(() => {
    if (phase === "idle") boot();
  }, [phase]);

  useEffect(() => {
    if (process.env.NODE_ENV === "production") return;
    // an element id equal to a hash word would make the browser scroll-jump to it
    const clash = routeWords().filter((w) => document.getElementById(w));
    if (clash.length) console.error(`[nav] element ids collide with route words: ${clash.join(", ")}`);
  }, [phase]);

  return null;
}
