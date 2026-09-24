/**
 * The rubric's constructed verdict cases, shared by `check-verdict.ts` (which
 * asserts what each must say) and `export-characterise-fixtures.ts` (which
 * records what the TypeScript says, for the backend twin to match).
 */
import type { VerdictInputs } from '../src/sim/verdict';

// A trail: long, even width, a vessel 100 m off its tail, moderate wind, good contrast.
const trail: VerdictInputs = {
  elongation: 12, lengthKm: 6, widthProfileM: Array.from({ length: 12 }, () => 120),
  endTarget: { end: 'tail', distanceKm: 0.1, matched: true, installation: false },
  windSpeedMs: 6, windGate: 1, dampingRatioDb: -5, bestVesselDrift: 0.8,
};

export const CONSTRUCTED_VERDICT_CASES = {
  trail,
  // The same line widening in a V from the vessel: a wake, and never oos.
  wake: { ...trail, widthProfileM: Array.from({ length: 12 }, (_, i) => 760 - i * 60) },
  // Compact, no vessel: unknown origin.
  patch: { ...trail, elongation: 2, endTarget: { end: 'head', distanceKm: 20, matched: true, installation: false } },
  // No bright target anywhere.
  alone: { ...trail, endTarget: null },
  // A listed installation at the end is not a vessel.
  platform: { ...trail, endTarget: { ...trail.endTarget!, installation: true } },
  // An unmatched target is said to be unidentified.
  dark: { ...trail, endTarget: { ...trail.endTarget!, matched: false } },
  // Unmeasured terms carry no weight.
  unmeasured: { ...trail, dampingRatioDb: null, bestVesselDrift: null },
  // A vessel on the head end: the width is read from the head, not reversed.
  headVessel: { ...trail, endTarget: { end: 'head', distanceKm: 1.2, matched: true, installation: false },
    widthProfileM: Array.from({ length: 9 }, (_, i) => 100 + i * 25) },
  // Too short a profile to fit a slope.
  shortProfile: { ...trail, widthProfileM: [100, 120] },
  // Weak contrast and a half-open wind gate.
  weak: { ...trail, dampingRatioDb: -0.9, windGate: 0.37, windSpeedMs: 2.6 },
  gate0: { ...trail, windGate: 0 },
  gate25: { ...trail, windGate: 0.25 },
  gate50: { ...trail, windGate: 0.5 },
  gate75: { ...trail, windGate: 0.75 },
} satisfies Record<string, VerdictInputs>;
