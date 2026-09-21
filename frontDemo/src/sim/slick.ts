/**
 * Slick geometry synthesis and characterisation.
 *
 * The generator lays a slick down the way the ocean does: oil released at a
 * point drifts, and the parcel released earliest has been spreading longest, so
 * the ribbon is narrow at the head and wide at the tail. P004 observed exactly
 * that on its Case 2 slick, and it is the reason the width profile carries
 * information about age.
 *
 * The characteriser then measures the polygon back, using the same operations
 * PHASE-03 specifies: equal-area shoelace for area, medial axis for length,
 * perpendicular sampling for the width profile, and both end points emitted
 * because geometry alone cannot say which end is the head.
 */

import {
  KM_PER_DEG_LAT,
  bearingDeg,
  centroid,
  destination,
  distanceKm,
  kmPerDegLon,
  pathLengthKm,
  ringAreaKm2,
  ringPerimeterKm,
} from "./geo";
import type { Rng } from "./rng";
import type { Characterisation, LngLat } from "./types";

export interface SlickSpec {
  /** Where the oil entered the water. The head sits at or near this point. */
  source: LngLat;
  /** Direction the ribbon runs, degrees from north. */
  axisDeg: number;
  lengthKm: number;
  /** Width at the head, metres. Fresh oil, barely spread. */
  headWidthM: number;
  /** Width at the tail, metres. Oldest oil, spread longest. */
  tailWidthM: number;
  /** Lateral wander of the centreline, km. Currents are not straight. */
  meanderKm: number;
  /** Number of disconnected parts. Wind and waves break a ribbon up. */
  fragments: number;
}

export interface SlickGeometry {
  parts: LngLat[][];
  centreline: LngLat[];
  head: LngLat;
  tail: LngLat;
}

const AXIS_SAMPLES = 48;

export function buildSlick(spec: SlickSpec, rng: Rng): SlickGeometry {
  const centreline: LngLat[] = [];
  const widths: number[] = [];

  // Two meander harmonics, so the ribbon curves without looking like a sine wave.
  const phase1 = rng.range(0, Math.PI * 2);
  const phase2 = rng.range(0, Math.PI * 2);

  // The wander is measured from the source, not around it. Without this the
  // ribbon starts a few hundred metres to one side of the point the oil came
  // out of, and every measurement taken against the head inherits that error.
  const lateralAt = (s: number) =>
    spec.meanderKm * Math.sin(s * 2.1 * Math.PI + phase1) * 0.7 +
    spec.meanderKm * Math.sin(s * 4.7 * Math.PI + phase2) * 0.3;
  const lateral0 = lateralAt(0);

  for (let i = 0; i < AXIS_SAMPLES; i++) {
    const s = i / (AXIS_SAMPLES - 1);
    const along = s * spec.lengthKm;
    const lateral = lateralAt(s) - lateral0;

    let p = destination(spec.source, spec.axisDeg, along);
    p = destination(p, spec.axisDeg + 90, lateral);
    centreline.push(p);

    // Fay-consistent spreading: width grows with the square root of elapsed
    // time, and elapsed time grows linearly along the ribbon.
    const t = Math.sqrt(s);
    widths.push(
      spec.headWidthM + (spec.tailWidthM - spec.headWidthM) * t +
        rng.normal() * spec.headWidthM * 0.09,
    );
  }

  // A ribbon is one polygon: walk one side out and the other side back.
  const left: LngLat[] = [];
  const right: LngLat[] = [];
  for (let i = 0; i < centreline.length; i++) {
    const prev = centreline[Math.max(0, i - 1)];
    const next = centreline[Math.min(centreline.length - 1, i + 1)];
    const heading = bearingDeg(prev, next);
    const halfKm = widths[i] / 2000;
    const roughness = 1 + rng.normal() * 0.07;
    left.push(destination(centreline[i], heading - 90, halfKm * roughness));
    right.push(destination(centreline[i], heading + 90, halfKm * (2 - roughness)));
  }

  const full: LngLat[] = [...left, ...right.slice().reverse()];
  full.push(full[0]);

  const parts =
    spec.fragments <= 1 ? [full] : splitRibbon(left, right, spec.fragments, rng);

  return {
    parts,
    centreline,
    head: centreline[0],
    tail: centreline[centreline.length - 1],
  };
}

/** Break the ribbon into fragments with gaps, the way wind and waves do. */
function splitRibbon(
  left: LngLat[],
  right: LngLat[],
  fragments: number,
  rng: Rng,
): LngLat[][] {
  const n = left.length;
  const parts: LngLat[][] = [];
  const per = Math.floor(n / fragments);

  for (let f = 0; f < fragments; f++) {
    const start = f * per;
    const gap = f === fragments - 1 ? 0 : rng.int(2, 5);
    const end = Math.min(n, start + per - gap);
    if (end - start < 4) continue;
    const ring = [
      ...left.slice(start, end),
      ...right.slice(start, end).reverse(),
    ];
    ring.push(ring[0]);
    parts.push(ring);
  }

  return parts;
}

export function characterise(
  detectionId: string,
  geom: SlickGeometry,
  opts: {
    windSpeedMs: number;
    dampingRatioDb: number;
    headResolved: boolean;
  },
): Characterisation {
  const areaKm2 = geom.parts.reduce((s, ring) => s + ringAreaKm2(ring), 0);
  const perimeterKm = geom.parts.reduce((s, r) => s + ringPerimeterKm(r), 0);
  const lengthKm = pathLengthKm(geom.centreline);

  // Width sampled perpendicular to the axis, which is what the profile means.
  const widthMProfile: number[] = [];
  for (let i = 0; i < geom.centreline.length; i++) {
    widthMProfile.push(widthAt(geom, i));
  }
  const widthMMean =
    widthMProfile.reduce((s, w) => s + w, 0) / widthMProfile.length;

  const orientationDeg = bearingDeg(geom.head, geom.tail);
  const elongation = (lengthKm * 1000) / Math.max(1, widthMMean);
  // Isoperimetric compactness: 1 for a circle, toward 0 for a thin ribbon.
  const compactness = (4 * Math.PI * areaKm2) / Math.max(1e-9, perimeterKm ** 2);

  return {
    detectionId,
    areaKm2,
    lengthKm,
    widthMMean,
    widthMProfile,
    orientationDeg,
    elongation,
    compactness,
    fragmentation: geom.parts.length,
    head: geom.head,
    tail: geom.tail,
    headTailResolvedBy: opts.headResolved ? "drift_field" : "ambiguous",
    medialAxis: geom.centreline,
    dampingRatioDb: opts.dampingRatioDb,
    dampingConfidence: "low",
    windSpeedMs: opts.windSpeedMs,
    windGateMultiplier: windGate(opts.windSpeedMs),
  };
}

/**
 * Width at a centreline index, measured across the polygon.
 *
 * Derived from the local polygon rather than from the generator's own width
 * array, so the number the UI prints is a measurement of the geometry it draws.
 */
function widthAt(geom: SlickGeometry, i: number): number {
  const c = geom.centreline;
  const prev = c[Math.max(0, i - 1)];
  const next = c[Math.min(c.length - 1, i + 1)];
  const heading = bearingDeg(prev, next);
  const probe = c[i];

  // Walk outward on both sides until leaving every part.
  const reach = (sign: number) => {
    let lo = 0;
    let hi = 6; // km, comfortably wider than any slick this demo generates
    for (let k = 0; k < 18; k++) {
      const mid = (lo + hi) / 2;
      const p = destination(probe, heading + 90 * sign, mid);
      if (inside(p, geom.parts)) lo = mid;
      else hi = mid;
    }
    return lo;
  };

  return (reach(1) + reach(-1)) * 1000;
}

function inside(p: LngLat, parts: LngLat[][]): boolean {
  for (const ring of parts) {
    let hit = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > p[1] !== yj > p[1]) {
        const x = ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
        if (p[0] < x) hit = !hit;
      }
    }
    if (hit) return true;
  }
  return false;
}

/**
 * Wind gate as a continuous multiplier in [0,1] (C9).
 *
 * Below roughly 3 m/s there is not enough Bragg roughness for oil to suppress,
 * so the sea is already dark and a dark patch means little. Above roughly
 * 10 to 12 m/s wind mixes oil down and re-roughens the surface. Both edges are
 * soft and regionally variable, so this ramps rather than cuts, and the raw wind
 * speed travels with it to the evidence card.
 */
export function windGate(ms: number): number {
  const ramp = (v: number, a: number, b: number) =>
    Math.max(0, Math.min(1, (v - a) / (b - a)));
  return ramp(ms, 2.0, 3.6) * (1 - ramp(ms, 9.5, 13.0));
}

/** Slick centroid, used to place the scene and to sample forcing. */
export function slickCentroid(geom: SlickGeometry): LngLat {
  return centroid(geom.centreline);
}

/**
 * Seed positions inside the mask, weighted toward the head.
 *
 * PHASE-04 allows the seed density to be weighted by damping ratio, and this is
 * what that weighting buys. Oil is thickest where it entered the water and
 * thins along the slick as it spreads, so the damping contrast is strongest at
 * the head. Seeding uniformly instead puts the peak of the origin field in the
 * middle of the slick body, and a field whose peak is not near the source
 * cannot pick the source out: every passing track that crosses the body scores
 * higher than the installation the oil is pouring out of.
 *
 * The bias is a power transform on the along-axis coordinate, so the tail is
 * still sampled and still contributes to the older end of the field.
 */
const HEAD_BIAS = 2.4;

export function seedPoints(
  geom: SlickGeometry,
  count: number,
  rng: Rng,
): LngLat[] {
  const pts: LngLat[] = [];
  const c = geom.centreline;
  const spans = c.length - 1;
  let guard = 0;

  while (pts.length < count && guard < count * 40) {
    guard++;
    const along = Math.pow(rng.next(), HEAD_BIAS) * spans;
    const i = Math.min(spans - 1, Math.floor(along));
    const f = along - i;
    const base: LngLat = [
      c[i][0] + (c[i + 1][0] - c[i][0]) * f,
      c[i][1] + (c[i + 1][1] - c[i][1]) * f,
    ];
    const jitterKm = rng.normal() * 0.35;
    const heading = bearingDeg(c[i], c[i + 1]) + 90;
    const p = destination(base, heading, jitterKm);
    if (inside(p, geom.parts)) pts.push(p);
  }

  // A very thin mask can starve the rejection sampler. Falling back to the
  // centreline keeps the particle count honest rather than quietly returning a
  // smaller ensemble than the run reports.
  while (pts.length < count) pts.push(c[pts.length % c.length]);
  return pts;
}

/** Distance in km between two positions, exposed for callers that already imported this module. */
export { distanceKm, kmPerDegLon, KM_PER_DEG_LAT };
