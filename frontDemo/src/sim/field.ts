/**
 * Analytic met-ocean forcing and probability-field extraction.
 *
 * The real system reads CMEMS currents and ERA5 wind from a NetCDF cache
 * (PHASE-04). This module substitutes a smooth analytic field with the same
 * qualitative structure: a mean flow, a tidal oscillation, and a mesoscale
 * eddy. Trajectories then curve, ensemble members separate, and the origin field
 * converges or diffuses for a physical reason rather than because a curve was
 * drawn to look convincing.
 *
 * Convergence is the property that matters. Where the flow has negative
 * divergence a backward-run cloud contracts, and that contraction is what the
 * age estimate keys on.
 */

import { KM_PER_DEG_LAT, kmPerDegLon } from "./geo";
import type { LngLat } from "./types";

export interface FieldConfig {
  /** Mean current, m/s, eastward and northward. */
  meanU: number;
  meanV: number;
  /** Mesoscale eddy centre and strength. */
  eddy: { centre: LngLat; radiusKm: number; strengthMs: number };
  /** Convergence cell. Negative divergence pulls a backward cloud together. */
  convergence: { centre: LngLat; radiusKm: number; strengthMs: number };
  /** Semidiurnal tidal ellipse, m/s. */
  tideMs: number;
  tidePhaseHours: number;
  /** 10 m wind, m/s, with a slow veer over the window. */
  windMs: number;
  windDirDeg: number;
  windRotateDegPerHour: number;
}

export interface Forcing {
  /** Surface current, m/s, in local east and north components. */
  current(p: LngLat, hour: number): [number, number];
  /** 10 m wind, m/s, in local east and north components. */
  wind(p: LngLat, hour: number): [number, number];
  speedAt(p: LngLat, hour: number): number;
}

export function makeForcing(cfg: FieldConfig): Forcing {
  const kmOffset = (a: LngLat, b: LngLat): [number, number] => [
    (a[0] - b[0]) * kmPerDegLon(b[1]),
    (a[1] - b[1]) * KM_PER_DEG_LAT,
  ];

  const current = (p: LngLat, hour: number): [number, number] => {
    let u = cfg.meanU;
    let v = cfg.meanV;

    // Rotational eddy: tangential velocity decaying with radius.
    {
      const [dx, dy] = kmOffset(p, cfg.eddy.centre);
      const r = Math.hypot(dx, dy);
      const g = Math.exp(-((r / cfg.eddy.radiusKm) ** 2));
      if (r > 1e-6) {
        u += (-dy / r) * cfg.eddy.strengthMs * g;
        v += (dx / r) * cfg.eddy.strengthMs * g;
      }
    }

    // Convergence cell: radial inflow. Its sign is what makes a backward cloud
    // spread on the way out and contract as it nears the release point.
    {
      const [dx, dy] = kmOffset(p, cfg.convergence.centre);
      const r = Math.hypot(dx, dy);
      const g = Math.exp(-((r / cfg.convergence.radiusKm) ** 2));
      if (r > 1e-6) {
        u += (-dx / r) * cfg.convergence.strengthMs * g;
        v += (-dy / r) * cfg.convergence.strengthMs * g;
      }
    }

    // Semidiurnal tide, 12.42 h.
    const w = ((hour + cfg.tidePhaseHours) / 12.42) * 2 * Math.PI;
    u += cfg.tideMs * Math.cos(w);
    v += cfg.tideMs * 0.55 * Math.sin(w);

    return [u, v];
  };

  const wind = (_p: LngLat, hour: number): [number, number] => {
    const dir =
      (cfg.windDirDeg + cfg.windRotateDegPerHour * hour) * (Math.PI / 180);
    // Meteorological convention: the direction the wind blows from.
    return [-cfg.windMs * Math.sin(dir), -cfg.windMs * Math.cos(dir)];
  };

  return {
    current,
    wind,
    speedAt: (p, hour) => {
      const [u, v] = current(p, hour);
      return Math.hypot(u, v);
    },
  };
}

/* ------------------------------------------------------------------ *
 * Particle density to probability contours
 * ------------------------------------------------------------------ */

export interface DensityGrid {
  values: Float64Array;
  nx: number;
  ny: number;
  minLon: number;
  minLat: number;
  dLon: number;
  dLat: number;
  /**
   * Ground area of one cell, square kilometres.
   *
   * Each frame sizes its own grid to its own cloud, so a raw cell count is not
   * comparable between frames: a spread cloud gets larger cells and therefore
   * more particles in each one, which would make it look denser than the tight
   * cloud it came from. Dividing through by this turns counts into a density
   * that means the same thing at every timestep.
   */
  cellAreaKm2: number;
}

/**
 * Rasterise particles onto a grid and smooth.
 *
 * Three box-blur passes approximate a Gaussian closely enough and are linear in
 * cell count rather than kernel area, which matters because this runs once per
 * timestep for every scenario.
 */
export function densityGrid(
  particles: Float64Array,
  n: number,
  nx = 128,
  ny = 128,
  padRatio = 0.28,
): DensityGrid {
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (let i = 0; i < n; i++) {
    const lon = particles[i * 2];
    const lat = particles[i * 2 + 1];
    if (lon < minLon) minLon = lon;
    if (lon > maxLon) maxLon = lon;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  }
  const padLon = Math.max((maxLon - minLon) * padRatio, 0.01);
  const padLat = Math.max((maxLat - minLat) * padRatio, 0.01);
  minLon -= padLon;
  maxLon += padLon;
  minLat -= padLat;
  maxLat += padLat;

  const dLon = (maxLon - minLon) / (nx - 1);
  const dLat = (maxLat - minLat) / (ny - 1);
  const values = new Float64Array(nx * ny);

  for (let i = 0; i < n; i++) {
    const gx = (particles[i * 2] - minLon) / dLon;
    const gy = (particles[i * 2 + 1] - minLat) / dLat;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= nx || y0 + 1 >= ny) continue;
    const fx = gx - x0;
    const fy = gy - y0;
    values[y0 * nx + x0] += (1 - fx) * (1 - fy);
    values[y0 * nx + x0 + 1] += fx * (1 - fy);
    values[(y0 + 1) * nx + x0] += (1 - fx) * fy;
    values[(y0 + 1) * nx + x0 + 1] += fx * fy;
  }

  boxBlur(values, nx, ny, 3);
  boxBlur(values, nx, ny, 3);
  boxBlur(values, nx, ny, 2);

  const midLat = minLat + ((ny - 1) * dLat) / 2;
  const cellAreaKm2 = dLon * kmPerDegLon(midLat) * dLat * KM_PER_DEG_LAT;

  return { values, nx, ny, minLon, minLat, dLon, dLat, cellAreaKm2 };
}

/**
 * Rasterise onto a grid whose cell size is dictated rather than derived.
 *
 * Comparing density between timesteps requires the same cell size at every
 * timestep. When each frame sizes its own grid, a spreading cloud gets larger
 * cells and a fixed number of blur passes then covers more ground, so the peak
 * density falls for a reason that has nothing to do with the oil. A slick then
 * appears to shrink while it is still growing.
 */
export function densityGridOn(
  particles: Float64Array,
  n: number,
  spec: { minLon: number; minLat: number; dLon: number; dLat: number; nx: number; ny: number },
): DensityGrid {
  const { minLon, minLat, dLon, dLat, nx, ny } = spec;
  const values = new Float64Array(nx * ny);

  for (let i = 0; i < n; i++) {
    const gx = (particles[i * 2] - minLon) / dLon;
    const gy = (particles[i * 2 + 1] - minLat) / dLat;
    const x0 = Math.floor(gx);
    const y0 = Math.floor(gy);
    if (x0 < 0 || y0 < 0 || x0 + 1 >= nx || y0 + 1 >= ny) continue;
    const fx = gx - x0;
    const fy = gy - y0;
    values[y0 * nx + x0] += (1 - fx) * (1 - fy);
    values[y0 * nx + x0 + 1] += fx * (1 - fy);
    values[(y0 + 1) * nx + x0] += (1 - fx) * fy;
    values[(y0 + 1) * nx + x0 + 1] += fx * fy;
  }

  boxBlur(values, nx, ny, 2);
  boxBlur(values, nx, ny, 2);

  const midLat = minLat + ((ny - 1) * dLat) / 2;
  const cellAreaKm2 = dLon * kmPerDegLon(midLat) * dLat * KM_PER_DEG_LAT;

  return { values, nx, ny, minLon, minLat, dLon, dLat, cellAreaKm2 };
}

function boxBlur(v: Float64Array, nx: number, ny: number, r: number) {
  const tmp = new Float64Array(v.length);
  const w = 2 * r + 1;
  for (let y = 0; y < ny; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += v[y * nx + clamp(x, 0, nx - 1)];
    for (let x = 0; x < nx; x++) {
      tmp[y * nx + x] = acc / w;
      acc -= v[y * nx + clamp(x - r, 0, nx - 1)];
      acc += v[y * nx + clamp(x + r + 1, 0, nx - 1)];
    }
  }
  for (let x = 0; x < nx; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[clamp(y, 0, ny - 1) * nx + x];
    for (let y = 0; y < ny; y++) {
      v[y * nx + x] = acc / w;
      acc -= tmp[clamp(y - r, 0, ny - 1) * nx + x];
      acc += tmp[clamp(y + r + 1, 0, ny - 1) * nx + x];
    }
  }
}

function clamp(v: number, lo: number, hi: number) {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Density-to-mass lookup for one timestep.
 *
 * A probability field is only useful if you can say what fraction of the total
 * probability lies at or above a given density. That single table answers both
 * questions the interface asks of the field:
 *
 *  - where to draw the 50% and 90% contours (mass to level)
 *  - which credible region a candidate falls inside (level to mass)
 *
 * Storing 256 quantiles rather than the whole sorted grid keeps a five-scenario
 * cache in kilobytes instead of tens of megabytes, and the interpolation error
 * is far below anything the interface prints.
 */
export interface MassTable {
  /** Descending density thresholds, particles per square kilometre. */
  levels: Float64Array;
  /** Fraction of total mass at or above the matching level. */
  mass: Float64Array;
  peak: number;
}

const TABLE_STEPS = 256;

export function massTable(grid: DensityGrid): MassTable {
  const sorted = Array.from(grid.values).sort((a, b) => b - a);
  const total = sorted.reduce((s, v) => s + v, 0);
  const levels = new Float64Array(TABLE_STEPS);
  const mass = new Float64Array(TABLE_STEPS);

  if (total <= 0) {
    return { levels, mass, peak: 0 };
  }

  let acc = 0;
  let next = 0;
  const stride = sorted.length / TABLE_STEPS;

  for (let i = 0; i < sorted.length; i++) {
    acc += sorted[i];
    if (i >= next * stride && next < TABLE_STEPS) {
      levels[next] = sorted[i] / grid.cellAreaKm2;
      mass[next] = acc / total;
      next++;
    }
  }
  for (let i = next; i < TABLE_STEPS; i++) {
    levels[i] = 0;
    mass[i] = 1;
  }

  return { levels, mass, peak: sorted[0] / grid.cellAreaKm2 };
}

/** The density level enclosing the requested fraction of the total mass. */
export function levelForMass(table: MassTable, wanted: number): number {
  for (let i = 0; i < table.mass.length; i++) {
    if (table.mass[i] >= wanted) return table.levels[i];
  }
  return table.levels[table.levels.length - 1];
}

/**
 * The smallest credible region containing a given density, as a mass fraction.
 *
 * A point at the mode returns close to 0; a point out in the skirt returns
 * close to 1. Subtracting it from one gives the number the scorer wants: how
 * central this position is in the field, independent of how wide the field is.
 */
export function massForLevel(table: MassTable, density: number): number {
  if (density <= 0) return 1;
  for (let i = 0; i < table.levels.length; i++) {
    if (table.levels[i] <= density) return table.mass[i];
  }
  return 1;
}

/**
 * Marching squares with linear interpolation, returning closed rings.
 *
 * Segments are emitted per cell and stitched by endpoint proximity. Not the
 * fastest formulation, but the grids are 128 squared and this runs at scenario
 * build time, not per frame.
 */
export function contour(grid: DensityGrid, level: number): LngLat[][] {
  const { values, nx, ny, minLon, minLat, dLon, dLat } = grid;
  const segments: [LngLat, LngLat][] = [];

  // `level` arrives as a density; the grid holds raw per-cell weights. Comparing
  // the two directly silently produces no crossings at all.
  const raw = level * grid.cellAreaKm2;

  const at = (x: number, y: number) => values[y * nx + x];
  const pos = (x: number, y: number): LngLat => [
    minLon + x * dLon,
    minLat + y * dLat,
  ];
  const lerp = (a: LngLat, b: LngLat, va: number, vb: number): LngLat => {
    const t = Math.abs(vb - va) < 1e-12 ? 0.5 : (raw - va) / (vb - va);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };

  for (let y = 0; y < ny - 1; y++) {
    for (let x = 0; x < nx - 1; x++) {
      const v0 = at(x, y);
      const v1 = at(x + 1, y);
      const v2 = at(x + 1, y + 1);
      const v3 = at(x, y + 1);
      const idx =
        (v0 > raw ? 1 : 0) |
        (v1 > raw ? 2 : 0) |
        (v2 > raw ? 4 : 0) |
        (v3 > raw ? 8 : 0);
      if (idx === 0 || idx === 15) continue;

      const p0 = pos(x, y);
      const p1 = pos(x + 1, y);
      const p2 = pos(x + 1, y + 1);
      const p3 = pos(x, y + 1);
      const bottom = () => lerp(p0, p1, v0, v1);
      const right = () => lerp(p1, p2, v1, v2);
      const top = () => lerp(p3, p2, v3, v2);
      const left = () => lerp(p0, p3, v0, v3);

      switch (idx) {
        case 1:
        case 14:
          segments.push([left(), bottom()]);
          break;
        case 2:
        case 13:
          segments.push([bottom(), right()]);
          break;
        case 3:
        case 12:
          segments.push([left(), right()]);
          break;
        case 4:
        case 11:
          segments.push([right(), top()]);
          break;
        case 6:
        case 9:
          segments.push([bottom(), top()]);
          break;
        case 7:
        case 8:
          segments.push([left(), top()]);
          break;
        case 5:
          segments.push([left(), top()]);
          segments.push([bottom(), right()]);
          break;
        case 10:
          segments.push([left(), bottom()]);
          segments.push([right(), top()]);
          break;
      }
    }
  }

  // Shared edges are interpolated from identical corner values, so matching
  // endpoints are bit-identical. The tolerance only absorbs rounding; anything
  // looser lets the walk hop onto a neighbouring contour and never close.
  return stitch(segments, Math.max(dLon, dLat) * 1e-6);
}

/**
 * Join marching-squares segments into closed rings.
 *
 * The walk grows in both directions from a starting segment. Growing only
 * forward splits any contour whose first segment happens to sit mid-ring into
 * two open halves, and closing those halves produces a large spurious polygon
 * whose area is meaningless. Since the area of the 90% ring is the number C3
 * tests against, a spurious ring is not a cosmetic problem.
 */
function stitch(segments: [LngLat, LngLat][], tol: number): LngLat[][] {
  const rings: LngLat[][] = [];
  const used = new Array(segments.length).fill(false);
  const near = (a: LngLat, b: LngLat) =>
    Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol;

  const findFrom = (point: LngLat): { index: number; other: LngLat } | null => {
    for (let j = 0; j < segments.length; j++) {
      if (used[j]) continue;
      if (near(segments[j][0], point)) return { index: j, other: segments[j][1] };
      if (near(segments[j][1], point)) return { index: j, other: segments[j][0] };
    }
    return null;
  };

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const chain: LngLat[] = [segments[i][0], segments[i][1]];

    // Forward, then backward from the original start.
    for (;;) {
      const next = findFrom(chain[chain.length - 1]);
      if (!next) break;
      used[next.index] = true;
      chain.push(next.other);
    }
    for (;;) {
      const prev = findFrom(chain[0]);
      if (!prev) break;
      used[prev.index] = true;
      chain.unshift(prev.other);
    }

    // Only a closed loop is a probability contour. An open chain means the
    // density ran off the edge of the grid, and closing it would invent area.
    if (chain.length >= 5 && near(chain[0], chain[chain.length - 1])) {
      chain[chain.length - 1] = chain[0];
      rings.push(chain);
    }
  }

  return rings;
}

/** Bilinear sample of the field, in particles per square kilometre. */
export function sampleDensity(grid: DensityGrid, p: LngLat): number {
  const gx = (p[0] - grid.minLon) / grid.dLon;
  const gy = (p[1] - grid.minLat) / grid.dLat;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  if (x0 < 0 || y0 < 0 || x0 + 1 >= grid.nx || y0 + 1 >= grid.ny) return 0;
  const fx = gx - x0;
  const fy = gy - y0;
  const v =
    grid.values[y0 * grid.nx + x0] * (1 - fx) * (1 - fy) +
    grid.values[y0 * grid.nx + x0 + 1] * fx * (1 - fy) +
    grid.values[(y0 + 1) * grid.nx + x0] * (1 - fx) * fy +
    grid.values[(y0 + 1) * grid.nx + x0 + 1] * fx * fy;
  return v / grid.cellAreaKm2;
}
