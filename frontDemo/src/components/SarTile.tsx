/**
 * A synthesised SAR tile.
 *
 * The previous version of this demo used stock photographs, duotoned to look
 * technical. They were ordinary pictures of the sea, and anyone glancing at the
 * page would reasonably have read them as radar. That is the one kind of
 * dishonesty a system built to accuse people of pollution cannot afford.
 *
 * So the imagery is generated instead, from the physics that makes a slick
 * visible at all:
 *
 *  - SAR speckle is multiplicative, not additive. A single-look intensity image
 *    is exponentially distributed, and multi-look averaging of L samples gives a
 *    gamma distribution with shape L. Averaging L uniforms through -ln(u) is
 *    exactly that, and it is why radar looks grainy in a way a photograph does
 *    not
 *  - oil damps the short capillary waves that produce Bragg backscatter, so the
 *    slick is a region of lower mean backscatter, not a dark object pasted on
 *  - the sea itself is not uniform. Wind streaks and swell modulate the mean,
 *    which is why look-alikes exist
 *
 * The result is not a Sentinel-1 acquisition and the caption always says so. It
 * is a picture of what the detector is being asked to work on.
 */

import { useEffect, useRef } from "react";
import { makeRng, seedFrom } from "../sim/rng";
import type { LngLat } from "../sim/types";

interface Props {
  /** Slick outlines in lon/lat, projected into the tile by its bounds. */
  parts: LngLat[][];
  bounds: [number, number, number, number];
  seed: string;
  /** Mean backscatter suppression inside the slick, dB. */
  dampingDb: number;
  /** Equivalent number of looks. Lower is grainier. */
  looks?: number;
  /** Wind speed drives how streaky the background is. */
  windMs: number;
  showMask?: boolean;
  /**
   * Outline colour for the mask. A CSS custom property is accepted and resolved
   * against the element, because `ctx.strokeStyle` silently ignores `var(...)`
   * and leaves the previous colour in place -- which is how the outline ends up
   * black on a black tile with no error anywhere.
   */
  maskColour?: string;
  className?: string;
  /**
   * Raster size. Square by default, but an editorial page wants a letterboxed
   * strip and a case file wants a portrait plate, so it is a parameter.
   */
  width?: number;
  height?: number;
}

/** Resolve `var(--token)` against an element, since canvas cannot. */
function resolveColour(value: string, el: HTMLElement | null): string {
  const match = /^var\((--[\w-]+)\)$/.exec(value.trim());
  if (!match || !el) return value;
  const resolved = getComputedStyle(el).getPropertyValue(match[1]).trim();
  return resolved || "#ffffff";
}

export function SarTile({
  parts,
  bounds,
  seed,
  dampingDb,
  looks = 4,
  windMs,
  showMask = false,
  maskColour = "#ff8a3d",
  className = "",
  width = 720,
  height = 720,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const rng = makeRng(seedFrom(seed));
    const [w, s, e, n] = bounds;

    const toPx = (p: LngLat): [number, number] => [
      ((p[0] - w) / (e - w)) * W,
      (1 - (p[1] - s) / (n - s)) * H,
    ];

    // Mask raster: rasterise the polygons once so the speckle loop can ask
    // "is this pixel oil" in constant time.
    const mask = new Uint8Array(W * H);
    {
      const off = document.createElement("canvas");
      off.width = W;
      off.height = H;
      const octx = off.getContext("2d");
      if (octx) {
        octx.fillStyle = "#fff";
        for (const ring of parts) {
          octx.beginPath();
          ring.forEach((p, i) => {
            const [x, y] = toPx(p);
            if (i === 0) octx.moveTo(x, y);
            else octx.lineTo(x, y);
          });
          octx.closePath();
          octx.fill();
        }
        const data = octx.getImageData(0, 0, W, H).data;
        for (let i = 0; i < W * H; i++) mask[i] = data[i * 4] > 127 ? 1 : 0;
      }
    }

    // Background modulation: wind streaks aligned with the wind, plus a slow
    // large-scale trend. This is what a look-alike is made of.
    const streakStrength = Math.min(0.22, 0.03 + windMs * 0.018);
    const phase = rng.range(0, Math.PI * 2);
    const trendX = rng.range(-0.12, 0.12);
    const trendY = rng.range(-0.12, 0.12);

    const img = ctx.createImageData(W, H);
    // Linear-scale mean backscatter. The damping is specified in dB, which is
    // how the characteriser reports it, so it converts here rather than being
    // stored as a made-up linear ratio.
    const dampLinear = Math.pow(10, dampingDb / 10);

    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const i = y * W + x;

        const u = x / W;
        const v = y / H;
        const streak =
          Math.sin((u * 9 + v * 3) * Math.PI + phase) * streakStrength +
          Math.sin((u * 21 - v * 6) * Math.PI + phase * 1.7) *
            streakStrength *
            0.4;
        const trend = trendX * (u - 0.5) + trendY * (v - 0.5);

        let mean = 0.34 * (1 + streak + trend);
        if (mask[i]) mean *= dampLinear;

        // Gamma speckle with shape `looks`, by averaging exponentials.
        let acc = 0;
        for (let l = 0; l < looks; l++) acc += -Math.log(1 - rng.next());
        const intensity = mean * (acc / looks);

        // Displayed as amplitude, which is the usual convention and keeps the
        // dynamic range readable without a log stretch.
        const g = Math.max(0, Math.min(255, Math.sqrt(intensity) * 300));
        img.data[i * 4] = g;
        img.data[i * 4 + 1] = g;
        img.data[i * 4 + 2] = g;
        img.data[i * 4 + 3] = 255;
      }
    }

    ctx.putImageData(img, 0, 0);

    if (showMask) {
      const colour = resolveColour(maskColour, canvas);
      ctx.strokeStyle = colour;
      ctx.lineWidth = 1.5;
      ctx.fillStyle = colour;
      ctx.globalAlpha = 0.16;
      for (const ring of parts) {
        ctx.beginPath();
        ring.forEach((p, idx) => {
          const [px, py] = toPx(p);
          if (idx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.stroke();
        ctx.globalAlpha = 0.16;
      }
      ctx.globalAlpha = 1;
    }
  }, [parts, bounds, seed, dampingDb, looks, windMs, showMask, maskColour, width, height]);

  return (
    <canvas
      ref={ref}
      width={width}
      height={height}
      className={className}
      style={{ imageRendering: "auto" }}
      role="img"
      aria-label="Synthesised radar tile with speckle, showing a damped region where oil suppresses surface roughness"
    />
  );
}

/**
 * Bounds that comfortably contain a slick, with margin.
 *
 * The bounds are matched to the canvas aspect rather than always squared,
 * because a stretched slick misrepresents its own geometry -- and geometry is
 * the thing this whole page is measuring.
 */
export function boundsFor(
  parts: LngLat[][],
  marginRatio = 0.35,
  aspect = 1,
): [number, number, number, number] {
  const lons = parts.flatMap((r) => r.map((p) => p[0]));
  const lats = parts.flatMap((r) => r.map((p) => p[1]));
  const w = Math.min(...lons);
  const e = Math.max(...lons);
  const s = Math.min(...lats);
  const n = Math.max(...lats);

  const cx = (w + e) / 2;
  const cy = (s + n) / 2;
  const kx = Math.cos((cy * Math.PI) / 180);

  // Work in kilometre-like units so the aspect fit is not skewed by latitude,
  // then convert the longitude half-span back to degrees at the end.
  const spanX = (e - w) * kx;
  const spanY = n - s;
  let halfX = (spanX / 2) * (1 + marginRatio * 2);
  let halfY = (spanY / 2) * (1 + marginRatio * 2);

  if (halfX / halfY < aspect) halfX = halfY * aspect;
  else halfY = halfX / aspect;

  return [cx - halfX / kx, cy - halfY, cx + halfX / kx, cy + halfY];
}
