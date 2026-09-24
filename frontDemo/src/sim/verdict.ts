/**
 * oos or slick_unknown, decided after detection, with its terms.
 *
 * FUTURE_WORK.md §2.4. The release model has ONE class, `slick`
 * (`weights/L1-ciou-research.json`), and it outlines slick-like regions without
 * being able to tell an operational discharge from a natural film or a wake:
 * distinguishing oil from look-alikes on SAR alone is unreliable
 * (`RESEARCH/topics/lookalike-discrimination.md`). So the class the console
 * shows is not the model's. It is this verdict, computed from evidence the model
 * cannot see and rendered term by term, the way a suspect's score is (C4):
 *
 *  - shape     how linear the slick is: elongation 3 (compact) to 6 (linear),
 *              the thresholds `backend/ingest/datasets/relabel.py` proposes with
 *  - vessel    a bright (CFAR) target at an END of the slick: full at 0.3 km,
 *              none past 3 km -- the proposer's 300 px at 10 m. CFAR cannot
 *              tell a ship from a platform: a target on a listed installation
 *              counts for nothing (a leak there is not a vessel's discharge),
 *              and one no AIS vessel matches is said to be a dark vessel or an
 *              unlisted installation
 *  - diverge   whether the slick widens away from that vessel: a wake opens in
 *              a V, a discharge trail widens only as the oil spreads. Width slope
 *              0.03 or less scores 0, 0.10 (a half-angle of about 3°) or more
 *              scores 1. These two are this project's choice from wake
 *              geometry, not a calibration, and the pane says so
 *  - wind      the wind gate multiplier (C9, `slick.ts` `windGate`), continuous
 *  - contrast  the damping ratio, a tiebreak only: weak contrast argues a film
 *  - drift     the best vessel candidate's drift term, when candidates were
 *              scored: a vessel through the origin field makes a discharge
 *              plausible
 *
 * support = shape x vessel x (1 - diverge) x wind x contrast x drift, and the
 * verdict is `oos` at 0.5 or more. An unmeasured term (no damping, nothing
 * scored) weighs nothing rather than a guess. A linear slick at a vessel that
 * opens in a V is flagged as a possible wake: the confusion the rubric calls
 * the most dangerous, because it would be blamed on the ship that made it.
 *
 * The rules were written from the rubric (FUTURE_WORK.md §2.3) and the research
 * before any run was compared against them; `check:verdict` prints, and does
 * not assert, what they say about the authored scenarios.
 */

import { distanceKm } from "./geo";
import type { Run } from "./types";

export type VerdictKey = "shape" | "vessel" | "diverge" | "wind" | "contrast" | "drift";

export interface VerdictTerm {
  key: VerdictKey;
  label: string;
  /** In [0,1]; null when it could not be measured, in which case it carries no weight. */
  value: number | null;
  detail: string;
}

export interface SlickVerdict {
  verdict: "oos" | "slick_unknown";
  /** Evidence for an operational discharge, in [0,1], after the wind gate. */
  support: number;
  /** A reason to distrust the shape, when there is one. */
  caution: string | null;
  terms: VerdictTerm[];
  summary: string;
}

/** What the verdict reads, so it can be tested without building a whole run. */
export interface VerdictInputs {
  elongation: number;
  lengthKm: number;
  /** Width along the medial axis, head to tail, metres. */
  widthProfileM: number[];
  /** The bright target nearest either end of the slick; null when there are none. */
  endTarget: {
    end: "head" | "tail";
    distanceKm: number;
    /** An AIS vessel reported at it at the pass. */
    matched: boolean;
    /** It sits on a listed installation. */
    installation: boolean;
  } | null;
  windSpeedMs: number;
  windGate: number;
  /** dB; null when not measured. */
  dampingRatioDb: number | null;
  /** Best drift term over vessel candidates; null when nothing was scored. */
  bestVesselDrift: number | null;
}

const LINEAR = 6;
const COMPACT = 3;
const ADJACENT_FULL_KM = 0.3;
const ADJACENT_NONE_KM = 3;
const SPREAD_SLOPE = 0.03;
const V_SLOPE = 0.1;
const OOS_AT = 0.5;
/** A bright target this close to a listed installation is taken to be it. */
const INSTALLATION_KM = 0.5;

const clamp = (v: number) => Math.max(0, Math.min(1, v));

/** Least-squares slope of width against distance along the axis, metres per metre. */
function widthSlope(widths: number[], lengthKm: number): number | null {
  const n = widths.length;
  if (n < 3 || !(lengthKm > 0)) return null;
  const step = (lengthKm * 1000) / (n - 1);
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    sx += x; sy += widths[i]; sxx += x * x; sxy += x * widths[i];
  }
  const denominator = n * sxx - sx * sx;
  return denominator > 0 ? (n * sxy - sx * sy) / denominator : null;
}

export function verdictFrom(e: VerdictInputs): SlickVerdict {
  const shape = clamp((e.elongation - COMPACT) / (LINEAR - COMPACT));

  let vessel = 0;
  let vesselDetail = "no bright target in the scene (CFAR), so nothing says a vessel was at the slick";
  let vesselEnd: "head" | "tail" | null = null;
  const target = e.endTarget;
  if (target) {
    vesselEnd = target.end;
    const d = target.distanceKm;
    const what = target.installation
      ? "a listed installation"
      : target.matched ? "an AIS vessel" : "not an AIS vessel: a dark vessel or an unlisted installation";
    vessel = target.installation ? 0 : clamp(1 - (d - ADJACENT_FULL_KM) / (ADJACENT_NONE_KM - ADJACENT_FULL_KM));
    vesselDetail = `nearest bright target ${d.toFixed(2)} km from the ${vesselEnd} end, ${what} ` +
      (target.installation
        ? "-- a leak there is not a vessel's discharge"
        : `(full at ${ADJACENT_FULL_KM} km, none past ${ADJACENT_NONE_KM} km)`);
  }

  // Width measured away from the vessel's end; head-to-tail otherwise.
  const profile = vesselEnd === "tail" ? [...e.widthProfileM].reverse() : e.widthProfileM;
  const slope = widthSlope(profile, e.lengthKm);
  const diverge = slope === null ? null : clamp((slope - SPREAD_SLOPE) / (V_SLOPE - SPREAD_SLOPE));
  const divergeDetail = slope === null
    ? "no width profile to measure"
    : `width grows ${slope.toFixed(3)} m per m away from the ${vesselEnd ?? "head"} end ` +
      `(${SPREAD_SLOPE} or less reads as spreading oil, ${V_SLOPE} or more as a V; this project's thresholds, uncalibrated)`;

  const contrast = e.dampingRatioDb === null || !Number.isFinite(e.dampingRatioDb) ? null : clamp(-e.dampingRatioDb / 3);
  const drift = e.bestVesselDrift === null ? null : clamp(e.bestVesselDrift);

  const terms: VerdictTerm[] = [
    { key: "shape", label: "linear", value: shape,
      detail: `elongation ${e.elongation.toFixed(1)} (compact at ${COMPACT} or less, linear at ${LINEAR} or more)` },
    { key: "vessel", label: "bright target at an end", value: vessel, detail: vesselDetail },
    { key: "diverge", label: "opens in a V", value: diverge, detail: divergeDetail },
    { key: "wind", label: "wind gate", value: clamp(e.windGate),
      detail: `${e.windSpeedMs.toFixed(1)} m/s at the pass; a continuous multiplier, never a cut (C9)` },
    { key: "contrast", label: "contrast", value: contrast,
      detail: contrast === null
        ? "damping ratio not measured for this detection; carries no weight"
        : `damping ${e.dampingRatioDb!.toFixed(1)} dB (full at 3 dB); a tiebreak only -- weak contrast argues a film` },
    { key: "drift", label: "vessel in the origin field", value: drift,
      detail: drift === null
        ? "no vessel candidate was scored against the origin field; carries no weight"
        : `best vessel drift term ${drift.toFixed(2)}` },
  ];

  const support =
    shape * vessel * (1 - (diverge ?? 0)) * clamp(e.windGate) *
    (contrast === null ? 1 : 0.75 + 0.25 * contrast) *
    (drift === null ? 1 : 0.5 + 0.5 * drift);
  const verdict = support >= OOS_AT ? "oos" : "slick_unknown";
  const caution = shape >= 0.5 && vessel >= 0.5 && (diverge ?? 0) >= 0.5
    ? "Linear, at a vessel, and opening in a V: the shape of a ship wake, which would be blamed on the ship that made it. Treated as a look-alike until a person looks."
    : null;

  const weakest = terms
    .filter((t) => t.value !== null && t.key !== "diverge")
    .sort((a, b) => (a.value ?? 1) - (b.value ?? 1))[0];
  const summary = verdict === "oos"
    ? `An operational discharge on this evidence (support ${support.toFixed(2)}): linear, with a bright target at its end, ` +
      `not opening in a V.` + (target && !target.matched
        ? " That target is not an AIS vessel, so it is a dark vessel or an installation nobody listed; CFAR cannot tell which."
        : "")
    : caution
      ? `Unknown origin: ${caution}`
      : `Unknown origin (support ${support.toFixed(2)}, under ${OOS_AT}); the weakest term is ${weakest?.label ?? "shape"}.`;
  return { verdict, support, caution, terms, summary };
}

const cache = new WeakMap<Run, SlickVerdict>();

/** The verdict for a built run: the seed slick's evidence, the scene's CFAR targets, its candidates. */
export function verdictFor(run: Run): SlickVerdict {
  const hit = cache.get(run);
  if (hit) return hit;
  const result = verdictFrom(verdictInputsFor(run));
  cache.set(run, result);
  return result;
}

/** What `verdictFor` reads off a run; exported so the backend twin can be tested on the same inputs. */
export function verdictInputsFor(run: Run): VerdictInputs {
  const c = run.characterisation;
  let endTarget: VerdictInputs["endTarget"] = null;
  for (const t of run.cfarTargets) {
    for (const end of ["head", "tail"] as const) {
      const d = distanceKm(c[end], t.position);
      if (endTarget && d >= endTarget.distanceKm) continue;
      endTarget = {
        end, distanceKm: d, matched: t.matched,
        installation: run.infrastructure.some((i) => distanceKm(i.position, t.position) <= INSTALLATION_KM),
      };
    }
  }
  const vessels = run.suspects.filter((s) => s.kind === "ais_vessel" || s.kind === "dark_vessel");
  return {
    elongation: c.elongation,
    lengthKm: c.lengthKm,
    widthProfileM: c.widthMProfile,
    endTarget,
    windSpeedMs: c.windSpeedMs,
    windGate: c.windGateMultiplier,
    dampingRatioDb: Number.isFinite(c.dampingRatioDb) ? c.dampingRatioDb : null,
    bestVesselDrift: vessels.length ? Math.max(...vessels.map((s) => s.terms.drift)) : null,
  };
}
