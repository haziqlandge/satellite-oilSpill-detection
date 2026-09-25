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

import { contour, densityGrid, levelForMass, massTable } from "./field";
import { centroid, distanceKm, kmPerDegLon, KM_PER_DEG_LAT, ringAreaKm2 } from "./geo";
import { ensureLandmask } from "./landmask";
import { realVessels, ensureRealTraffic, registerTrafficSource } from "./realAis";
import { deepAshore, sceneLabel, type RealDriftRun } from "./realDrift";
import { buildTraffic, planCorridors, positionAt } from "./ais";
import { completeFlow, flowMean, isSimulated, ringsBbox, speedToward } from "./flow";
import { makeRng, seedFrom } from "./rng";
import { characterise, windGate, type SlickGeometry } from "./slick";
import type { Characterisation, DetectionPartKind, FlowGrid, LngLat, Run, ScenarioId } from "./types";

export type RealRunId = Extract<ScenarioId, `real-${string}`>;

export interface RealRunListing {
  id: RealRunId;
  scene: string;
  name: string;
  short: string;
  region: "gulf-of-mexico";
  tests: string;
}

/** Where a real run's files are: the static exports, or a run the live API made. */
interface RealRunSource {
  scene: string;
  /** Directory URL holding `drift.json` and `scene.json`. */
  base: string;
  /** `POST /api/v1/runs` run id, for a run the live pipeline made. */
  apiRun: string | null;
}

const EXPORTED: Record<string, string> = {
  "real-20230409": "S1A_IW_GRDH_1SDV_20230409T000206_20230409T000231_048012_05C552_27F2_s0db",
  "real-20230515": "S1A_IW_GRDH_1SDV_20230515T000208_20230515T000233_048537_05D69B_35AF_s0db",
  "real-20231205": "S1A_IW_GRDH_1SDV_20231205T000214_20231205T000239_051512_0637C7_66B8_s0db",
};

const SOURCES = new Map<string, RealRunSource>(
  Object.entries(EXPORTED).map(([id, scene]) => [id, { scene, base: `runs/${scene}`, apiRun: null }]),
);

export const REAL_RUN_LISTINGS: RealRunListing[] = (Object.keys(EXPORTED) as RealRunId[]).map((id) => ({
  id,
  scene: EXPORTED[id],
  name: `Real · ${sceneLabel(EXPORTED[id]).replace("Sentinel-1 ", "")}`,
  short: "Real detections · OpenDrift −72 h · real AIS",
  region: "gulf-of-mexico",
  tests: "Real detections, real OpenDrift, real AIS — and the refusal the physics forces.",
}));

/*
  Runs the live pipeline made (`POST /api/v1/runs`, `lib/api.ts`), registered
  as the console learns of them. The pipeline writes the same three files the
  exports are, so they are read by this same view; only where the files live,
  and what the detection stage was, differ.
*/
let apiListings: RealRunListing[] = [];
const apiListeners = new Set<() => void>();

export function apiRunListings(): RealRunListing[] {
  return apiListings;
}

export function subscribeApiRuns(listener: () => void): () => void {
  apiListeners.add(listener);
  return () => { apiListeners.delete(listener); };
}

export function apiRunId(id: string): string | null {
  return SOURCES.get(id)?.apiRun ?? null;
}

/** Make a finished API run selectable. Idempotent; returns its scenario id. */
export function registerApiRun(run: { id: string; source: string; hasAis: boolean }): RealRunId {
  const id = `real-api-${run.id}` as RealRunId;
  if (SOURCES.has(id)) return id;
  const files = `api/v1/runs/${run.id}/files`;
  SOURCES.set(id, { scene: run.source, base: files, apiRun: run.id });
  registerTrafficSource(id, run.hasAis ? `${files}/ais.json` : null);
  const when = /(\d{8})T(\d{6})/.exec(run.source);
  apiListings = [...apiListings, {
    id,
    scene: run.source,
    name: `API · ${when ? sceneLabel(run.source).replace("Sentinel-1 ", "") : run.source}`,
    short: `Live pipeline run ${run.id.slice(0, 15)} · real detections · OpenDrift ±72 h`,
    region: "gulf-of-mexico",
    tests: "The live pipeline on this machine: two-pass detection, real OpenDrift, AIS where it is on disk.",
  }];
  apiListeners.forEach((listener) => listener());
  return id;
}

export function isRealRun(id: string | null): id is RealRunId {
  return id !== null && SOURCES.has(id);
}

/** The export beside each drift run: detections and the wind it ran on. */
export interface RealSceneFile {
  scene: string;
  /**
   * One entry per polygon part. `feature` is the detection it belongs to: a
   * detection can be a MultiPolygon, so there are more rings than detections.
   * Absent from exports written before it was added.
   */
  detections: { ring: LngLat[]; feature?: number; confidence: number; seed: boolean; boxCut?: boolean }[];
  detectionSource: string;
  /**
   * CA-CFAR on the processed scene within `radiusKm` of the seed
   * (`export_real_scenes.cfar_near_seed`). Absent from exports made before it.
   */
  cfar?: {
    status: "run" | "not_run";
    reason?: string;
    radiusKm?: number;
    targets: { position: LngLat; peakDb: number; areaPx: number }[];
  };
  wind: {
    source: string;
    gridPoint: LngLat;
    hours: number[];
    ms: number[];
    fromDeg: number[];
    current: string;
  };
  /** Wind and current around the run for the map's arrows (`backend/drift/flow.py`). Absent from older exports. */
  flow?: FlowGrid;
  /**
   * The backend's PHASE-03 record for the seed detection
   * (`export_real_scenes.characterise_seed`): geometry from the unsimplified
   * polygon, damping on the scene's own band 2, the wind gate at the pass.
   * Null damping means not measured. Absent from exports made before it, and
   * then the view measures the simplified ring itself.
   */
  characterisation?: Omit<Characterisation, "dampingRatioDb" | "windSpeedMs" | "windGateMultiplier" | "backend"> & {
    dampingRatioDb: number | null;
    windSpeedMs: number | null;
    windGateMultiplier: number | null;
    source: string;
    damping: { note: string } | null;
    wind: { speedMs: number; fromDeg: number; gridPoint: LngLat; validTime: string; offsetS: number; source: string } | null;
    agePrior: NonNullable<Characterisation["backend"]>["agePrior"] & { confidence: string };
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
    const base = SOURCES.get(id)!.base;
    const [drift, scene] = await Promise.all([
      readJson(`${base}/drift.json`) as Promise<RealDriftRun>,
      readJson(`${base}/scene.json`) as Promise<RealSceneFile>,
      ensureRealTraffic(id),
    ]);
    if (!drift.frames?.length) throw new Error(`${id}: the exported drift has no frames`);
    // The outlines are smoothed here and masked to water (`densityGrid`), so
    // the coastline has to be in hand for everywhere the cloud reaches.
    let reach = 0;
    for (const frame of drift.frames)
      for (let k = 0; k < frame.particles.length; k += 2)
        reach = Math.max(reach, distanceKm(drift.seed, [frame.particles[k], frame.particles[k + 1]]));
    // Far enough out for simulated lanes too (`planCorridors` reaches 110 km),
    // in case this place has no AIS and traffic has to be simulated.
    await ensureLandmask(drift.seed, Math.max(reach + 20, 140));
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

  const measured = scene.characterisation;
  let characterisation: Characterisation;
  if (measured) {
    // The backend's numbers, field by field (not spread: the export carries
    // more than the console's type, and the extras belong in `backend`).
    characterisation = {
      detectionId: `${id}-det`,
      areaKm2: measured.areaKm2,
      lengthKm: measured.lengthKm,
      widthMMean: measured.widthMMean,
      widthMProfile: measured.widthMProfile,
      orientationDeg: measured.orientationDeg,
      elongation: measured.elongation,
      compactness: measured.compactness,
      fragmentation: measured.fragmentation,
      head: measured.head,
      tail: measured.tail,
      headTailResolvedBy: "ambiguous",
      medialAxis: measured.medialAxis,
      // NaN renders as "not measured", which is what a null from the export means.
      dampingRatioDb: measured.dampingRatioDb ?? Number.NaN,
      dampingConfidence: "low",
      windSpeedMs: measured.windSpeedMs ?? windAtPass,
      windGateMultiplier: measured.windGateMultiplier ?? windGate(windAtPass),
      backend: {
        source: measured.source,
        dampingNote: measured.damping?.note ?? null,
        windNote: measured.wind
          ? `${measured.wind.source}, ${Math.abs(measured.wind.offsetS / 60).toFixed(0)} min from the pass`
          : null,
        agePrior: measured.agePrior,
      },
    };
  } else {
    const axis = medialAxis(seedRing.ring);
    const geom: SlickGeometry = { parts: [seedRing.ring], centreline: axis, head: axis[0], tail: axis[axis.length - 1] };
    characterisation = characterise(`${id}-det`, geom, {
      windSpeedMs: windAtPass,
      // No backscatter reached the console for exports made before the
      // backend characterisation; NaN renders as "not measured".
      dampingRatioDb: Number.NaN,
      headResolved: false,
    });
  }
  const measuredNote = measured
    ? `Characterisation: ${measured.source}` +
      (measured.dampingRatioDb === null ? "; damping not measured. " : `; damping ${measured.dampingRatioDb.toFixed(1)} dB, a relative contrast (C2). `)
    : "Characterisation: measured in the console from the simplified ring; damping not measured. ";

  /*
    The 50% and 90% outlines, smoothed from OpenDrift's own parcels -- all of
    them, every member -- by the blur and contour the authored scenes use
    (`sim/field.ts`), so a real run and an authored one are drawn the same way.
    The export also holds the backend's answer on its 0.01 degree grid, as cell
    boxes (`contour_geojson`); drawn as they are, those read as pixel art next
    to an authored scene (ISSUES F18). They stay in the file and are quoted in
    the provenance; the areas printed are the outlines drawn.
  */
  const frames = drift.frames.map((f) => {
    const particles = Float64Array.from(f.particles);
    // A forecast hour after every parcel stranded has nothing afloat to outline.
    const grid = particles.length
      // Masked on deep land only: see `densityGrid` for why the raster coast is not enough here.
      ? densityGrid(particles, particles.length / 2, undefined, undefined, undefined, deepAshore)
      : null;
    const table = grid && massTable(grid);
    const contour50 = grid && table ? contour(grid, levelForMass(table, 0.5)) : [];
    const contour90 = grid && table ? contour(grid, levelForMass(table, 0.9)) : [];
    return {
      hour: f.hour,
      at: acquiredAt + f.hour * HOUR,
      particles,
      contour50,
      contour90,
      area50Km2: contour50.reduce((sum, r) => sum + ringAreaKm2(r), 0),
      area90Km2: contour90.reduce((sum, r) => sum + ringAreaKm2(r), 0),
      spreadKm: f.spreadKm,
    };
  });
  // Frames run from the hindcast horizon through the pass to the forecast
  // horizon; the pass is hour 0, not the last frame.
  const passIndex = frames.findIndex((f) => f.hour === 0);
  const pass = frames[passIndex];
  const cellsAtHorizon = drift.frames[0].area90Km2;
  const cellsAtPass = drift.frames[passIndex].area90Km2;
  const horizon = frames[0];
  const ahead = frames.filter((f) => f.hour > 0);
  const lastAhead = drift.frames[drift.frames.length - 1];
  // The forecast envelope, drawn the way an authored scene's is: the 90% outline every 12 h.
  const forwardImpact = ahead.filter((f) => f.hour % 12 === 0).flatMap((f) => f.contour90);
  const realTracks = realVessels(id);
  // No AIS for this place and time (marinecadastre is US waters only, ISSUES
  // F14): simulated voyages are drawn instead, SIM wherever they show. Display
  // only: the radar matching and the gate below read the real tracks alone, so
  // a simulated ship can never make a real radar target look matched.
  const simulatedTraffic = !realTracks.length;
  const vessels = simulatedTraffic
    ? buildTraffic(
        {
          corridors: planCorridors(drift.seed).corridors,
          vesselCount: 24,
          cadenceS: 120,
          windowHours: drift.backwardHours + 8,
          acquiredAt,
        },
        makeRng(seedFrom(`sim-traffic-${id}`)),
      )
    : realTracks;
  // A loop, not Math.min(...): tens of thousands of reports overflow the stack.
  let firstReport = acquiredAt;
  for (const v of realTracks) for (const p of v.points) if (p.t < firstReport) firstReport = p.t;
  const aisHours = Math.round((acquiredAt - firstReport) / HOUR);

  // The scene's own radar returns near the seed, each matched to a real vessel
  // that reported within 10 minutes and 0.5 km of it at the pass. An unmatched
  // return is a dark vessel or an installation: CFAR cannot tell which.
  const MATCH_KM = 0.5;
  const reportedAtPass = realTracks.filter((v) => v.points.some((p) => Math.abs(p.t - acquiredAt) <= 10 * 60_000));
  const passPositions = reportedAtPass.map((v) => positionAt(v, acquiredAt)).filter((p): p is LngLat => p !== null);
  const radar = scene.cfar?.status === "run" ? scene.cfar.targets : [];
  const cfarTargets = radar.map((t, i) => ({
    id: `cfar-${i}`,
    position: t.position,
    // An extent from the target's area on the 10 m grid, not a measured length.
    lengthM: Math.round(Math.sqrt(t.areaPx) * 10),
    matched: passPositions.some((p) => distanceKm(p, t.position) <= MATCH_KM),
  }));
  const matched = cfarTargets.filter((t) => t.matched).length;
  const radarNote = scene.cfar?.status === "run"
    ? `Radar: CA-CFAR on the scene within ${scene.cfar.radiusKm ?? 15} km of the seed, ${cfarTargets.length} bright ` +
      `target${cfarTargets.length === 1 ? "" : "s"}, ${matched} matched to AIS at the pass. `
    : `Radar: CFAR not run (${scene.cfar?.reason ?? "exported before it existed"}). `;
  // The age is the export's own (`estimate_age`), a triple with its method
  // (C1), when the backward field has a convergence minimum; otherwise a
  // refusal. Either way nothing is ranked: wind-only, or not yet scored (X16).
  const triple = drift.age.age_hours;
  const aged = drift.age.status === "converged" && !!triple &&
    [triple.low, triple.best, triple.high].every((v) => v !== null && Number.isFinite(v));
  const ageHours: [number, number, number] = aged
    ? [triple!.low!, triple!.best!, triple!.high!]
    : [0, drift.backwardHours, drift.backwardHours];
  const currents = drift.forcing === "era5+cmems";
  const windOnly = (currents
    ? "ranking a real field is not built yet (ISSUES X16), although this one is current-forced (CMEMS). "
    : "the field is wind-only: there is no current field (ISSUES X2), and a wind-only field cannot " +
      "carry an attribution. ") +
    // The scorer's own first refusal (C9), which no forcing can lift: below the
    // Bragg threshold the sea is dark with or without oil on it.
    (characterisation.windGateMultiplier === 0
      ? `The wind at the pass, ${characterisation.windSpeedMs.toFixed(1)} m/s, puts the wind gate at 0 as well, so ` +
        "no ranking here would mean anything whatever the forcing. "
      : "") +
    (simulatedTraffic
      ? `No real AIS here; ${vessels.length} simulated vessels are shown, none scored.`
      : `${vessels.length} real vessels are shown; none is scored.`);
  const reasons = aged
    ? `An age but no ranking. The backward field is tightest ${ageHours[1].toFixed(1)} h before the ` +
      `pass (${ageHours[0].toFixed(1)} / ${ageHours[1].toFixed(1)} / ${ageHours[2].toFixed(1)} h, convergence ` +
      `minimum: ${drift.age.explanation ?? "OpenDrift ensemble spread"}); its 90% contour is ` +
      `${pass.area90Km2.toFixed(1)} km2 at the pass and ${horizon.area90Km2.toFixed(0)} km2 at ${horizon.hour} h. ` +
      `But ${windOnly}`
    : `No age and no ranking. The backward field never converges -- its 90% contour widens ` +
      `from ${pass.area90Km2.toFixed(1)} km2 at the pass to ` +
      `${horizon.area90Km2.toFixed(0)} km2 at ${horizon.hour} h -- so convergence gives no age ` +
      `(${drift.age.status ?? "monotonic"}), and ${windOnly}`;

  // Detections, not rings: a MultiPolygon detection is several rings. An
  // export without the feature index can only be counted in rings, and says so.
  const rings = scene.detections.length;
  const features = scene.detections.every((d) => d.feature !== undefined)
    ? new Set(scene.detections.map((d) => d.feature)).size
    : null;
  const counted = features === null
    ? `${rings} slick polygon${rings === 1 ? "" : "s"}`
    : `${features} detection${features === 1 ? "" : "s"} (${rings} polygon${rings === 1 ? "" : "s"})`;
  const pick = drift.seedDetection;
  // Say which detection was hindcast and what was passed over for it. The
  // largest detections in these scenes are boxes the model filled (ISSUES Q5);
  // seeding from one of those is what this sentence exists to rule out.
  const seedNote = pick
    ? `the drift is seeded from ${pick.rule} (${pick.areaKm2.toFixed(1)} km2, confidence ` +
      `${pick.confidence.toFixed(2)}; ${pick.passedOver.frameCut} larger box-cut and ` +
      `${pick.passedOver.ashore} ashore detection${pick.passedOver.ashore === 1 ? "" : "s"} passed over)`
    : `the drift is seeded from the largest (confidence ${seedRing.confidence.toFixed(2)})`;
  const apiRun = SOURCES.get(id)?.apiRun ?? null;
  // A live pipeline run says how it detected: two-pass on the raster it was
  // given, or a PRECOMPUTED segmentation of that exact file (§1.5).
  const detected = apiRun
    ? `REAL · Live pipeline run ${apiRun} (POST /api/v1/runs). Detections: ${scene.detectionSource}, `
    : `REAL · Detections: the release model (L1-ciou research) on the full Sentinel-1 scene, `;
  const aisNote = !simulatedTraffic
    ? `AIS: marinecadastre.gov, identities withheld; it covers the last ${aisHours} h of the ` +
      `${drift.backwardHours} h hindcast. `
    : "AIS: none for this place and time (marinecadastre covers US waters only, ISSUES F14). The " +
      `${vessels.length} vessels drawn are SIMULATED voyages on lanes laid around the coast, for display only: ` +
      "no radar target is matched to them and nobody is scored. ";
  const flow = completeFlow(scene.flow, [...scene.detections.filter((d) => d.seed).map((d) => d.ring), ...frames.flatMap((f) => f.contour90)],
    scene.wind.hours, drift.seed);
  const simulatedParts = [
    simulatedTraffic && "the ship traffic",
    isSimulated(flow.windSource) && "the wind arrows",
    isSimulated(flow.currentSource) && "the current arrows",
  ].filter((part): part is string => !!part);
  const provenance =
    (simulatedParts.length ? `SIM ${simulatedParts.join(", ")} (no real data for this place and time) · ` : "") +
    detected +
    `${counted}; ${seedNote}. SAR alone cannot tell oil ` +
    `from a natural film (ISSUES Q2). Drift: ${drift.engine}, ${drift.members} members x ` +
    `${drift.particlesPerMember} particles, ${drift.backwardHours} h backward, ${drift.forcingNote} ` +
    `The 50% and 90% outlines are smoothed from OpenDrift's ${drift.members * drift.particlesPerMember} parcels ` +
    `the way the authored scenes are; on the export's own 0.01 degree grid the 90% region is ` +
    `${cellsAtPass.toFixed(1)} km2 at the pass and ${cellsAtHorizon.toFixed(0)} km2 at ${-drift.backwardHours} h. ` +
    `Every member starts from the same parcels, spread over the seed slick itself. ` +
    (drift.forwardHours > 0 && ahead.length
      ? `Forecast: the same parcels run forward ${drift.forwardHours} h on the ERA5 wind after the pass` +
        (lastAhead.strandedPct !== undefined ? `; ${lastAhead.strandedPct.toFixed(1)}% reach the coast by +${lastAhead.hour} h. ` : ". ")
      : "No forecast was exported for this run. ") +
    `${aisNote}${radarNote}${measuredNote}Wind: ${scene.wind.source}. ` +
    (simulatedParts.length
      ? `Simulated, and labelled SIM: ${simulatedParts.join(", ")}. Nobody is ranked -- see the drift pane for why.`
      : "Nothing here is simulated, and nobody is ranked -- see the drift pane for why.");

  const hours = scene.wind.hours;
  // The mean around the slick, as the flow cards read it: a point at a seed
  // against the coast falls in the current field's land cells.
  const around = ringsBbox(scene.detections.filter((d) => d.seed).map((d) => d.ring), 1.5);
  const measuredCurrent = (h: number) => {
    const v = isSimulated(flow.currentSource) ? null : flowMean(flow, "current", around, h);
    return v ? speedToward(v) : null;
  };
  return {
    meta: {
      id,
      name: [...REAL_RUN_LISTINGS, ...apiListings].find((l) => l.id === id)!.name,
      region: "gulf-of-mexico",
      place: apiRun
        ? `at ${Math.abs(drift.seed[1]).toFixed(3)}°${drift.seed[1] >= 0 ? "N" : "S"} ` +
          `${Math.abs(drift.seed[0]).toFixed(3)}°${drift.seed[0] >= 0 ? "E" : "W"}`
        : "off the Mississippi delta, Gulf of Mexico",
      provenance,
      acquiredAt,
      centre: drift.seed,
      zoom: 9,
      // May's view as the user framed it (2026-09-26): the console opens on it.
      ...(id === "real-20230515" ? { view: { west: -90.28, east: -87.67, south: 27.732, zoom: 8.24 } } : {}),
      sceneId: drift.scene,
      summary:
        `The model's ${counted} in a real Sentinel-1 scene, OpenDrift's backward field ` +
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
      partKinds: scene.detections.map((d): DetectionPartKind => (d.seed ? "seed" : d.boxCut ? "box" : "other")),
      partConfidence: scene.detections.map((d) => d.confidence),
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
      ageHours,
      ageMethod: aged ? "drift_convergence" : "no_convergence",
      // The authored engine's rule (`drift.ts`), so both read an age the same way.
      temporalState: aged ? (ageHours[1] <= 6 ? "ongoing" : ageHours[1] <= 24 ? "recent" : "legacy") : "indeterminate",
      insufficientEvidence: { area90Km2: horizon.area90Km2, reason: reasons,
        kind: !aged ? "no_age" : currents ? "unscored" : "wind_only" },
      diffuseThresholdKm2: DIFFUSE_THRESHOLD_KM2,
    },
    vessels,
    suspects: [],
    infrastructure: [],
    cfarTargets,
    forwardImpact,
    // Nobody knows when this oil entered the water; there is no release to play.
    release: [],
    releaseStartHour: -drift.backwardHours,
    releaseEndHour: -drift.backwardHours,
    aisPointCount: vessels.reduce((s, v) => s + v.points.length, 0),
    environment: {
      hours,
      windMs: scene.wind.ms,
      windFromDeg: scene.wind.fromDeg,
      // Measured currents only (CMEMS, at the seed); a simulated one stays NaN
      // here, because these charts carry no SIM label. NaN, not zero: zero
      // would read as a measured slack current.
      currentMs: hours.map((h) => measuredCurrent(h)?.speed ?? Number.NaN),
      currentTowardDeg: hours.map((h) => measuredCurrent(h)?.towardDeg ?? Number.NaN),
      tideMs: hours.map(() => Number.NaN),
    },
    flow,
    trafficSource: simulatedTraffic ? "SIM voyages" : "marinecadastre AIS",
    gate: { considered: realTracks.length, admitted: 0, reason: reasons },
    separability: null,
    truth: null,
  };
}
