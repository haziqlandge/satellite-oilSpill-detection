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
  name: "SlickTrace",
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

/* ------------------------------------------------------------------ *
 * Why spills happen
 *
 * General to the problem, not to any one case: this is the part of the page
 * that stays put when the reader changes which spill a figure is showing. The
 * split matters because the two causes leave different evidence, and the
 * system treats them differently -- one is a vessel that can be identified from
 * its own broadcasts, the other is a vessel that has stopped making them.
 * ------------------------------------------------------------------ */

export interface Cause {
  key: string;
  title: string;
  /** One clause, for the directions that list rather than set. */
  short: string;
  body: string;
  /** What this cause leaves behind that the system can actually key on. */
  signature: string;
}

export const CAUSES: Cause[] = [
  {
    key: "operational",
    title: "Operational and accidental discharge",
    short: "Routine practice and equipment failure, transponder on",
    body: "Most oil at sea does not come from a tanker breaking up. It comes from routine practice -- tank washings, oily bilge water, fuel transfer, a valve left open -- and from equipment that fails while a vessel is going about its business. The vessel is usually still broadcasting throughout, because nothing about it is trying to hide, and often nobody aboard has registered that anything happened at all.",
    signature: "A continuous AIS track that passes through the origin window at the right time. The discharge is visible as a trail because the source was moving while it leaked, and the trail runs parallel to the track.",
  },
  {
    key: "deliberate",
    title: "Deliberate release with the transponder off",
    short: "The gap in the record is the tell, and a gap is not proof",
    body: "The other kind is deliberate: discharge at night, far from a coast, with the transponder switched off for the duration. AIS is a cooperative system and it can simply be turned off, so a vessel that intends not to be seen will not be in the traffic record at the hour that matters. What remains is a radar contact with nothing broadcasting from it.",
    signature: "A bright radar target with no AIS association, or a track that stops before the origin window and resumes after it. Both are ranked; neither is named. A gap is measured against the reception the region actually supports, because there are legitimate reasons to go dark and a raw gap on its own is not evidence.",
  },
];

/* ------------------------------------------------------------------ *
 * How the detector is trained
 *
 * Kept deliberately short and free of numbers this demo cannot stand behind.
 * No model has been trained yet; what is stated here is the design and the
 * corpus it will be trained on, not a result.
 * ------------------------------------------------------------------ */

export interface MethodNote {
  key: string;
  title: string;
  body: string;
}

export const METHOD: MethodNote[] = [
  {
    key: "corpus",
    title: "What it learns from",
    body: "A published corpus of Sentinel-1 scenes with the slicks outlined by hand, plus a deliberately large pool of look-alikes: low-wind cells, biogenic films, sea ice, ship wakes. Roughly a tenth of every split is a look-alike that is not oil, because look-alikes are the dominant failure mode and the single highest-leverage intervention available is to show the model plenty of them.",
  },
  {
    key: "architecture",
    title: "What it looks for",
    body: "Instance segmentation rather than boxes, in two classes: an operational discharge, and a slick whose origin is unknown. Contours rather than boxes because the drift ensemble is seeded inside the mask, and a bounding box would seed the sea around it. A large-kernel attention stage sits at the detection heads, which is what lets the model weigh a dark patch against its surroundings rather than in isolation.",
  },
  {
    key: "gate",
    title: "How a suspect is reached",
    body: "The detection is characterised, run backward through an ensemble of drift members, and turned into a probability field over space and time. Historic traffic is then filtered against that field at matching hours -- the one filter in the system with physics behind it -- and whatever survives is scored on six weighted terms. Vessels, unlit contacts and fixed infrastructure compete on one scale, so a platform can outrank a passing tanker without any rule in the code saying it should.",
  },
  {
    key: "honesty",
    title: "What it refuses to do",
    body: "No model has been trained yet, and every number on this page comes from the simulation running in your browser. When the origin field is too diffuse to separate one candidate from another, the system reports that instead of producing a suspect. A candidate is never called responsible, and a contact with no transponder is ranked but never given a name.",
  },
];
