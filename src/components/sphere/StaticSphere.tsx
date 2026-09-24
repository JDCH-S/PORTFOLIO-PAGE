/**
 * Static fallback for the holographic sphere: used before the 3D scene loads,
 * for prefers-reduced-motion, and when WebGL is unavailable.
 * The PNG is a real capture of the sphere; the CSS glow behind it keeps the
 * hero alive even if the image has not arrived yet.
 */
export default function StaticSphere({
  loading = false,
  className = "",
}: {
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`absolute inset-0 flex items-center justify-center ${className}`}
      aria-hidden={loading}
      role={loading ? undefined : "img"}
      aria-label={loading ? undefined : "Holographic golden sphere made of thousands of light fragments"}
      data-sphere-static={loading ? "loading" : "fallback"}
    >
      <div
        className="relative aspect-square w-[min(72vmin,720px)]"
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(255,241,207,0.55) 0%, rgba(255,178,63,0.35) 18%, rgba(255,106,0,0.12) 42%, rgba(255,106,0,0) 62%)",
          filter: loading ? "blur(6px)" : "none",
          opacity: loading ? 0.6 : 1,
          transition: "opacity 600ms ease, filter 600ms ease",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- static asset, sized by container */}
        <img
          src="/sphere-static.png"
          alt=""
          decoding="async"
          loading="eager"
          className="absolute inset-0 h-full w-full object-contain"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
    </div>
  );
}
