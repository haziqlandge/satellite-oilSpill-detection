/**
 * The 15 May 2023 pass, as the technical journey draws it: the console's own
 * shipped run files plus the small exports under `public/present/`.
 */
import type { RealTrafficFile } from "../../sim/realAis";
import type { FlowGrid, LngLat } from "../../sim/types";
import type { Bounds } from "./geo";

const RUN = "/runs/S1A_IW_GRDH_1SDV_20230515T000208_20230515T000233_048537_05D69B_35AF_s0db";

export interface JourneyJson {
  scene: { id: string; bounds: [number, number, number, number]; widthPx: number; heightPx: number; image: string };
  clean: { bounds: [number, number, number, number]; raw: string; filtered: string };
  tiles: string[];
  gate: { considered: number; admitted: number; admittedIds: string[]; threshold: number };
  score: {
    label: string;
    isTruth: boolean;
    rank: number;
    of: number;
    detail: string;
    total: number;
    terms: { key: string; label: string; value: number; weight: number }[];
  };
  ranking: { rank: number; label: string; kind: string; total: number; isTruth: boolean }[];
}

export interface SceneJson {
  detections: { ring: LngLat[]; confidence: number; seed: boolean }[];
  cfar: { targets: { position: LngLat; peakDb: number; areaPx: number }[] };
  characterisation: {
    areaKm2: number;
    lengthKm: number;
    widthMMean: number;
    widthMProfile: number[];
    medialAxis: LngLat[];
    head: LngLat;
    tail: LngLat;
    dampingRatioDb: number;
    windSpeedMs: number;
  };
  /** ERA5 10 m wind at the grid point nearest the slick, hourly around the pass. */
  wind: { gridPoint: LngLat; hours: number[]; ms: number[]; fromDeg: number[] };
  flow: FlowGrid;
}

export interface DriftFrame {
  hour: number;
  particles: number[];
  contour50: LngLat[][];
  contour90: LngLat[][];
}

export interface DriftJson {
  seed: LngLat;
  members: number;
  particlesPerMember: number;
  backwardHours: number;
  forwardHours: number;
  age: { age_hours: { low: number | null; best: number | null; high: number | null } };
  frames: DriftFrame[];
}

export interface CoastJson {
  bounds: [number, number, number, number];
  step: number;
  land: [number, number][];
}

export interface JourneyData {
  journey: JourneyJson;
  scene: SceneJson;
  drift: DriftJson;
  ais: RealTrafficFile;
  coast: CoastJson;
  coastDrift: CoastJson;
  /** Case 2's published ship, its recorded track on this same pass (gom-moving.json). */
  suspect: Vessel | null;
}

export type Vessel = RealTrafficFile["vessels"][number];

const get = async <T,>(url: string): Promise<T> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`present: ${url} answered ${r.status}`);
  return (await r.json()) as T;
};

export async function loadJourney(): Promise<JourneyData> {
  const [journey, coast, coastDrift, scene, drift, ais, gom] = await Promise.all([
    get<JourneyJson>("/present/journey.json"),
    get<CoastJson>("/present/coast-gulf.json"),
    get<CoastJson>("/present/coast-drift.json"),
    get<SceneJson>(`${RUN}/scene.json`),
    get<DriftJson>(`${RUN}/drift.json`),
    get<RealTrafficFile>("/ais/real-20230515.json"),
    get<RealTrafficFile>("/ais/gom-moving.json"),
  ]);
  return { journey, scene, drift, ais, coast, coastDrift, suspect: publishedVessel(gom) };
}

/** A frame by hour from acquisition (the file holds -72..72, ascending). */
export function frameAt(drift: DriftJson, hour: number): DriftFrame {
  return drift.frames[Math.max(0, Math.min(drift.frames.length - 1, Math.round(hour) + drift.backwardHours))];
}

/** The one vessel an AIS export marks as the published case's ship, if any. */
export function publishedVessel(file: RealTrafficFile): Vessel | null {
  return file.vessels.find((v) => v.published) ?? null;
}

/** Where a track is at `t` seconds from acquisition, linearly between reports (clamped to its ends). */
export function positionAt(v: Vessel, t: number): LngLat {
  if (t <= v.t[0]) return [v.lon[0], v.lat[0]];
  for (let i = 1; i < v.t.length; i++) {
    if (v.t[i] >= t) {
      const f = (t - v.t[i - 1]) / Math.max(1, v.t[i] - v.t[i - 1]);
      return [v.lon[i - 1] + (v.lon[i] - v.lon[i - 1]) * f, v.lat[i - 1] + (v.lat[i] - v.lat[i - 1]) * f];
    }
  }
  return [v.lon[v.lon.length - 1], v.lat[v.lat.length - 1]];
}

/** The area the drift actually covers: every particle of every frame, padded. */
export function driftBounds(drift: DriftJson): Bounds {
  let west = Infinity;
  let east = -Infinity;
  let south = Infinity;
  let north = -Infinity;
  for (const f of drift.frames) {
    for (let k = 0; k + 1 < f.particles.length; k += 2) {
      const lon = f.particles[k];
      const lat = f.particles[k + 1];
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  const px = (east - west) * 0.1;
  const py = (north - south) * 0.14;
  return { west: west - px, east: east + px, south: south - py, north: north + py };
}
