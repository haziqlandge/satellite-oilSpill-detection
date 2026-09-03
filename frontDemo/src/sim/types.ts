/**
 * Simulated counterparts of the pipeline's real data structures.
 *
 * Every shape here mirrors `PLAN/INTERFACES.md` section 2 so that swapping the
 * generator for the FastAPI client in PHASE-07 is a transport change, not a
 * rewrite. Where the real schema carries a value this demo cannot honestly
 * produce (a NetCDF path, a COG URL) the field is omitted rather than faked.
 *
 * Nothing in this module is measured. It is a physically-shaped simulation used
 * to exercise the interface before the model exists; `provenance` on every
 * scenario says so, and the UI prints it.
 */

export type LngLat = [number, number];

export type SlickClass = "oos" | "slick_unknown";

export type CandidateKind = "ais_vessel" | "dark_vessel" | "infrastructure";

export type TemporalState = "ongoing" | "recent" | "legacy" | "indeterminate";

export type AgeMethod =
  | "drift_convergence"
  | "source_coincidence"
  | "beyond_horizon";

/** INTERFACES.md section 2 -- Detection. */
export interface Detection {
  id: string;
  sceneId: string;
  className: SlickClass;
  confidence: number;
  /** Outer ring per part. EPSG:4326. */
  parts: LngLat[][];
  acquiredAt: number;
}

/** INTERFACES.md section 2 -- Characterisation. */
export interface Characterisation {
  detectionId: string;
  areaKm2: number;
  lengthKm: number;
  widthMMean: number;
  /** Sampled perpendicular to the medial axis, head to tail. */
  widthMProfile: number[];
  orientationDeg: number;
  elongation: number;
  compactness: number;
  fragmentation: number;
  /** Both ends are emitted: geometry alone cannot say which is which (PHASE-03). */
  head: LngLat;
  tail: LngLat;
  headTailResolvedBy: "drift_field" | "ambiguous";
  medialAxis: LngLat[];
  dampingRatioDb: number;
  /** Always "low". C2 forbids converting this to a thickness. */
  dampingConfidence: "low";
  windSpeedMs: number;
  /** Continuous in [0,1]. C9 forbids a hard cut. */
  windGateMultiplier: number;
}

/** One backward or forward timestep of the ensemble. */
export interface DriftFrame {
  /** Hours from acquisition. Negative is backward. */
  hour: number;
  at: number;
  /** Particle positions, thinned for rendering. */
  particles: Float64Array;
  contour50: LngLat[][];
  contour90: LngLat[][];
  area50Km2: number;
  area90Km2: number;
  /** Mean particle distance from the cloud centroid, km. */
  spreadKm: number;
}

/** INTERFACES.md section 2 -- DriftRun. */
export interface DriftRun {
  id: string;
  detectionId: string;
  ensembleSize: number;
  particleCount: number;
  backwardHours: number;
  forwardHours: number;
  /** Ordered most-backward first, through acquisition, to the forecast horizon. */
  frames: DriftFrame[];
  convergence: { hour: number; area90Km2: number; spreadKm: number }[];
  /** C1: never a scalar. */
  ageHours: [low: number, best: number, high: number];
  ageMethod: AgeMethod;
  temporalState: TemporalState;
  /** Set when the field is too diffuse to discriminate (C3). */
  insufficientEvidence: { area90Km2: number; reason: string } | null;
}

export interface AisPoint {
  t: number;
  lon: number;
  lat: number;
  sog: number;
  cog: number;
}

export interface Vessel {
  mmsi: string;
  /** Masked for display. Real identities are never rendered by this demo. */
  label: string;
  kind: string;
  lengthM: number;
  draftM: number;
  points: AisPoint[];
  background: boolean;
}

export interface AnomalyFlag {
  code: string;
  label: string;
  detail: string;
  /** C7 / C4: a flag always carries the series that raised it. */
  series: { t: number; v: number }[];
  seriesLabel: string;
  /** For gaps: what reception density the region actually supports. */
  expected?: number;
}

export interface TermExplanation {
  key: ScoreTermKey;
  value: number;
  weight: number;
  detail: string;
  /** The geometry that produced the term, for the map to highlight. */
  geometry: LngLat[] | null;
}

export type ScoreTermKey =
  | "drift"
  | "proximity"
  | "parity"
  | "temporality"
  | "behaviour"
  | "prior";

export interface EvidenceCard {
  terms: TermExplanation[];
  matchedSegment: LngLat[] | null;
  originWindow: [number, number];
  originOverlap: LngLat[] | null;
  anomalies: AnomalyFlag[];
  caveats: string[];
}

export interface Suspect {
  id: string;
  kind: CandidateKind;
  /** Dark vessels carry no identity. Never resolve one to a name. */
  label: string;
  detail: string;
  total: number;
  rank: number;
  terms: Record<ScoreTermKey, number>;
  weights: Record<ScoreTermKey, number>;
  evidence: EvidenceCard;
  track: LngLat[] | null;
  position: LngLat;
  /** Recomputed without S_drift, for the term ablation (EVALUATION.md section 4). */
  totalWithoutDrift: number;
  rankWithoutDrift: number;
  isTruth: boolean;
}

export interface ScenarioMeta {
  id: string;
  name: string;
  region: "gulf-of-mexico" | "indian-waters";
  /**
   * The water this scene is in, as a person would name it.
   *
   * `region` is too coarse for prose: two of the five scenarios are in Indian
   * waters but one is the Gulf of Kutch and the other is the Mumbai High field,
   * and an interface that writes copy off the region alone will put a slick in
   * the wrong sea. It is stated once here rather than inferred four times.
   */
  place: string;
  /** Where the ground truth comes from, or that it is authored (C10). */
  provenance: string;
  acquiredAt: number;
  centre: LngLat;
  zoom: number;
  sceneId: string;
  summary: string;
  /** What this scenario is meant to prove. */
  tests: string;
  expectedTop1: string;
}

/**
 * The met-ocean forcing this event actually ran through, sampled hour by hour.
 *
 * Not a new model and not decoration: these are the same currents and winds
 * `makeForcing` hands to the drift ensemble, read at the slick centroid across
 * the event span. The home page charts them so a reader can see *why* the oil
 * went where it went, rather than being asked to take the trajectory on faith.
 *
 * Wind direction follows the meteorological convention `field.ts` uses -- the
 * direction the wind blows *from*. Current direction is the direction it sets
 * *towards*, which is the oceanographic convention, and the two are opposite by
 * discipline rather than by accident. Both are labelled in the interface.
 */
export interface Environment {
  /** Hourly, first parcel in the water through to the forecast horizon. */
  hours: number[];
  /** 10 m wind speed, m/s. */
  windMs: number[];
  /** Direction the wind blows from, degrees true. */
  windFromDeg: number[];
  /** Surface current speed, m/s. */
  currentMs: number[];
  /** Direction the current sets towards, degrees true. */
  currentTowardDeg: number[];
  /** The semidiurnal tidal component alone, m/s, signed along its major axis. */
  tideMs: number[];
}

export interface Run {
  meta: ScenarioMeta;
  detection: Detection;
  characterisation: Characterisation;
  drift: DriftRun;
  vessels: Vessel[];
  suspects: Suspect[];
  infrastructure: { id: string; label: string; position: LngLat }[];
  cfarTargets: { id: string; position: LngLat; lengthM: number; matched: boolean }[];
  forwardImpact: LngLat[][];
  /**
   * The release as it happened, hour by hour.
   *
   * Oil does not appear as a finished slick. This is the record of it entering
   * the water a parcel at a time and being carried, from the first hour of the
   * discharge through to the end of the forecast, so the interface can play the
   * event rather than only show its result.
   */
  release: import("./drift").ReleaseFrame[];
  /** Hour the release began, negative. Authored (C10). */
  releaseStartHour: number;
  /** Hour it stopped. Zero means it was still running at acquisition. */
  releaseEndHour: number;
  aisPointCount: number;
  /** The forcing the drift ran through, for the environment charts. */
  environment: Environment;
  /**
   * What the spatiotemporal gate considered and what it admitted.
   *
   * Carried onto the run rather than left inside the scorer because filtering
   * is a deliverable, not an implementation detail: the step that turns tens of
   * thousands of AIS reports into a handful of candidates is the one the
   * problem statement asks for, and an interface that cannot state how many
   * tracks it threw away cannot be audited. It was previously computed and
   * discarded, which forced the case-file view to re-derive a weaker
   * approximation of it by counting proximity.
   */
  gate: { considered: number; admitted: number; reason: string };
  /**
   * Margin between the top candidate and the next.
   *
   * Reported per case, never targeted. Null when fewer than two candidates
   * survived, which is itself a result.
   */
  separability: number | null;
  /** Truth marker, authored by us, never derived from a detector (C10). */
  truth: { label: string; position: LngLat; releasedAt: number } | null;
}
