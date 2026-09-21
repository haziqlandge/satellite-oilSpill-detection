export const DEMO_SAMPLE_KEYS = ["sample1", "sample2", "sample3"] as const;

export type DemoSampleKey = (typeof DEMO_SAMPLE_KEYS)[number];

export type AnimationFrameSource = "input" | "clean" | "blend" | "mask";

export interface DemoModelTiming {
  label: string;
  durationMs: number;
}

export interface DemoAisRecord {
  vessel: string;
  mmsi: string;
  lastSeen: string;
  distanceNm: string;
  confidence: string;
}

export interface DemoFrame {
  label: string;
  source: AnimationFrameSource;
  filter?: string;
  scale?: number;
}

export interface DemoPreset {
  id: DemoSampleKey;
  title: string;
  sampleImage: string;
  cleanImage: string;
  sampleHint: string;
  summary: string;
  hindcast: {
    window: string;
    maxSpreadKm2: string;
    confidence: string;
  };
  forecast: {
    horizon: string;
    envelopeKm2: string;
    confidence: string;
    spreadRate: string;
  };
  ais: DemoAisRecord;
  timings: DemoModelTiming[];
    animationFrames: DemoFrame[];
}

export interface DemoJobStatus {
  state: "idle" | "processing" | "complete";
  message: string;
  step: number;
  startedAt: number | null;
  completedAt: number | null;
  sourceName: string | null;
}

export const DEMO_PRESETS: Record<DemoSampleKey, DemoPreset> = {
  sample1: {
    id: "sample1",
    title: "sample1 — coastal discharge prebuilt scenario",
    sampleImage: "/data_sample/sample1.jpg",
    cleanImage: "/data_sample/clean1.jpg",
    sampleHint: "Upload any file named sample1.* to trigger this preset.",
    summary:
      "A low-energy release with a smooth, compact slick on the western flank of the plume.",
    hindcast: {
      window: "12 h",
      maxSpreadKm2: "8.4",
      confidence: "0.84",
    },
    forecast: {
      horizon: "48 h",
      envelopeKm2: "26.8",
      confidence: "0.79",
      spreadRate: "+18 %",
    },
    ais: {
      vessel: "M/V North Current",
      mmsi: "538••••4",
      lastSeen: "09:24Z, T-3 h",
      distanceNm: "2.6",
      confidence: "82 %",
    },
    timings: [
      { label: "Input decode + crop", durationMs: 480 },
      { label: "Cloud/speckle correction", durationMs: 620 },
      { label: "Hindcast inversion pass", durationMs: 1200 },
      { label: "AIS correlation and vessel match", durationMs: 840 },
      { label: "Forecast rollout", durationMs: 1780 },
      { label: "Animation render", durationMs: 640 },
      { label: "Evidence packet assembly", durationMs: 420 },
    ],
    animationFrames: [
      { label: "Input ingest", source: "input", filter: "grayscale(12%) contrast(1.07)", scale: 1 },
      { label: "Noise suppression", source: "input", filter: "contrast(1.18) saturate(0.85)", scale: 1.02 },
      { label: "Initial detection", source: "blend", filter: "contrast(1.22) saturate(0.94)", scale: 1.01 },
      { label: "Clean comparison", source: "clean", filter: "contrast(1.02)", scale: 1.0 },
      { label: "Forecast envelope", source: "clean", filter: "brightness(1.08)", scale: 1.03 },
      { label: "Black-mask boundary", source: "mask", filter: "none", scale: 1 },
    ],
  },
  sample2: {
    id: "sample2",
    title: "sample2 — platform drift scenario",
    sampleImage: "/data_sample/sample2.jpg",
    cleanImage: "/data_sample/clean2.jpg",
    sampleHint: "Upload any file named sample2.* to trigger this preset.",
    summary:
      "A larger, textured slick crossing a high-current shear with a wider confidence band.",
    hindcast: {
      window: "14 h",
      maxSpreadKm2: "14.2",
      confidence: "0.73",
    },
    forecast: {
      horizon: "72 h",
      envelopeKm2: "49.5",
      confidence: "0.71",
      spreadRate: "+27 %",
    },
    ais: {
      vessel: "M/T Azure Ledge",
      mmsi: "672••••9",
      lastSeen: "08:41Z, T-1 h",
      distanceNm: "1.9",
      confidence: "76 %",
    },
    timings: [
      { label: "Input decode + resize", durationMs: 560 },
      { label: "Adaptive thresholding", durationMs: 690 },
      { label: "Hindcast inversion pass", durationMs: 1350 },
      { label: "AIS correlation and vessel match", durationMs: 920 },
      { label: "Forecast rollout", durationMs: 2100 },
      { label: "Animation render", durationMs: 810 },
      { label: "Evidence packet assembly", durationMs: 520 },
    ],
    animationFrames: [
      { label: "Input ingest", source: "input", filter: "grayscale(10%) contrast(1.03)", scale: 1 },
      { label: "Contrast normalisation", source: "input", filter: "contrast(1.12) saturate(0.8)", scale: 1.01 },
      { label: "Texture suppression", source: "blend", filter: "brightness(1.04) contrast(1.18)", scale: 1.0 },
      { label: "Mask extraction", source: "clean", filter: "saturate(1.1)", scale: 1.02 },
      { label: "Forecast envelope", source: "clean", filter: "contrast(1.08)", scale: 1.03 },
      { label: "Black-mask boundary", source: "mask", filter: "none", scale: 1 },
    ],
  },
  sample3: {
    id: "sample3",
    title: "sample3 — channel discharge scenario",
    sampleImage: "/data_sample/sample3.jpg",
    cleanImage: "/data_sample/clean3.jpg",
    sampleHint: "Upload any file named sample3.* to trigger this preset.",
    summary:
      "A dispersed field with channel boundaries, producing a broader predicted drift path.",
    hindcast: {
      window: "16 h",
      maxSpreadKm2: "11.1",
      confidence: "0.69",
    },
    forecast: {
      horizon: "60 h",
      envelopeKm2: "37.4",
      confidence: "0.64",
      spreadRate: "+21 %",
    },
  ais: {
    vessel: "AHTS Driftwatch",
    mmsi: "491••••3",
    lastSeen: "10:07Z, T-2 h",
    distanceNm: "—",
    confidence: "79 %",
  },
    timings: [
      { label: "Input decode + align", durationMs: 530 },
      { label: "Adaptive denoise pass", durationMs: 640 },
      { label: "Hindcast inversion pass", durationMs: 1280 },
      { label: "AIS correlation and vessel match", durationMs: 890 },
      { label: "Forecast rollout", durationMs: 1960 },
      { label: "Animation render", durationMs: 700 },
      { label: "Evidence packet assembly", durationMs: 490 },
    ],
    animationFrames: [
      { label: "Input ingest", source: "input", filter: "contrast(1.04) brightness(0.98)", scale: 1 },
      { label: "Boundary suppression", source: "input", filter: "grayscale(16%) contrast(1.06)", scale: 1.01 },
      { label: "Feature consolidation", source: "blend", filter: "brightness(1.02)", scale: 1.0 },
      { label: "Mask extraction", source: "clean", filter: "contrast(1.06)", scale: 1.03 },
      { label: "Forward spread", source: "clean", filter: "saturate(1.05)", scale: 1.02 },
      { label: "Black-mask boundary", source: "mask", filter: "none", scale: 1 },
    ],
  },
};

export const PROCESS_MESSAGES = [
  "Predicting hindcast and forecast",
  "Checking vessel information",
  "Running simulated AIS confidence",
  "Composing clean-vs-sample evidence",
] as const;

export const PROCESS_MESSAGE_MS = 5_000;

export const FRAME_TICK_MS = 850;

export function parseSampleFromFileName(fileName: string): DemoSampleKey | null {
  const match = fileName.toLowerCase().match(/sample\s*([1-3])/);
  if (!match) return null;
  const idx = Number.parseInt(match[1], 10);
  return `sample${idx}` as DemoSampleKey;
}
