/**
 * A few long, curving arrows instead of a field of short ones.
 *
 * The run's hourly wind and current grids are averaged over the whole window
 * (the user asked for arrows "long and curvy by taking average"), and each
 * arrow is a streamline traced through that mean field: it follows the average
 * direction of the air or the water across the drift area.
 */
import type { FlowGrid, LngLat } from "../../sim/types";

export interface MeanField {
  u: Float64Array;
  v: Float64Array;
}

/** Time-mean (u, v) per node; null when the run carries no such field. */
export function meanField(grid: FlowGrid, kind: "wind" | "current"): MeanField | null {
  const table = kind === "wind" ? grid.wind : grid.current;
  if (!table || !table.length) return null;
  const n = grid.nx * grid.ny;
  const u = new Float64Array(n);
  const v = new Float64Array(n);
  const count = new Float64Array(n);
  for (const row of table) {
    for (let k = 0; k < n; k++) {
      const a = row[2 * k];
      const b = row[2 * k + 1];
      if (a == null || b == null) continue;
      u[k] += a;
      v[k] += b;
      count[k]++;
    }
  }
  for (let k = 0; k < n; k++) {
    u[k] = count[k] ? u[k] / count[k] : Number.NaN;
    v[k] = count[k] ? v[k] / count[k] : Number.NaN;
  }
  return { u, v };
}

/** Bilinear mean flow at a point inside the grid, or null outside it or over land. */
function sample(grid: FlowGrid, f: MeanField, lon: number, lat: number): [number, number] | null {
  const fx = (lon - grid.minLon) / grid.dLon;
  const fy = (lat - grid.minLat) / grid.dLat;
  if (fx < 0 || fy < 0 || fx > grid.nx - 1 || fy > grid.ny - 1) return null;
  const i = Math.min(grid.nx - 2, Math.floor(fx));
  const j = Math.min(grid.ny - 2, Math.floor(fy));
  const tx = fx - i;
  const ty = fy - j;
  const k = (a: number, b: number) => b * grid.nx + a;
  const mix = (arr: Float64Array) =>
    (1 - tx) * (1 - ty) * arr[k(i, j)] + tx * (1 - ty) * arr[k(i + 1, j)] + (1 - tx) * ty * arr[k(i, j + 1)] + tx * ty * arr[k(i + 1, j + 1)];
  const u = mix(f.u);
  const v = mix(f.v);
  return Number.isFinite(u) && Number.isFinite(v) ? [u, v] : null;
}

/** One unit step along the flow direction, `stepDeg` of ground distance (x corrected by cos lat). */
function heading(grid: FlowGrid, f: MeanField, p: LngLat, stepDeg: number): LngLat | null {
  const w = sample(grid, f, p[0], p[1]);
  if (!w) return null;
  const speed = Math.hypot(w[0], w[1]);
  if (speed < 1e-9) return null;
  const cos = Math.cos((p[1] * Math.PI) / 180);
  return [((w[0] / speed) * stepDeg) / cos, (w[1] / speed) * stepDeg];
}

/** A streamline from `start`, midpoint-integrated, `steps` long unless it leaves the grid first. */
export function streamline(grid: FlowGrid, f: MeanField, start: LngLat, stepDeg: number, steps: number): LngLat[] {
  const line: LngLat[] = [start];
  let p = start;
  for (let s = 0; s < steps; s++) {
    const a = heading(grid, f, p, stepDeg);
    if (!a) break;
    const mid: LngLat = [p[0] + a[0] / 2, p[1] + a[1] / 2];
    const b = heading(grid, f, mid, stepDeg);
    if (!b) break;
    const next: LngLat = [p[0] + b[0], p[1] + b[1]];
    if (!sample(grid, f, next[0], next[1])) break;
    line.push(next);
    p = next;
  }
  return line;
}
