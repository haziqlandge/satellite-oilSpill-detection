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
