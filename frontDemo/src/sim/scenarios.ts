/**
 * The five scenarios the demo runs, and the builder that assembles one.
 *
 * Three are shaped on the published Port of South Louisiana cases from
 * Zhao et al. 2025 (Mar. Pollut. Bull., doi:10.1016/j.marpolbul.2025.118608).
 * Their acquisition times, slick lengths and suspected-source coordinates are
 * the paper's; everything the paper does not state is simulated, and the
 * scenario's `provenance` string says which is which so nothing here can be
 * mistaken for a measurement.
 *
 * Two are Indian-waters scenarios with authored ground truth (C10). Free real
 * AIS covers US waters only, which is why the project is dual-region in the
 * first place.
 *
 * Vessel identities are masked throughout. The paper names the real ships; a
 * demo has no reason to.
 */

import { advect, fieldProbabilityAt, runDrift, runRelease } from "./drift";
import { makeForcing, type FieldConfig, type Forcing } from "./field";
import { bearingDeg, centroid, circleRing, destination, distanceKm } from "./geo";
import { makeRng, seedFrom } from "./rng";
import {
  berthedDischarge,
  buildTraffic,
  movingDischarge,
  positionAt,
  type Corridor,
} from "./ais";
import { score, type DriftVariant } from "./scoring";
import { buildSlick, characterise, seedPoints, windGate } from "./slick";
import type {
  Environment,
  LngLat,
  Run,
  ScenarioId,
  ScenarioMeta,
  Vessel,
} from "./types";

/** Re-exported so the dozen existing `from "../sim/scenarios"` imports stand. */
export type { ScenarioId };

export interface ScenarioListing {
  id: ScenarioId;
  name: string;
  short: string;
  region: "gulf-of-mexico" | "indian-waters";
  tests: string;
}

export const SCENARIOS: ScenarioListing[] = [
  {
    id: "gom-moving",
    name: "Moving discharge",
    short: "Underway tanker, 19 km trail",
    region: "gulf-of-mexico",
    tests: "The straightforward case. Every term agrees.",
  },
  {
    id: "gom-berthed",
    name: "Berthed discharge",
    short: "Vessel moored two days, still discharging",
    region: "gulf-of-mexico",
    tests:
      "The adversarial case. Parity and proximity both fail; only the drift field reaches the berth.",
  },
  {
    id: "gom-platform",
    name: "Platform leak",
    short: "Fixed installation, no vessel within 5 km",
    region: "gulf-of-mexico",
    tests: "Infrastructure has to outrank vessels without a special case.",
  },
  {
    id: "kutch-dark",
    name: "Dark vessel",
    short: "Radar contact, transponder off",
    region: "indian-waters",
    tests: "A candidate with no identity is ranked and never named.",
  },
  {
    id: "mumbai-null",
    name: "Look-alike, no spill",
    short: "Low wind, biogenic film",
    region: "indian-waters",
    tests:
      "The system has to name nobody. A pipeline that always produces a suspect is useless.",
  },
];

/* ------------------------------------------------------------------ *
 * Scenario definitions
 * ------------------------------------------------------------------ */

interface ScenarioSpec {
  meta: Omit<ScenarioMeta, "acquiredAt"> & { acquiredAtIso: string };
  field: FieldConfig;
  /** Where the oil entered the water, before any drift. */
  release: LngLat;
  /**
   * Hours the release has been running, or for a finished one, how long ago it
   * stopped. Authored (C10).
   */
  releaseAgeHours: number;
  /**
   * Whether oil was still entering the water at acquisition.
   *
   * This decides where the head of the slick is, and it is the distinction
   * P004 asks for in its future work: an ongoing discharge still has its source
   * at the head of the slick, while a finished one has drifted clear of it and
   * needs the backward run to find where it started.
   */
  ongoing: boolean;
  slick: {
    /** Bearing of the ribbon at the moment it was laid. */
    axisDeg: number;
    lengthKm: number;
    headWidthM: number;
    tailWidthM: number;
    meanderKm: number;
    fragments: number;
    className: "oos" | "slick_unknown";
    confidence: number;
    dampingRatioDb: number;
  };
  drift: {
    backwardHours: number;
    forwardHours: number;
    ensembleSize: number;
    perMember: number;
    diffusivity: number;
    diffuseThresholdKm2: number;
  };
  traffic: { corridors: Corridor[]; vesselCount: number };
  infrastructure: { id: string; label: string; position: LngLat }[];
  infrastructureCoverage: "complete" | "partial";
  /** How the true source appears in the data, if at all. */
  source:
    | {
        type: "moving";
        courseDeg: number;
        sogKn: number;
        /** How long the discharge ran. Slick length follows from this. */
        durationHours: number;
        kind: string;
        lengthM: number;
      }
    | { type: "berthed"; approachBearingDeg: number; approachKm: number; mooredHoursBefore: number; kind: string; lengthM: number }
    | { type: "platform"; infraId: string }
    | { type: "dark"; lengthM: number }
    | { type: "none" };
}

const DEG_MIN_SEC = (d: number, m: number, s: number) => d + m / 60 + s / 3600;

/** P004 Case 2, 00:02 UTC 15 May 2023. Southern tip at the suspected source. */
const GOM_CASE_2: LngLat = [
  -DEG_MIN_SEC(89, 13, 31.332),
  DEG_MIN_SEC(28, 21, 31.968),
];

/** P004 Case 3, 23:57:19 UTC 5 Dec 2023. Northern peak at the suspected source. */
const GOM_CASE_3: LngLat = [
  -DEG_MIN_SEC(89, 58, 7.356),
  DEG_MIN_SEC(28, 56, 12.876),
];

/** P004 Case 1, 00:02 UTC 9 April 2023. Northern tip at the platform group. */
const GOM_CASE_1: LngLat = [
  -DEG_MIN_SEC(89, 37, 8.076),
  DEG_MIN_SEC(29, 6, 58.176),
];

/** Midpoint of the 19 km discharge line, bearing 17 degrees from the tip. */
const GOM_CASE_2_MID: LngLat = [-89.1755, 28.4407];

const KUTCH: LngLat = [69.42, 22.46];
const MUMBAI_HIGH: LngLat = [71.62, 19.48];

const SPECS: Record<ScenarioId, ScenarioSpec> = {
  "gom-moving": {
    meta: {
      id: "gom-moving",
      name: "Moving discharge",
      region: "gulf-of-mexico",
      provenance:
        "Acquisition time, slick length and suspected-source coordinate from Zhao et al. 2025 Case 2. Drift field, AIS traffic and all scores are simulated.",
      acquiredAtIso: "2023-05-15T00:02:00Z",
      centre: [-89.28, 28.28],
      zoom: 9.6,
      sceneId: "S1A_IW_GRDH_1SDV_20230515T000200_GoM",
      place: "the Port of South Louisiana",
      summary:
        "A 19 km ribbon trailing south of the Mississippi Delta, laid in under two hours by a vessel underway and then carried downstream for most of a day.",
      tests: "The straightforward case. Every term agrees.",
      expectedTop1: "The vessel that laid the trail",
    },
    field: {
      meanU: -0.09,
      meanV: -0.17,
      eddy: { centre: [-89.42, 28.18], radiusKm: 26, strengthMs: 0.11 },
      convergence: { centre: GOM_CASE_2_MID, radiusKm: 17, strengthMs: 0.035 },
      tideMs: 0.05,
      tidePhaseHours: 2.4,
      windMs: 6.4,
      windDirDeg: 148,
      windRotateDegPerHour: 0.35,
    },
    release: GOM_CASE_2,
    releaseAgeHours: 4,
    ongoing: false,
    slick: {
      axisDeg: 197,
      lengthKm: 19,
      headWidthM: 220,
      tailWidthM: 640,
      meanderKm: 0.5,
      fragments: 1,
      className: "oos",
      confidence: 0.91,
      dampingRatioDb: -7.4,
    },
    drift: {
      backwardHours: 30,
      forwardHours: 48,
      ensembleSize: 12,
      perMember: 320,
      diffusivity: 1.6,
      diffuseThresholdKm2: 420,
    },
    traffic: {
      vesselCount: 190,
      corridors: [
        { from: [-89.7, 28.9], to: [-88.7, 27.9], widthKm: 6 },
        { from: [-89.9, 28.2], to: [-88.6, 28.55], widthKm: 5 },
        { from: [-89.15, 29.1], to: [-89.45, 27.7], widthKm: 4 },
      ],
    },
    infrastructure: [
      { id: "infra-mp-311", label: "Platform group MP-311", position: [-89.44, 28.46] },
      { id: "infra-sp-89", label: "Platform group SP-89", position: [-89.05, 28.62] },
    ],
    infrastructureCoverage: "complete",
    source: {
      type: "moving",
      // Northbound. The discharge therefore trails away to the south, which is
      // the orientation the published case reports.
      courseDeg: 17,
      sogKn: 8.0,
      durationHours: 19 / (8.0 * 1.852),
      kind: "Product tanker",
      lengthM: 183,
    },
  },

  "gom-berthed": {
    meta: {
      id: "gom-berthed",
      name: "Berthed discharge",
      region: "gulf-of-mexico",
      provenance:
        "Acquisition time, slick length and suspected-source coordinate from Zhao et al. 2025 Case 3, where the vessel had been moored for two days. Drift field, AIS traffic and all scores are simulated.",
      acquiredAtIso: "2023-12-05T23:57:19Z",
      centre: [-89.96, 28.9],
      zoom: 10.6,
      sceneId: "S1A_IW_GRDH_1SDV_20231205T235719_GoM",
      place: "the Port of South Louisiana",
      summary:
        "A 5 km band running south from a mooring. The vessel at the head of it has not moved since the third of December, so its track parallels nothing.",
      tests:
        "The adversarial case. Parity and proximity both fail; only the drift field reaches the berth.",
      expectedTop1: "The moored vessel",
    },
    field: {
      meanU: -0.02,
      meanV: -0.085,
      eddy: { centre: [-90.1, 28.78], radiusKm: 18, strengthMs: 0.05 },
      convergence: { centre: GOM_CASE_3, radiusKm: 11, strengthMs: 0.05 },
      tideMs: 0.04,
      tidePhaseHours: 5.1,
      windMs: 5.1,
      windDirDeg: 22,
      windRotateDegPerHour: -0.28,
    },
    release: GOM_CASE_3,
    releaseAgeHours: 16,
    ongoing: true,
    slick: {
      axisDeg: 186,
      lengthKm: 5.1,
      headWidthM: 140,
      tailWidthM: 430,
      meanderKm: 0.28,
      fragments: 2,
      className: "oos",
      confidence: 0.84,
      dampingRatioDb: -6.1,
    },
    drift: {
      backwardHours: 36,
      forwardHours: 48,
      ensembleSize: 12,
      perMember: 320,
      diffusivity: 3.2,
      diffuseThresholdKm2: 420,
    },
    traffic: {
      vesselCount: 260,
      corridors: [
        { from: [-90.25, 29.1], to: [-89.6, 28.6], widthKm: 4 },
        { from: [-90.15, 28.7], to: [-89.55, 29.05], widthKm: 3.5 },
        // The berth sits on a working channel. Traffic passes within a few
        // hundred metres of it constantly, which is what makes this case a
        // filtering problem rather than a lookup.
        { from: [-89.985, 29.06], to: [-89.955, 28.72], widthKm: 1.1 },
        { from: [-90.06, 28.905], to: [-89.87, 28.965], widthKm: 0.9 },
      ],
    },
    infrastructure: [
      { id: "infra-wd-73", label: "Platform group WD-73", position: [-90.09, 28.99] },
    ],
    infrastructureCoverage: "partial",
    source: {
      type: "berthed",
      approachBearingDeg: 228,
      approachKm: 26,
      mooredHoursBefore: 53,
      kind: "Offshore supply",
      lengthM: 64,
    },
  },

  "gom-platform": {
    meta: {
      id: "gom-platform",
      name: "Platform leak",
      region: "gulf-of-mexico",
      provenance:
        "Acquisition time, slick length and suspected-source coordinate from Zhao et al. 2025 Case 1, where no vessel track lay within 5 km. Drift field, AIS traffic and all scores are simulated.",
      acquiredAtIso: "2023-04-09T00:02:00Z",
      centre: [-89.62, 29.06],
      zoom: 10.4,
      sceneId: "S1A_IW_GRDH_1SDV_20230409T000200_GoM",
      place: "the South Pass lease blocks",
      summary:
        "A 5.5 km banded slick with its northern tip on a platform group, and the nearest vessel track well outside the origin window.",
      tests: "Infrastructure has to outrank vessels without a special case.",
      expectedTop1: "The platform group",
    },
    field: {
      meanU: 0.03,
      meanV: -0.1,
      eddy: { centre: [-89.5, 29.0], radiusKm: 20, strengthMs: 0.06 },
      convergence: { centre: GOM_CASE_1, radiusKm: 13, strengthMs: 0.045 },
      tideMs: 0.045,
      tidePhaseHours: 0.8,
      windMs: 7.2,
      windDirDeg: 65,
      windRotateDegPerHour: 0.2,
    },
    release: GOM_CASE_1,
    releaseAgeHours: 15,
    ongoing: true,
    slick: {
      axisDeg: 163,
      lengthKm: 5.5,
      headWidthM: 170,
      tailWidthM: 520,
      meanderKm: 0.3,
      fragments: 1,
      className: "oos",
      confidence: 0.88,
      dampingRatioDb: -8.2,
    },
    drift: {
      backwardHours: 30,
      forwardHours: 48,
      ensembleSize: 12,
      perMember: 320,
      diffusivity: 3.0,
      diffuseThresholdKm2: 420,
    },
    traffic: {
      vesselCount: 180,
      corridors: [
        { from: [-89.95, 29.35], to: [-89.2, 28.8], widthKm: 5 },
        { from: [-89.85, 28.85], to: [-89.15, 29.3], widthKm: 4 },
        // Passing traffic, kept outside the 5 km radius the published case
        // reports as empty. Collation has to rank the platform above these
        // without a rule that says so.
        { from: [-89.80, 29.30], to: [-89.66, 28.88], widthKm: 2.0 },
      ],
    },
    infrastructure: [
      { id: "infra-sp-52", label: "Platform group SP-52", position: GOM_CASE_1 },
      { id: "infra-sp-47", label: "Platform group SP-47", position: [-89.53, 29.19] },
    ],
    infrastructureCoverage: "complete",
    source: { type: "platform", infraId: "infra-sp-52" },
  },

  "kutch-dark": {
    meta: {
      id: "kutch-dark",
      name: "Dark vessel",
      region: "indian-waters",
      provenance:
        "Authored scenario. Ground truth is written by us, never derived from an anomaly detector, and the AIS is synthetic because free real AIS covers US waters only.",
      acquiredAtIso: "2024-02-18T00:41:00Z",
      centre: [69.4, 22.42],
      zoom: 10.2,
      sceneId: "S1A_IW_GRDH_1SDV_20240218T004100_KUTCH",
      place: "the Gulf of Kutch",
      summary:
        "A 9 km trail in the approaches to the Gulf of Kutch. A radar bright target sits at the head of it with no AIS report anywhere near.",
      tests: "A candidate with no identity is ranked and never named.",
      expectedTop1: "An unlit radar contact, unnamed",
    },
    field: {
      meanU: -0.13,
      meanV: 0.06,
      eddy: { centre: [69.28, 22.3], radiusKm: 22, strengthMs: 0.08 },
      convergence: { centre: KUTCH, radiusKm: 14, strengthMs: 0.04 },
      tideMs: 0.11,
      tidePhaseHours: 3.7,
      windMs: 5.8,
      windDirDeg: 305,
      windRotateDegPerHour: 0.4,
    },
    release: KUTCH,
    releaseAgeHours: 18,
    ongoing: true,
    slick: {
      axisDeg: 295,
      lengthKm: 9.2,
      headWidthM: 180,
      tailWidthM: 500,
      meanderKm: 0.42,
      fragments: 2,
      className: "oos",
      confidence: 0.79,
      dampingRatioDb: -6.8,
    },
    drift: {
      backwardHours: 28,
      forwardHours: 48,
      ensembleSize: 12,
      perMember: 320,
      diffusivity: 1.5,
      diffuseThresholdKm2: 420,
    },
    traffic: {
      vesselCount: 230,
      corridors: [
        { from: [69.05, 22.68], to: [69.95, 21.98], widthKm: 5 },
        { from: [68.95, 22.25], to: [69.9, 22.62], widthKm: 5 },
        { from: [69.6, 22.9], to: [69.3, 21.95], widthKm: 4 },
      ],
    },
    infrastructure: [
      { id: "infra-vadinar", label: "Vadinar SPM buoy", position: [69.72, 22.38] },
    ],
    infrastructureCoverage: "partial",
    source: { type: "dark", lengthM: 118 },
  },

  "mumbai-null": {
    meta: {
      id: "mumbai-null",
      name: "Look-alike, no spill",
      region: "indian-waters",
      provenance:
        "Authored scenario. There is no spill in it. Ground truth is that nobody is responsible.",
      acquiredAtIso: "2024-03-02T00:52:00Z",
      centre: [71.6, 19.5],
      zoom: 9.8,
      sceneId: "S1A_IW_GRDH_1SDV_20240302T005200_MH",
      place: "the Mumbai High field",
      summary:
        "A large dark patch near the Mumbai High field at 1.9 m/s wind. Low wind flattens the sea on its own, and a flat sea is dark whether or not there is oil on it.",
      tests:
        "The system has to name nobody. A pipeline that always produces a suspect is useless.",
      expectedTop1: "Nobody. Insufficient evidence.",
    },
    field: {
      meanU: 0.05,
      meanV: 0.04,
      eddy: { centre: [71.45, 19.62], radiusKm: 30, strengthMs: 0.03 },
      // No convergence cell. Nothing pulls the cloud together, so the field just
      // spreads, which is the correct behaviour and the reason this run reports
      // insufficient evidence rather than a suspect.
      convergence: { centre: MUMBAI_HIGH, radiusKm: 10, strengthMs: 0 },
      tideMs: 0.03,
      tidePhaseHours: 1.2,
      windMs: 1.9,
      windDirDeg: 240,
      windRotateDegPerHour: 0.9,
    },
    release: MUMBAI_HIGH,
    releaseAgeHours: 18,
    ongoing: false,
    slick: {
      axisDeg: 74,
      lengthKm: 12.5,
      headWidthM: 900,
      tailWidthM: 1500,
      meanderKm: 1.6,
      fragments: 3,
      className: "slick_unknown",
      confidence: 0.44,
      dampingRatioDb: -3.1,
    },
    drift: {
      backwardHours: 42,
      forwardHours: 48,
      ensembleSize: 12,
      perMember: 320,
      diffusivity: 6.5,
      diffuseThresholdKm2: 300,
    },
    traffic: {
      vesselCount: 240,
      corridors: [
        { from: [71.1, 19.9], to: [72.2, 19.1], widthKm: 7 },
        { from: [71.15, 19.2], to: [72.15, 19.8], widthKm: 6 },
        { from: [71.75, 20.0], to: [71.4, 18.95], widthKm: 5 },
      ],
    },
    infrastructure: [
      { id: "infra-mh-north", label: "Mumbai High North complex", position: [71.52, 19.66] },
      { id: "infra-mh-south", label: "Mumbai High South complex", position: [71.68, 19.36] },
    ],
    infrastructureCoverage: "complete",
    source: { type: "none" },
  },
};

/* ------------------------------------------------------------------ *
 * The forcing, sampled
 * ------------------------------------------------------------------ */

/**
 * The wind and current this event ran through, hour by hour.
 *
 * Read from the same `Forcing` the drift ensemble and the release both step
 * through, at the centroid of the detected slick, across the whole event span.
 * Nothing is modelled here that was not already modelled: this is the interface
 * being given access to the physics the simulation was already using, so the
 * environment charts are a window onto the run rather than a second story about
 * it.
 *
 * The tidal component is recovered analytically rather than by differencing,
 * because `FieldConfig` states it directly -- the semidiurnal ellipse is a term
 * in the sum, not an emergent property of it.
 */
function sampleEnvironment(
  cfg: FieldConfig,
  forcing: Forcing,
  at: LngLat,
  fromHour: number,
  toHour: number,
): Environment {
  const hours: number[] = [];
  const windMs: number[] = [];
  const windFromDeg: number[] = [];
  const currentMs: number[] = [];
  const currentTowardDeg: number[] = [];
  const tideMs: number[] = [];

  for (let h = Math.floor(fromHour); h <= Math.ceil(toHour); h++) {
    const [wu, wv] = forcing.wind(at, h);
    const [cu, cv] = forcing.current(at, h);

    hours.push(h);
    windMs.push(Math.hypot(wu, wv));
    // `wind()` returns the vector the air travels along; the reported direction
    // is the one it comes from, so the vector is reversed before conversion.
    windFromDeg.push((Math.atan2(-wu, -wv) * 180) / Math.PI);
    currentMs.push(Math.hypot(cu, cv));
    currentTowardDeg.push((Math.atan2(cu, cv) * 180) / Math.PI);

    // The semidiurnal term on its own, along its major axis. 12.42 h is the
    // M2 period `makeForcing` uses.
    const w = ((h + cfg.tidePhaseHours) / 12.42) * 2 * Math.PI;
    tideMs.push(cfg.tideMs * Math.cos(w));
  }

  const norm = (d: number) => ((d % 360) + 360) % 360;
  return {
    hours,
    windMs,
    windFromDeg: windFromDeg.map(norm),
    currentMs,
    currentTowardDeg: currentTowardDeg.map(norm),
    tideMs,
  };
}

/* ------------------------------------------------------------------ *
 * Builder
 * ------------------------------------------------------------------ */

/** Field probability at which a candidate counts as coincident with the source. */
const COINCIDENCE_THRESHOLD = 0.06;

const cache = new Map<string, Run>();

export function buildRun(id: ScenarioId, variant: DriftVariant = "integral"): Run {
  const key = `${id}:${variant}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const run = assemble(id, variant);
  cache.set(key, run);
  return run;
}

function assemble(id: ScenarioId, variant: DriftVariant): Run {
  const spec = SPECS[id];
  const rng = makeRng(seedFrom(id));
  const acquiredAt = Date.parse(spec.meta.acquiredAtIso);
  const forcing = makeForcing(spec.field);

  // The slick head sits where the last oil entered the water. For a moving
  // discharge that is the far end of the line the vessel drew, not the tip the
  // published case names.
  const releasePoint =
    spec.source.type === "moving"
      ? destination(
          spec.release,
          spec.source.courseDeg,
          spec.source.durationHours * spec.source.sogKn * 1.852,
        )
      : spec.release;

  // An ongoing discharge still has oil entering at the source, so the head of
  // the slick sits on it. A finished one has drifted clear, and the head is the
  // release point carried forward through the same forcing the hindcast will
  // later run backward. Building it that way is the forward-consistency
  // property EVALUATION.md asks of the real engine, applied to the generator.
  const slickHead = spec.ongoing
    ? releasePoint
    : advect(releasePoint, forcing, -spec.releaseAgeHours, 0, 0.03);

  // The ribbon's bearing at acquisition: the bearing it was laid on, rotated by
  // however much the flow sheared it.
  const geom = buildSlick(
    {
      source: slickHead,
      axisDeg: spec.slick.axisDeg,
      lengthKm: spec.slick.lengthKm,
      headWidthM: spec.slick.headWidthM,
      tailWidthM: spec.slick.tailWidthM,
      meanderKm: spec.slick.meanderKm,
      fragments: spec.slick.fragments,
    },
    rng,
  );

  const windSpeedMs = spec.field.windMs;
  const characterisation = characterise(`${id}-det`, geom, {
    windSpeedMs,
    dampingRatioDb: spec.slick.dampingRatioDb,
    headResolved: id !== "mumbai-null",
  });

  const seeds = seedPoints(geom, 420, rng);
  const { run: driftRun, grids } = runDrift(
    {
      seeds,
      forcing,
      acquiredAt,
      backwardHours: spec.drift.backwardHours,
      forwardHours: spec.drift.forwardHours,
      ensembleSize: spec.drift.ensembleSize,
      perMember: spec.drift.perMember,
      diffusivity: spec.drift.diffusivity,
      diffuseThresholdKm2: spec.drift.diffuseThresholdKm2,
      truthAgeHours: spec.source.type === "none" ? null : spec.releaseAgeHours,
    },
    rng,
  );

  /* --- AIS ------------------------------------------------------- */

  const cadenceS = 120;
  const windowHours = spec.drift.backwardHours + 8;
  const vessels: Vessel[] = buildTraffic(
    {
      corridors: spec.traffic.corridors,
      vesselCount: spec.traffic.vesselCount,
      cadenceS,
      windowHours,
      acquiredAt,
    },
    rng,
  );

  let truth: Run["truth"] = null;
  let truthId: string | null = null;
  const darkTargets: { id: string; position: LngLat; lengthM: number }[] = [];

  if (spec.source.type === "moving") {
    const scripted = movingDischarge(
      {
        dischargeStart: spec.release,
        courseDeg: spec.source.courseDeg,
        sogKn: spec.source.sogKn,
        endedHoursBefore: spec.releaseAgeHours,
        durationHours: spec.source.durationHours,
        windowHours,
        cadenceS: 60,
        acquiredAt,
        kind: spec.source.kind,
        lengthM: spec.source.lengthM,
      },
      rng,
    );
    vessels.unshift(scripted);
    truthId = scripted.mmsi;
    truth = {
      label: scripted.label,
      position: spec.release,
      releasedAt: acquiredAt - spec.releaseAgeHours * 3600_000,
    };
  }

  if (spec.source.type === "berthed") {
    const approach = destination(
      spec.release,
      spec.source.approachBearingDeg,
      spec.source.approachKm,
    );
    const scripted = berthedDischarge(
      {
        approachFrom: approach,
        berth: spec.release,
        mooredHoursBefore: spec.source.mooredHoursBefore,
        windowHours: Math.max(windowHours, spec.source.mooredHoursBefore + 6),
        cadenceS: 300,
        acquiredAt,
        kind: spec.source.kind,
        lengthM: spec.source.lengthM,
      },
      rng,
    );
    vessels.unshift(scripted);
    truthId = scripted.mmsi;
    truth = {
      label: scripted.label,
      position: spec.release,
      releasedAt: acquiredAt - spec.releaseAgeHours * 3600_000,
    };
  }

  if (spec.source.type === "platform") {
    truthId = spec.source.infraId;
    const infra = spec.infrastructure.find((i) => i.id === truthId);
    if (infra) {
      truth = {
        label: infra.label,
        position: infra.position,
        releasedAt: acquiredAt - spec.releaseAgeHours * 3600_000,
      };
    }
  }

  if (spec.source.type === "dark") {
    darkTargets.push({
      id: "dark-01",
      // A vessel still discharging is at the head of its own slick.
      position: destination(spec.release, spec.slick.axisDeg + 180, 0.2),
      lengthM: spec.source.lengthM,
    });
    truthId = "dark-01";
    truth = {
      label: "Unlit contact",
      position: spec.release,
      releasedAt: acquiredAt - spec.releaseAgeHours * 3600_000,
    };
  }

  /* --- CFAR bright targets ---------------------------------------- */

  // Bright targets are what the radar sees; a target with a matching AIS report
  // is an identified ship, and one without is a dark contact.
  const cfarTargets = vessels
    .filter((_, i) => i % 4 === 0)
    .slice(0, 22)
    .map((v, i) => {
      const p = positionAt(v, acquiredAt) ?? [v.points[0].lon, v.points[0].lat];
      return {
        id: `cfar-${i}`,
        position: p as LngLat,
        lengthM: v.lengthM,
        matched: true,
      };
    });
  for (const d of darkTargets) {
    cfarTargets.push({
      id: d.id,
      position: d.position,
      lengthM: d.lengthM,
      matched: false,
    });
  }

  /* --- Scoring ---------------------------------------------------- */

  const scored = score({
    drift: { ...driftRun, id: `${id}-drift`, detectionId: `${id}-det` },
    grids,
    characterisation,
    acquiredAt,
    vessels,
    infrastructure: spec.infrastructure,
    darkTargets,
    variant,
    truthId,
    infrastructureCoverage: spec.infrastructureCoverage,
  });

  // Age refined by source coincidence where a candidate actually falls inside
  // the 50% contour. PHASE-04 calls this the operationally meaningful signal:
  // the timestep at which the high-probability region first reaches a candidate.
  const refined = refineAge(driftRun, scored.suspects, vessels, grids);

  /* --- The release, forward ---------------------------------------- */

  // How long oil was entering the water, and where from. For a moving
  // discharge the source travels with the vessel, which is what draws the line
  // rather than a growing blob.
  const moving = spec.source.type === "moving" ? spec.source : null;
  const releaseStartHour = moving
    ? -(spec.releaseAgeHours + moving.durationHours)
    : -spec.releaseAgeHours;
  const releaseEndHour = moving ? -spec.releaseAgeHours : 0;

  const movingSource = moving
    ? (hour: number) =>
        destination(
          spec.release,
          moving.courseDeg,
          Math.max(0, hour - releaseStartHour) * moving.sogKn * 1.852,
        )
    : undefined;

  const release = runRelease(
    {
      source: spec.release,
      sourceAt: movingSource,
      forcing,
      acquiredAt,
      startHour: releaseStartHour,
      endHour: releaseEndHour,
      forwardHours: spec.drift.forwardHours,
      ratePerHour: Math.max(
        60,
        Math.round(2400 / Math.max(1, releaseEndHour - releaseStartHour)),
      ),
      // Much lower than the hindcast's. These two diffusivities are different
      // quantities and it is right that they differ: the release spreads real
      // oil across the sea surface, while the backward ensemble spreads
      // uncertainty about where that oil came from. Uncertainty grows far
      // faster than a slick does.
      diffusivity: spec.drift.diffusivity * 0.1,
      windFactor: 0.03,
      targetAreaKm2: characterisation.areaKm2,
    },
    makeRng(seedFrom(`${id}-release`)),
  );

  /* --- Forward impact --------------------------------------------- */

  const forwardImpact = driftRun.frames
    .filter((f) => f.hour > 0 && f.hour % 12 === 0)
    .flatMap((f) => f.contour90);

  const aisPointCount = vessels.reduce((s, v) => s + v.points.length, 0);

  // Sampled at the slick centroid over the same span the playback covers,
  // so a reader scrubbing the event and a reader reading the wind chart are
  // looking at the same hours.
  const environment = sampleEnvironment(
    spec.field,
    forcing,
    centroid(geom.parts.flat()),
    Math.min(releaseStartHour, -spec.drift.backwardHours),
    spec.drift.forwardHours,
  );

  const meta: ScenarioMeta = { ...spec.meta, acquiredAt };

  return {
    meta,
    detection: {
      id: `${id}-det`,
      sceneId: spec.meta.sceneId,
      className: spec.slick.className,
      confidence: spec.slick.confidence,
      parts: geom.parts,
      acquiredAt,
    },
    characterisation,
    drift: {
      ...driftRun,
      ...refined,
      id: `${id}-drift`,
      detectionId: `${id}-det`,
      insufficientEvidence:
        scored.insufficientEvidence ?? driftRun.insufficientEvidence,
    },
    vessels,
    suspects: scored.suspects,
    infrastructure: spec.infrastructure,
    cfarTargets,
    forwardImpact,
    release,
    releaseStartHour,
    releaseEndHour,
    aisPointCount,
    environment,
    gate: scored.gate,
    separability: scored.separability,
    truth,
  };
}

/**
 * Age from source coincidence, falling back to the convergence minimum.
 *
 * PHASE-04 lists two independent signals. The convergence minimum is the
 * spatial one; source coincidence is the operationally meaningful one, because
 * what an investigator wants is not "when was the cloud tightest" but "when did
 * the field reach something that could have released this".
 *
 * The interval is the span of backward hours over which the top candidate sat
 * inside the 90% contour, and the best estimate is the hour it sat deepest in
 * the field. It is always three numbers and a method (C1).
 */
function refineAge(
  driftRun: Omit<import("./types").DriftRun, "id" | "detectionId">,
  suspects: import("./types").Suspect[],
  vessels: Vessel[],
  grids: Map<number, import("./drift").FieldFrame>,
): Pick<
  import("./types").DriftRun,
  "ageHours" | "ageMethod" | "temporalState"
> {
  const fallback = {
    ageHours: driftRun.ageHours,
    ageMethod: driftRun.ageMethod,
    temporalState: driftRun.temporalState,
  };
  if (driftRun.insufficientEvidence || !suspects.length) return fallback;

  const top = suspects[0];
  const vessel = vessels.find((v) => v.mmsi === top.id);

  const hits: number[] = [];
  let bestHour = 0;
  let bestDepth = -1;

  for (const frame of driftRun.frames) {
    if (frame.hour > 0) continue;
    const p = vessel ? positionAt(vessel, frame.at) : top.position;
    if (!p) continue;

    // Tested against the field itself rather than against the 90% ring. A
    // source that is still discharging sits at the very tip of the slick, and
    // the tip is exactly the mass a 90% contour excludes, so ring membership
    // would report no coincidence for the clearest case there is.
    const depth = fieldProbabilityAt(grids, frame.hour, p);
    if (depth >= COINCIDENCE_THRESHOLD) {
      hits.push(Math.abs(frame.hour));
      if (depth > bestDepth) {
        bestDepth = depth;
        bestHour = Math.abs(frame.hour);
      }
    }
  }

  if (hits.length < 2) return fallback;

  const low = Math.min(...hits);
  const high = Math.max(...hits);
  const best = Math.min(high, Math.max(low, bestHour));
  const temporalState =
    best <= 6 ? "ongoing" : best <= 24 ? "recent" : ("legacy" as const);

  return {
    ageHours: [low, best, high],
    ageMethod: "source_coincidence",
    temporalState,
  };
}

/* ------------------------------------------------------------------ *
 * Small helpers the UI needs and would otherwise reimplement
 * ------------------------------------------------------------------ */

export { windGate, circleRing, distanceKm, bearingDeg, positionAt };

export function scenarioListing(id: ScenarioId): ScenarioListing {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

/** Clears the memo, used when the scoring variant changes shape. */
export function resetRunCache() {
  cache.clear();
}
