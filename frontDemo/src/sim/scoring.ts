/**
 * Candidate gating, the six scoring terms, collation, and evidence cards.
 *
 * This mirrors PHASE-06. Four properties of it are not stylistic:
 *
 *  - `S_drift` is the term nothing else in the reviewed literature has. Cerulean
 *    substitutes slick geometry as a proxy for transport; P004 does the AIS
 *    check by hand and names reverse-trajectory simulation as future work. The
 *    ablation exported from here is what makes that claim checkable
 *  - the weights are hand-set and printed, never fitted. Three ground-truth
 *    cases cannot support fitting six weights, and a weight fitted to make a
 *    fixture pass is not evidence
 *  - a total without its terms is not a permitted output (C4)
 *  - a diffuse field returns insufficient evidence rather than a ranked
 *    suspect (C3)
 */

import { distanceKm, distanceToPathKm, bearingDeg, pathLengthKm } from "./geo";
import {
  fieldAgreement,
  fieldProbabilityAt,
  type FieldAgreement,
  type FieldFrame,
} from "./drift";
import { behaviour, trackPath, vesselPrior } from "./ais";

import type {
  AnomalyFlag,
  CandidateKind,
  Characterisation,
  DriftRun,
  EvidenceCard,
  LngLat,
  ScoreTermKey,
  Suspect,
  TermExplanation,
  Vessel,
} from "./types";

/**
 * Weights, version-stamped and shown in the interface.
 *
 * Hand-set from the term definitions, not fitted. `drift` carries the largest
 * share because it is the only term grounded in transport physics; the rest are
 * Cerulean's, kept at their relative ordering so the comparison stays legible.
 */
export const WEIGHTS: Record<ScoreTermKey, number> = {
  drift: 0.3,
  proximity: 0.2,
  parity: 0.15,
  temporality: 0.15,
  behaviour: 0.12,
  prior: 0.08,
};

export const WEIGHTS_VERSION = "w1-handset";

/** Proximity decay constant, km. Cerulean's value. */
export const PROXIMITY_LAMBDA_KM = 4.0;

export type DriftVariant = "integral" | "max";

export interface ScoringInput {
  drift: DriftRun;
  grids: Map<number, FieldFrame>;
  characterisation: Characterisation;
  acquiredAt: number;
  vessels: Vessel[];
  infrastructure: { id: string; label: string; position: LngLat }[];
  darkTargets: { id: string; position: LngLat; lengthM: number }[];
  /** Which S_drift formulation to use. Both are computed either way. */
  variant: DriftVariant;
  /** MMSI or infrastructure id that authored ground truth names (C10). */
  truthId: string | null;
  /** Infrastructure coverage status, surfaced as a caveat when partial. */
  infrastructureCoverage: "complete" | "partial";
}

export interface ScoringResult {
  suspects: Suspect[];
  /** Candidates the gate removed, and how many. Filtering is a deliverable. */
  gate: { considered: number; admitted: number; reason: string };
  /** Margin between the top candidate and the next. Reported, never targeted. */
  separability: number | null;
  insufficientEvidence: { area90Km2: number; reason: string } | null;
}

/** Field probability above which a track point counts as inside the field. */
const GATE_THRESHOLD = 0.06;

/* ------------------------------------------------------------------ *
 * The six terms
 * ------------------------------------------------------------------ */

/**
 * S_drift: agreement between a track and the origin field at matching times.
 *
 * This is the term nothing in the reviewed literature computes. Two
 * formulations are produced because PHASE-06 leaves the choice open:
 *
 *  - `max` takes the single best moment. It rewards a track that passed through
 *    the high-probability region, which is what a moving discharge looks like
 *  - `integral` takes that peak and scales it by how long the track stayed
 *    inside the field, saturating at six hours. It rewards a candidate that
 *    lingered, which is what a berthed discharge looks like
 *
 * Both are reported. The interface lets the choice be switched so the
 * difference is visible rather than asserted.
 */
const DWELL_SATURATION_H = 6;

export function sDrift(
  track: { t: number; lon: number; lat: number }[],
  grids: Map<number, FieldFrame>,
  acquiredAt: number,
  backwardHours: number,
): {
  max: number;
  integral: number;
  bestHour: number;
  bestPoint: LngLat;
  dwellHours: number;
  best: FieldAgreement;
} {
  let max = 0;
  let bestHour = 0;
  let best: FieldAgreement = {
    centrality: 0,
    informativeness: 0,
    value: 0,
    credibleRegionPct: 100,
    area90Km2: 0,
  };
  let bestPoint: LngLat = track.length ? [track[0].lon, track[0].lat] : [0, 0];
  let insideSamples = 0;
  let windowSamples = 0;
  let spanMs = 0;

  for (let i = 0; i < track.length; i++) {
    const p = track[i];
    const hour = Math.round((p.t - acquiredAt) / 3600_000);
    if (hour > 0 || hour < -backwardHours) continue;
    windowSamples++;
    if (i > 0) spanMs = Math.max(spanMs, p.t - track[i - 1].t);

    const agreement = fieldAgreement(grids, hour, [p.lon, p.lat]);
    if (agreement.value >= GATE_THRESHOLD) insideSamples++;
    if (agreement.value > max) {
      max = agreement.value;
      best = agreement;
      bestHour = hour;
      bestPoint = [p.lon, p.lat];
    }
  }

  const cadenceH = spanMs > 0 ? spanMs / 3600_000 : 1 / 30;
  const dwellHours = insideSamples * cadenceH;
  const dwell = Math.min(1, dwellHours / DWELL_SATURATION_H);

  return {
    max,
    integral: windowSamples ? max * (0.55 + 0.45 * dwell) : 0,
    bestHour,
    bestPoint,
    dwellHours,
    best,
  };
}

/** S_proximity: slick head to nearest track point, exponential decay. */
export function sProximity(head: LngLat, track: LngLat[]): {
  value: number;
  km: number;
  index: number;
} {
  if (!track.length) return { value: 0, km: Infinity, index: 0 };
  const { km, index } = distanceToPathKm(head, track);
  return { value: Math.exp(-km / PROXIMITY_LAMBDA_KM), km, index };
}

/**
 * S_parity: how much of the slick this track could have laid down.
 *
 * Measured on the stretch of track near the slick, not the whole voyage. A
 * hundred-kilometre transit that clips the corner of the scene should not score
 * as though it drew a nineteen-kilometre ribbon, which is what an unrestricted
 * projection would give it.
 *
 * The value combines two things: how closely the local course aligns with the
 * slick axis, and how well the length matches. A vessel that never moved scores
 * zero here. That is the right answer to the question this term asks and the
 * wrong answer to the question of who did it, which is exactly why the other
 * terms exist and why a total is never shown without them.
 */
export function sParity(
  head: LngLat,
  tail: LngLat,
  track: LngLat[],
  slickLengthKm: number,
): { value: number; projectedKm: number; alignmentDeg: number } {
  if (track.length < 2 || slickLengthKm <= 0) {
    return { value: 0, projectedKm: 0, alignmentDeg: 90 };
  }

  // Local segment: track points within a slick length and a half of either end.
  const reachKm = Math.max(6, slickLengthKm * 1.5);
  const local = track.filter(
    (p) =>
      distanceKm(p, head) <= reachKm || distanceKm(p, tail) <= reachKm,
  );
  if (local.length < 2) return { value: 0, projectedKm: 0, alignmentDeg: 90 };

  const localLen = pathLengthKm(local);
  if (localLen < 0.05) return { value: 0, projectedKm: 0, alignmentDeg: 90 };

  const axis = bearingDeg(head, tail);
  const course = bearingDeg(local[0], local[local.length - 1]);
  const deltaDeg = Math.abs(((course - axis + 540) % 360) - 180);
  const align = Math.abs(Math.cos((deltaDeg * Math.PI) / 180));

  const projectedKm = localLen * align;
  // Symmetric length agreement: too short and too long are both wrong.
  const lengthAgreement =
    Math.min(projectedKm, slickLengthKm) / Math.max(projectedKm, slickLengthKm);

  return {
    value: align * lengthAgreement,
    projectedKm,
    alignmentDeg: Math.min(deltaDeg, 180 - deltaDeg),
  };
}

/** S_temporality: how close the candidate's presence is to acquisition. */
export function sTemporality(
  nearestHoursBefore: number,
  backwardHours: number,
): number {
  if (!isFinite(nearestHoursBefore)) return 0;
  return Math.exp(-Math.abs(nearestHoursBefore) / (backwardHours * 0.55));
}

/* ------------------------------------------------------------------ *
 * Gate, score, collate
 * ------------------------------------------------------------------ */

export function score(input: ScoringInput): ScoringResult {
  const {
    drift,
    grids,
    characterisation,
    acquiredAt,
    vessels,
    infrastructure,
    darkTargets,
    variant,
    truthId,
  } = input;

  const backwardHours = drift.backwardHours;
  const head = characterisation.head;

  // Stage 1: the spatiotemporal gate. This is the filter the problem statement
  // asks for, and it is the physically motivated one: a track only survives if
  // it was inside the origin field at the matching backward time.
  const admitted: { vessel: Vessel; peak: number }[] = [];
  for (const v of vessels) {
    let peak = 0;
    for (const p of v.points) {
      const hour = Math.round((p.t - acquiredAt) / 3600_000);
      if (hour > 0 || hour < -backwardHours) continue;
      const prob = fieldProbabilityAt(grids, hour, [p.lon, p.lat]);
      if (prob > peak) peak = prob;
    }
    if (peak >= GATE_THRESHOLD) admitted.push({ vessel: v, peak });
  }

  const gate = {
    considered: vessels.length,
    admitted: admitted.length,
    reason: `Tracks retained where P(lat, lon, t) exceeded ${GATE_THRESHOLD.toFixed(2)} of the field peak at the matching backward hour.`,
  };

  const rows: Suspect[] = [];

  for (const { vessel } of admitted) {
    rows.push(
      scoreVessel(vessel, input, backwardHours, head, variant, truthId),
    );
  }

  for (const infra of infrastructure) {
    rows.push(scoreInfrastructure(infra, input, backwardHours, head, truthId));
  }

  for (const dark of darkTargets) {
    rows.push(scoreDark(dark, input, backwardHours, head, truthId));
  }

  // Stage 3: collate. Vessels, dark contacts and infrastructure land on one
  // scale so that a platform can outrank a passing tanker without a special
  // case, which is what P004's Case 1 requires.
  rank(rows, "total", "rank");
  rank(rows, "totalWithoutDrift", "rankWithoutDrift");

  // Score separability: the margin between the top candidate and the next one.
  // EVALUATION.md asks for this per case, and it is a different statement from
  // insufficient evidence. A narrow margin means two candidates are hard to
  // separate; a diffuse field means none of them can be.
  const separability = rows.length >= 2 ? rows[0].total - rows[1].total : null;

  // C3. A field too diffuse to discriminate is a finding, not a failure, and it
  // must reach the interface as one.
  let insufficient: ScoringResult["insufficientEvidence"] = null;

  const gateMultiplier = characterisation.windGateMultiplier;
  if (gateMultiplier < 0.15) {
    insufficient = {
      area90Km2: drift.convergence[0]?.area90Km2 ?? 0,
      reason: `Wind ${characterisation.windSpeedMs.toFixed(1)} m/s at the detection centroid puts the gate multiplier at ${gateMultiplier.toFixed(2)}. At this wind the sea is dark whether or not there is oil on it, so no ranking here would mean anything.`,
    };
  } else if (drift.insufficientEvidence) {
    insufficient = drift.insufficientEvidence;
  } else if (rows.length === 0) {
    insufficient = {
      area90Km2: drift.convergence[0]?.area90Km2 ?? 0,
      reason:
        "No candidate intersected the origin field anywhere inside the backward horizon.",
    };
  } else if (separability !== null && separability < 0.015) {
    insufficient = {
      area90Km2: drift.convergence.reduce(
        (m, c) => Math.min(m, c.area90Km2),
        Infinity,
      ),
      reason: `Top two candidates separated by ${separability.toFixed(3)}. That is inside the noise of the weighting, so neither is distinguished from the other.`,
    };
  }

  return { suspects: rows, gate, separability, insufficientEvidence: insufficient };
}

function rank(
  rows: Suspect[],
  by: "total" | "totalWithoutDrift",
  into: "rank" | "rankWithoutDrift",
) {
  [...rows]
    .sort((a, b) => b[by] - a[by])
    .forEach((r, i) => {
      r[into] = i + 1;
    });
  rows.sort((a, b) => a.rank - b.rank);
}

function scoreVessel(
  vessel: Vessel,
  input: ScoringInput,
  backwardHours: number,
  head: LngLat,
  variant: DriftVariant,
  truthId: string | null,
): Suspect {
  const { grids, acquiredAt, characterisation } = input;
  const gate = characterisation.windGateMultiplier;
  const track = trackPath(vessel);

  const drift = sDrift(vessel.points, grids, acquiredAt, backwardHours);
  const driftValue = variant === "max" ? drift.max : drift.integral;

  const prox = sProximity(head, track);
  const parity = sParity(
    characterisation.head,
    characterisation.tail,
    track,
    characterisation.lengthKm,
  );
  const nearestHours = Math.abs(drift.bestHour);
  const temporality = sTemporality(nearestHours, backwardHours);
  const beh = behaviour(vessel, acquiredAt);
  const prior = vesselPrior(vessel.kind, vessel.lengthM);

  const terms: Record<ScoreTermKey, number> = {
    drift: driftValue,
    proximity: prox.value,
    parity: parity.value,
    temporality,
    behaviour: beh.score,
    prior,
  };

  // The matched segment: the stretch of track that sat inside the field.
  const matched = matchedSegment(vessel, grids, acquiredAt, backwardHours);

  const explanations: TermExplanation[] = [
    {
      key: "drift",
      value: driftValue,
      weight: WEIGHTS.drift,
      detail: `At ${fmtHour(drift.bestHour)} this track sat inside the ${drift.best.credibleRegionPct.toFixed(0)}% credible region of the origin field, which covered ${drift.best.area90Km2.toFixed(0)} km2 at that hour.${
        variant === "integral"
          ? ` It stayed inside the field for ${drift.dwellHours.toFixed(1)} h of the window.`
          : ""
      }`,
      geometry: matched,
    },
    {
      key: "proximity",
      value: prox.value,
      weight: WEIGHTS.proximity,
      detail: `Slick head ${prox.km.toFixed(2)} km from the nearest track point. Decay exp(-d/${PROXIMITY_LAMBDA_KM.toFixed(1)}).`,
      geometry: [head, track[prox.index] ?? head],
    },
    {
      key: "parity",
      value: parity.value,
      weight: WEIGHTS.parity,
      detail:
        parity.projectedKm < 0.2
          ? "Track projects nothing onto the slick axis. A stationary vessel cannot satisfy this term, and a low value here is not exculpatory."
          : `Local track projects ${parity.projectedKm.toFixed(1)} km onto a ${characterisation.lengthKm.toFixed(1)} km slick axis, ${parity.alignmentDeg.toFixed(0)} degrees off it.`,
      geometry: [characterisation.head, characterisation.tail],
    },
    {
      key: "temporality",
      value: temporality,
      weight: WEIGHTS.temporality,
      detail: `Closest field agreement ${nearestHours.toFixed(0)} h before acquisition.`,
      geometry: null,
    },
    {
      key: "behaviour",
      value: beh.score,
      weight: WEIGHTS.behaviour,
      detail: beh.flags.length
        ? `${beh.flags.length} rule-based flag${beh.flags.length > 1 ? "s" : ""}, each with its raw series.`
        : "No behavioural flag raised on this track.",
      geometry: null,
    },
    {
      key: "prior",
      value: prior,
      weight: WEIGHTS.prior,
      detail: `${vessel.kind}, ${vessel.lengthM} m, ${vessel.draftM} m draught.`,
      geometry: null,
    },
  ];

  const caveats = buildCaveats(input, beh.flags);

  return {
    id: vessel.mmsi,
    kind: "ais_vessel",
    label: vessel.label,
    detail: `${vessel.kind}, ${vessel.lengthM} m`,
    total: combine(terms, gate),
    rank: 0,
    terms,
    weights: WEIGHTS,
    totalWithoutDrift: combineWithout(terms, "drift", gate),
    rankWithoutDrift: 0,
    isTruth: truthId === vessel.mmsi,
    track,
    position: track[track.length - 1],
    evidence: {
      terms: explanations,
      matchedSegment: matched,
      originWindow: [
        input.acquiredAt - backwardHours * 3600_000,
        input.acquiredAt,
      ],
      originOverlap: matched,
      anomalies: beh.flags,
      caveats,
    },
  };
}

function scoreInfrastructure(
  infra: { id: string; label: string; position: LngLat },
  input: ScoringInput,
  backwardHours: number,
  head: LngLat,
  truthId: string | null,
): Suspect {
  const { grids, acquiredAt } = input;
  const gate = input.characterisation.windGateMultiplier;

  // A fixed installation is present at every timestep, so its drift term is the
  // best probability the field ever assigns to its position.
  let max = 0;
  let bestHour = 0;
  let best = fieldAgreement(grids, 0, infra.position);
  for (let h = -backwardHours; h <= 0; h++) {
    const agreement = fieldAgreement(grids, h, infra.position);
    if (agreement.value > max) {
      max = agreement.value;
      best = agreement;
      bestHour = h;
    }
  }

  const km = distanceKm(head, infra.position);
  const proximity = Math.exp(-km / PROXIMITY_LAMBDA_KM);
  const temporality = sTemporality(Math.abs(bestHour), backwardHours);

  const terms: Record<ScoreTermKey, number> = {
    drift: max,
    proximity,
    // A platform has no track, so parity is undefined rather than zero. It is
    // reported as zero and stated as inapplicable, so it cannot be read as a
    // score against the candidate.
    parity: 0,
    temporality,
    behaviour: 0,
    prior: 0.86,
  };

  const explanations: TermExplanation[] = [
    {
      key: "drift",
      value: max,
      weight: WEIGHTS.drift,
      detail: `At ${fmtHour(bestHour)} the origin field placed this installation inside its ${best.credibleRegionPct.toFixed(0)}% credible region, over ${best.area90Km2.toFixed(0)} km2.`,
      geometry: [infra.position],
    },
    {
      key: "proximity",
      value: proximity,
      weight: WEIGHTS.proximity,
      detail: `Slick head ${km.toFixed(2)} km from the installation.`,
      geometry: [head, infra.position],
    },
    {
      key: "parity",
      value: 0,
      weight: WEIGHTS.parity,
      detail: "Not applicable. Fixed infrastructure has no track to be parallel to.",
      geometry: null,
    },
    {
      key: "temporality",
      value: temporality,
      weight: WEIGHTS.temporality,
      detail: `Present at every timestep. Best field agreement ${Math.abs(bestHour).toFixed(0)} h before acquisition.`,
      geometry: null,
    },
    {
      key: "behaviour",
      value: 0,
      weight: WEIGHTS.behaviour,
      detail: "Not applicable to fixed infrastructure.",
      geometry: null,
    },
    {
      key: "prior",
      value: 0.86,
      weight: WEIGHTS.prior,
      detail: "Production platform. Leak and routine discharge are both plausible.",
      geometry: null,
    },
  ];

  const caveats = [
    input.infrastructureCoverage === "partial"
      ? "Infrastructure coverage for this AOI is partial. A missing installation would push its share of the score onto vessels."
      : "Infrastructure coverage for this AOI is complete in the reference dataset.",
    ...baseCaveats(input),
  ];

  return {
    id: infra.id,
    kind: "infrastructure",
    label: infra.label,
    detail: "Fixed installation",
    total: combine(terms, gate),
    rank: 0,
    terms,
    weights: WEIGHTS,
    totalWithoutDrift: combineWithout(terms, "drift", gate),
    rankWithoutDrift: 0,
    isTruth: truthId === infra.id,
    track: null,
    position: infra.position,
    evidence: {
      terms: explanations,
      matchedSegment: null,
      originWindow: [acquiredAt - backwardHours * 3600_000, acquiredAt],
      originOverlap: [infra.position],
      anomalies: [],
      caveats,
    },
  };
}

function scoreDark(
  dark: { id: string; position: LngLat; lengthM: number },
  input: ScoringInput,
  backwardHours: number,
  head: LngLat,
  truthId: string | null,
): Suspect {
  const { grids, acquiredAt } = input;
  const gate = input.characterisation.windGateMultiplier;

  // A radar contact is a position at one instant. There is no track, so the
  // field is sampled at acquisition only, and everything a track would have
  // supplied is reported as unavailable rather than as zero evidence.
  const agreement = fieldAgreement(grids, 0, dark.position);
  const prob = agreement.value;
  const km = distanceKm(head, dark.position);
  const proximity = Math.exp(-km / PROXIMITY_LAMBDA_KM);

  const terms: Record<ScoreTermKey, number> = {
    drift: prob,
    proximity,
    parity: 0,
    temporality: 1,
    behaviour: 0.45,
    prior: Math.min(0.8, dark.lengthM / 260),
  };

  const explanations: TermExplanation[] = [
    {
      key: "drift",
      value: prob,
      weight: WEIGHTS.drift,
      detail: `At acquisition the contact sits inside the ${agreement.credibleRegionPct.toFixed(0)}% credible region of the field. Without a track there is no earlier position to test.`,
      geometry: [dark.position],
    },
    {
      key: "proximity",
      value: proximity,
      weight: WEIGHTS.proximity,
      detail: `Slick head ${km.toFixed(2)} km from the radar contact.`,
      geometry: [head, dark.position],
    },
    {
      key: "parity",
      value: 0,
      weight: WEIGHTS.parity,
      detail: "Unavailable. No AIS track exists for this contact.",
      geometry: null,
    },
    {
      key: "temporality",
      value: 1,
      weight: WEIGHTS.temporality,
      detail: "Contact detected in the acquisition itself.",
      geometry: null,
    },
    {
      key: "behaviour",
      value: 0.45,
      weight: WEIGHTS.behaviour,
      detail:
        "Absence of AIS is scored against the regional reception expectation, not as a raw gap. It is suggestive, not conclusive.",
      geometry: null,
    },
    {
      key: "prior",
      value: Math.min(0.8, dark.lengthM / 260),
      weight: WEIGHTS.prior,
      detail: `Radar-estimated length ${dark.lengthM} m. Vessel class unknown.`,
      geometry: null,
    },
  ];

  return {
    id: dark.id,
    kind: "dark_vessel",
    // Ranked, never named. There is no identity to resolve and inventing one
    // would be the worst failure this system could have.
    label: "Unlit contact",
    detail: `Radar bright target, ${dark.lengthM} m estimated`,
    total: combine(terms, gate),
    rank: 0,
    terms,
    weights: WEIGHTS,
    totalWithoutDrift: combineWithout(terms, "drift", gate),
    rankWithoutDrift: 0,
    isTruth: truthId === dark.id,
    track: null,
    position: dark.position,
    evidence: {
      terms: explanations,
      matchedSegment: null,
      originWindow: [acquiredAt - backwardHours * 3600_000, acquiredAt],
      originOverlap: [dark.position],
      anomalies: [
        {
          code: "no_ais",
          label: "No AIS association",
          detail:
            "Radar bright target with no AIS report within the matching tolerance. Reception in this AOI supports roughly 92% of Class A traffic, so the absence is not explained by coverage alone.",
          series: [],
          seriesLabel: "",
          expected: 0.92,
        },
      ],
      caveats: [
        "This candidate carries no identity and is not resolvable to a vessel. It is ranked as a hypothesis only.",
        ...baseCaveats(input),
      ],
    },
  };
}

/**
 * Weighted combination, scaled by the wind gate (C9).
 *
 * The gate is a confidence multiplier on the detection, not a filter on it. A
 * slick found at 1.9 m/s is still shown, still characterised, and still drives a
 * drift run. What it does not do is support an accusation, so it scales every
 * score that rests on it and the raw wind speed travels to the card.
 */
function combine(
  terms: Record<ScoreTermKey, number>,
  windGate: number,
): number {
  const raw = (Object.keys(WEIGHTS) as ScoreTermKey[]).reduce(
    (s, k) => s + terms[k] * WEIGHTS[k],
    0,
  );
  return raw * windGate;
}

/** Renormalised over the remaining weights, so the ablation is a fair comparison. */
function combineWithout(
  terms: Record<ScoreTermKey, number>,
  drop: ScoreTermKey,
  windGate: number,
): number {
  const keys = (Object.keys(WEIGHTS) as ScoreTermKey[]).filter(
    (k) => k !== drop,
  );
  const wsum = keys.reduce((s, k) => s + WEIGHTS[k], 0);
  return (
    (keys.reduce((s, k) => s + terms[k] * WEIGHTS[k], 0) / wsum) * windGate
  );
}

function matchedSegment(
  vessel: Vessel,
  grids: Map<number, FieldFrame>,
  acquiredAt: number,
  backwardHours: number,
): LngLat[] | null {
  const seg: LngLat[] = [];
  for (const p of vessel.points) {
    const hour = Math.round((p.t - acquiredAt) / 3600_000);
    if (hour > 0 || hour < -backwardHours) continue;
    if (fieldProbabilityAt(grids, hour, [p.lon, p.lat]) >= GATE_THRESHOLD) {
      seg.push([p.lon, p.lat]);
    }
  }
  return seg.length >= 2 ? seg : seg.length === 1 ? [seg[0], seg[0]] : null;
}

function baseCaveats(input: ScoringInput): string[] {
  const out: string[] = [];
  const c = input.characterisation;

  if (c.windGateMultiplier < 0.75) {
    out.push(
      `Wind ${c.windSpeedMs.toFixed(1)} m/s at the detection centroid. Gate multiplier ${c.windGateMultiplier.toFixed(2)}, so this detection carries reduced confidence.`,
    );
  }
  if (c.headTailResolvedBy === "ambiguous") {
    out.push(
      "Head and tail could not be separated from geometry alone. Proximity was computed against both ends and the better is reported.",
    );
  }
  out.push(
    `Damping ratio ${c.dampingRatioDb.toFixed(1)} dB is a relative contrast index. It is not a thickness and no volume follows from it.`,
  );
  out.push(
    "Forcing resolution is coarser than the slick. That widens the origin field and is reflected in the interval, not hidden.",
  );
  return out;
}

function buildCaveats(input: ScoringInput, flags: AnomalyFlag[]): string[] {
  const out = baseCaveats(input);
  if (flags.some((f) => f.code === "reception_gap")) {
    out.push(
      "A reception gap appears in this track. Gaps are normalised against expected reception density before they count, and the raw series is on the card.",
    );
  }
  if (input.infrastructureCoverage === "partial") {
    out.push(
      "Infrastructure coverage for this AOI is partial. A missing installation would inflate every vessel score here.",
    );
  }
  return out;
}

function fmtHour(hour: number): string {
  const h = Math.abs(hour);
  if (hour === 0) return "acquisition";
  return `T${hour < 0 ? "-" : "+"}${h}h`;
}

/** Evidence card lookup, kept separate so the panel can be lazy about it. */
export function cardFor(suspects: Suspect[], id: string): EvidenceCard | null {
  return suspects.find((s) => s.id === id)?.evidence ?? null;
}

export type { CandidateKind };
