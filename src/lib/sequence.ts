/**
 * The load sequence timeline. Times in seconds from the moment the sphere is ready.
 * Steps: 1 sphere assembling · 2 "INITIALISING" · 3 name decoded · 4 beams · 5 panels · 6 items.
 */
export interface IntroTimeline {
  sparks: [number, number];
  assemble: [number, number];
  ignite: [number, number];
  text: number;
  name: number;
  beams: number;
  panels: number;
  items: number;
  total: number;
}

export const TIMELINES = {
  desktop: {
    full: { sparks: [0, 1.1], assemble: [0.5, 1.9], ignite: [1.6, 2.2], text: 1.9, name: 2.25, beams: 2.55, panels: 3.0, items: 3.4, total: 3.9 },
    quick: { sparks: [0, 0.3], assemble: [0.1, 0.5], ignite: [0.4, 0.6], text: 0.45, name: 0.55, beams: 0.65, panels: 0.75, items: 0.9, total: 1.05 },
  },
  mobile: {
    full: { sparks: [0, 0.5], assemble: [0.3, 1.0], ignite: [0.85, 1.15], text: 1.0, name: 1.15, beams: 1.3, panels: 1.5, items: 1.8, total: 2.05 },
    quick: { sparks: [0, 0.3], assemble: [0.1, 0.5], ignite: [0.4, 0.6], text: 0.45, name: 0.55, beams: 0.65, panels: 0.75, items: 0.9, total: 1.05 },
  },
} as const satisfies Record<string, Record<"full" | "quick", IntroTimeline>>;

export type IntroStepValue = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** The load sequence stops on the bare hologram (step 3); the content emerges on interaction. */
export const INTRO_LAST_STEP: IntroStepValue = 3;

/** Emergence of the modules after the core is opened: seconds until beams, panels, items. */
export const EMERGE = {
  desktop: { beams: 0.05, panels: 0.45, items: 0.85 },
  mobile: { beams: 0.05, panels: 0.3, items: 0.6 },
  quick: { beams: 0, panels: 0.12, items: 0.24 },
} as const;

export interface IntroHandlers {
  onIntro: (v: { converge: number; assemble: number; ignite: number }) => void;
  onStep: (step: IntroStepValue) => void;
  onDone: () => void;
}

const ramp = (t: number, [s, e]: readonly [number, number]) => Math.min(1, Math.max(0, (t - s) / Math.max(1e-3, e - s)));

/** Runs a timeline with requestAnimationFrame. Returns a controller: skip() jumps to the end, cancel() stops silently. */
export function runIntro(tl: IntroTimeline, h: IntroHandlers) {
  let raf = 0;
  let done = false;
  let step: IntroStepValue = 0;
  const start = performance.now();
  const setStep = (s: IntroStepValue) => {
    if (s > step) {
      step = s;
      h.onStep(s);
    }
  };
  const finish = () => {
    if (done) return;
    done = true;
    cancelAnimationFrame(raf);
    h.onIntro({ converge: 1, assemble: 1, ignite: 1 });
    setStep(INTRO_LAST_STEP);
    h.onDone();
  };
  const tick = () => {
    if (done) return;
    const t = (performance.now() - start) / 1000;
    h.onIntro({ converge: ramp(t, tl.sparks), assemble: ramp(t, tl.assemble), ignite: ramp(t, tl.ignite) });
    if (t >= tl.assemble[0]) setStep(1);
    if (t >= tl.text) setStep(2);
    if (t >= tl.name) setStep(3);
    // the sequence ends shortly after the name has decoded; beams and panels wait for the user
    if (t >= tl.name + 0.7) {
      finish();
      return;
    }
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return {
    skip: finish,
    cancel: () => {
      done = true;
      cancelAnimationFrame(raf);
    },
  };
}
