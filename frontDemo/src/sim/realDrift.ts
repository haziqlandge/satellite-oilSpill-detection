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
 * in the results, which are not uniform: of the three exported scenes two
 * report `monotonic` -- the field never stops widening, so there is no
 * convergence minimum and the age is a refusal -- and the December scene
 * reaches `convergence_minimum` and returns an actual age triple. That is the
 * first age this project has produced that is a number rather than a refusal,
 * and it took genuine time-varying wind to get it. Both outcomes are carried
 * through as they come; a refusal is a result (C1, C3) and is rendered, not
 * hidden.
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
 * The frames as the particle overlay consumes them, nudged clear of the shore.
 *
 * OpenDrift holds a backward parcel at its last water position when it reaches
 * the coast -- `coastline_action="previous"`, which is the honest statement
 * that the parcel came from at least there and no further. But OpenDrift's
 * coastline is GSHHS and this project's is a 0.005 degree raster sampled from
 * the basemap, and two coastlines never agree to the metre. A parcel parked
 * exactly on the shore therefore lands on the land side of one mask and the
 * water side of the other, and the map draws oil on a beach.
 *
 * Measured across the three exported scenes, that was 10.3%, 10.5% and 33.3%
 * of rendered parcels. So each one is walked to the nearest water cell inside a
 * short radius, and the count is returned rather than hidden: this is a
 * rendering correction for a disagreement between two masks, not a claim that
 * the physics put the parcel there. A parcel with no water within the radius is
 * dropped, because moving it further would be inventing a position.
 */
export function overlayFrames(
  run: RealDriftRun,
): { frames: { hour: number; particles: Float64Array }[]; nudged: number; dropped: number } {
  // Eight cells, about 4.5 km: enough to cross a disagreement between two
  // coastlines, far too short to relocate a parcel that is genuinely inland.
  const CELL = 0.005;
  const RINGS = 8;
  let nudged = 0;
  let dropped = 0;

  const toWater = (lon: number, lat: number): LngLat | null => {
    if (!isLand(lon, lat)) return [lon, lat];
    for (let ring = 1; ring <= RINGS; ring++) {
      for (let step = 0; step < 16; step++) {
        const angle = (step / 16) * 2 * Math.PI;
        const candidate: LngLat = [
          lon + Math.cos(angle) * ring * CELL,
          lat + Math.sin(angle) * ring * CELL,
        ];
        if (!isLand(candidate[0], candidate[1])) {
          nudged++;
          return candidate;
        }
      }
    }
    dropped++;
    return null;
  };

  const frames = run.frames.map((frame) => {
    const out: number[] = [];
    for (let i = 0; i < frame.particles.length; i += 2) {
      const moved = toWater(frame.particles[i], frame.particles[i + 1]);
      if (moved) {
        out.push(moved[0]);
        out.push(moved[1]);
      }
    }
    return { hour: frame.hour, particles: Float64Array.from(out) };
  });
  return { frames, nudged, dropped };
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
