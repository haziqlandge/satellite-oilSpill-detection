/**
 * Lon/lat onto the stage, for the technical journey's views.
 *
 * Equirectangular with x scaled by cos(mid latitude), fitted and centred in a
 * box: the same local projection the console's own figures use at these
 * scales, and exact for the preprocessed rasters, which are EPSG:4326.
 */
import { tileStarts } from "../../sim/segmenter";

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Project = (lon: number, lat: number) => [number, number];

export function projector(b: Bounds, box: Box): Project {
  const k = Math.cos((((b.south + b.north) / 2) * Math.PI) / 180);
  const bw = (b.east - b.west) * k;
  const bh = b.north - b.south;
  const s = Math.min(box.w / bw, box.h / bh);
  const ox = box.x + (box.w - bw * s) / 2;
  const oy = box.y + (box.h - bh * s) / 2;
  return (lon, lat) => [ox + (lon - b.west) * k * s, oy + (b.north - lat) * s];
}

/** The stage rectangle a lon/lat box covers under `project`. */
export function rectOf(project: Project, b: Bounds): Box {
  const [x0, y0] = project(b.west, b.north);
  const [x1, y1] = project(b.east, b.south);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Tiles the browser segmenter cuts an image into: its own `tileStarts`, 1024 px at 10% overlap. */
export function tileCount(widthPx: number, heightPx: number, tile = 1024, overlap = 0.1): number {
  const stride = Math.max(1, Math.round(tile * (1 - overlap)));
  return tileStarts(heightPx, tile, stride).length * tileStarts(widthPx, tile, stride).length;
}

export const boundsOf = (b: readonly number[]): Bounds => ({ west: b[0], south: b[1], east: b[2], north: b[3] });
