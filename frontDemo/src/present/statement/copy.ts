/**
 * Every word the statement sequence (T) puts on screen.
 *
 * Wording follows the NTRO brief (SIH26143) and the repository's own measured
 * numbers, never the pitch deck's. `scripts/check-present.ts` holds all of it to
 * the copy rules in `../copyGuard.ts`.
 */

export const PROVENANCE =
  "Statement sequence. The title is the official SIH26143 problem statement, verbatim. " +
  "Numbers are measured in this repository: 4,227 training tiles including 872 lookalikes " +
  "(DATA.md, final-v12), false alarms 55 to 4 of 87 (eval/part2/REPORT.md), 91% confidence on " +
  "Zenodo 00016 and about 9 s WebGPU inference, 10 to 25 s per upload (the user's own runs, " +
  "2026-09-27). Images are the console's real data and captures of the console itself.";

export const STATEMENT = {
  title: [
    { text: "Leveraging satellite imagery to determine ", red: false },
    { text: "Oil spills at sea", red: true },
    { text: " along with ", red: false },
    { text: "AIS data correlations", red: true },
    { text: " to ", red: false },
    { text: "identify vessel", red: true },
    { text: " responsible for the spill.", red: false },
  ],
  description:
    "Oil spills at sea wreck marine ecosystems and often stay unattributed. Satellite imagery and AIS data together can find the spill and the ship behind it.",
  chips: ["SIH26143", "NTRO", "Disaster Management"],
} as const;

export const PILL = {
  problem: "PROBLEM",
  statement: "STATEMENT",
  objectives: "OBJECTIVES",
  solution: "PROPOSED SOLUTION",
} as const;

export type ObjectiveId = "detect" | "characterise" | "trace" | "predict" | "attribute";
export type ObjectiveIcon = "Crosshair" | "Ruler" | "ClockCounterClockwise" | "Path" | "Boat";

export const OBJECTIVES: readonly { id: ObjectiveId; icon: ObjectiveIcon; heading: string; body: string }[] = [
  {
    id: "detect",
    icon: "Crosshair",
    heading: "DETECT",
    body: "Find oil slicks in SAR and optical satellite passes and tell them apart from lookalikes",
  },
  {
    id: "characterise",
    icon: "Ruler",
    heading: "CHARACTERISE",
    body: "Measure area, shape, length and width, and estimate how old the slick is",
  },
  {
    id: "trace",
    icon: "ClockCounterClockwise",
    heading: "TRACE BACK",
    body: "Run the slick back through wind and current data to its origin point and time",
  },
  {
    id: "predict",
    icon: "Path",
    heading: "PREDICT",
    body: "Forecast where the oil drifts next and which shore it reaches",
  },
  {
    id: "attribute",
    icon: "Boat",
    heading: "ATTRIBUTE",
    body: "Rebuild AIS traffic around the origin window, drop irrelevant ships and score suspects on proximity, trajectory and behaviour",
  },
];

export const STATEMENT_BEATS: readonly string[] = [
  "blackout",
  "pill",
  "statement",
  "roll",
  "obj1",
  "obj2",
  "obj3",
  "obj4",
  "obj5",
  "reflow",
  // Each solution takes two presses: it lands large, then Q shrinks it into the stack.
  ...[1, 2, 3, 4, 5, 6, 7].flatMap((n) => [`sol${n}`, `sol${n}-stack`]),
  "reveal",
];

export type SolutionId = "model" | "slice" | "weather" | "drift" | "local" | "ais" | "score";
export type SolutionIcon = "GraphicsCard" | "Broadcast" | "ChartBar";

/** In landing order: the four image cards, then the three icon cards (the user's choice). */
export const SOLUTIONS: readonly {
  id: SolutionId;
  title: string;
  caption: string;
  kind: "image" | "icon";
  icon?: SolutionIcon;
  answers: readonly ObjectiveId[];
}[] = [
  {
    id: "model",
    title: "Model Trained on Real SAR",
    caption:
      "YOLO11 segmentation with LSK attention, trained on 4,227 Sentinel-1 tiles including 872 lookalikes. False alarms on lookalikes fell from 55 to 4 of 87.",
    kind: "image",
    answers: ["detect"],
  },
  {
    id: "slice",
    title: "Sliced, then Segmented",
    caption:
      "Every image is cut into 1024 px tiles with 10% overlap. Each slick gets a mask, 91% confidence here, then area, length, width and an age window.",
    kind: "image",
    answers: ["detect", "characterise"],
  },
  {
    id: "weather",
    title: "Wind and Currents on Demand",
    caption: "ERA5 wind and CMEMS surface currents, fetched for the exact place and hour of the satellite pass.",
    kind: "image",
    // Predict ticks with the drift, not the weather (the user, 2026-09-28).
    answers: ["trace"],
  },
  {
    id: "drift",
    title: "OpenDrift, Both Ways",
    caption: "10 runs of 200 particles, 72 h back to an origin area and time, and 72 h ahead to where the oil goes.",
    kind: "image",
    answers: ["trace", "predict"],
  },
  {
    id: "local",
    title: "Runs Locally on User-GPU",
    caption: "Detection runs on the user's own GPU through WebGPU in about 9 s. A whole upload takes 10 to 25 s. No server GPU.",
    kind: "icon",
    icon: "GraphicsCard",
    answers: [],
  },
  {
    id: "ais",
    title: "AIS in the Origin Window",
    caption:
      "Historic MarineCadastre AIS rebuilt around the origin window. Ships outside the drift field are dropped, radar contacts with AIS off are added.",
    kind: "icon",
    icon: "Broadcast",
    // Attribute ticks only once the score names someone (the user, 2026-09-27).
    answers: [],
  },
  {
    id: "score",
    title: "Six Factor Score",
    caption:
      "Drift, parity, proximity, timing, behaviour and vessel prior, each shown with its geometry. The top scorer is named as the suspected vessel.",
    kind: "icon",
    icon: "ChartBar",
    answers: ["attribute"],
  },
];

/** Which objectives each solution flips to a tick (first time answered) and which it only pulses. */
export function tickPlan(solutions: typeof SOLUTIONS): { flip: ObjectiveId[]; pulse: ObjectiveId[] }[] {
  const ticked = new Set<ObjectiveId>();
  return solutions.map((s) => {
    const flip: ObjectiveId[] = [];
    const pulse: ObjectiveId[] = [];
    for (const id of s.answers) {
      (ticked.has(id) ? pulse : flip).push(id);
      ticked.add(id);
    }
    return { flip, pulse };
  });
}

/** Files under `public/` the statement sequence draws. */
export const MAY_RUN = "runs/S1A_IW_GRDH_1SDV_20230515T000208_20230515T000233_048537_05D69B_35AF_s0db";
export const STATEMENT_ASSETS: readonly string[] = [
  ...Array.from({ length: 12 }, (_, i) => `present/tiles/zenodo-${String(i).padStart(2, "0")}.webp`),
  "present/capture/sar-00016.webp",
  "present/capture/mask-00016.webp",
  "present/capture/map-20230515.webp",
  `${MAY_RUN}/scene.json`,
];

/** Every on-screen string except the verbatim official title. */
export function allStatementCopy(): string[] {
  return [
    STATEMENT.description,
    ...STATEMENT.chips,
    ...Object.values(PILL),
    ...OBJECTIVES.flatMap((o) => [o.heading, o.body]),
    ...SOLUTIONS.flatMap((s) => [s.title, s.caption]),
    ...Object.values(VISUAL_COPY),
  ];
}

/** Labels drawn inside the solution visuals. */
export const VISUAL_COPY = {
  tiles: "training tiles",
  sliceTiles: "tiles of 1024 px",
  sar: "SAR in",
  mask: "mask out",
  confidence: "confidence",
  termWind: "fetch ERA5 wind",
  termCurrent: "fetch CMEMS currents",
  termSame: "same cell, same hour",
  termFrames: "hourly fields cached, 72 h either side of the pass",
  hindcast: "hindcast",
  forecast: "forecast",
} as const;
