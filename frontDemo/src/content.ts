/**
 * Shared copy and data for all five layouts.
 *
 * Every number here is either real and sourced, or explicitly marked as
 * illustrative. No invented precision: the detection figures come from
 * Zhao et al. 2025 (Mar. Pollut. Bull., doi:10.1016/j.marpolbul.2025.118608),
 * which is the paper this system builds on.
 *
 * Vessel identities are deliberately masked. The published cases name real
 * ships, and putting a real vessel's name on a marketing page next to the word
 * "polluter" is not something a layout demo should do.
 */

export const PRODUCT = {
  name: "Slickline",
  tagline: "Find the slick. Trace it home. Name the ship.",
  summary:
    "Detect oil at sea from radar satellites, run the drift backwards to where it started, and rank the vessels that were there.",
};

export const CAPABILITIES = [
  {
    id: "detect",
    label: "Detect",
    title: "Radar sees through weather and darkness",
    body: "Oil flattens the sea surface, so slicks read as dark patches in Sentinel-1 radar. Instance segmentation separates vessel discharges from slicks of unknown origin.",
  },
  {
    id: "characterise",
    label: "Characterise",
    title: "Geometry, not just a bounding box",
    body: "Area, length along the medial axis, width profile, orientation and fragmentation. The head of the slick is found from the outline, because that is where the source scoring keys in.",
  },
  {
    id: "hindcast",
    label: "Hindcast",
    title: "Run the ocean backwards",
    body: "An ensemble drift model steps the slick back through currents and wind to produce an origin probability field across space and time, not a single line on a map.",
  },
  {
    id: "attribute",
    label: "Attribute",
    title: "Rank who was actually there",
    body: "Historic vessel tracks are filtered against that origin field, then scored on drift agreement, proximity, parallelism, timing, behaviour and vessel type.",
  },
];

export const PIPELINE = [
  { step: "Ingest", detail: "Sentinel-1 VV, calibrated, speckle-filtered, geocoded" },
  { step: "Segment", detail: "Two classes: operational discharge, unknown origin" },
  { step: "Measure", detail: "Area, axis, head and tail, surface contrast" },
  { step: "Reverse", detail: "Ensemble backward drift to an origin field" },
  { step: "Match", detail: "Vessel tracks gated on that field in space and time" },
  { step: "Score", detail: "Six weighted terms, every one of them inspectable" },
];

/** Sourced figures. Each carries its provenance so nothing reads as invented. */
export const EVIDENCE = [
  {
    value: "94.2%",
    unit: "mAP50",
    note: "Multi-class detection accuracy reported for the model architecture this builds on",
    source: "Zhao et al. 2025",
  },
  {
    value: "19 km",
    unit: "slick length",
    note: "A single discharge trail measured in one published Gulf of Mexico case",
    source: "Zhao et al. 2025",
  },
  {
    value: "10 m",
    unit: "ground sample",
    note: "Sentinel-1 interferometric wide swath resolution, 250 km per pass",
    source: "ESA Copernicus",
  },
];

export const SCORE_TERMS = [
  { key: "drift", label: "Drift agreement", weight: 0.30, note: "Track intersects the origin field at the matching time" },
  { key: "proximity", label: "Proximity", weight: 0.20, note: "Distance from the slick head to the nearest track point" },
  { key: "parity", label: "Parallelism", weight: 0.15, note: "Slick axis against the vessel's course" },
  { key: "temporality", label: "Timing", weight: 0.15, note: "Closeness to the moment the image was taken" },
  { key: "behaviour", label: "Behaviour", weight: 0.12, note: "Speed drops, course changes, loitering, transponder gaps" },
  { key: "prior", label: "Vessel prior", weight: 0.08, note: "Type, size and draught change" },
];

/**
 * Illustrative candidate list. Identities are masked and the scores are
 * examples, not output from a run.
 */
export const CANDIDATES = [
  { rank: 1, id: "MMSI 636•••••4", kind: "Product tanker", score: 0.87, verdict: "Strong" },
  { rank: 2, id: "MMSI 538•••••1", kind: "Bulk carrier", score: 0.41, verdict: "Weak" },
  { rank: 3, id: "Platform cluster", kind: "Fixed infrastructure", score: 0.33, verdict: "Weak" },
  { rank: 4, id: "Unlit contact", kind: "No transponder", score: 0.29, verdict: "Weak" },
];

export const LIMITS = [
  {
    title: "Diffusion does not run backwards cleanly",
    body: "Reversing a spreading process spreads it further. Past roughly two days the origin field widens until it cannot separate one candidate from another, and the honest output then is that the window is too diffuse to attribute.",
  },
  {
    title: "A dark patch is not always oil",
    body: "Low wind, natural films, sea ice and ship wakes all flatten the surface the same way. Wind speed is checked at every detection and the confidence is reported, not silently applied.",
  },
  {
    title: "Transponders can be switched off",
    body: "Vessels that stop broadcasting are still scored, as radar contacts without an identity. They are ranked but never named.",
  },
];

/**
 * Placeholder imagery. These are ordinary photographs treated with duotone and
 * halftone so the composition is honest about tone and density. They are NOT
 * radar imagery and must be swapped for real Sentinel-1 tiles.
 */
export const IMAGES = {
  slickWide: "https://picsum.photos/seed/slickline-sar-swath/1600/900?grayscale",
  slickTall: "https://picsum.photos/seed/slickline-slick-detail/900/1200?grayscale",
  sea: "https://picsum.photos/seed/slickline-open-water/1400/900?grayscale",
  coast: "https://picsum.photos/seed/slickline-delta-coast/1200/800?grayscale",
  vessel: "https://picsum.photos/seed/slickline-tanker-wake/1200/800?grayscale",
  scope: "https://picsum.photos/seed/slickline-radar-scope/1000/1000?grayscale",
};
