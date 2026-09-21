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
import { usePalette } from "../lib/palette";
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
  /**
   * Display stretch.
   *
   * How bright the amplitude is drawn, not what it is. SAR analysts pick a
   * stretch for the display they are looking at, and the right one here depends
   * on the page: the plate was composed against paper, where a bright tile sits
   * naturally, and the same values on a near-black editorial ground read as a
   * lit slab that the rest of the page has to work around.
   *
   * Lowering it changes no pixel's *relative* value, so the slick is damped by
   * exactly as much as it was. 300 is the original paper stretch.
   */
  gain?: number;
}

/** The custom property a `var(--token)` string names, or `null` for a literal. */
function tokenIn(value: string): string | null {
  const match = /^var\((--[\w-]+)\)$/.exec(value.trim());
  return match ? match[1] : null;
}

/** Resolve `var(--token)` against an element, since canvas cannot. */
function resolveColour(value: string, el: HTMLElement | null): string {
  const name = tokenIn(value);
  if (!name || !el) return value;
  const resolved = getComputedStyle(el).getPropertyValue(name).trim();
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
  gain = 300,
}: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  /**
   * The token override the mask outline is currently subject to, if any.
   *
   * Everything else on both surfaces reads its colour through `var(--…)` at
   * paint time, so the colour panel recolours it the instant a token moves. A
   * canvas cannot: `ctx.strokeStyle` takes a resolved string, so the token is
   * read once, inside the effect, and baked into pixels that no later style
   * change can reach. The draw is therefore only as current as the last time
   * the effect ran -- and every other dependency here (`parts`, `bounds`,
   * `seed`, and `maskColour`, which is the *literal string* `"var(--accent)"`)
   * is unchanged by a token override. The tile went on showing the outgoing
   * accent while every SVG figure beside it had already changed.
   *
   * Depending on the override's *value* rather than on the whole override
   * record keeps that narrow: moving `--base` does not force a redraw of a
   * 720x720 speckle field that would come out identical. Reading it through
   * the context also means a cleared override (`clearToken`, `reset`) is a
   * change too, so the tile goes back to the shipped colour rather than
   * sticking at whatever it was last dialled to.
   *
   * `usePalette` falls back to an inert overlay with no provider mounted, so a
   * tile rendered outside a surface keeps working and simply never redraws --
   * which is correct, because outside a surface there is nothing to override.
   */
  const palette = usePalette();
  const maskToken = tokenIn(maskColour);
  const maskOverride = maskToken ? palette.tokens[maskToken] : undefined;

  /**
   * The generated acquisition, held so a recolour does not re-run the physics.
   *
   * Redrawing on a token change is only affordable because the expensive half
   * of this effect is skipped when nothing generative moved. The speckle loop
   * is per-pixel with an inner average of `looks` logarithms, and the plate on
   * the home page is 459x620: measured at ~37 ms of pure arithmetic before the
   * two `ImageData` round trips the mask raster also needs. The colour panel's
   * channel sliders fire on every step of a drag, so regenerating would have
   * put a 40-100 ms block between each frame of a slider the reader is holding
   * -- a fix for a colour that does not follow, paid for with a control that
   * does not move.
   *
   * The key is the same set of values the effect's own dependency array
   * compares, minus the mask's colour, and compared the same way -- `Object.is`
   * on each entry. So it is exactly as stale-proof as the effect gate already
   * was: `parts` and `bounds` are the only non-primitives, both arrive
   * memoised from their call sites, and a caller that hands over fresh arrays
   * every render already re-ran this effect every render and simply misses the
   * cache too.
   */
  const held = useRef<{ key: unknown[]; img: ImageData } | null>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const [w, s, e, n] = bounds;

    const toPx = (p: LngLat): [number, number] => [
      ((p[0] - w) / (e - w)) * W,
      (1 - (p[1] - s) / (n - s)) * H,
    ];

    const key: unknown[] = [parts, bounds, seed, dampingDb, looks, windMs, gain, W, H];
    const cached = held.current;
    let img: ImageData | null =
      cached &&
      cached.key.length === key.length &&
      cached.key.every((v, i) => Object.is(v, key[i]))
        ? cached.img
        : null;

    if (!img) {
      const rng = makeRng(seedFrom(seed));

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

      img = ctx.createImageData(W, H);
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
          const g = Math.max(0, Math.min(255, Math.sqrt(intensity) * gain));
          img.data[i * 4] = g;
          img.data[i * 4 + 1] = g;
          img.data[i * 4 + 2] = g;
          img.data[i * 4 + 3] = 255;
        }
      }

      held.current = { key, img };
    }

    // Repainted from the acquisition every time, cached or not. The outline
    // below fills at 16% alpha, so drawing it over the previous draw instead
    // of over the raster would compound the wash a shade darker each redraw.
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
    // `maskOverride` is in here for its side effect on the dependency check
    // rather than because the body reads it: it is what makes a token move
    // re-run a draw that resolves the token again. See the note above it.
  }, [parts, bounds, seed, dampingDb, looks, windMs, showMask, maskColour, maskOverride, width, height, gain]);

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
