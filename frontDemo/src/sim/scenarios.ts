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

import {
  advect,
  fieldProbabilityAt,
  runDrift,
  runRelease,
  type ReleaseShapeName,
} from "./drift";
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
import { buildSlick, characterise, seedPoints, windGate, type SlickGeometry } from "./slick";
import { SAMPLE_SPECS, SAMPLE_LISTINGS } from "./samples";
import { hasRealTraffic, publishedVesselId, realVessels } from "./realAis";
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
  region: "gulf-of-mexico" | "indian-waters" | "south-china-sea";
  tests: string;
}

export const SCENARIOS: ScenarioListing[] = [
  {
    id: "gom-moving",
    name: "Moving discharge",
    short: "Southbound tanker, 19 km trail, real AIS",
    region: "gulf-of-mexico",
    tests:
      "The straightforward case. Drift and proximity both put the true vessel first. Parity does not, because it measures the whole nearby transit rather than the stretch that was discharging.",
  },
  {
    id: "gom-berthed",
    name: "Berthed discharge",
    short: "Vessel moored three days, real AIS",
    region: "gulf-of-mexico",
    tests:
      "The adversarial case. Parity is weak for a vessel that never moved, and passing real traffic beats it on that term; it has to win on drift, proximity and timing instead.",
  },
  {
    id: "gom-platform",
    name: "Platform leak",
    short: "Fixed installation among real traffic",
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

export interface ScenarioSpec {
  geometry?: SlickGeometry;
  meta: Omit<ScenarioMeta, "acquiredAt"> & { acquiredAtIso: string };
  field: FieldConfig;
  /** Where the oil entered the water, before any drift. */
  release: LngLat;
  /**
   * How the discharge rate varies across its window. Authored (C10).
   *
   * Omitted means `steady`, which is what every scenario was before these were
   * assigned -- a perfectly constant tap, giving every scene the same straight
   * accumulation line at a different length.
   */
  releaseShape?: ReleaseShapeName;
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
  /**
   * Background traffic. `real` scenes draw theirs from marinecadastre AIS
   * (`sim/realAis.ts`) and ignore the corridors; the rest are simulated.
   */
  traffic: { corridors: Corridor[]; vesselCount: number; real?: boolean };
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

/**
 * Where the Case 2 discharge began, read off the named vessel's real AIS.
 *
 * The published case gives the tip, a 19 km length and the vessel; it does not
 * give the direction the vessel was going. This scene used to assume north,
 * at 17 degrees, with the discharge over four hours before the pass. The real
 * track says otherwise, measured from marinecadastre 2023-05-14/15: over the
 * 1.28 h a 19 km trail takes at 8 kn, the vessel ran 18.44 km on 179.3 degrees
 * at a mean 7.78 kn, and at 00:02:21 -- the pass -- it was 104 m from the
 * published tip. Southbound, and still laying oil when the satellite went
 * over. This is its reported position at T-1.28 h.
 */
const GOM_CASE_2_START: LngLat = [-89.22823, 28.52485];

/**
 * P004 Case 3, 23:57:19 UTC 5 Dec 2023. Northern peak at the suspected source.
 *
 * CORRECTED 2026-09-22 from 89 degrees 58' W to 88 degrees 58' W. The real AIS
 * of the vessel the case names puts it moored at (-88.96927, 28.93729) from
 * before 00:01 on 3 December until 23:45 on the 5th -- 0.07 km from
 * 88 58' 07.356" W and 97 km from the 89 58' this constant used to hold. The
 * minutes, seconds and latitude agree to the metre; only the degree differs,
 * which is a transcription error, not a different place. The whole scene moved
 * one degree east with it.
 */
const GOM_CASE_3: LngLat = [
  -DEG_MIN_SEC(88, 58, 7.356),
  DEG_MIN_SEC(28, 56, 12.876),
];

/** P004 Case 1, 00:02 UTC 9 April 2023. Northern tip at the platform group. */
const GOM_CASE_1: LngLat = [
  -DEG_MIN_SEC(89, 37, 8.076),
  DEG_MIN_SEC(29, 6, 58.176),
];

/**
 * Centre of the `gom-moving` convergence cell.
 *
 * The comment here used to call this "the midpoint of the 19 km discharge line,
 * bearing 17 degrees from the tip". Measured, it is neither: it lies 10.32 km
 * from `GOM_CASE_2` on a bearing of 28.2 degrees, which puts it 2.10 km east of
 * the actual midpoint (9.5 km along bearing 17). The constant is left where it
 * is -- it is a field parameter and moving it would change every number in this
 * scenario -- but it is no longer described as something it is not.
 */
const GOM_CASE_2_MID: LngLat = [-89.1755, 28.4407];

/**
 * The coordinates the publication gives for the two named vessels, for
 * `check:realais`, which asserts each vessel's real track actually reaches its
 * published point. That check is what caught the Case 3 degree error.
 */
export const PUBLISHED_SOURCES: Partial<Record<ScenarioId, LngLat>> = {
  "gom-moving": GOM_CASE_2,
  "gom-berthed": GOM_CASE_3,
};

const KUTCH: LngLat = [69.42, 22.46];
const MUMBAI_HIGH: LngLat = [71.62, 19.48];

/**
 * Every scenario that is written down. `upload` is excluded by construction:
 * it is built from a raster at runtime and there is nothing to author.
 */
const AUTHORED_SPECS: Record<Exclude<ScenarioId, "upload">, ScenarioSpec> = {
  ...SAMPLE_SPECS,
  "gom-moving": {
    meta: {
      id: "gom-moving",
      name: "Moving discharge",
      region: "gulf-of-mexico",
      provenance:
        "AIS · REAL: every vessel track, including the vessel Zhao et al. 2025 name for Case 2, is marinecadastre.gov AIS for 13-15 May 2023, simplified to within 100 m and with identities withheld. Acquisition time, slick length and suspected-source coordinate are the paper's; the discharge's direction and timing are read off the named vessel's real track. SIM: the slick outline, the drift field and every score are simulated, so a real vessel's rank here demonstrates the gate on real traffic and is not a finding about that vessel.",
      acquiredAtIso: "2023-05-15T00:02:00Z",
      centre: [-89.28, 28.28],
      zoom: 9.6,
      sceneId: "S1A_IW_GRDH_1SDV_20230515T000200_GoM",
      place: "the Port of South Louisiana",
      summary:
        "A 19 km ribbon south of the Mississippi Delta, laid behind a tanker running south at 7.8 kn that was still at its southern tip, still discharging, when the satellite passed.",
      tests:
        "The straightforward case. Drift and proximity both put the true vessel first. Parity does not, because it measures the whole nearby transit rather than the stretch that was discharging.",
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
    // A valve open while the vessel is underway; the window is 1.3 h, too
    // short for a pump to do anything interesting in. It ends AT the pass:
    // the real track has the vessel at the tip at 00:02, so the head of the
    // slick is the vessel and the ribbon runs back north along its wake.
    releaseShape: "steady",
    release: GOM_CASE_2_START,
    releaseAgeHours: 0,
    ongoing: true,
    slick: {
      axisDeg: 359,
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
    // Real marinecadastre AIS; see `sim/realAis.ts`. The corridors that used
    // to be here were synthetic lanes and are gone with the traffic they drew.
    traffic: { real: true, vesselCount: 0, corridors: [] },
    infrastructure: [
      { id: "infra-mp-311", label: "Platform group MP-311", position: [-89.44, 28.46] },
      { id: "infra-sp-89", label: "Platform group SP-89", position: [-89.05, 28.62] },
    ],
    infrastructureCoverage: "complete",
    source: {
      type: "moving",
      // Southbound, measured -- see GOM_CASE_2_START. The oil is laid along the
      // vessel's own reported track, so these three only time the release.
      courseDeg: 179.3,
      sogKn: 7.8,
      durationHours: 19 / (8.0 * 1.852),
      kind: "Tanker",
      lengthM: 180,
    },
  },

  "gom-berthed": {
    meta: {
      id: "gom-berthed",
      name: "Berthed discharge",
      region: "gulf-of-mexico",
      provenance:
        "AIS · REAL: every vessel track, including the vessel Zhao et al. 2025 name for Case 3, is marinecadastre.gov AIS for 4-5 December 2023, simplified to within 100 m and with identities withheld; there is no AIS after 23:59 on the 5th on this machine, so the forecast hours carry none. The published coordinate is corrected by one degree of longitude to where that vessel's AIS puts its berth (see GOM_CASE_3). Acquisition time and slick length are the paper's. SIM: the slick outline, the drift field and every score are simulated, so a real vessel's rank here demonstrates the gate on real traffic and is not a finding about that vessel.",
      acquiredAtIso: "2023-12-05T23:57:19Z",
      centre: [-88.96, 28.9],
      zoom: 10.6,
      sceneId: "S1A_IW_GRDH_1SDV_20231205T235719_GoM",
      place: "the Port of South Louisiana",
      summary:
        "A 5 km band running south from a berth. The vessel at its head had been moored there since before the third of December and slipped twelve minutes before the pass, so for almost the whole window its track parallels nothing.",
      tests:
        "The adversarial case. Parity is weak for a vessel that never moved, and passing real traffic beats it on that term; it has to win on drift, proximity and timing instead.",
      expectedTop1: "The moored vessel",
    },
    field: {
      meanU: -0.02,
      meanV: -0.085,
      // One degree east with the corrected berth, like everything in this scene.
      eddy: { centre: [-89.1, 28.78], radiusKm: 18, strengthMs: 0.05 },
      convergence: { centre: GOM_CASE_3, radiusKm: 11, strengthMs: 0.05 },
      tideMs: 0.04,
      tidePhaseHours: 5.1,
      windMs: 5.1,
      windDirDeg: 22,
      windRotateDegPerHour: -0.28,
    },
    // Moored and discharging on pump cycles, which is what a berthed vessel
    // emptying slops actually does.
    releaseShape: "pulsed",
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
    // Real marinecadastre AIS; see `sim/realAis.ts`. The four synthetic lanes
    // that used to be here were placed around the wrong berth, 97 km west.
    traffic: { real: true, vesselCount: 0, corridors: [] },
    infrastructure: [
      // Moved east with the berth, and renamed: "WD" was West Delta, which is
      // where the uncorrected coordinate put it and this is not.
      { id: "infra-p-73", label: "Platform group P-73", position: [-89.09, 28.99] },
    ],
    infrastructureCoverage: "partial",
    source: {
      type: "berthed",
      /*
        The vessel's track is its real AIS, so the approach and mooring below
        drive nothing in this scene; they are what that AIS shows, kept so the
        spec does not describe a different voyage. Measured from marinecadastre
        3-5 December 2023: already moored at 00:01 on the 3rd (so at least 72 h
        before the pass -- the 53 h this used to state was authored, not read),
        slipped at 23:45 on the 5th, twelve minutes before it, and 78 m long.
      */
      approachBearingDeg: 105,
      approachKm: 26,
      mooredHoursBefore: 72,
      kind: "Offshore supply",
      lengthM: 78,
    },
  },

  "gom-platform": {
    meta: {
      id: "gom-platform",
      name: "Platform leak",
      region: "gulf-of-mexico",
      provenance:
        "AIS · REAL: every vessel track is marinecadastre.gov AIS for 7-9 April 2023, at this scene's position, simplified to within 100 m and with identities withheld. Acquisition time and slick geometry are Zhao et al. 2025 Case 1's; the POSITION is not the published one. The whole scene is displaced 85 km south-south-west of the Case 1 coordinate, out of the Mississippi bird's-foot and into the open Gulf, because a credible region bounded by marsh on three sides describes the delta rather than the oil. The published case reports no vessel within 5 km of its platform; this displaced scene makes no such claim -- whatever real traffic passed here is what the platform has to outrank. SIM: the slick outline, the drift field and every score are simulated.",
      acquiredAtIso: "2023-04-09T00:02:00Z",
      centre: [-89.62, 29.06],
      zoom: 10.4,
      sceneId: "S1A_IW_GRDH_1SDV_20230409T000200_GoM",
      // Displaced out of the South Pass lease blocks; see DISPLACEMENTS.
      place: "the open Gulf south-west of South Pass",
      summary:
        "A 5.5 km banded slick with its northern tip on a platform group, in the real traffic that passed this position over the two days before the pass.",
      /*
        WHAT THIS SCENARIO TESTS, now that its traffic is real.

        It used to run a synthetic lane straight over the slick so that the
        platform had vessels to outrank, and the numbers recorded here were
        measured against that lane. The lane is gone -- the traffic is whatever
        real AIS passed this position on 7-9 April 2023 -- and so are those
        numbers. The ranking the platform now earns against real traffic is
        measured by `npm run check:scenarios` and not restated here, because a
        figure in a comment is how this file came to disagree with itself.
      */
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
    // A fixed installation with a fault that worsens: nothing, then a
    // rising rate. This is the one whose slick genuinely starts tiny.
    releaseShape: "building",
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
    // Real marinecadastre AIS at the displaced position; see `sim/realAis.ts`.
    traffic: { real: true, vesselCount: 0, corridors: [] },
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
        "SIM · Authored scenario, displaced 139 km west of the Gulf of Kutch into the open Arabian Sea so the scene is not pressed against a coast on both sides. Ground truth is written by us, never derived from an anomaly detector, and the AIS is synthetic because free real AIS covers US waters only.",
      acquiredAtIso: "2024-02-18T00:41:00Z",
      centre: [69.4, 22.42],
      zoom: 10.2,
      sceneId: "S1A_IW_GRDH_1SDV_20240218T004100_KUTCH",
      // Displaced out of the gulf itself; see DISPLACEMENTS.
      place: "the Arabian Sea west of the Gulf of Kutch",
      summary:
        "A 9 km trail in the approaches to the Gulf of Kutch. A radar bright target sits at the head of it, in a working lane, carrying no AIS report of its own.",
      tests: "A candidate with no identity is ranked and never named.",
      /*
        STILL FALSE UNDER THE `max` VARIANT. Left standing deliberately, and the
        diagnosis is now much sharper than it was.

        Under `integral` this holds: `dark-01` ranks 1 at 0.6390 with the next
        candidate at 0.5422. Switch S_drift to `max` -- which the interface lets
        a reader do -- and the contact falls to rank 3 behind a 32 m tug at
        0.6572, the top-two margin drops to 0.0058, and the run trips the
        separability branch and reports insufficient evidence instead.

        This was treated as a corridor-placement problem for two sessions. It is
        not one. Twelve geometries were measured on 2026-09-05, including one
        that fixes `max` outright in all three corridor slots: the requirement
        that fails is not "traffic is too close to the release" but "a fixed
        point cannot win under a rule that scores tracks by their best cell".
        `dark-01` has one sample, so its max and its integral are the same
        number; a vessel's max is the densest cell anywhere along it. Any lane
        whose vessels cross the slick -- and they must, or the map stops showing
        an attribution problem -- puts them in the field peak. The corridor note
        above carries the measurements.

        THE PRIOR LEVER WAS PULLED ON 2026-09-05 AND IS NOT ENOUGH. `scoreDark`
        used to score `prior` as `min(0.8, lengthM/260)` -- pure size, where a
        vessel's prior is 78% class and 22% size -- giving a 118 m contact
        0.4538, below an identified 118 m general cargo at 0.4898. That was a
        real defect and it is fixed: `unknownClassPrior` now applies the vessel
        formula with the class term averaged over the classes the measured
        length admits. For this contact that is General cargo alone, so it lands
        on exactly 0.4898, the same prior the one class it could be would get.

        The effect is real but small. `dark-01` goes 0.6390 -> 0.6419 and the
        `integral` margin widens 0.0968 -> 0.0997. Under `max` it stays rank 3,
        because the gap to close is 0.0153 on a term weighted 0.08: **the prior
        would have to be 0.6811** to take first place. There is no honest route
        to that number. The obvious argument for one -- that running dark is
        itself suspicious -- is already spent, explicitly, in the `behaviour`
        term, and spending it twice is double counting.

        So one lever remains, and it is the one that re-scores everything:
        `max` reduces a track by its single densest cell and a point by its only
        cell. Changing that is a director decision about the scoring model, not
        a tidy-up.

        Nothing compares this string to anything -- it is prose. What sits under
        it IS now checked: `checkExpectation` below fires on this scenario under
        `max`, by design, so the failure is visible in any dev console instead
        of only in this comment. See the note on the field in `types.ts`.
      */
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
    // A tank emptied fast and then trailing off -- the reason to run dark
    // is to be finished before anyone looks.
    releaseShape: "tapering",
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
      /*
        Re-authored 2026-09-05, because all three of these ran over land.

        The Gulf of Kutch is a narrow funnel between the Kutch peninsula to the
        north and Saurashtra to the south, and the previous corridors were laid
        out without checking either shore. Measured against the basemap raster,
        the old set was 52%, 20% and 54% land: the first ended inland near
        Jamjodhpur, the third crossed the whole Saurashtra peninsula and had
        *both* endpoints on dry ground. Two hundred and thirty vessels then drew
        their tracks straight across it.

        The replacements are 0% land, sampled at 25 points along each centreline
        and at four lateral offsets out to the full `widthKm`, which is roughly
        two sigma of the scatter `buildTraffic` applies. They keep the three
        roles: c1 is the gulf trunk running the length of the funnel, c2 comes
        in off the Arabian Sea through the mouth, and c3 is the local lane that
        passes the release, so the gate still has to filter traffic that
        genuinely could have been the source. c1 and c2 pass at 13.8 and 8.1 km;
        the old set sat at 5.8 and 2.8, so the scene is slightly less crowded at
        the release than it was, which is the price of the south shore being
        where it is. Moving c3 further out was attempted on 2026-09-05 and
        reverted; the note on it records what that cost and why the trade is not
        available.

        HOW A CORRIDOR USED TO BE CHECKED, and how it is checked now

        The project now carries a global land mask -- `src/sim/landmask.ts`,
        the GSHHG shoreline OpenDrift uses, rasterised by
        `scripts/build_landmask.py` -- so `npm run check:corridors` tests every
        lane in every scenario against it automatically, across the full
        lateral scatter, and asserts that no vessel on any lane is ashore.
        Running that is the answer to this question. `buildTraffic` also
        re-sails any voyage that touches land, from a stream of its own so the
        rest of the scene is unchanged.

        The by-hand method below is HISTORICAL. It is how these lanes were first
        placed, before the project had coastline geometry, and it is kept
        because the numbers recorded against them were measured this way. It
        classified the basemap picture rather than a coastline, and that picture
        disagrees with GSHHG in places -- it called Venice, Louisiana water.
        What it did was sample the tiles themselves. Fetch
        `Ocean/World_Ocean_Base` at z=10 for the point, read the pixel, and
        classify on `blue - red`: water is blue-dominant (+36 to +54 across the
        points checked here) and land is a near-white cream (-3 to -7). The gap
        is wide enough that any threshold around +12 separates them. Calibrate
        on two known points before trusting a run.
      */
      corridors: [
        { from: [68.85, 22.5], to: [70.05, 22.68], widthKm: 5 },
        { from: [68.88, 22.8], to: [69.55, 22.48], widthKm: 5 },
        /*
          THE LOCAL LANE, and the one that gives the gate its work. Its
          centreline passes 2.27 km off the release, and 27 of its 36 admitted
          tracks cross the T0 detection polygon -- which is the point of it, and
          the constraint that decided the attempt described below.

          HISTORICAL FIGURES. Every count and distance in this note was measured
          against the straight-corridor generator that `voyage()` in `ais.ts`
          replaced on 2026-09-23, when simulated ships started taking routes of
          their own that funnel through this lane and fan out beyond it. The
          lane's geometry and its role are unchanged; the figures describe the
          old run, not this one. What the run does now is measured by
          `npm run check:scenarios` -- the dark contact still ranks first under
          `integral`.

          `buildTraffic` scatters each vessel laterally by
          `rng.normal() * widthKm * 0.5`, so sigma here is 1.75 km and 2.27 km
          is 1.3 sigma -- well inside the traffic, not clear of it. What the run
          contains is a nearest AIS report 248 m from the bright target, a
          nearest track 70 m from it, 8 reports inside 500 m from 5 vessels,
          33 inside 1 km from 13, and 135 inside 2 km from 29.

          MOVING THIS LANE WAS TRIED ON 2026-09-05 AND REVERTED. Recorded in
          full, because the next person to look at `expectedTop1` will have the
          same idea.

          The brief was to move the lane clear of the origin field so the
          scenario would stop failing its own `expectedTop1` under the `max`
          S_drift variant. That is achievable: a lane at
          `[69.38, 22.35] -> [69.62, 22.70]`, widthKm 2.6, is 0% land over
          17806 samples and keeps `dark-01` first under both variants in all
          three corridor slots, with margins of 0.287 to 0.351 against the 0.015
          halt floor. It was built, measured, and thrown away, because it also
          moved every AIS line off the oil: nearest report 248 m -> 863 m,
          nothing at all inside 500 m, and no track crossing the slick. The
          director rejected it on sight, and was right to -- the lines running
          over the slick is what makes this a scene rather than a scatter plot.

          Twelve geometries were measured in total. THE TWO REQUIREMENTS ARE
          MUTUALLY EXCLUSIVE AT THE DATA LEVEL, and the reason is in the scorer,
          not here: the slick sits inside the origin field, so a lane whose
          vessels cross the slick necessarily puts them in the field peak, and
          under `max` a vessel is scored by the densest cell its track ever
          touches while `dark-01` is one fixed point whose max and integral are
          equal. Every crossing candidate measured -- 13 to 28 crossing tracks
          -- loses the contact its first place under `max`. Every candidate that
          holds first place crosses nothing.

          So the lane stays where it is, and the `max` failure is left standing
          as a scorer question. See the note on `expectedTop1`, and the long
          note in `scoreDark` in `scoring.ts`.

          Any replacement still has to be land-checked against the basemap
          raster, per the method recorded above -- and sampled at or below the
          z=10 pixel size. Two candidates in this round measured 0% land on a
          900-sample envelope grid and 0.08-0.09% at 150 m spacing: the coarse
          grid had stepped over a single 400 m islet at [69.404, 22.528], and it
          sat at 1.3-1.6 sigma, not out in the tail where it could be waved off.
        */
        { from: [69.24, 22.34], to: [69.68, 22.7], widthKm: 3.5 },
      ],
    },
    infrastructure: [
      // Moved north out of Vadinar town, where it had been sitting on dry land.
      // A single point mooring is a buoy tankers berth against; it is offshore
      // by definition, and this one is now in the water it has to be in.
      { id: "infra-vadinar", label: "Vadinar SPM buoy", position: [69.72, 22.45] },
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
      /*
        No convergence cell, so nothing pulls the cloud together.

        This comment used to add "which is the correct behaviour and the reason
        this run reports insufficient evidence rather than a suspect". Measured,
        that attributes the refusal to the wrong mechanism. The field does not
        spread far enough to trip anything: the 90% origin contour is 15.2 km2 at
        its tightest and 129.6 km2 at its widest, against this scenario's
        `diffuseThresholdKm2` of 300, so `deriveAge` returns
        `insufficientEvidence: null` and `ageMethod` stays `drift_convergence`
        rather than `beyond_horizon`.

        The refusal is the wind gate. `windGate(1.9)` is 0.00, which is below the
        scorer's 0.15 floor, so every total is multiplied to exactly zero and the
        wind branch fires first. Absent convergence still matters -- it is why
        this looks like a look-alike rather than a spill -- but it is not what
        withholds the attribution.
      */
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
 * Presentation displacement
 * ------------------------------------------------------------------ */

/**
 * Two scenes are moved bodily out to open water, 2026-09-22.
 *
 * `gom-platform` was centred in the West Bay side of the Mississippi bird's-foot
 * and `kutch-dark` inside the Gulf of Kutch, which is 31% land inside the
 * masked box. Both are real places for the events they depict, and the land
 * mask now keeps parcels and contours off the shore correctly -- but the result
 * still reads as a spill pressed up against a coastline, and a hindcast whose
 * credible region is bounded by a marsh on three sides is telling the operator
 * more about the geography than about the oil.
 *
 * The displacement is a rigid translation of the whole scene: release, forcing
 * centres, every shipping lane, every installation. That is deliberate and it
 * is the only transform that is safe here. Each of these scenarios is tuned
 * against measured properties -- which vessel passes how close, the corridor
 * ORDER that `buildTraffic` consumes round-robin, the rank-1 margin and the
 * separability floor -- and every one of those is a statement about relative
 * geometry. A translation leaves all of them exactly as authored. Moving the
 * release alone, or nudging lanes individually, would quietly invalidate the
 * numbers recorded in the comments above.
 *
 * The authored coordinates stay in `AUTHORED_SPECS` above rather than being
 * overwritten, so the published case positions remain readable in source and
 * the offset applied to them is visible rather than baked in.
 *
 * WHAT THIS COSTS, stated plainly: `gom-platform` draws its release from
 * `GOM_CASE_1`, the suspected-source coordinate published in Zhao et al. 2025
 * Case 1. Displaced, the scene is no longer at that coordinate, so `provenance`
 * no longer claims it is -- it says the geometry is the published case's and
 * the position is not. Presenting a moved scene as being at a published
 * position would be the one kind of error this project cannot afford.
 */
const DISPLACEMENTS: Partial<Record<ScenarioId, LngLat>> = {
  // West Bay to the open Gulf, 85 km south-south-west. Clearance from the
  // nearest land, measured over the whole scene including its shipping lanes,
  // goes from ashore to 24 km.
  "gom-platform": [-0.15, -0.75],
  // Gulf of Kutch to the Arabian Sea west of Dwarka, 139 km west. Clearance
  // 22 km on the same measure.
  "kutch-dark": [-1.35, 0.1],
};

const shift = (p: LngLat, by: LngLat): LngLat => [p[0] + by[0], p[1] + by[1]];

/** Every coordinate-bearing field of a spec, translated together. */
function displace(spec: ScenarioSpec, by: LngLat): ScenarioSpec {
  return {
    ...spec,
    meta: { ...spec.meta, centre: shift(spec.meta.centre, by) },
    field: {
      ...spec.field,
      eddy: { ...spec.field.eddy, centre: shift(spec.field.eddy.centre, by) },
      convergence: {
        ...spec.field.convergence,
        centre: shift(spec.field.convergence.centre, by),
      },
    },
    release: shift(spec.release, by),
    traffic: {
      ...spec.traffic,
      corridors: spec.traffic.corridors.map((c) => ({
        ...c,
        from: shift(c.from, by),
        to: shift(c.to, by),
      })),
    },
    infrastructure: spec.infrastructure.map((i) => ({
      ...i,
      position: shift(i.position, by),
    })),
  };
}

/**
 * The slot an uploaded raster fills.
 *
 * `SPECS` is a total record over `ScenarioId`, and making it partial to admit
 * one runtime entry would push an undefined check into every consumer for the
 * sake of a case that is always populated before anything reads it. A neutral
 * open-water placeholder keeps the type honest; `registerUpload` replaces it
 * with the real thing and drops the cached runs built from whatever was there
 * before.
 */
const UPLOAD_PLACEHOLDER: ScenarioSpec = {
  ...AUTHORED_SPECS.sample1,
  meta: {
    ...AUTHORED_SPECS.sample1.meta,
    id: "upload",
    name: "Uploaded image",
    provenance: "SIM · No raster has been uploaded yet.",
  },
};

const SPECS: Record<ScenarioId, ScenarioSpec> = {
  ...(Object.fromEntries(
    Object.entries(AUTHORED_SPECS).map(([id, spec]) => {
      const by = DISPLACEMENTS[id as ScenarioId];
      return [id, by ? displace(spec, by) : spec];
    }),
  ) as Record<ScenarioId, ScenarioSpec>),
  upload: UPLOAD_PLACEHOLDER,
};

/**
 * Install a spec built from a real uploaded raster, and forget the last one.
 *
 * The run cache is keyed by id and variant, so without the eviction a second
 * upload would silently show the first one's results under the new file's name
 * -- which is exactly the class of bug the panel this replaces was made of.
 */
export function registerUpload(spec: ScenarioSpec): void {
  SPECS.upload = spec;
  for (const variant of ["integral", "max"]) cache.delete(`upload:${variant}`);
}

/** Exposed for scripts/check-corridors.ts, which validates lanes against the land mask. */
export const SPEC_FOR_CHECK = SPECS;

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
  // Cast rather than pulling in `vite/client`: those ambient types also declare
  // every asset import in the project, and widening global type resolution to
  // switch on one boolean is a poor trade.
  if ((import.meta as { env?: { DEV?: boolean } }).env?.DEV) {
    checkExpectation(id, variant, run);
  }
  return run;
}

/*
 * The falsifiable half of `meta.expectedTop1`.
 *
 * `expectedTop1` is prose -- "The platform group", "Nobody. Insufficient
 * evidence." -- so nothing can compare it to a run. It had no consumer at all,
 * which is how `kutch-dark` was able to carry a note saying its own expectation
 * was false under one of the two variants the interface exposes, for two
 * sessions, with a clean build the whole time. The most falsifiable string in
 * the file was the one thing nothing checked.
 *
 * What IS machine-checkable is the claim underneath the prose, and it needs no
 * new field because `truth` and `isTruth` already carry it:
 *
 *   truth === null  =>  the run must refuse, and name nobody
 *   truth !== null  =>  exactly one candidate is the truth, it ranks 1, and the
 *                       run does not refuse
 *
 * This runs per scenario AND per variant, because a variant switch is a reader
 * action and the failure it caught was variant-only. Dev builds only: it is a
 * tripwire for whoever is editing the fixtures, not a runtime guard, and a
 * scenario that trips it is still rendered so the failure can be looked at.
 */
function checkExpectation(id: ScenarioId, variant: DriftVariant, run: Run) {
  // An uploaded scene has no authored ground truth -- that is the whole point
  // of it -- so there is no expectation to contradict.
  if (id === "upload") return;
  const halted = run.drift.insufficientEvidence !== null;
  const truthRows = run.suspects.filter((s) => s.isTruth);
  const say = (msg: string) =>
    console.warn(
      `[scenario] ${id}/${variant} contradicts meta.expectedTop1 ` +
        `(${JSON.stringify(SPECS[id].meta.expectedTop1)}): ${msg}`,
    );

  if (run.truth === null) {
    if (!halted) say("ground truth is nobody, but the run did not refuse");
    if (truthRows.length) say(`${truthRows.length} candidates are flagged isTruth`);
    return;
  }
  if (truthRows.length !== 1) {
    say(`expected exactly one isTruth candidate, found ${truthRows.length}`);
    return;
  }
  if (halted) {
    say(
      `the run refused (${run.drift.insufficientEvidence!.reason}) although ` +
        `there is a ground truth to name`,
    );
  }
  if (truthRows[0].rank !== 1) {
    say(
      `truth ${truthRows[0].label} ranks ${truthRows[0].rank}, behind ` +
        `${run.suspects[0].label}; separability ` +
        `${run.separability === null ? "n/a" : run.separability.toFixed(4)}`,
    );
  }
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
  const geom = spec.geometry ?? buildSlick(
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
  const realTraffic = spec.traffic.real === true;
  if (realTraffic && !hasRealTraffic(id)) {
    // Building without it would silently fall back to nothing and cache a run
    // with no traffic. Loud is better: the caller forgot to await the load.
    throw new Error(`${id} uses real AIS; await ensureRealTraffic("${id}") before buildRun.`);
  }
  const vessels: Vessel[] = realTraffic
    ? [...realVessels(id)]
    : buildTraffic(
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
  let truthVessel: Vessel | null = null;
  const darkTargets: { id: string; position: LngLat; lengthM: number }[] = [];

  /*
    In a real-AIS scene the vessel the publication names is already in the
    traffic, as its own real track, and it IS the ground truth -- there is no
    scripted stand-in to add. The answer still comes from the publication, not
    from anything this system detected (C10).
  */
  if (realTraffic && (spec.source.type === "moving" || spec.source.type === "berthed")) {
    const published = publishedVesselId(id);
    truthVessel = vessels.find((v) => v.mmsi === published) ?? null;
    if (!truthVessel) throw new Error(`${id}: the published vessel is missing from its real AIS`);
    truthId = truthVessel.mmsi;
    truth = {
      label: truthVessel.label,
      position: spec.release,
      releasedAt: acquiredAt - spec.releaseAgeHours * 3600_000,
    };
  } else if (spec.source.type === "moving") {
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

  if (!realTraffic && spec.source.type === "berthed") {
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
  // is an identified ship, and one without is a dark contact. Only a ship that
  // was actually there at the pass can return one: `positionAt` clamps to a
  // track's ends, so without this a real track that ended hours earlier would
  // put a radar target where no ship was.
  const present = (v: Vessel) =>
    v.points.some((p) => Math.abs(p.t - acquiredAt) <= 10 * 60_000);
  const cfarTargets = vessels
    .filter(present)
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

  // A real truth vessel lays the oil along its own reported track.
  const movingSource = moving && truthVessel
    ? (hour: number) =>
        positionAt(truthVessel!, acquiredAt + hour * 3600_000) ?? spec.release
    : moving
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
      shape: spec.releaseShape,
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

/** The listing for a raster the operator supplied. Never in the picker. */
const UPLOAD_LISTING: ScenarioListing = {
  id: "upload",
  name: "Uploaded image",
  short: "Operator raster · screened outline",
  region: "gulf-of-mexico",
  tests: "The geometry is the uploaded image; everything downstream is simulated.",
};

export function scenarioListing(id: ScenarioId): ScenarioListing {
  return (
    [...SCENARIOS, ...SAMPLE_LISTINGS, UPLOAD_LISTING].find((s) => s.id === id) ?? SCENARIOS[0]
  );
}

/** Clears the memo, used when the scoring variant changes shape. */
export function resetRunCache() {
  cache.clear();
}
