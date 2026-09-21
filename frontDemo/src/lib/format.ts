/**
 * Formatting, shared because it is vocabulary rather than styling.
 *
 * A term is called the same thing in all four designs. How it is set, weighted
 * and placed is each design's business; what it is called is the project's.
 */

import type { CandidateKind, DriftRun, ScoreTermKey } from "../sim/types";

export function formatUtc(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace(".000Z", "Z");
}

/** `2023-12-05 23:57Z`, the form every design uses for an acquisition. */
export function stamp(ms: number): string {
  return `${formatUtc(ms).slice(0, 16)}Z`;
}

/** `05 DEC 2023`, for the designs that carry a dateline. */
export function dateline(ms: number): string {
  const d = new Date(ms);
  const months = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
  ];
  return `${String(d.getUTCDate()).padStart(2, "0")} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function clock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
}

export function formatHour(hour: number): string {
  if (Math.round(hour) === 0) return "T0";
  const h = Math.abs(Math.round(hour));
  return `T${hour < 0 ? "−" : "+"}${h}h`;
}

/** Signed hour without the T prefix, for axes. */
export function relHour(hour: number): string {
  const h = Math.round(hour);
  if (h === 0) return "0";
  return `${h < 0 ? "−" : "+"}${Math.abs(h)}`;
}

/**
 * How to state a slick's age without lying in either direction.
 *
 * C1 forbids a bare scalar, so the interval and the method always travel
 * together. But an interval is not always the honest form either: when the
 * discharge was still running at the acquisition, source coincidence puts the
 * most recent oil in the water at zero hours, and the interval collapses to
 * `0–0 h`. Printing that as though it were a measurement reads as false
 * precision in the opposite direction -- it suggests the system pinned the age
 * exactly, when what it actually determined is that the release had not
 * stopped. So an ongoing discharge is stated as one, and the interval is kept
 * beside it rather than instead of it.
 */
export function ageStatement(drift: DriftRun): {
  /** Short form, for a readout. */
  value: string;
  /** Long form, for a sentence. */
  phrase: string;
  method: string;
  state: string;
  /** True when the interval carries no width and should not lead. */
  degenerate: boolean;
} {
  const [lo, best, hi] = drift.ageHours;
  const method = drift.ageMethod.replace(/_/g, " ");
  const degenerate = hi - lo < 1;

  if (drift.temporalState === "ongoing" && degenerate) {
    return {
      value: "ongoing",
      phrase:
        "the discharge had not stopped at the moment of the pass, so the freshest oil is minutes old and the oldest is as old as the release",
      method,
      state: drift.temporalState,
      degenerate: true,
    };
  }

  if (degenerate) {
    return {
      value: `≤ ${Math.max(1, hi)} h`,
      phrase: `under ${Math.max(1, hi)} hours, by ${method}`,
      method,
      state: drift.temporalState,
      degenerate: true,
    };
  }

  return {
    value: `${lo}–${hi} h`,
    phrase: `between ${lo} and ${hi} hours, best estimate ${best}, by ${method}`,
    method,
    state: drift.temporalState,
    degenerate: false,
  };
}

export const TERM_LABEL: Record<ScoreTermKey, string> = {
  drift: "Drift agreement",
  proximity: "Proximity",
  parity: "Parallelism",
  temporality: "Timing",
  behaviour: "Behaviour",
  prior: "Vessel prior",
};

/** Compact forms, for the designs that align terms in a column. */
export const TERM_SHORT: Record<ScoreTermKey, string> = {
  drift: "DRIFT",
  proximity: "PROXIM",
  parity: "PARITY",
  temporality: "TEMPOR",
  behaviour: "BEHAVE",
  prior: "PRIOR",
};

export const TERM_ORDER: ScoreTermKey[] = [
  "drift",
  "proximity",
  "parity",
  "temporality",
  "behaviour",
  "prior",
];

export const KIND_LABEL: Record<CandidateKind, string> = {
  ais_vessel: "AIS vessel",
  dark_vessel: "Unlit contact",
  infrastructure: "Infrastructure",
};

export const KIND_SHORT: Record<CandidateKind, string> = {
  ais_vessel: "AIS",
  dark_vessel: "DARK",
  infrastructure: "INFRA",
};

/** Roman numerals, for the case-file index. Only ever needs single digits. */
export const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];

export function ordinal(n: number): string {
  return String(n).padStart(2, "0");
}

export function signed(n: number, digits = 3): string {
  return `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}`;
}
