/**
 * The project's substance, in one place.
 *
 * What lives here is what is true regardless of who is presenting it: the six
 * scoring terms and where each came from, the pipeline stages, how this sits
 * against the prior art, and the limits the system refuses to talk its way out
 * of. Those are the project's positions, not a direction's copy.
 *
 * What deliberately does *not* live here is headlines, ledes, section titles
 * and section order. Those belong to each direction and are written inside it,
 * because a publication opening an investigation, a workstation reporting its
 * state, an instrument coming online and a case file being unsealed are not the
 * same sentence in four typefaces. When the four shared a copy deck they read
 * as one website, which is exactly the problem this restructure exists to fix.
 *
 * The one rule the whole file obeys: no invented precision, and no real vessel
 * named.
 */

import type { ScoreTermKey } from "./sim/types";

export const PRODUCT = {
  name: "Slickline",
  /** Used only where a direction wants a one-line statement of the system. */
  summary:
    "Detect oil at sea from radar satellites, run the drift backwards to where it started, and rank the vessels that were there.",
};

/* ------------------------------------------------------------------ *
 * The pipeline
 * ------------------------------------------------------------------ */

export interface Stage {
  key: string;
  name: string;
  /** Machine-side name, for the direction that reports stages as processes. */
  proc: string;
  body: string;
}

export const STAGES: Stage[] = [
  {
    key: "ingest",
    name: "Ingest",
    proc: "s1.preprocess",
    body: "Sentinel-1 interferometric wide swath, VV polarisation, 10 m ground sample, 250 km per pass. Calibrated to sigma nought, speckle filtered, land masked, terrain corrected. The pixel to geographic round trip has to close inside one pixel, because every proximity measurement downstream inherits that error.",
  },
  {
    key: "segment",
    name: "Segment",
    proc: "detect.instance",
    body: "Instance segmentation into two classes: operational discharge, and slick of unknown origin. Contours rather than boxes, because the drift ensemble seeds inside the mask and a bounding box would seed the sea around it.",
  },
  {
    key: "characterise",
    name: "Characterise",
    proc: "geom.characterise",
    body: "Area on an equal-area projection, length along the medial axis, width sampled perpendicular to it, orientation, fragmentation, and the head. Where along a slick you look matters more than how you weight distance from it.",
  },
  {
    key: "hindcast",
    name: "Hindcast",
    proc: "drift.backward",
    body: "An ensemble of drift members steps particles backward through currents and wind, producing a probability field over space and time rather than a line on a map. The same engine runs forward for a 72 hour impact forecast.",
  },
  {
    key: "gate",
    name: "Gate",
    proc: "ais.gate",
    body: "Historic traffic is filtered against that field at matching times. This is the step that turns tens of thousands of AIS reports into a handful of candidates, and it is the only filter in the system with physics behind it.",
  },
  {
    key: "score",
    name: "Score",
    proc: "attrib.collate",
    body: "Six weighted terms, collated so that vessels, unlit contacts and fixed infrastructure compete on one scale. A platform outranks a passing tanker when it should, and no rule in the code says so.",
  },
];

/* ------------------------------------------------------------------ *
 * The six terms
 * ------------------------------------------------------------------ */

export const TERM_ORIGIN: Record<ScoreTermKey, string> = {
  drift: "This project",
  proximity: "Cerulean",
  parity: "Cerulean",
  temporality: "Cerulean",
  behaviour: "This project",
  prior: "Cerulean",
};

export const TERM_NOTE: Record<ScoreTermKey, string> = {
  drift:
    "Agreement between the track and the origin field at matching times. Nothing in the reviewed literature computes it: the operational reference system substitutes slick geometry as a proxy, and the paper this builds on named reverse-trajectory simulation as future work.",
  proximity:
    "Slick head to the nearest point of the track, decaying exponentially with distance. Measures where the vessel was, not where it was going.",
  parity:
    "How much of the slick this track could have laid down, measured on the stretch of it that runs near the slick. Meaningless for a vessel that was not moving.",
  temporality:
    "How close the candidate's presence is to the acquisition, and to the estimated release window inside it.",
  behaviour:
    "Rules plus a composite, never a raw anomaly number. An anomaly score with no series behind it is not inspectable evidence, and a reception-normalised gap is not the same thing as a raw gap.",
  prior:
    "Vessel type, size and draught. A weak prior, weighted as one, and never enough on its own to move a ranking.",
};

/* ------------------------------------------------------------------ *
 * Against the prior art
 * ------------------------------------------------------------------ */

export interface Comparison {
  system: string;
  detect: string;
  drift: string;
  ais: string;
  explain: string;
  ours?: boolean;
}

export const COMPARISON: Comparison[] = [
  {
    system: "Zhao et al. 2025",
    detect: "Two classes, boxes",
    drift: "None. Named as future work",
    ais: "By hand, per case",
    explain: "No",
  },
  {
    system: "Cerulean, SkyTruth",
    detect: "Binary, contours",
    drift: "None. Geometry used as a proxy",
    ais: "Automatic",
    explain: "Partial",
  },
  {
    system: "This project",
    detect: "Two classes, instance masks",
    drift: "Ensemble origin field",
    ais: "Conditioned on the field",
    explain: "Evidence card per candidate",
    ours: true,
  },
];

/* ------------------------------------------------------------------ *
 * Limits
 *
 * Carried in the same weight of type as the claims, in every direction. A
 * system that names vessels as suspected polluters and does not publish where
 * it stops being certain is not a usable system, it is a confident one.
 * ------------------------------------------------------------------ */

export interface Limit {
  key: string;
  title: string;
  /** Compressed to a single clause, for the directions that list rather than set. */
  short: string;
  body: string;
}

export const LIMITS: Limit[] = [
  {
    key: "diffusion",
    title: "Diffusion does not run backwards cleanly",
    short: "Reversal spreads, it does not focus",
    body: "Reversing a spreading process spreads it further. Past roughly a day or two the origin field widens until it cannot separate one candidate from another, and the honest output then is that the window is too diffuse to attribute. That state is not an empty result; it is the finding.",
  },
  {
    key: "lookalike",
    title: "A dark patch is not always oil",
    short: "Low wind and biogenic film look identical in radar",
    body: "Low wind, natural films, sea ice and ship wakes all flatten the surface the same way. Wind speed is sampled at every detection and carried through as a continuous multiplier, so a detection at 1.9 m/s visibly loses confidence rather than quietly disappearing.",
  },
  {
    key: "dark",
    title: "Transponders can be switched off",
    short: "An unlit contact is ranked but never named",
    body: "A radar bright target with no AIS association is scored as a candidate and never given a name. Absence of a signal is measured against the reception the region actually supports, because a raw gap is not evidence and there are legitimate reasons to go dark.",
  },
  {
    key: "thickness",
    title: "Damping is not thickness",
    short: "There is no field for microns, or for volume",
    body: "Backscatter contrast between the slick and the water around it is a relative index. Converting it to microns, or to a spilled volume, would be inventing a number that remote sensing cannot currently supply. There is no field for either anywhere in this system.",
  },
  {
    key: "forcing",
    title: "Coarse forcing widens everything",
    short: "The ocean model grid is wider than the slick",
    body: "Ocean model grids are coarser than a slick is wide. That uncertainty belongs in the interval the system reports, not hidden inside a tighter-looking contour.",
  },
  {
    key: "determination",
    title: "A ranked candidate is not a determination",
    short: "Candidate, suspected, score. Never responsible or confirmed",
    body: "The language here is candidate, suspected and score. It is never responsible, confirmed or guilty, and the alternative hypotheses stay on screen next to the top-ranked one.",
  },
];

/* ------------------------------------------------------------------ *
 * Provenance
 *
 * Integrated differently by each direction -- as a source note under an
 * editorial figure, as a machine status flag, as telemetry metadata, as an
 * evidence classification -- but the substance of the statement is fixed.
 * ------------------------------------------------------------------ */

export const PROVENANCE = {
  full: "Simulated demonstration. Acquisition times, slick lengths and suspected-source coordinates come from Zhao et al. 2025; the drift fields, AIS traffic, radar imagery and every score are generated by the simulation running on this page. No model has been trained yet.",
  short: "Simulated. No model trained. Identities masked.",
  flag: "SIM",
};

export const PUBLISHED = [
  "Acquisition times, slick lengths and suspected-source coordinates for the three Gulf of Mexico cases.",
  "Sentinel-1 instrument parameters, and the wind band over which oil is detectable at all.",
  "The proximity decay constant and the term family, from the operational reference implementation.",
];

export const SIMULATED = [
  "Every current and wind field, as a smooth analytic substitute for the ocean model the pipeline reads.",
  "Every AIS track. Real traffic is not redistributed here, and Indian-waters scenarios are authored because free real AIS covers United States waters only.",
  "Every score. No model has been trained yet, and no number on these pages is a measurement of one.",
  "Radar imagery, generated from a speckle model rather than photographed, so nothing on screen can be mistaken for an acquisition.",
];
