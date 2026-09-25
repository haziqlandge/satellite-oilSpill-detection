/**
 * The land, with the network off (ISSUES F11, C12).
 *
 * The basemap is Esri's tiles; with no network the map used to draw water and
 * nothing else, so a slick or an origin field sat on a blank sea with no coast
 * to read it against. The land mask the drift already uses -- GSHHG, the
 * coastline OpenDrift tests parcels against, shipped under `public/landmask/`
 * -- is local, so it draws the land instead: one image over the view, painted
 * from the mask cell by cell.
 *
 * It is the physics' coast at 1/240 deg (~460 m), not a cartographer's: no
 * names, and a stair-step at z12+ (ISSUES F13). Offline, that is the honest
 * picture of what the drift itself knew about the shore.
 */

import { ensureLandmask, isLand } from "../sim/landmask";

/** The widest the image gets, in pixels; wider views are sampled, not drawn cell for cell. */
const MAX_PX = 1024;
const CELLS_PER_DEG = 240;
const MAX_LAT = 85;

const mercatorY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latFromMercatorY = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

export interface LandImage {
  url: string;
  /** Top-left, top-right, bottom-right, bottom-left, as MapLibre's image source wants them. */
  coordinates: [[number, number], [number, number], [number, number], [number, number]];
}

/**
 * The land inside `bounds` as a PNG, or null when the view holds no land.
 *
 * Rows are spaced evenly in Web Mercator, because MapLibre stretches an image
 * source linearly between its corners in projected space; rows spaced in
 * latitude would slide the coast north of where it is by the top of a wide view.
 */
export async function landImage(bounds: [number, number, number, number], ink: string): Promise<LandImage | null> {
  const [west, rawSouth, east, rawNorth] = bounds;
  const south = Math.max(-MAX_LAT, rawSouth);
  const north = Math.min(MAX_LAT, rawNorth);
  if (!(east > west && north > south)) return null;

  const centreLat = (south + north) / 2;
  const kmPerDeg = 111.32;
  const radiusKm = Math.hypot(((east - west) / 2) * kmPerDeg * Math.cos((centreLat * Math.PI) / 180),
    ((north - south) / 2) * kmPerDeg);
  await ensureLandmask([(west + east) / 2, centreLat], radiusKm + 5);

  const top = mercatorY(north);
  const bottom = mercatorY(south);
  const width = Math.max(1, Math.min(MAX_PX, Math.ceil((east - west) * CELLS_PER_DEG)));
  const height = Math.max(1, Math.min(MAX_PX, Math.round((width * (top - bottom)) / (((east - west) * Math.PI) / 180))));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.fillStyle = ink;

  let land = 0;
  for (let j = 0; j < height; j++) {
    const lat = latFromMercatorY(top - ((j + 0.5) / height) * (top - bottom));
    // Runs of land in a row become one rectangle each.
    let from = -1;
    for (let i = 0; i <= width; i++) {
      const dry = i < width && isLand(west + ((i + 0.5) / width) * (east - west), lat);
      if (dry && from < 0) from = i;
      if (!dry && from >= 0) {
        ctx.fillRect(from, j, i - from, 1);
        land += i - from;
        from = -1;
      }
    }
  }
  if (land === 0) return null;
  return {
    url: canvas.toDataURL("image/png"),
    coordinates: [[west, north], [east, north], [east, south], [west, south]],
  };
}
