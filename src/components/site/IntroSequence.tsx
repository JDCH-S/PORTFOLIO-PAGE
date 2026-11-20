"use client";

import { useEffect, useRef, useState } from "react";
import { useSiteStore } from "@/store/siteStore";
import { useSphereStore } from "@/components/sphere/sphereStore";
import { readIntroSeen, writeIntroSeen } from "@/lib/introStorage";
import { INTRO_LAST_STEP, runIntro, TIMELINES } from "@/lib/sequence";
import Typewriter from "@/components/ui/Typewriter";
import { linkedRoute } from "@/lib/nav";

type Mode = "full" | "quick" | "none";

/**
 * Drives the load sequence: hologram intro uniforms (once the head is built), the reveal steps, the INITIALISING
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
  // decided once on mount (this component only renders on the client); a shared link to a
  // section or item plays the short version even on a first visit
  const [mode] = useState<Mode>(() => (reduced ? "none" : readIntroSeen() || linkedRoute().depth > 0 ? "quick" : "full"));
  const ctrl = useRef<{ skip: () => void; cancel: () => void } | null>(null);

  // put the hologram in its dark, unbuilt state before it renders. The (blurred) loading poster, painted with the
  // page, stays up while the head builds (a black hero for seconds reads as broken); the live canvas cross-fades over
  // it the moment the head is ready, and the head then scans in from the dark.
  useEffect(() => {
    setIntroSeen(mode !== "full");
    const sphere = useSphereStore.getState();
    if (mode !== "none") sphere.setIntro({ converge: 0, assemble: 0, ignite: 0 });
  }, [mode, setIntroSeen]);

  const started = useRef(false);
  // the page was revealed while the head was still building: only the head's scan-in is left to play
  const revealed = useRef(false);
  useEffect(() => {
    if (started.current) return;
    const sphere = useSphereStore.getState();
    const finishInstantly = () => {
      started.current = true;
      sphere.setIntro({ converge: 1, assemble: 1, ignite: 1 });
      setStep(INTRO_LAST_STEP);
      setPhase("idle");
    };
    if (mode === "none" || tier === "static") {
      finishInstantly();
      return;
    }
    if (!ready) {
      if (revealed.current) return;
      // the scene is still loading: after a few seconds the page itself is revealed. If no build is running (the
      // scene never mounted), the head is shown built; if one is, the head stays dark (the poster shows) and scans in
      // the moment it is ready (below), instead of fading in already built.
      const reveal = window.setTimeout(() => {
        if (!useSphereStore.getState().building) {
          finishInstantly();
          return;
        }
        revealed.current = true;
        setStep(INTRO_LAST_STEP);
        setPhase("idle");
      }, 6000);
      return () => window.clearTimeout(reveal);
    }
    started.current = true;
    const tl = TIMELINES[desktop ? "desktop" : "mobile"][mode];
    if (revealed.current) {
      // late head: the page is already up, so play only the head's part of the timeline (no steps, no skip overlay)
      const c = runIntro(tl, {
        onIntro: (v) => useSphereStore.getState().setIntro(v),
        onStep: () => {},
        onDone: () => writeIntroSeen(),
      });
      ctrl.current = c;
      return;
    }
    setPhase("intro");
    const c = runIntro(tl, {
      onIntro: (v) => useSphereStore.getState().setIntro(v),
      onStep: (s) => setStep(s),
      onDone: () => {
        setPhase("idle");
        writeIntroSeen();
      },
    });
    ctrl.current = c;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "Enter" || e.key === " ") c.skip();
    };
    // any press skips too, and the press still counts (a click on the hologram opens the sections)
    const onPointer = () => c.skip();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onPointer, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onPointer, true);
    };
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
