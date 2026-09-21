/**
 * Projecting run geometry into an SVG box.
 *
 * Shared because it is arithmetic, not design. Each direction draws the origin
 * field, the track and the slick completely differently -- as annotated
 * newsprint exhibit, as a wireframe scope, as an instrument plot, as a ruled
 * plate -- but all four need the same equirectangular fit with the longitude
 * scale corrected for latitude, and there is no version of that which belongs
 * to one of them.
 */

import type { LngLat, Run } from "../sim/types";

export interface Projection {
  toXY: (p: LngLat) => [number, number];
  /** Kilometres per SVG unit, so a design can draw its own scale bar. */
  kmPerUnit: number;
  width: number;
  height: number;
}

export function fitProjection(
  points: LngLat[],
  width: number,
  height: number,
  pad = 1.16,
): Projection {
  const pts = points.length ? points : ([[0, 0], [1, 1]] as LngLat[]);
  const lons = pts.map((p) => p[0]);
  const lats = pts.map((p) => p[1]);
  const w = Math.min(...lons);
  const e = Math.max(...lons);
  const s = Math.min(...lats);
  const n = Math.max(...lats);

  const cy = (s + n) / 2;
  const cx = (w + e) / 2;
  const kx = Math.cos((cy * Math.PI) / 180);
  const spanX = Math.max(1e-6, (e - w) * kx);
  const spanY = Math.max(1e-6, n - s);
  const scale = Math.min(width / (spanX * pad), height / (spanY * pad));

  return {
    width,
    height,
    kmPerUnit: 110.574 / scale,
    toXY: (p) => [
      width / 2 + (p[0] - cx) * kx * scale,
      height / 2 - (p[1] - cy) * scale,
    ],
  };
}

/**
 * Frame a figure on the hours that carry the argument.
 *
 * Fitting to everything a run produced puts the whole backward horizon and a
 * long approach leg inside the frame, which squeezes the slick and the hours
 * that matter into a corner. Framing on the hours the age estimate spans, and
 * clipping the rest, is what makes the figure readable.
 */
export function fieldProjection(
  run: Run,
  width: number,
  height: number,
  hours: number[],
  pad = 1.16,
  opts: { includeTrack?: boolean } = {},
): Projection {
  const { includeTrack = true } = opts;
  const pts: LngLat[] = [];
  for (const h of hours) {
    const f = run.drift.frames.find((x) => x.hour === h);
    if (!f) continue;
    for (const ring of f.contour90) pts.push(...ring);
  }
  for (const ring of run.detection.parts) pts.push(...ring);
  // The matched segment belongs in the fit for a *backward* figure -- it is
  // the part of the track the origin field is being compared against, and a
  // frame that cut it off would be hiding the comparison the figure exists to
  // make.
  //
  // Forward it is the opposite. The vessel's track runs off in whatever
  // direction it was steaming, which has nothing to do with where the oil is
  // going, and fitting to both puts the data in a diagonal ribbon across a
  // mostly empty plate. Draw the track, clip it, and frame on the forecast.
  const matched = includeTrack ? run.suspects[0]?.evidence.matchedSegment : null;
  if (matched) pts.push(...matched);
  return fitProjection(pts, width, height, pad);
}

/** Hours to draw a contracting stack of origin contours over. */
export function fieldHours(run: Run, count = 7): number[] {
  const outer = Math.min(
    run.drift.backwardHours,
    Math.max(8, Math.round(run.drift.ageHours[2] * 1.8)),
  );
  return Array.from({ length: count }, (_, i) =>
    -Math.round((outer * (count - 1 - i)) / (count - 1)),
  );
}

/**
 * Hours to draw an expanding stack of forecast contours over.
 *
 * The mirror of `fieldHours`, and deliberately simpler: the backward version
 * has to decide how far back is worth framing, because an ensemble reversed
 * past the age estimate is all frame and no argument. Forward there is no such
 * judgement to make -- the horizon is the horizon, the simulation ran to it,
 * and every hour in between is a state the forecast asserts.
 *
 * Runs from the pass outward, so index 0 is T0 and the last is the horizon.
 */
export function forecastHours(run: Run, count = 7): number[] {
  const outer = run.drift.forwardHours;
  if (outer <= 0) return [0];
  return Array.from({ length: count }, (_, i) =>
    Math.round((outer * i) / (count - 1)),
  );
}

export function ringPath(ring: LngLat[], proj: Projection): string {
  if (!ring.length) return "";
  return (
    ring
      .map((p, i) => {
        const [x, y] = proj.toXY(p);
        return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ") + " Z"
  );
}

export function linePath(pts: LngLat[], proj: Projection): string {
  if (!pts.length) return "";
  return pts
    .map((p, i) => {
      const [x, y] = proj.toXY(p);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

/** A polyline through a plain series, for sparklines and profile charts. */
export function seriesPath(
  values: number[],
  width: number,
  height: number,
  padY = 2,
): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  return values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * width;
      const y = height - ((v - min) / span) * (height - padY * 2) - padY;
      return `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}
