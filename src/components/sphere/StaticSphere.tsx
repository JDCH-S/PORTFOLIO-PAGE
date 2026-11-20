import { preload } from "react-dom";

const SRCSET = "/sphere-static-600.webp 600w, /sphere-static.webp 1200w";
/**
 * The poster is a square capture at the desktop hero framing (unit circle = HERO_FILL 0.72 of the side). Portrait
 * viewports frame the live head at HERO_FILL_PORTRAIT 0.88 of the width (see fillFor), so there the poster is drawn
 * 0.88 / 0.72 = 122.2vmin wide (clipped) and the head does not jump in size when the live canvas cross-fades in.
 */
const SIZES = "(max-aspect-ratio: 4/5) 123vmin, min(100vmin, 1000px)";

/**
 * Static fallback for the face hologram: used before the 3D scene loads and builds the head,
 * for prefers-reduced-motion, and when WebGL is unavailable.
 * The image is a real capture of the hologram's light on black (front, fully assembled, the
 * live scene's framing); blended with `screen` it composites additively over any dark page
 * background, exactly like the live render. The faint CSS glow behind it keeps the hero
 * alive even before the image arrives.
 */
export default function StaticSphere({
  loading = false,
  className = "",
}: {
  loading?: boolean;
  className?: string;
}) {
  // the poster is the largest paint before the canvas: fetch it ahead of the scripts and fonts
  preload("/sphere-static.webp", { as: "image", imageSrcSet: SRCSET, imageSizes: SIZES, fetchPriority: "high" });
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center overflow-hidden ${className}`}
      aria-hidden={loading}
      role={loading ? undefined : "img"}
      aria-label={loading ? undefined : "Holographic portrait of Juan Diego Chiriboga drawn in golden light filaments"}
      data-sphere-static={loading ? "loading" : "fallback"}
    >
      <div
        className="relative aspect-square w-[min(100vmin,1000px)] shrink-0 [@media(max-aspect-ratio:4/5)]:w-[122.22vmin]"
        style={{
          background:
            "radial-gradient(ellipse 34% 44% at 50% 52%, rgba(255,178,63,0.09) 0%, rgba(255,106,0,0.05) 55%, rgba(255,106,0,0) 100%)",
          filter: loading ? "blur(6px)" : "none",
          opacity: loading ? 0.65 : 1,
          transition: "opacity 600ms ease, filter 600ms ease",
        }}
      >
        <picture>
          <img
            src="/sphere-static.webp"
            srcSet={SRCSET}
            sizes={SIZES}
            alt=""
            width={1200}
            height={1200}
            decoding="async"
            loading="eager"
            fetchPriority="high"
            className="absolute inset-0 h-full w-full object-contain mix-blend-screen"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
        </picture>
      </div>
    </div>
  );
}
