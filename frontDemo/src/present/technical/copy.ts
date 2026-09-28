/**
 * Every word the technical sequence (X) puts on screen, and the files it draws.
 *
 * Numbers that belong to the 15 May 2023 pass are formatted from its own files
 * at run time, not written here.
 */

export const PROVENANCE =
  "Technical sequence. One real pass carries every beat: Sentinel-1A, 15 May 2023 00:02 UTC. " +
  "Imagery, detections, characterisation, ERA5/CMEMS forcing, OpenDrift frames and MarineCadastre " +
  "AIS are the console's own shipped files; the gate is the backend's gate_admitted on them " +
  "(scripts/export_present_assets.py). The Score beat's six terms are Case 2's top candidate from " +
  "the authored scoring fixture, shown by its masked MMSI as the most suspected vessel (the user " +
  "asked for a named suspect, 2026-09-27). The Timing beat is the deck's measured 00016 run. Tech stack lists only what the repository's md files name.";

export const RAIL = [
  "Acquire",
  "Clean",
  "Slice",
  "Segment",
  "Measure",
  "Weather Data",
  "Hindcast",
  "Forecast",
  "Gate",
  "Score",
  "Timing",
] as const;

export const TECH_BEATS: readonly string[] = [
  "blackout",
  "pill",
  "acquire",
  "clean",
  "slice",
  "segment",
  "measure",
  "weather",
  "hindcast",
  "forecast",
  "gate",
  "score",
  "timing",
  "stackIn",
  "layer1",
  "layer2",
  "layer3",
  "layer4",
  "layer5",
  "thanks",
];

export const LABELS = {
  pill: "TECHNICAL APPROACH",
  stack: "TECH STACK",
  sensor: "Sentinel-1A IW GRD, VV",
  when: "15 May 2023, 00:02 UTC",
  metadata: "Time and position read from the file",
  raw: "Raw",
  filtered: "Filtered",
  calibrated: "Calibrated",
  lee: "Refined Lee speckle filter",
  land: "Land masked",
  db: "dB after filtering",
  vv: "VV",
  vh: "VH",
  bandNote: "Oil contrast, so the model reads VV",
  tiles: "tiles of 1024 px, 10% overlap",
  detections: "detections",
  era5: "ERA5",
  cmems: "CMEMS",
  windName: "Wind at 10 m",
  currentName: "Ocean surface current",
  from: "from",
  toward: "toward",
  forcingNote: "Hourly, 72 h either side of the pass",
  back: "h back",
  ahead: "h ahead",
  hindcastKey: "Hindcast particles",
  originKey: "Origin area, 50% and 90%",
  forecastKey: "Forecast particles",
  aheadKey: "Where the oil goes, 90%",
  origin: "origin area",
  gateTitle: "AIS traffic",
  inWindow: "tracks in the time window",
  gate: "inside the field at the right hour",
  dark: "radar contacts, no AIS",
  suspectKey: "most suspected",
  scoreTitle: "Most suspected vessel",
  candidate: "A candidate, six terms",
  ranked: "Ranked candidates",
  rankedNote: "Every ship that crossed the field, scored the same way",
  weight: "weight",
  score: "score",
  suspected: "suspected source",
  rank: "rank",
  of: "of",
  named: "Ground truth in the published Case 2, Zhao et al. 2025",
  timingTitle: "Measured processing time",
  timingSub: "Zenodo scene 00016, run live in the browser",
  speed: "Speed",
  model: "Model",
  total: "end to end, image in to suspects ranked",
  inference: "model inference on the user's GPU",
  typical: "a typical upload",
  typicalValue: "10 to 25 s",
  confidence: "model confidence on this scene's slick",
  rejected: "look-alikes rejected, 83 of 87 unseen tiles",
} as const;

/**
 * The Timing beat: the console's Model Timing pane for Zenodo scene 00016.tif,
 * run live in the browser, as the SIH deck records it (SIH-26143-updated-v3.pptx,
 * slide 4, "Measured pipeline time"). The stage names are the console's own
 * (`UPLOAD_STAGES`); the total is the deck's stated 22.7 s.
 */
export const TIMING = {
  stages: [
    { name: "Decode raster", detail: "2048 × 2048, band 2", ms: 3400, model: false },
    { name: "Load segmenter", detail: "ONNX model, WebGPU", ms: 8600, model: true },
    { name: "Segmenter inference", detail: "7 detections, 9 tiles, WebGPU", ms: 9100, model: true },
    { name: "Trace outline", detail: "1.79% of the frame", ms: 117, model: false },
    { name: "Despeckle (display only)", detail: "Lee 7 × 7", ms: 562, model: false },
    { name: "Coastline tiles (GSHHG)", detail: "2 coastal tiles fetched", ms: 51, model: false },
    { name: "Wind and currents (ERA5, Copernicus)", detail: "ERA5 wind and SMOC currents, 111 h", ms: 929, model: false },
    { name: "AIS traffic (MarineCadastre)", detail: "AIS ship traffic", ms: 10, model: false },
    { name: "Drift, traffic and scoring", detail: "36 h back, 72 h ahead, on the map", ms: 33, model: false },
  ],
  totalS: 22.7,
  inferenceS: 9.1,
  /** The model's confidence on that same scene's slick, as the console shows it. */
  confidencePct: 91,
  /** eval/RESULTS.md: v12 raises an alarm on 4 of 87 frozen holdout look-alikes. */
  lookalikes: { alarms: 4, of: 87 },
  rejectedPct: 95,
} as const;

export const TECH_ASSETS: readonly string[] = [
  "present/journey.json",
  "present/coast-gulf.json",
  "present/coast-drift.json",
  "present/may/scene.webp",
  "present/may/raw-crop.webp",
  "present/may/clean-crop.webp",
  "runs/S1A_IW_GRDH_1SDV_20230515T000208_20230515T000233_048537_05D69B_35AF_s0db/scene.json",
  "runs/S1A_IW_GRDH_1SDV_20230515T000208_20230515T000233_048537_05D69B_35AF_s0db/drift.json",
  "ais/real-20230515.json",
  "ais/gom-moving.json",
  "present/repo-qr.svg",
];

/** The team, for the closing screen (the user, 2026-09-27). */
export const TEAM = {
  name: "Dead Braincells",
  teamId: "161987",
  problemId: "SIH26143",
  members: ["Haziq Landge", "Aditya Madhavi", "Jayraj Sanas", "Smit Patil", "Sayoni Patil", "Harvinder Jadhav"],
  repo: "https://github.com/haziqlandge/satellite-oilSpill-detection",
} as const;

export const THANKS = {
  title: "THANK YOU",
  team: "Team",
  teamId: "Team ID",
  problemId: "Problem Statement ID",
  scan: "Scan to open the repository",
} as const;

export function allTechnicalCopy(): string[] {
  return [
    ...RAIL,
    ...Object.values(LABELS),
    ...TIMING.stages.flatMap((st) => [st.name, st.detail]),
    ...Object.values(THANKS),
    TEAM.name,
    ...TEAM.members,
  ];
}
