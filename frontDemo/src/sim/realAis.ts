/**
 * Real AIS traffic, from marinecadastre.gov, for the scenes that have it.
 *
 * Everything else in `sim/ais.ts` invents traffic. This does not: it reads what
 * `scripts/export_ais_traffic.py` cut from the national AIS days on disk --
 * real vessels, real turns, stops and reception gaps -- for the three Gulf
 * scenes, whose acquisition dates are exactly the days that data covers.
 *
 * WHAT IS REAL AND WHAT IS NOT, in a scene that uses this. The tracks are real,
 * including the vessel the published case names, which is the scene's ground
 * truth (C10: the answer comes from the publication, not from a detector). The
 * slick geometry is authored from the publication; the drift field and every
 * score are simulated. So a real vessel ranked here is a demonstration of the
 * gate on real traffic, not a finding about that vessel -- which is also why
 * identities never reach the browser: the export keeps only the MID.
 *
 * WHY THE TRACKS ARE RESAMPLED. The export simplifies each track so that its
 * position at every instant is within 100 m of what was reported (TD-TR). That
 * is compact, but it is not a report stream: a straight hour becomes two
 * points, and `behaviour()` reads report counts and cadence -- it would call
 * that hour a reception gap and a stop a handful of reports. So within each
 * continuous segment the track is resampled to a fixed cadence, and between
 * segments -- the real reception gaps, which the export never bridges -- it is
 * not. A gap in a real track stays a gap everywhere, including on the map.
 */

import type { AisPoint, LngLat, Vessel } from "./types";
import { bearingDeg, distanceKm } from "./geo";
import { maskMmsi } from "./ais";

export interface RealTrafficFile {
  scene: string;
  source: string;
  note: string;
  acquiredAt: string;
  centre: LngLat;
  box: [number, number, number, number];
  window: { startS: number; endS: number; dataEndsS: number };
  simplification: { method: string; toleranceKm: number; gapMin: number };
  rows: { inBoxAndWindow: number; afterClean: number; kept: number };
  identities: string;
  vessels: {
    id: string;
    kind: string;
    aisType: number | null;
    lengthM: number | null;
    draftM: number | null;
    published: boolean;
    /** Indices where reports genuinely stopped before this point: a reception gap. */
    breaks: number[];
    t: number[];
    lon: number[];
    lat: number[];
    sog: (number | null)[];
    cog: (number | null)[];
  }[];
}

/** The scenes whose traffic is real. Their runs cannot be built without it. */
export const REAL_AIS_SCENES: ReadonlySet<string> = new Set(["gom-platform", "gom-moving", "gom-berthed"]);

/** Resampling cadence inside a continuous segment. */
export const REAL_CADENCE_S = 300;

const files = new Map<string, RealTrafficFile>();
const pending = new Map<string, Promise<void>>();

export type TrafficLoader = (scene: string) => Promise<RealTrafficFile>;

let loader: TrafficLoader = async (scene) => {
  const response = await fetch(`ais/${scene}.json`);
  // A dev server answers a missing file with its own index page and a 200, so
  // `ok` alone cannot tell "here is the data" from "there is no data".
  const type = response.headers.get("content-type") ?? "";
  if (!response.ok || !type.includes("json")) {
    throw new Error(
      `Real AIS for ${scene} could not be loaded (ais/${scene}.json returned ${response.status} ${type || "no type"}). ` +
        "Run scripts/export_ais_traffic.py; if the file exists, restart the dev server -- Vite can lose track of a public file that was deleted and re-created.",
    );
  }
  return (await response.json()) as RealTrafficFile;
};

/** For Node checks, which read `public/ais/` from disk instead of fetching. */
export function setTrafficLoader(next: TrafficLoader): void {
  loader = next;
}

export function hasRealTraffic(scene: string): boolean {
  return files.has(scene);
}

export function realTrafficFile(scene: string): RealTrafficFile | undefined {
  return files.get(scene);
}

/** Load a scene's real traffic if it has any. Concurrent calls share one fetch. */
export async function ensureRealTraffic(scene: string): Promise<void> {
  if (!REAL_AIS_SCENES.has(scene) || files.has(scene)) return;
  const inFlight = pending.get(scene);
  if (inFlight) return inFlight;
  const work = loader(scene).then((file) => {
    files.set(scene, file);
  });
  pending.set(scene, work);
  try {
    await work;
  } finally {
    pending.delete(scene);
  }
}

/**
 * Typical lengths, for the size term of the prior when AIS reports none.
 *
 * Assumed, not fitted. Many AIS transponders leave length blank -- the vessel
 * the published Case 2 names is one of them -- and the size term needs
 * something, so it gets the middle of its class rather than a zero that would
 * mark it down for a missing field.
 */
const TYPICAL_LENGTH_M: Record<string, number> = {
  Tanker: 180,
  Cargo: 170,
  Passenger: 150,
  Fishing: 25,
  Tug: 30,
  "Pleasure craft": 12,
  "Service vessel": 40,
  Other: 60,
  Unknown: 60,
};

/**
 * One real track as the scorer's `Vessel`, resampled within its segments.
 *
 * Speed and course come from the reports where the transponder gave them; a
 * blank one is derived from the neighbouring positions, never filled with 0,
 * because a zero speed would read as a stop that did not happen.
 */
function toVessel(v: RealTrafficFile["vessels"][number], t0Ms: number): Vessel {
  const n = v.t.length;
  const derived = (i: number): { sog: number; cog: number } => {
    const a = i > 0 ? i - 1 : i;
    const b = i > 0 ? i : Math.min(n - 1, i + 1);
    if (a === b) return { sog: 0, cog: 0 };
    const km = distanceKm([v.lon[a], v.lat[a]], [v.lon[b], v.lat[b]]);
    const hours = Math.max(1, v.t[b] - v.t[a]) / 3600;
    return { sog: km / 1.852 / hours, cog: bearingDeg([v.lon[a], v.lat[a]], [v.lon[b], v.lat[b]]) };
  };
  const sogAt = (i: number) => v.sog[i] ?? derived(i).sog;
  const cogAt = (i: number) => v.cog[i] ?? derived(i).cog;

  /*
    Onto one global grid, every REAL_CADENCE_S from the acquisition, within
    each continuous segment. A grid rather than "each report plus multiples of
    the cadence" because `behaviour()` takes the first step as the nominal
    cadence: two reports 60 s apart at the start of a track would make every
    later 300 s step read as missed reports. On the grid every step inside a
    segment is exactly one cadence, and every step across a real gap is longer
    than the gap threshold -- so a gap is still a gap.

    Segments come from the export's `breaks`, never from time spacing: the
    simplifier leaves an hour between two kept points on a straight leg that
    reported every minute, and reading that as silence would invent gaps.
  */
  const points: AisPoint[] = [];
  const ends = [...v.breaks, n];
  let a = 0;
  for (const end of ends) {
    const b = end - 1;
    if (b < a) continue;
    let j = a;
    for (let s = Math.ceil(v.t[a] / REAL_CADENCE_S) * REAL_CADENCE_S; s <= v.t[b]; s += REAL_CADENCE_S) {
      while (j < b && v.t[j + 1] < s) j++;
      const k = Math.min(b, j + 1);
      const span = v.t[k] - v.t[j];
      const f = span > 0 ? (s - v.t[j]) / span : 0;
      const turn = ((cogAt(k) - cogAt(j) + 540) % 360) - 180;
      points.push({
        t: t0Ms + s * 1000,
        lon: v.lon[j] + (v.lon[k] - v.lon[j]) * f,
        lat: v.lat[j] + (v.lat[k] - v.lat[j]) * f,
        sog: sogAt(j) + (sogAt(k) - sogAt(j)) * f,
        cog: (cogAt(j) + turn * f + 360) % 360,
      });
    }
    a = end;
  }
  const lengthM = v.lengthM ?? TYPICAL_LENGTH_M[v.kind] ?? 60;
  return {
    mmsi: v.id,
    label: maskMmsi(v.id),
    kind: v.kind,
    lengthM: Math.round(lengthM),
    draftM: v.draftM ?? 0,
    points,
    background: !v.published,
    source: "real",
    lengthAssumed: v.lengthM === null,
  };
}

const vesselCache = new Map<string, Vessel[]>();

/** A scene's real traffic as `Vessel`s. Throws if it has not been loaded. */
export function realVessels(scene: string): Vessel[] {
  const hit = vesselCache.get(scene);
  if (hit) return hit;
  const file = files.get(scene);
  if (!file) {
    throw new Error(`Real AIS for ${scene} is not loaded; await ensureRealTraffic("${scene}") before building it.`);
  }
  const t0 = Date.parse(file.acquiredAt);
  const vessels = file.vessels.map((v) => toVessel(v, t0));
  vesselCache.set(scene, vessels);
  return vessels;
}

/** The id of the vessel the publication names, or null for a scene without one. */
export function publishedVesselId(scene: string): string | null {
  return files.get(scene)?.vessels.find((v) => v.published)?.id ?? null;
}

/**
 * Split a track where reports stop, so a reception gap is drawn as a gap.
 *
 * Joining the points either side of a gap with a straight line is exactly the
 * artefact synthetic traffic was criticised for, and on a real track it also
 * asserts a path nobody observed.
 */
export function trackSegments(points: AisPoint[], maxGapMs = 12 * 60_000): LngLat[][] {
  const out: LngLat[][] = [];
  let current: LngLat[] = [];
  for (let i = 0; i < points.length; i++) {
    if (i > 0 && points[i].t - points[i - 1].t > maxGapMs) {
      if (current.length > 1) out.push(current);
      current = [];
    }
    current.push([points[i].lon, points[i].lat]);
  }
  if (current.length > 1) out.push(current);
  return out;
}
