/**
 * Page textures: film grain and halftone imagery.
 *
 * Grain is an inline SVG feTurbulence rather than a GIF, so there is no asset
 * request and it works offline. It lives on a fixed, pointer-events-none layer
 * because grain over a scrolling container forces a GPU repaint every frame.
 */

export function Grain({ opacity = 0.16 }: { opacity?: number }) {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-40 mix-blend-soft-light"
      style={{ opacity }}
    >
      <svg className="h-full w-full">
        <filter id="grain-filter">
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.8"
            numOctaves={3}
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect width="100%" height="100%" filter="url(#grain-filter)" />
      </svg>
    </div>
  );
}

/**
 * Halftone-treated image.
 *
 * Two layers: a duotoned photograph, and a dot lattice masked by the image's
 * own luminance so dark areas keep their dots and highlights drop out. That
 * luminance mask is the difference between real halftone and a dot overlay
 * pasted on top.
 *
 * The `src` images are placeholders. Swap them for real Sentinel-1 VV tiles
 * before this goes in front of anyone -- see the README.
 */
export function Halftone({
  src,
  alt,
  dot = 5,
  className = "",
  tint,
}: {
  src: string;
  alt: string;
  dot?: number;
  className?: string;
  tint?: string;
}) {
  return (
    <figure className={`relative overflow-hidden ${className}`}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className="duotone h-full w-full object-cover"
      />

      {/* Dot lattice, masked by the image so dots track its tonality. */}
      <div
        aria-hidden
        className="halftone pointer-events-none absolute inset-0 mix-blend-overlay"
        style={{
          ["--dot" as string]: `${dot}px`,
          color: tint ?? "var(--accent)",
          WebkitMaskImage: `url(${src})`,
          maskImage: `url(${src})`,
          WebkitMaskSize: "cover",
          maskSize: "cover",
          WebkitMaskPosition: "center",
          maskPosition: "center",
        }}
      />

      {/* Keeps text legible over any placeholder that comes back too bright. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, var(--base) 2%, transparent 55%)",
        }}
      />
    </figure>
  );
}

/** Radar-style concentric sweep, drawn as SVG so anime can stroke-draw it. */
export function ScopeRings({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 400 400"
      className={className}
      fill="none"
      stroke="currentColor"
    >
      {[60, 110, 160, 195].map((r) => (
        <circle
          key={r}
          className="scope-ring"
          cx="200"
          cy="200"
          r={r}
          strokeWidth="1"
          opacity={0.35}
        />
      ))}
      <line className="scope-ring" x1="200" y1="5" x2="200" y2="395" strokeWidth="1" opacity={0.2} />
      <line className="scope-ring" x1="5" y1="200" x2="395" y2="200" strokeWidth="1" opacity={0.2} />
    </svg>
  );
}
