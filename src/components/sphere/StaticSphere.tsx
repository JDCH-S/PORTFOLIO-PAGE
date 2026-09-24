import { preload } from "react-dom";

const SRCSET = "/sphere-static-600.webp 600w, /sphere-static.webp 1200w";
const SIZES = "(max-width: 640px) 60vw, min(100vmin, 1000px)";

/**
 * Static fallback for the holographic sphere: used before the 3D scene loads,
 * for prefers-reduced-motion, and when WebGL is unavailable.
 * The image is a real capture of the sphere's light on black; blended with
 * `screen` it composites additively over any dark page background, exactly
 * like the live render. The CSS glow behind it keeps the hero alive even
 * before the image arrives.
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
      className={`absolute inset-0 flex items-center justify-center ${className}`}
      aria-hidden={loading}
      role={loading ? undefined : "img"}
      aria-label={loading ? undefined : "Holographic golden sphere made of thousands of light fragments"}
      data-sphere-static={loading ? "loading" : "fallback"}
    >
      <div
        className="relative aspect-square w-[min(100vmin,1000px)]"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(255,241,207,0.3) 0%, rgba(255,178,63,0.2) 12%, rgba(255,106,0,0.08) 30%, rgba(255,106,0,0) 46%)",
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
