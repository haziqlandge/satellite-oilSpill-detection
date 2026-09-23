/**
 * Spherical geodesy, kept to the few operations the simulation needs.
 *
 * Areas are computed on a local equal-area tangent plane rather than in degrees,
 * for the same reason PHASE-03 requires it of the real characteriser: a square
 * degree is not a constant area, and every geometry figure the UI prints would
 * be wrong by the cosine of the latitude.
 */

import type { LngLat } from "./types";

const R_EARTH_KM = 6371.0088;
const DEG = Math.PI / 180;

export function toRad(d: number): number {
  return d * DEG;
}

export function toDeg(r: number): number {
  return r / DEG;
}

/** Kilometres per degree of longitude at a given latitude. */
export function kmPerDegLon(lat: number): number {
  return 111.32 * Math.cos(toRad(lat));
}

export const KM_PER_DEG_LAT = 110.574;

/** Great-circle distance, km. */
export function distanceKm(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLon = toRad(a[0] - b[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial bearing from a to b, degrees clockwise from north. */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLon = toRad(b[0] - a[0]);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Point at distance and bearing from an origin. */
export function destination(
  origin: LngLat,
  bearing: number,
  distKm: number,
): LngLat {
  const d = distKm / R_EARTH_KM;
  const br = toRad(bearing);
  const lat1 = toRad(origin[1]);
  const lon1 = toRad(origin[0]);
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(br) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  return [toDeg(lon2), toDeg(lat2)];
}

/** Offset in metres, applied on the local tangent plane. Cheap and adequate at slick scale. */
export function offsetM(p: LngLat, eastM: number, northM: number): LngLat {
  return [
    p[0] + eastM / 1000 / kmPerDegLon(p[1]),
    p[1] + northM / 1000 / KM_PER_DEG_LAT,
  ];
}

/** Shoelace area on a local equal-area plane centred on the ring, km squared. */
export function ringAreaKm2(ring: LngLat[]): number {
  if (ring.length < 3) return 0;
  const lat0 = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const kx = kmPerDegLon(lat0);
  const ky = KM_PER_DEG_LAT;
  let acc = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0] * kx;
    const yi = ring[i][1] * ky;
    const xj = ring[j][0] * kx;
    const yj = ring[j][1] * ky;
    acc += xj * yi - xi * yj;
  }
  return Math.abs(acc) / 2;
}

/** Ring perimeter, km. */
export function ringPerimeterKm(ring: LngLat[]): number {
  let acc = 0;
  for (let i = 1; i < ring.length; i++) acc += distanceKm(ring[i - 1], ring[i]);
  if (ring.length > 2) acc += distanceKm(ring[ring.length - 1], ring[0]);
  return acc;
}

/** Total length of an open polyline, km. */
export function pathLengthKm(path: LngLat[]): number {
  let acc = 0;
  for (let i = 1; i < path.length; i++) acc += distanceKm(path[i - 1], path[i]);
  return acc;
}

export function pointInRing(p: LngLat, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1]) {
      const x = ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi;
      if (p[0] < x) inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygon(p: LngLat, parts: LngLat[][]): boolean {
  return parts.some((ring) => pointInRing(p, ring));
}

/**
 * Group a flat list of rings into polygons by nesting: a ring inside an odd
 * number of others is a hole in the smallest one around it.
 *
 * Contour lists are flat -- `contour90` is `LngLat[][]` -- and a region can
 * have holes. Drawn one filled polygon per ring, a hole is painted as a second
 * layer of the region instead of as a gap in it. Each ring is tested at the
 * middle of its first edge, which no other ring can pass through: iso-lines do
 * not cross, and a dissolved cell outline shares no edge with another ring.
 */
export function polygonsOf(rings: LngLat[][]): LngLat[][][] {
  const probe = rings.map((r): LngLat => [(r[0][0] + r[1][0]) / 2, (r[0][1] + r[1][1]) / 2]);
  const area = rings.map(ringAreaKm2);
  const parent = rings.map((_, i) => {
    let depth = 0;
    let best = -1;
    for (let j = 0; j < rings.length; j++) {
      if (j === i || !pointInRing(probe[i], rings[j])) continue;
      depth++;
      if (best < 0 || area[j] < area[best]) best = j;
    }
    return depth % 2 === 1 ? best : -1;
  });
  const polygons = new Map<number, LngLat[][]>();
  rings.forEach((ring, i) => { if (parent[i] < 0) polygons.set(i, [ring]); });
  rings.forEach((ring, i) => { if (parent[i] >= 0) polygons.get(parent[i])?.push(ring); });
  return [...polygons.values()];
}

/**
 * Merge equal grid-cell boxes into the outline of their union.
 *
 * The real drift export writes a credible region as one box per 0.01° cell, on
 * purpose: a smoothed iso-line would claim more precision than the grid holds
 * (`contour_geojson` in `backend/drift/origin_field.py`). Drawn box by box,
 * every cell gets its own outline and the region reads as a grid. This keeps
 * exactly the same cells -- the outline still steps at the grid -- and draws
 * only where the region ends. Outer rings run anticlockwise and holes
 * clockwise; cells touching only at a corner stay separate rings, as they are
 * separate regions.
 */
export function dissolveCells(boxes: LngLat[][]): LngLat[][] {
  if (boxes.length === 0) return [];
  const step = Math.abs(boxes[0][1][0] - boxes[0][0][0]);
  let lon0 = Infinity;
  let lat0 = Infinity;
  for (const b of boxes) {
    if (b.length !== 5 || Math.abs(Math.abs(b[1][0] - b[0][0]) - step) > step * 1e-3) {
      throw new Error("dissolveCells: expected equal axis-aligned cell boxes");
    }
    lon0 = Math.min(lon0, b[0][0], b[2][0]);
    lat0 = Math.min(lat0, b[0][1], b[2][1]);
  }
  const key = (x: number, y: number) => `${x},${y}`;
  const cells = new Set<string>();
  for (const b of boxes) {
    const west = Math.min(b[0][0], b[2][0]);
    const south = Math.min(b[0][1], b[2][1]);
    cells.add(key(Math.round((west - lon0) / step), Math.round((south - lat0) / step)));
  }

  // Every cell side with no cell across it, directed so the region is on the
  // left. Shared sides are never emitted, so what is left is the boundary.
  const out = new Map<string, [number, number][]>();
  const edge = (x0: number, y0: number, x1: number, y1: number) => {
    const k = key(x0, y0);
    const list = out.get(k);
    if (list) list.push([x1, y1]);
    else out.set(k, [[x1, y1]]);
  };
  for (const c of cells) {
    const [x, y] = c.split(",").map(Number);
    if (!cells.has(key(x, y - 1))) edge(x, y, x + 1, y);
    if (!cells.has(key(x + 1, y))) edge(x + 1, y, x + 1, y + 1);
    if (!cells.has(key(x, y + 1))) edge(x + 1, y + 1, x, y + 1);
    if (!cells.has(key(x - 1, y))) edge(x, y + 1, x, y);
  }

  const rings: LngLat[][] = [];
  const round = (v: number) => Math.round(v * 1e5) / 1e5;
  for (const [startKey, starts] of out) {
    while (starts.length) {
      const [sx, sy] = startKey.split(",").map(Number);
      const path: [number, number][] = [[sx, sy]];
      let [px, py] = [sx, sy];
      let [cx, cy] = starts.pop()!;
      while (cx !== sx || cy !== sy) {
        path.push([cx, cy]);
        const next = out.get(key(cx, cy));
        if (!next?.length) throw new Error("dissolveCells: open boundary");
        // Where two cells touch only at this corner there are two ways on;
        // the left turn keeps to the region being traced.
        const dx = cx - px, dy = cy - py;
        let pick = next.length - 1;
        for (let i = 0; i < next.length; i++) {
          if (next[i][0] - cx === -dy && next[i][1] - cy === dx) pick = i;
        }
        [px, py] = [cx, cy];
        [cx, cy] = next.splice(pick, 1)[0];
      }
      // Drop the corners that are not corners: straight runs along a row.
      const n = path.length;
      const ring: LngLat[] = [];
      for (let i = 0; i < n; i++) {
        const [ax, ay] = path[(i + n - 1) % n];
        const [bx, by] = path[i];
        const [qx, qy] = path[(i + 1) % n];
        if ((bx - ax) * (qy - by) - (by - ay) * (qx - bx) === 0) continue;
        ring.push([round(lon0 + bx * step), round(lat0 + by * step)]);
      }
      ring.push(ring[0]);
      rings.push(ring);
    }
  }
  return rings;
}

/** Shortest distance from a point to a polyline, km. */
export function distanceToPathKm(
  p: LngLat,
  path: LngLat[],
): { km: number; index: number } {
  let best = Infinity;
  let idx = 0;
  const kx = kmPerDegLon(p[1]);
  for (let i = 1; i < path.length; i++) {
    const d = segDistKm(p, path[i - 1], path[i], kx);
    if (d < best) {
      best = d;
      idx = i - 1;
    }
  }
  if (path.length === 1) return { km: distanceKm(p, path[0]), index: 0 };
  return { km: best, index: idx };
}

function segDistKm(p: LngLat, a: LngLat, b: LngLat, kx: number): number {
  const px = p[0] * kx;
  const py = p[1] * KM_PER_DEG_LAT;
  const ax = a[0] * kx;
  const ay = a[1] * KM_PER_DEG_LAT;
  const bx = b[0] * kx;
  const by = b[1] * KM_PER_DEG_LAT;
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Circle as a closed ring, for infrastructure buffers and search radii. */
export function circleRing(centre: LngLat, radiusKm: number, steps = 64): LngLat[] {
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    ring.push(destination(centre, (i / steps) * 360, radiusKm));
  }
  return ring;
}

export function centroid(points: LngLat[]): LngLat {
  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
  }
  return [x / points.length, y / points.length];
}
