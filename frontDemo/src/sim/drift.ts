/**
 * Backward and forward Lagrangian drift, run as an ensemble.
 *
 * This is the simulated stand-in for PHASE-04's OpenDrift OpenOil runs, and it
 * keeps the properties that phase treats as correctness requirements:
 *
 *  - it is an ensemble, never a single trajectory (C5). Members differ in wind
 *    drift factor, diffusivity, and wind phase, which is where Kampouris 2021
 *    found the sensitivity actually lives
 *  - the cloud spreads going backward, because diffusion is irreversible.
 *    Reversal is not information recovery, and the origin field legitimately
 *    widens with backward time
 *  - when the 90% contour grows past the point of discriminating between
 *    candidates, the run reports insufficient evidence rather than a suspect (C3)
 *
 * The one thing it does not simulate is OpenDrift's vertical mixing scheme.
 * A demo has no depth dimension to mix through, so horizontal spreading here is
 * a parameterised random walk. In the real engine, hand-rolling that is
 * forbidden (C6) precisely because a naive scheme produces spurious accumulation
 * that reads as a false, confident origin.
 */

import {
  KM_PER_DEG_LAT,
  centroid,
  distanceKm,
  kmPerDegLon,
  ringAreaKm2,
} from "./geo";
import {
  contour,
  densityGrid,
  densityGridOn,
  levelForMass,
  massForLevel,
  massTable,
  sampleDensity,
  type DensityGrid,
  type Forcing,
  type MassTable,
} from "./field";
import type { Rng } from "./rng";
import type { AgeMethod, DriftFrame, DriftRun, LngLat, TemporalState } from "./types";

export interface DriftConfig {
  seeds: LngLat[];
  forcing: Forcing;
  acquiredAt: number;
  backwardHours: number;
  forwardHours: number;
  ensembleSize: number;
  /** Particles per ensemble member. */
  perMember: number;
  /** Horizontal diffusivity, m squared per second. */
  diffusivity: number;
  /** Contour area beyond which the field cannot discriminate, km squared. */
  diffuseThresholdKm2: number;
  /** True release time, hours before acquisition. Authored, not inferred (C10). */
  truthAgeHours: number | null;
}

/** One integration step. Small enough that the tidal term is resolved. */
const STEP_MIN = 20;

/**
 * One timestep of the origin field, in the form the scorer and the map need.
 *
 * `area90Km2` travels with the grid because how wide the field is at that hour
 * is half of what agreement with it means. A track sitting at the mode of a
 * four-hundred-square-kilometre cloud has coincided with almost nothing.
 */
export interface FieldFrame {
  grid: DensityGrid;
  table: MassTable;
  area90Km2: number;
}

export function runDrift(cfg: DriftConfig, rng: Rng): {
  run: Omit<DriftRun, "id" | "detectionId">;
  grids: Map<number, FieldFrame>;
} {
  const members = buildMembers(cfg, rng);
  const total = cfg.ensembleSize * cfg.perMember;

  // Every member starts from the same mask, then diverges under its own
  // parameters. That divergence is the ensemble spread the age interval uses.
  const state = new Float64Array(total * 2);
  for (let m = 0; m < cfg.ensembleSize; m++) {
    for (let i = 0; i < cfg.perMember; i++) {
      const seed = cfg.seeds[(m * cfg.perMember + i) % cfg.seeds.length];
      const k = (m * cfg.perMember + i) * 2;
      state[k] = seed[0];
      state[k + 1] = seed[1];
    }
  }

  const frames: DriftFrame[] = [];
  const grids = new Map<number, FieldFrame>();

  const record = (hour: number, positions: Float64Array) => {
    const grid = densityGrid(positions, total);
    const table = massTable(grid);

    const c50 = contour(grid, levelForMass(table, 0.5));
    const c90 = contour(grid, levelForMass(table, 0.9));
    const area90 = c90.reduce((s, r) => s + ringAreaKm2(r), 0);
    grids.set(hour, { grid, table, area90Km2: area90 });
    const cloud: LngLat[] = [];
    for (let i = 0; i < total; i += 7) {
      cloud.push([positions[i * 2], positions[i * 2 + 1]]);
    }
    const mid = centroid(cloud);
    const spreadKm =
      cloud.reduce((s, p) => s + distanceKm(p, mid), 0) / cloud.length;

    frames.push({
      hour,
      at: cfg.acquiredAt + hour * 3600_000,
      // Thinned for rendering. The statistics above use every particle.
      particles: thin(positions, total, 1400),
      contour50: c50,
      contour90: c90,
      area50Km2: c50.reduce((s, r) => s + ringAreaKm2(r), 0),
      area90Km2: area90,
      spreadKm,
    });
  };

  record(0, state);

  // Backward leg. A negative time step is the mechanism OpenDrift documents; the
  // integration below is the same equations with the sign flipped.
  const back = state.slice();
  for (let h = 1; h <= cfg.backwardHours; h++) {
    integrateHour(back, members, cfg, -1, -(h - 1), rng);
    record(-h, back);
  }

  // Forward leg, same engine, positive step, for the impact forecast.
  const fwd = state.slice();
  for (let h = 1; h <= cfg.forwardHours; h++) {
    integrateHour(fwd, members, cfg, 1, h - 1, rng);
    record(h, fwd);
  }

  frames.sort((a, b) => a.hour - b.hour);

  const convergence = frames
    .filter((f) => f.hour <= 0)
    .map((f) => ({
      hour: f.hour,
      area90Km2: f.area90Km2,
      spreadKm: f.spreadKm,
    }))
    .sort((a, b) => a.hour - b.hour);

  const { ageHours, ageMethod, temporalState, insufficientEvidence } =
    deriveAge(convergence, cfg);

  return {
    run: {
      ensembleSize: cfg.ensembleSize,
      particleCount: total,
      backwardHours: cfg.backwardHours,
      forwardHours: cfg.forwardHours,
      frames,
      convergence,
      ageHours,
      ageMethod,
      temporalState,
      insufficientEvidence,
      diffuseThresholdKm2: cfg.diffuseThresholdKm2,
    },
    grids,
  };
}

interface Member {
  /** Fraction of wind speed transferred to the slick. Literature: 0.02 to 0.04. */
  windFactor: number;
  /** Wind phase shift, hours. Kampouris found the model is sensitive to this. */
  windPhaseH: number;
  /** Multiplicative perturbation on the current field. */
  currentScale: number;
  diffusivity: number;
}

function buildMembers(cfg: DriftConfig, rng: Rng): Member[] {
  const members: Member[] = [];
  for (let m = 0; m < cfg.ensembleSize; m++) {
    members.push({
      windFactor: 0.02 + (m / Math.max(1, cfg.ensembleSize - 1)) * 0.02,
      windPhaseH: rng.range(-3, 3),
      currentScale: 1 + rng.normal() * 0.08,
      diffusivity: cfg.diffusivity * rng.range(0.6, 1.6),
    });
  }
  return members;
}

function integrateHour(
  state: Float64Array,
  members: Member[],
  cfg: DriftConfig,
  sign: 1 | -1,
  baseHour: number,
  rng: Rng,
) {
  const steps = Math.round(60 / STEP_MIN);
  const dt = STEP_MIN * 60; // seconds

  for (let s = 0; s < steps; s++) {
    const hour = baseHour + sign * (s * (STEP_MIN / 60));

    for (let m = 0; m < members.length; m++) {
      const mem = members[m];
      const from = m * cfg.perMember;
      const to = from + cfg.perMember;
      // Random-walk step for this member: sigma = sqrt(2 K dt).
      const sigmaM = Math.sqrt(2 * mem.diffusivity * dt);

      for (let i = from; i < to; i++) {
        const k = i * 2;
        const p: LngLat = [state[k], state[k + 1]];

        const [cu, cv] = cfg.forcing.current(p, hour);
        const [wu, wv] = cfg.forcing.wind(p, hour + mem.windPhaseH);

        const u = cu * mem.currentScale + wu * mem.windFactor;
        const v = cv * mem.currentScale + wv * mem.windFactor;

        // Advection reverses with the sign. Diffusion does not: running a
        // diffusive process backward spreads it further, which is exactly why
        // the origin field widens rather than sharpening.
        const eastM = sign * u * dt + rng.normal() * sigmaM;
        const northM = sign * v * dt + rng.normal() * sigmaM;

        state[k] += eastM / 1000 / kmPerDegLon(p[1]);
        state[k + 1] += northM / 1000 / KM_PER_DEG_LAT;
      }
    }
  }
}

function thin(state: Float64Array, total: number, want: number): Float64Array {
  const stride = Math.max(1, Math.floor(total / want));
  const n = Math.floor(total / stride);
  const out = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    out[i * 2] = state[i * stride * 2];
    out[i * 2 + 1] = state[i * stride * 2 + 1];
  }
  return out;
}

/**
 * Age from the convergence minimum, with the ensemble spread as its interval.
 *
 * Two signals are available in the real system: the timestep at which the cloud
 * is most concentrated, and the timestep at which the high-probability region
 * first intersects a candidate source. This uses the first and reports the
 * second in the scenario builder when a source is actually reached.
 *
 * C1: the result is always three numbers and a method, never a scalar.
 */
function deriveAge(
  convergence: { hour: number; area90Km2: number; spreadKm: number }[],
  cfg: DriftConfig,
): Pick<
  DriftRun,
  "ageHours" | "ageMethod" | "temporalState" | "insufficientEvidence"
> {
  let best = convergence[0];
  for (const c of convergence) if (c.area90Km2 < best.area90Km2) best = c;

  const bestHours = Math.abs(best.hour);

  // C3. The test is whether the field constrains anything, not where its
  // minimum happens to fall. Under diffusion the tightest the cloud is ever
  // going to be is at acquisition, so a minimum at hour zero is the expected
  // result and not a failure; a 90% contour that never comes inside the
  // threshold is.
  if (best.area90Km2 > cfg.diffuseThresholdKm2) {
    return {
      ageHours: [0, bestHours, cfg.backwardHours],
      ageMethod: "beyond_horizon",
      temporalState: "indeterminate",
      insufficientEvidence: {
        area90Km2: best.area90Km2,
        reason: `90% origin contour spans ${best.area90Km2.toFixed(0)} km2 at its tightest. Nothing inside it is distinguished from anything else inside it.`,
      },
    };
  }

  // Interval from the width of the convergence basin: the range of backward
  // hours whose contour area is within 25% of the minimum.
  const band = convergence.filter(
    (c) => c.area90Km2 <= best.area90Km2 * 1.25,
  );
  const low = Math.min(...band.map((c) => Math.abs(c.hour)));
  const high = Math.max(...band.map((c) => Math.abs(c.hour)));

  const temporalState: TemporalState =
    bestHours <= 6 ? "ongoing" : bestHours <= 24 ? "recent" : "legacy";
  const ageMethod: AgeMethod = "drift_convergence";

  return {
    ageHours: [low, bestHours, high],
    ageMethod,
    temporalState,
    insufficientEvidence: null,
  };
}

/**
 * How much a position agrees with the origin field at one hour.
 *
 * Two independent things are being asked, and folding them into one number
 * without saying so is how a system ends up confidently naming a ship on the
 * strength of a cloud four hundred square kilometres wide:
 *
 *  - **centrality**: how deep in the field the position sits, expressed as the
 *    smallest credible region containing it. Independent of how wide the field
 *    is, so it stays comparable between an hour after acquisition and a day
 *    before it
 *  - **informativeness**: how much the field constrains anything at all. It
 *    falls with the area of the 90% contour, which is the quantity C3 turns
 *    into an insufficient-evidence result when it grows too far
 *
 * The product is the term. Both parts are returned so the evidence card can say
 * which one carried the score, and which one lost it.
 */

/** Area of a 90% contour that still constrains an origin, square kilometres. */
const INFORMATIVE_AREA_KM2 = 25;

export interface FieldAgreement {
  /** 1 at the mode of the field, 0 out in the skirt. */
  centrality: number;
  /** 1 for a tight field, falling as the 90% contour spreads. */
  informativeness: number;
  /** The product. This is what S_drift uses. */
  value: number;
  /** Credible region containing the position, as a percentage. */
  credibleRegionPct: number;
  area90Km2: number;
}

const NO_AGREEMENT: FieldAgreement = {
  centrality: 0,
  informativeness: 0,
  value: 0,
  credibleRegionPct: 100,
  area90Km2: 0,
};

export function fieldAgreement(
  grids: Map<number, FieldFrame>,
  hour: number,
  p: LngLat,
): FieldAgreement {
  const entry = grids.get(Math.round(hour));
  if (!entry) return NO_AGREEMENT;

  const density = sampleDensity(entry.grid, p);
  const mass = massForLevel(entry.table, density);
  const centrality = 1 - mass;

  const informativeness = Math.min(
    1,
    Math.sqrt(INFORMATIVE_AREA_KM2 / Math.max(1e-6, entry.area90Km2)),
  );

  return {
    centrality,
    informativeness,
    value: centrality * informativeness,
    credibleRegionPct: mass * 100,
    area90Km2: entry.area90Km2,
  };
}

/** Convenience for callers that only need the scalar. */
export function fieldProbabilityAt(
  grids: Map<number, FieldFrame>,
  hour: number,
  p: LngLat,
): number {
  return fieldAgreement(grids, hour, p).value;
}

/**
 * Deterministic advection of one point, no diffusion.
 *
 * Used to place a scenario's slick: the release position is carried forward
 * through the same forcing the hindcast will later run backward, so the two
 * agree by construction. That is the forward-consistency check EVALUATION.md
 * asks of the real engine, applied here to the generator itself.
 */
export function advect(
  p: LngLat,
  forcing: Forcing,
  fromHour: number,
  toHour: number,
  windFactor = 0.03,
): LngLat {
  const sign = toHour >= fromHour ? 1 : -1;
  const steps = Math.round((Math.abs(toHour - fromHour) * 60) / STEP_MIN);
  const dt = STEP_MIN * 60;
  let cur: LngLat = [p[0], p[1]];

  for (let s = 0; s < steps; s++) {
    const hour = fromHour + sign * s * (STEP_MIN / 60);
    const [cu, cv] = forcing.current(cur, hour);
    const [wu, wv] = forcing.wind(cur, hour);
    const u = cu + wu * windFactor;
    const v = cv + wv * windFactor;
    cur = [
      cur[0] + (sign * u * dt) / 1000 / kmPerDegLon(cur[1]),
      cur[1] + (sign * v * dt) / 1000 / KM_PER_DEG_LAT,
    ];
  }

  return cur;
}

/* ------------------------------------------------------------------ *
 * The release itself
 * ------------------------------------------------------------------ */

export interface ReleaseFrame {
  hour: number;
  at: number;
  /** Every parcel in the water at this hour. */
  particles: Float64Array;
  /** Outline of the oil on the surface, as a 92% mass contour. */
  extent: LngLat[][];
  areaKm2: number;
  /** Fraction of the total release that has entered the water by now. */
  releasedFraction: number;
}

export interface ReleaseConfig {
  /** Where oil enters the water. A point for a fixed source. */
  source: LngLat;
  /** For a moving source, where the vessel is at a given hour. */
  sourceAt?: (hour: number) => LngLat;
  forcing: Forcing;
  acquiredAt: number;
  /** Hour the release began, negative. */
  startHour: number;
  /** Hour it stopped. Zero or negative; zero means it was still running. */
  endHour: number;
  /** Hours to keep advecting after acquisition, for the forecast. */
  forwardHours: number;
  /** Parcels emitted per hour of release. */
  ratePerHour: number;
  diffusivity: number;
  windFactor: number;
  /**
   * Surface area the release should cover at acquisition, square kilometres.
   *
   * A detector does not see all the oil, it sees oil above the concentration at
   * which backscatter is measurably suppressed. Rather than pick a contour by
   * eye, the threshold is solved for once, so that the modelled extent at the
   * moment of the pass matches the polygon the segmenter produced, and then
   * held fixed across every other hour. The result is a growing slick with a
   * consistent detection threshold rather than a shape that changes meaning
   * from frame to frame.
   */
  targetAreaKm2: number;
}

/**
 * The spill as it actually happened: a release that starts small and grows.
 *
 * Oil does not appear as a finished slick. It enters the water parcel by
 * parcel, and what the satellite eventually photographs is the accumulated
 * history of that release carried by the ocean. Simulating it that way rather
 * than drawing a finished shape is what makes the playback mean something:
 * every frame is where the oil released so far had got to by that hour, and the
 * vessel positions shown beside it are where the traffic was at the same
 * moment.
 *
 * It is also the forward half of the argument the hindcast makes backward. The
 * two run through the same forcing, so if the backward field did not land on
 * the release point, that would be a real disagreement and not a rendering
 * choice.
 */
export function runRelease(cfg: ReleaseConfig, rng: Rng): ReleaseFrame[] {
  const releaseHours = Math.max(1, cfg.endHour - cfg.startHour);
  const total = Math.round(releaseHours * cfg.ratePerHour);
  const positions = new Float64Array(total * 2);
  // Hour at which each parcel enters the water, spread evenly across the
  // release so the slick grows steadily rather than in steps.
  const birth = new Float64Array(total);
  for (let i = 0; i < total; i++) {
    birth[i] = cfg.startHour + (i / total) * releaseHours;
  }

  const steps = Math.round(60 / STEP_MIN);
  const dt = STEP_MIN * 60;
  const sigmaM = Math.sqrt(2 * cfg.diffusivity * dt);

  const emitAt = (hour: number): LngLat =>
    cfg.sourceAt ? cfg.sourceAt(hour) : cfg.source;

  interface Raw {
    hour: number;
    alive: number;
    live: Float64Array;
    grid: DensityGrid | null;
    table: MassTable | null;
  }

  const raw: Raw[] = [];
  let alive = 0;

  for (let h = Math.floor(cfg.startHour); h <= cfg.forwardHours; h++) {
    while (alive < total && birth[alive] <= h) {
      const p = emitAt(birth[alive]);
      positions[alive * 2] = p[0];
      positions[alive * 2 + 1] = p[1];
      alive++;
    }

    if (alive > 0) {
      for (let s = 0; s < steps; s++) {
        const hour = h + s * (STEP_MIN / 60);
        for (let i = 0; i < alive; i++) {
          const k = i * 2;
          const at: LngLat = [positions[k], positions[k + 1]];
          const [cu, cv] = cfg.forcing.current(at, hour);
          const [wu, wv] = cfg.forcing.wind(at, hour);
          const u = cu + wu * cfg.windFactor;
          const v = cv + wv * cfg.windFactor;
          positions[k] +=
            (u * dt + rng.normal() * sigmaM) / 1000 / kmPerDegLon(at[1]);
          positions[k + 1] +=
            (v * dt + rng.normal() * sigmaM) / 1000 / KM_PER_DEG_LAT;
        }
      }
    }

    raw.push({
      hour: h,
      alive,
      live: positions.slice(0, alive * 2),
      grid: null,
      table: null,
    });
  }

  // One grid geometry for every frame, sized on the release window rather than
  // on the forecast, so the cells stay fine enough to resolve a slick.
  const GRID_N = 192;
  let minLon = Infinity;
  let maxLon = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const r of raw) {
    if (r.hour > 0) continue;
    for (let i = 0; i < r.alive; i++) {
      const lon = r.live[i * 2];
      const lat = r.live[i * 2 + 1];
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  const padLon = Math.max((maxLon - minLon) * 0.3, 0.01);
  const padLat = Math.max((maxLat - minLat) * 0.3, 0.01);
  const dLon = (maxLon - minLon + 2 * padLon) / (GRID_N - 1);
  const dLat = (maxLat - minLat + 2 * padLat) / (GRID_N - 1);

  for (const r of raw) {
    if (r.alive <= 40) continue;
    // Each frame is centred on its own cloud but keeps the shared cell size, so
    // the forecast can drift outside the release window without losing either
    // resolution or comparability.
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < r.alive; i++) {
      cx += r.live[i * 2];
      cy += r.live[i * 2 + 1];
    }
    cx /= r.alive;
    cy /= r.alive;

    r.grid = densityGridOn(r.live, r.alive, {
      minLon: cx - (dLon * (GRID_N - 1)) / 2,
      minLat: cy - (dLat * (GRID_N - 1)) / 2,
      dLon,
      dLat,
      nx: GRID_N,
      ny: GRID_N,
    });
    r.table = massTable(r.grid);
  }

  // Solve the detection threshold once, at the hour of the pass.
  const atPass = raw.find((r) => r.hour === 0) ?? raw[raw.length - 1];
  let level = 0;
  if (atPass?.grid && atPass.table) {
    let lo = 0.05;
    let hi = 0.995;
    for (let i = 0; i < 22; i++) {
      const mid = (lo + hi) / 2;
      const l = levelForMass(atPass.table, mid);
      const area = contour(atPass.grid, l).reduce(
        (s, r) => s + ringAreaKm2(r),
        0,
      );
      if (area < cfg.targetAreaKm2) lo = mid;
      else hi = mid;
    }
    level = levelForMass(atPass.table, (lo + hi) / 2);
  }

  return raw.map((r) => {
    const extent = r.grid && level > 0 ? contour(r.grid, level) : [];
    return {
      hour: r.hour,
      at: cfg.acquiredAt + r.hour * 3600_000,
      particles: thin(r.live, r.alive, 1200),
      extent,
      areaKm2: extent.reduce((s, ring) => s + ringAreaKm2(ring), 0),
      releasedFraction: r.alive / total,
    };
  });
}
