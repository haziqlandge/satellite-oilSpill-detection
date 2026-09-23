/**
 * A console run built entirely from real data: the real-run views.
 *
 * Every other run in the console is a simulation around something real at
 * best. These are the three full Sentinel-1 scenes the project processed end to
 * end, shown as they came out:
 *
 *  - **detections** -- the release model's full-scene output
 *    (`eval/final/scenes/`), every slick it found, exported beside the run by
 *    `scripts/export_real_scenes.py`
 *  - **drift** -- OpenDrift OpenOil, 10 members x 200 particles, run backward
 *    72 h by `scripts/export_drift_runs.py` from the largest detection that is
 *    at sea and not a box the model filled (`choose_seed`, ISSUES Q5), with
 *    ERA5 wind and NO current field (ISSUES X2)
 *  - **traffic** -- marinecadastre AIS cut around that seed
 *    (`export_ais_traffic.py --real-runs`), identities withheld; 48 h of it for
 *    April and May, 72 h for December, because that is what is on disk
 *  - **wind** -- the ERA5 series the drift actually ran on, at the seed
 *
 * WHAT THESE RUNS DO NOT DO: rank anybody. All three backward fields widen
 * monotonically from the observation -- there is no convergence minimum, so no
 * age (C1 keeps the triple and says so) -- and a wind-only field cannot carry
 * an attribution. The run carries that refusal with its reasons, and names no
 * candidate, rather than scoring real ships against incomplete physics. That
 * is the result, not a gap in the view.
 */

import { centroid, dissolveCells, kmPerDegLon, KM_PER_DEG_LAT } from "./geo";
import { realVessels, ensureRealTraffic } from "./realAis";
import { sceneLabel, type RealDriftRun } from "./realDrift";
import { characterise, type SlickGeometry } from "./slick";
import type { LngLat, Run, ScenarioId } from "./types";

export type RealRunId = Extract<ScenarioId, `real-${string}`>;

export interface RealRunListing {
  id: RealRunId;
  scene: string;
  name: string;
  short: string;
  region: "gulf-of-mexico";
  tests: string;
}

const SCENES: Record<RealRunId, string> = {
  "real-20230409": "S1A_IW_GRDH_1SDV_20230409T000206_20230409T000231_048012_05C552_27F2_s0db",
  "real-20230515": "S1A_IW_GRDH_1SDV_20230515T000208_20230515T000233_048537_05D69B_35AF_s0db",
  "real-20231205": "S1A_IW_GRDH_1SDV_20231205T000214_20231205T000239_051512_0637C7_66B8_s0db",
};

export const REAL_RUN_LISTINGS: RealRunListing[] = (Object.keys(SCENES) as RealRunId[]).map((id) => ({
  id,
  scene: SCENES[id],
  name: `Real · ${sceneLabel(SCENES[id]).replace("Sentinel-1 ", "")}`,
  short: "Real detections · OpenDrift −72 h · real AIS",
  region: "gulf-of-mexico",
  tests: "Real detections, real OpenDrift, real AIS — and the refusal the physics forces.",
}));

export function isRealRun(id: string | null): id is RealRunId {
  return id !== null && id in SCENES;
}

/** The export beside each drift run: detections and the wind it ran on. */
export interface RealSceneFile {
  scene: string;
  detections: { ring: LngLat[]; confidence: number; seed: boolean }[];
  detectionSource: string;
  wind: {
    source: string;
    gridPoint: LngLat;
    hours: number[];
    ms: number[];
    fromDeg: number[];
    current: string;
  };
}

export type JsonLoader = (path: string) => Promise<unknown>;

let readJson: JsonLoader = async (path) => {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`${path}: ${response.status}`);
  // A dev server answers a missing file with its index page and a 200.
  if (!(response.headers.get("content-type") ?? "").includes("json")) {
    throw new Error(`${path} is missing (the server returned a page, not data)`);
  }
  return response.json();
};

/** For the Node checks, which read the same files from disk. */
export function setRealRunLoader(next: JsonLoader): void {
  readJson = next;
}

const loaded = new Map<RealRunId, { drift: RealDriftRun; scene: RealSceneFile }>();
const pending = new Map<RealRunId, Promise<void>>();

/** Fetch everything a real run needs. A scenario that is not one returns at once. */
export async function ensureRealRun(id: string): Promise<void> {
  if (!isRealRun(id) || loaded.has(id)) return;
  const inFlight = pending.get(id);
  if (inFlight) return inFlight;
  const job = (async () => {
    const base = `runs/${SCENES[id]}`;
    const [drift, scene] = await Promise.all([
      readJson(`${base}/drift.json`) as Promise<RealDriftRun>,
      readJson(`${base}/scene.json`) as Promise<RealSceneFile>,
      ensureRealTraffic(id),
    ]);
    if (!drift.frames?.length) throw new Error(`${id}: the exported drift has no frames`);
    loaded.set(id, { drift, scene });
  })();
  pending.set(id, job);
  try {
    await job;
  } finally {
    pending.delete(id);
  }
}

/**
 * A centreline for a detected polygon, traced rather than assumed.
 *
 * The characteriser measures width by probing out from centreline points, so
 * the line has to stay inside the slick; a straight principal axis leaves a
 * curved one. So the polygon is binned along its principal direction and each
 * bin contributes the middle of its cross-section -- the same idea as the
 * upload tracer (`ingest.ts`), on vertices instead of pixels.
 */
export function medialAxis(ring: LngLat[], stations = 24): LngLat[] {
  const c = centroid(ring);
  const kx = kmPerDegLon(c[1]);
  const ky = KM_PER_DEG_LAT;
  const xy = ring.map(([lon, lat]) => [(lon - c[0]) * kx, (lat - c[1]) * ky]);
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of xy) { sxx += x * x; syy += y * y; sxy += x * y; }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const dx = Math.cos(theta), dy = Math.sin(theta);
  const along = xy.map(([x, y]) => x * dx + y * dy);
  const across = xy.map(([x, y]) => -x * dy + y * dx);
  let lo = Infinity, hi = -Infinity;
  for (const a of along) { if (a < lo) lo = a; if (a > hi) hi = a; }
  const step = (hi - lo) / stations || 1;
  const axis: LngLat[] = [];
  for (let s = 0; s < stations; s++) {
    const a0 = lo + s * step, a1 = a0 + step;
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < along.length; i++) {
      if (along[i] < a0 || along[i] > a1) continue;
      if (across[i] < min) min = across[i];
      if (across[i] > max) max = across[i];
    }
    if (min > max) continue;
    const a = (a0 + a1) / 2, b = (min + max) / 2;
    axis.push([c[0] + (a * dx - b * dy) / kx, c[1] + (a * dy + b * dx) / ky]);
  }
  return axis.length >= 2 ? axis : [ring[0], ring[Math.floor(ring.length / 2)]];
}

const HOUR = 3600_000;
/** The Gulf scenarios' C3 threshold, so the drift pane prints a comparable test. */
const DIFFUSE_THRESHOLD_KM2 = 420;

export function buildRealRun(id: RealRunId): Run {
  const data = loaded.get(id);
  if (!data) throw new Error(`${id} is not loaded; await ensureRealRun("${id}") before building it.`);
  const { drift, scene } = data;
  const acquiredAt = Date.parse(drift.acquiredAtIso);
  const seedRing = scene.detections.find((d) => d.seed) ?? scene.detections[0];
  const windAtPass = scene.wind.ms[scene.wind.hours.indexOf(0)] ?? scene.wind.ms[scene.wind.ms.length - 1];

  const axis = medialAxis(seedRing.ring);
  const geom: SlickGeometry = { parts: [seedRing.ring], centreline: axis, head: axis[0], tail: axis[axis.length - 1] };
  const characterisation = characterise(`${id}-det`, geom, {
    windSpeedMs: windAtPass,
    // No backscatter reaches the console for these scenes; NaN renders as
    // "not measured" rather than as a contrast nobody measured.
    dampingRatioDb: Number.NaN,
    headResolved: false,
  });

  const frames = drift.frames.map((f) => ({
    hour: f.hour,
    at: acquiredAt + f.hour * HOUR,
    particles: Float64Array.from(f.particles),
    // The export's cell boxes, merged into the outline of the same cells.
    contour50: dissolveCells(f.contour50),
    contour90: dissolveCells(f.contour90),
    area50Km2: f.area50Km2,
    area90Km2: f.area90Km2,
    spreadKm: f.spreadKm,
  }));
  const horizon = frames[0];
  const vessels = realVessels(id);
  // A loop, not Math.min(...): tens of thousands of reports overflow the stack.
  let firstReport = acquiredAt;
  for (const v of vessels) for (const p of v.points) if (p.t < firstReport) firstReport = p.t;
  const aisHours = Math.round((acquiredAt - firstReport) / HOUR);
  const reasons =
    `No age and no ranking. The backward field never converges -- its 90% contour widens ` +
    `from ${frames[frames.length - 1].area90Km2.toFixed(1)} km2 at the pass to ` +
    `${horizon.area90Km2.toFixed(0)} km2 at ${horizon.hour} h -- so convergence gives no age ` +
    `(${drift.age.status ?? "monotonic"}), and the field is wind-only: there is no current ` +
    "field (ISSUES X2), and a wind-only field cannot carry an attribution. " +
    `${vessels.length} real vessels are shown; none is scored.`;

  const count = scene.detections.length;
  const pick = drift.seedDetection;
  // Say which detection was hindcast and what was passed over for it. The
  // largest detections in these scenes are boxes the model filled (ISSUES Q5);
  // seeding from one of those is what this sentence exists to rule out.
  const seedNote = pick
    ? `the drift is seeded from ${pick.rule} (${pick.areaKm2.toFixed(1)} km2, confidence ` +
      `${pick.confidence.toFixed(2)}; ${pick.passedOver.frameCut} larger box-cut and ` +
      `${pick.passedOver.ashore} ashore detection${pick.passedOver.ashore === 1 ? "" : "s"} passed over)`
    : `the drift is seeded from the largest (confidence ${seedRing.confidence.toFixed(2)})`;
  const provenance =
    `REAL · Detections: the release model (L1-ciou research) on the full Sentinel-1 scene, ` +
    `${count} slick polygon${count === 1 ? "" : "s"}; ${seedNote}. SAR alone cannot tell oil ` +
    `from a natural film (ISSUES Q2). Drift: ${drift.engine}, ${drift.members} members x ` +
    `${drift.particlesPerMember} particles, ${drift.backwardHours} h backward, ${drift.forcingNote} ` +
    `AIS: marinecadastre.gov, identities withheld; it covers the last ${aisHours} h of the ` +
    `${drift.backwardHours} h hindcast. Wind: ${scene.wind.source}. ` +
    "Nothing here is simulated, and nobody is ranked -- see the drift pane for why.";

  const hours = scene.wind.hours;
  return {
    meta: {
      id,
      name: REAL_RUN_LISTINGS.find((l) => l.id === id)!.name,
      region: "gulf-of-mexico",
      place: "off the Mississippi delta, Gulf of Mexico",
      provenance,
      acquiredAt,
      centre: drift.seed,
      zoom: 9,
      sceneId: drift.scene,
      summary:
        `The model's ${count} detections in a real Sentinel-1 scene, OpenDrift's backward field ` +
        "from the largest one at sea with a slick's edge, and the real traffic around it.",
      tests: "Real detections, real OpenDrift, real AIS — and the refusal the physics forces.",
      expectedTop1: "Nobody: the field never converges and has no currents, so no candidate is ranked.",
    },
    detection: {
      id: `${id}-det`,
      sceneId: drift.scene,
      className: "slick_unknown",
      confidence: seedRing.confidence,
      parts: scene.detections.map((d) => d.ring),
      acquiredAt,
    },
    characterisation,
    drift: {
      id: `${id}-drift`,
      detectionId: `${id}-det`,
      ensembleSize: drift.members,
      particleCount: drift.members * drift.particlesPerMember,
      backwardHours: drift.backwardHours,
      forwardHours: drift.forwardHours,
      frames,
      convergence: drift.convergence,
      // C1: a triple and a method even when there is nothing to put in it.
      ageHours: [0, drift.backwardHours, drift.backwardHours],
      ageMethod: "no_convergence",
      temporalState: "indeterminate",
      insufficientEvidence: { area90Km2: horizon.area90Km2, reason: reasons, kind: "no_age" },
      diffuseThresholdKm2: DIFFUSE_THRESHOLD_KM2,
    },
    vessels,
    suspects: [],
    infrastructure: [],
    cfarTargets: [],
    forwardImpact: [],
    // Nobody knows when this oil entered the water; there is no release to play.
    release: [],
    releaseStartHour: -drift.backwardHours,
    releaseEndHour: -drift.backwardHours,
    aisPointCount: vessels.reduce((s, v) => s + v.points.length, 0),
    environment: {
      hours,
      windMs: scene.wind.ms,
      windFromDeg: scene.wind.fromDeg,
      // No current field exists for these runs. NaN, not zero: zero would read
      // as a measured slack current.
      currentMs: hours.map(() => Number.NaN),
      currentTowardDeg: hours.map(() => Number.NaN),
      tideMs: hours.map(() => Number.NaN),
    },
    gate: { considered: vessels.length, admitted: 0, reason: reasons },
    separability: null,
    truth: null,
  };
}
