/**
 * Wind, current and the drift's own motion around an event: what the map's
 * arrows and the flow cards show.
 *
 * One grid per run (`FlowGrid`), sampled once: from the analytic `Forcing` for
 * an authored run (`sampleFlowGrid`, labelled SIM), and from ERA5 and CMEMS for
 * a real one (`backend/drift/flow.py`, written into `scene.json`). The map reads
 * it only on and around the event -- the slick, the hindcast and the forecast
 * (`map/FlowStreaks.ts`), never across the whole view.
 *
 * A value the grid does not have (outside its hours or box, or a current node on
 * land) is null and draws no arrow. Nothing is extrapolated.
 */

import { makeForcing, type Forcing } from "./field";
import { KM_PER_DEG_LAT, kmPerDegLon } from "./geo";
import type { Detection, DriftFrame, FlowGrid, LngLat } from "./types";

export type Bbox = [west: number, south: number, east: number, north: number];

/** Nodes per side of a run's grid. 10 x 10 over the event is finer than any arrow spacing drawn from it. */
const GRID_NODES = 10;

/**
 * The spill itself: a real scene's detection holds every polygon in a 250 km
 * scene, and only its seed is the slick the run is about.
 */
export function spillParts(detection: Detection): LngLat[][] {
  const kinds = detection.partKinds;
  return kinds ? detection.parts.filter((_, i) => kinds[i] === "seed") : detection.parts;
}

/** The box the given rings fall in, padded by a share of its size (at least ~2 km). */
export function ringsBbox(rings: LngLat[][], padRatio = 0.15): Bbox {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (x < west) west = x;
      if (x > east) east = x;
      if (y < south) south = y;
      if (y > north) north = y;
    }
  }
  const padLon = Math.max((east - west) * padRatio, 0.02);
  const padLat = Math.max((north - south) * padRatio, 0.02);
  return [west - padLon, south - padLat, east + padLon, north + padLat];
}

/** An authored run's analytic forcing on a grid over `bbox`, at every hour it plays. */
export function sampleFlowGrid(forcing: Forcing, bbox: Bbox, hours: number[]): FlowGrid {
  const [west, south, east, north] = bbox;
  const nx = GRID_NODES;
  const ny = GRID_NODES;
  const dLon = (east - west) / (nx - 1);
  const dLat = (north - south) / (ny - 1);
  const round = (v: number) => Math.round(v * 1000) / 1000;
  const table = (field: (p: LngLat, hour: number) => [number, number]) =>
    hours.map((hour) => {
      const row: number[] = [];
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const [u, v] = field([west + i * dLon, south + j * dLat], hour);
          row.push(round(u), round(v));
        }
      }
      return row;
    });
  return {
    minLon: west, minLat: south, dLon, dLat, nx, ny, hours,
    wind: table(forcing.wind),
    current: table(forcing.current),
    windSource: "SIM analytic",
    currentSource: "SIM analytic",
  };
}

/**
 * A plain field for a place with no measured one: a weak mean set, the
 * semidiurnal tide and a steady breeze. Only ever shown labelled SIM.
 */
function simulatedForcing(centre: LngLat): Forcing {
  return makeForcing({
    meanU: 0.06,
    meanV: 0.02,
    eddy: { centre, radiusKm: 1, strengthMs: 0 },
    convergence: { centre, radiusKm: 1, strengthMs: 0 },
    tideMs: 0.12,
    tidePhaseHours: 0,
    windMs: 6,
    windDirDeg: 90,
    windRotateDegPerHour: 0.5,
  });
}

/** Whether a source string names a simulated value (the cards tag these SIM). */
export const isSimulated = (source: string | null | undefined) => !source || source.startsWith("SIM");

/**
 * A real run's grid with whatever it lacks simulated and labelled so: the
 * current of a wind-only run, or the whole grid of a run exported before the
 * grid existed. What a real run measured is never replaced. Display only: the
 * drift already ran on what the run had.
 */
export function completeFlow(flow: FlowGrid | undefined, rings: LngLat[][], hours: number[], centre: LngLat): FlowGrid {
  if (flow?.current) return flow;
  const forcing = simulatedForcing(centre);
  if (!flow) {
    return { ...sampleFlowGrid(forcing, ringsBbox(rings), hours), windSource: "SIM (no wind data)", currentSource: "SIM (no current data)" };
  }
  const current = flow.hours.map((hour) => {
    const row: number[] = [];
    for (let j = 0; j < flow.ny; j++) {
      for (let i = 0; i < flow.nx; i++) {
        const [u, v] = forcing.current([flow.minLon + i * flow.dLon, flow.minLat + j * flow.dLat], hour);
        row.push(Math.round(u * 1000) / 1000, Math.round(v * 1000) / 1000);
      }
    }
    return row;
  });
  return { ...flow, current, currentSource: "SIM (no current data)" };
}

/** Bilinear in space; null outside the grid or where a corner has no value (land). */
function atNodes(grid: FlowGrid, row: (number | null)[], p: LngLat): [number, number] | null {
  const gx = (p[0] - grid.minLon) / grid.dLon;
  const gy = (p[1] - grid.minLat) / grid.dLat;
  if (!(gx >= 0 && gy >= 0 && gx <= grid.nx - 1 && gy <= grid.ny - 1)) return null;
  const x0 = Math.min(grid.nx - 2, Math.floor(gx));
  const y0 = Math.min(grid.ny - 2, Math.floor(gy));
  const fx = gx - x0;
  const fy = gy - y0;
  const out: [number, number] = [0, 0];
  for (const [dx, dy, w] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) {
    const k = ((y0 + dy) * grid.nx + (x0 + dx)) * 2;
    const u = row[k];
    const v = row[k + 1];
    if (u === null || v === null || u === undefined || v === undefined || !Number.isFinite(u) || !Number.isFinite(v)) return null;
    out[0] += u * w;
    out[1] += v * w;
  }
  return out;
}

/** Wind or current at `p` and `hour` (east, north, m/s): bilinear in space, linear in time; null where there is none. */
export function flowAt(grid: FlowGrid, kind: "wind" | "current", p: LngLat, hour: number): [number, number] | null {
  const table = kind === "wind" ? grid.wind : grid.current;
  const hours = grid.hours;
  if (!table || !hours.length || hour < hours[0] || hour > hours[hours.length - 1]) return null;
  let k = 0;
  while (k + 1 < hours.length && hours[k + 1] <= hour) k++;
  const a = atNodes(grid, table[k], p);
  if (k + 1 >= hours.length || hours[k] === hour) return a;
  const b = atNodes(grid, table[k + 1], p);
  if (!a || !b) return null;
  const t = (hour - hours[k]) / (hours[k + 1] - hours[k]);
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** Speed and the bearing the vector points toward, degrees true. */
export function speedToward([u, v]: [number, number]): { speed: number; towardDeg: number } {
  return { speed: Math.hypot(u, v), towardDeg: (((Math.atan2(u, v) * 180) / Math.PI) % 360 + 360) % 360 };
}

/** The mean wind or current over `bbox` at `hour`, from a 4 x 4 sample of it; null where none of it has a value. */
export function flowMean(grid: FlowGrid, kind: "wind" | "current", bbox: Bbox, hour: number): [number, number] | null {
  const [west, south, east, north] = bbox;
  let u = 0;
  let v = 0;
  let n = 0;
  for (let j = 0; j < 4; j++) {
    for (let i = 0; i < 4; i++) {
      const value = flowAt(grid, kind, [west + ((i + 0.5) / 4) * (east - west), south + ((j + 0.5) / 4) * (north - south)], hour);
      if (!value) continue;
      u += value[0];
      v += value[1];
      n++;
    }
  }
  return n ? [u / n, v / n] : null;
}

/** Centroid of a frame's finite particles, or null when none is afloat. */
function cloudCentre(frame: DriftFrame): LngLat | null {
  let x = 0;
  let y = 0;
  let n = 0;
  for (let k = 0; k + 1 < frame.particles.length; k += 2) {
    const lon = frame.particles[k];
    const lat = frame.particles[k + 1];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    x += lon;
    y += lat;
    n++;
  }
  return n ? [x / n, y / n] : null;
}

/** How fast the ensemble's centre moves at `hour`, forward in time: km/h and the bearing it moves toward. */
export function driftMotion(frames: DriftFrame[], hour: number): { kmh: number; towardDeg: number } | null {
  let i = 0;
  while (i + 2 < frames.length && frames[i + 1].hour <= hour) i++;
  const a = frames[i];
  const b = frames[i + 1];
  if (!a || !b || b.hour === a.hour) return null;
  const from = cloudCentre(a);
  const to = cloudCentre(b);
  if (!from || !to) return null;
  const east = (to[0] - from[0]) * kmPerDegLon((from[1] + to[1]) / 2);
  const north = (to[1] - from[1]) * KM_PER_DEG_LAT;
  const { speed, towardDeg } = speedToward([east, north]);
  return { kmh: speed / (b.hour - a.hour), towardDeg };
}
