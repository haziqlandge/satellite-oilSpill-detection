/**
 * Measured wind and currents for an uploaded scene, fetched in the browser.
 *
 * An upload has a place and a time, so its drift need not run through an
 * authored analytic field. Open-Meteo serves ERA5 hourly 10 m wind (1940 on)
 * and Copernicus Marine SMOC surface currents, tides included (2022 on), with
 * open CORS and no key, so this works on the static site with no server. The
 * drift engine is still the console's own (SIM); only its forcing is measured,
 * and the panels say which is which. The local pipeline's OpenDrift run on
 * ERA5 + CMEMS NetCDF is the real thing (`backend/pipeline/run.py`).
 *
 * Open-Meteo's terms: free for non-commercial use, attribution required -- the
 * source strings below name it.
 */

import { flowAt } from "./flow";
import type { Forcing } from "./field";
import { KM_PER_DEG_LAT, kmPerDegLon } from "./geo";
import type { FlowGrid, LngLat } from "./types";

/** Nodes per side, and how far the grid reaches from the scene centre: 72 h of drift at ~0.4 m/s. */
const NODES = 5;
const HALF_SPAN_KM = 110;
const WIND_URL = "https://archive-api.open-meteo.com/v1/archive";
const MARINE_URL = "https://marine-api.open-meteo.com/v1/marine";
export const WIND_SOURCE = "ERA5 10 m (Open-Meteo)";
export const CURRENT_SOURCE = "Copernicus Marine SMOC (Open-Meteo)";

type Series = { time: string[] } & Record<string, (number | null)[] | string[]>;

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

async function points(base: string, lats: number[], lons: number[], from: number, to: number, vars: string, extra: string, signal?: AbortSignal): Promise<Series[]> {
  const url = `${base}?latitude=${lats.map((v) => v.toFixed(3)).join(",")}&longitude=${lons.map((v) => v.toFixed(3)).join(",")}` +
    `&start_date=${day(from)}&end_date=${day(to)}&hourly=${vars}&wind_speed_unit=ms&timezone=GMT${extra}`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${new URL(base).host} answered ${response.status}`);
  const body = await response.json();
  return (Array.isArray(body) ? body : [body]).map((b: { hourly: Series }) => b.hourly);
}

/**
 * ERA5 wind and SMOC currents on a NODES x NODES grid around `centre`, hourly
 * from `fromHour` to `toHour` (hours from `acquiredAt`). Null when there is no
 * wind for the window (ERA5 runs about five days behind real time). Currents are
 * null when the marine service has none (before 2022): the caller says so.
 */
export async function fetchMeasuredFlow(centre: LngLat, acquiredAt: number, fromHour: number, toHour: number, signal?: AbortSignal): Promise<FlowGrid | null> {
  const dLon = (2 * HALF_SPAN_KM) / kmPerDegLon(centre[1]) / (NODES - 1);
  const dLat = (2 * HALF_SPAN_KM) / KM_PER_DEG_LAT / (NODES - 1);
  const minLon = centre[0] - dLon * (NODES - 1) / 2;
  const minLat = centre[1] - dLat * (NODES - 1) / 2;
  const lats: number[] = [];
  const lons: number[] = [];
  // Row-major from minLat, the FlowGrid layout.
  for (let j = 0; j < NODES; j++) for (let i = 0; i < NODES; i++) { lats.push(minLat + j * dLat); lons.push(minLon + i * dLon); }
  const from = acquiredAt + (fromHour - 1) * 3600_000;
  const to = acquiredAt + (toHour + 1) * 3600_000;
  const [wind, sea] = await Promise.all([
    points(WIND_URL, lats, lons, from, to, "wind_speed_10m,wind_direction_10m", "&models=era5", signal),
    // A current failure is not a wind failure: the run goes on wind-only and says so.
    points(MARINE_URL, lats, lons, from, to, "ocean_current_velocity,ocean_current_direction", "&cell_selection=sea", signal).catch(() => null),
  ]);
  const hours: number[] = [];
  const windRows: number[][] = [];
  const currentRows: (number | null)[][] = [];
  wind[0].time.forEach((stamp, k) => {
    const hour = (Date.parse(`${stamp}Z`) - acquiredAt) / 3600_000;
    if (hour < fromHour - 1 || hour > toHour + 1) return;
    const w: number[] = [];
    for (const node of wind) {
      const speed = node.wind_speed_10m[k] as number | null;
      const fromDeg = node.wind_direction_10m[k] as number | null;
      if (speed === null || fromDeg === null) return; // an hour ERA5 has not published yet
      // Meteorological: the direction it blows FROM.
      const r = (fromDeg * Math.PI) / 180;
      w.push(-speed * Math.sin(r), -speed * Math.cos(r));
    }
    const c: (number | null)[] = [];
    for (const node of sea ?? []) {
      const speed = node.ocean_current_velocity?.[k] as number | null | undefined;
      const towardDeg = node.ocean_current_direction?.[k] as number | null | undefined;
      if (speed == null || towardDeg == null) { c.push(null, null); continue; }
      // Oceanographic: the direction it flows TOWARD.
      const r = (towardDeg * Math.PI) / 180;
      c.push(speed * Math.sin(r), speed * Math.cos(r));
    }
    hours.push(hour);
    windRows.push(w);
    currentRows.push(c);
  });
  if (hours.length < 2) return null;
  const anyCurrent = currentRows.some((row) => row.some((v) => v !== null));
  return {
    minLon, minLat, dLon, dLat, nx: NODES, ny: NODES, hours,
    wind: windRows,
    current: anyCurrent ? currentRows : null,
    windSource: WIND_SOURCE,
    currentSource: anyCurrent ? CURRENT_SOURCE : null,
  };
}

/**
 * The console's `Forcing` read from a measured grid: bilinear in space, linear in time.
 *
 * ponytail: a parcel beyond the fetched box or hours reads the nearest edge value
 * (HALF_SPAN_KM covers 72 h at ~0.4 m/s); widen the grid if runs get longer. A
 * run with no measured current keeps `analytic`'s current, labelled SIM by the caller.
 */
export function measuredForcing(flow: FlowGrid, analytic: Forcing): Forcing {
  // A hair inside the far edges: exactly on them, rounding can put a point outside the grid.
  const east = flow.minLon + flow.dLon * (flow.nx - 1 - 1e-6);
  const north = flow.minLat + flow.dLat * (flow.ny - 1 - 1e-6);
  const first = flow.hours[0];
  const last = flow.hours[flow.hours.length - 1];
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  const read = (kind: "wind" | "current") => (p: LngLat, hour: number): [number, number] =>
    flowAt(flow, kind, [clamp(p[0], flow.minLon, east), clamp(p[1], flow.minLat, north)], clamp(hour, first, last)) ?? [0, 0];
  const current = flow.current ? read("current") : analytic.current;
  return { wind: read("wind"), current, speedAt: (p, hour) => Math.hypot(...current(p, hour)) };
}
