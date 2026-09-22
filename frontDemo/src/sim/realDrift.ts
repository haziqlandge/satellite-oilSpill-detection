/**
 * Drift frames from a real OpenDrift run, loaded from static files.
 *
 * Everything else in `sim/` computes its drift in the browser. This does not:
 * it reads what `scripts/export_drift_runs.py` produced by running OpenDrift's
 * OpenOil on this machine, seeded from a real detection centroid and forced by
 * real ERA5 wind. The simulated engine remains for the authored scenarios,
 * which need AIS and a known answer that a real scene cannot supply.
 *
 * WHAT IS REAL IN A REAL RUN, and what is not. The particles, the contours, the
 * spread and the age refusal are OpenDrift's. The AIS traffic, the candidate
 * scores and the release accumulation around them are still simulated, because
 * there is no AIS ingest for these scenes. An interface showing one of these
 * must say which half is which, which is why `forcingNote` and `engine` travel
 * with the data rather than being written into a caption somewhere.
 *
 * NO CURRENTS. CMEMS has no credentials (ISSUES X2), so the ensemble is
 * wind-driven over a zero current field. That is a real limitation and it shows
 * in the results: all three exported scenes report `monotonic` -- the field
 * never stops widening, so there is no convergence minimum and the age is a
 * refusal with a null triple. An earlier note here said the December scene
 * reached `convergence_minimum`; the artifacts on disk (re-exported after the
 * backward coastline fix) do not, and no present artifact supports that claim.
 * A refusal is a result (C1, C3) and is rendered, not hidden.
 */

import { isLand } from "./landmask";
import type { LngLat } from "./types";

export interface RealDriftFrame {
  hour: number;
  /** Flat lon,lat pairs, as the overlay wants them. */
  particles: number[];
  contour50: LngLat[][];
  contour90: LngLat[][];
  area50Km2: number;
  area90Km2: number;
  spreadKm: number;
}

export interface RealDriftRun {
  scene: string;
  acquiredAtIso: string;
  seed: LngLat;
  detectionPolygons: number;
  engine: string;
  forcing: string;
  forcingNote: string;
  members: number;
  particlesPerMember: number;
  particlesRendered: number;
  backwardHours: number;
  forwardHours: number;
  stepMinutes: number;
  memberFailures: string[];
  elapsedSeconds: number;
  /** A triple when the field converged, or a refusal. Nulls, never NaN. */
  age: {
    age_hours?: { low: number | null; best: number | null; high: number | null };
    age_method?: string;
    status?: string;
    explanation?: string;
    method?: string;
    reason?: string;
  };
  convergence: { hour: number; area90Km2: number; spreadKm: number }[];
  frames: RealDriftFrame[];
}

/** Scenes with an exported run, newest first. Filled by `loadManifest`. */
export type RealDriftListing = { scene: string; label: string };

const cache = new Map<string, RealDriftRun>();

/**
 * A short human label for a Sentinel-1 scene id.
 *
 * The raw name is 67 characters of orbit and product codes, which is the right
 * thing to keep as an identity and the wrong thing to put in a picker.
 */
export function sceneLabel(scene: string): string {
  const match = /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(scene);
  if (!match) return scene.slice(0, 24);
  const [, y, mo, d, h, mi] = match;
  return `Sentinel-1 ${y}-${mo}-${d} ${h}:${mi}Z`;
}

/**
 * Load one exported run.
 *
 * Throws with the scene named rather than returning null: a missing artifact is
 * a build problem, not a state the interface should paper over with an empty
 * map.
 */
export async function loadRealDrift(scene: string): Promise<RealDriftRun> {
  const hit = cache.get(scene);
  if (hit) return hit;
  const response = await fetch(`runs/${scene}/drift.json`);
  if (!response.ok) {
    throw new Error(`No exported drift for ${scene} (${response.status}). Run scripts/export_drift_runs.py.`);
  }
  const run = (await response.json()) as RealDriftRun;
  if (!Array.isArray(run.frames) || run.frames.length === 0) {
    throw new Error(`Exported drift for ${scene} has no frames.`);
  }
  cache.set(scene, run);
  return run;
}

/**
 * The frames as the particle overlay consumes them, exactly as OpenDrift left them.
 *
 * This used to walk every parcel the frontend mask called land to the nearest
 * water cell, because OpenDrift tested against GSHHG and the frontend against
 * basemap pixel colour, and the two disagreed at the shore. They no longer
 * disagree: the frontend mask IS GSHHG, rasterised (`sim/landmask.ts`).
 *
 * What remains is rounding. `coastline_action="previous"` parks a backward
 * parcel at its last water position, hard against the shore, and a parcel
 * fifty metres offshore can sit in a 1/240 degree cell whose centre is on land.
 * Measured on the three exported scenes, the raster calls 19.0%, 40.0% and
 * 25.6% of parcels ashore where OpenDrift itself calls 0.10%, 0.26% and 0.14%,
 * and 98-99.99% of the difference is within one cell of water. Nudging those
 * would move a real position to correct a rounding of the same coastline, so
 * OpenDrift, which holds the polygons, is taken at its word.
 */
export function overlayFrames(
  run: RealDriftRun,
): { frames: { hour: number; particles: Float64Array }[] } {
  return {
    frames: run.frames.map((frame) => ({
      hour: frame.hour,
      particles: Float64Array.from(frame.particles),
    })),
  };
}

/**
 * Whether a point is land by more than the raster's own rounding: land, with
 * no water in any of the eight neighbouring cells. This is the test for a real
 * disagreement with OpenDrift rather than a parcel parked against the shore.
 */
export function deepAshore(lon: number, lat: number): boolean {
  if (!isLand(lon, lat)) return false;
  const cell = 1 / 240;
  for (const dx of [-cell, 0, cell]) {
    for (const dy of [-cell, 0, cell]) {
      if ((dx || dy) && !isLand(lon + dx, lat + dy)) return false;
    }
  }
  return true;
}

/**
 * How the age reads, in one line, including when it is a refusal.
 *
 * C1 keeps an age a triple with a method even when there is no value to put in
 * it, so the refusal has to be rendered rather than skipped. "Indeterminate" on
 * screen with the reason beside it is a result; a blank field is a bug.
 */
export function ageStatement(run: RealDriftRun): string {
  const triple = run.age.age_hours;
  const usable =
    triple &&
    triple.low !== null &&
    triple.best !== null &&
    triple.high !== null &&
    Number.isFinite(triple.best);
  if (usable) {
    return `${triple!.low!.toFixed(1)} / ${triple!.best!.toFixed(1)} / ${triple!.high!.toFixed(1)} h (${run.age.age_method ?? "convergence"})`;
  }
  const why = run.age.explanation ?? run.age.reason ?? run.age.status ?? "no convergence minimum";
  return `indeterminate — ${why}`;
}
