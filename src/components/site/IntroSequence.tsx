"use client";

import { useEffect, useRef, useState } from "react";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { readIntroSeen, writeIntroSeen } from "@/lib/introStorage";
import { INTRO_LAST_STEP, runIntro, TIMELINES } from "@/lib/sequence";
import Typewriter from "@/components/ui/Typewriter";

type Mode = "full" | "quick" | "none";

/**
 * Drives the load sequence: sphere intro uniforms, the reveal steps, the INITIALISING
 * line and the skip control. Plays in full on the first visit, quickly afterwards,
 * and not at all with reduced motion or without WebGL.
 */
export default function IntroSequence({ desktop, reduced }: { desktop: boolean; reduced: boolean }) {
  const phase = useSiteStore((s) => s.phase);
  const step = useSiteStore((s) => s.step);
  const setPhase = useSiteStore((s) => s.setPhase);
  const setStep = useSiteStore((s) => s.setStep);
  const setIntroSeen = useSiteStore((s) => s.setIntroSeen);
  const ready = useSphereStore((s) => s.ready);
  const tier = useSphereStore((s) => s.tier);
  const frame = useSphereStore((s) => s.frame);
  // decided once on mount (this component only renders on the client)
  const [mode] = useState<Mode>(() => (reduced ? "none" : readIntroSeen() ? "quick" : "full"));
  const ctrl = useRef<{ skip: () => void; cancel: () => void } | null>(null);

  // put the sphere in its dark scattered state before it renders
  useEffect(() => {
    setIntroSeen(mode !== "full");
    const sphere = useSphereStore.getState();
    if (mode !== "none") {
      sphere.setIntro({ converge: 0, assemble: 0, ignite: 0 });
      sphere.setHidePoster(true);
    }
  }, [mode, setIntroSeen]);

  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    const sphere = useSphereStore.getState();
    const finishInstantly = () => {
      started.current = true;
      sphere.setIntro({ converge: 1, assemble: 1, ignite: 1 });
      sphere.setHidePoster(false);
      setStep(INTRO_LAST_STEP);
      setPhase("idle");
    };
    if (mode === "none" || tier === "static") {
      finishInstantly();
      return;
    }
    if (!ready) {
      // the scene is still loading: give it a few seconds, then reveal the page anyway
      const id = window.setTimeout(finishInstantly, 6000);
      return () => window.clearTimeout(id);
    }
    started.current = true;
    setPhase("intro");
    const tl = TIMELINES[desktop ? "desktop" : "mobile"][mode];
    const c = runIntro(tl, {
      onIntro: (v) => useSphereStore.getState().setIntro(v),
      onStep: (s) => setStep(s),
      onDone: () => {
        useSphereStore.getState().setHidePoster(false);
        setPhase("idle");
        writeIntroSeen();
      },
    });
    ctrl.current = c;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") c.skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, ready, tier, desktop, setPhase, setStep]);

  // cancel a running timeline only when this component unmounts
  useEffect(() => () => ctrl.current?.cancel(), []);

  if (phase !== "intro") return null;
  const cx = frame ? frame.x : typeof window !== "undefined" ? window.innerWidth / 2 : 0;
  const below = frame ? frame.y + frame.size / 2 + 28 : typeof window !== "undefined" ? window.innerHeight * 0.5 + 0.36 * Math.min(window.innerWidth, window.innerHeight) + 28 : 0;
  return (
    <div className="pointer-events-none fixed inset-0 z-[70]" aria-live="polite">
      <div className="absolute -translate-x-1/2 text-center" style={{ left: cx, top: below }}>
        <div className="label text-gold" style={{ opacity: step >= 2 && step < 3 ? 1 : 0, transition: "opacity 240ms var(--ease-out)" }}>
          <Typewriter text="INITIALISING" active={step >= 2} />
        </div>
      </div>
      <button
        type="button"
        onClick={() => ctrl.current?.skip()}
        className="label pointer-events-auto absolute right-5 bottom-16 flex h-11 items-center gap-2 rounded-[2px] border border-steel-line bg-bg/70 px-3 text-steel hover:border-gold hover:text-gold-hot"
      >
        skip <span className="text-steel-dim">esc</span>
      </button>
    </div>
  );
}
