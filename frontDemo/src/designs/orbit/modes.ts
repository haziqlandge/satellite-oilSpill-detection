/**
 * ORBIT -- mission modes.
 *
 * Orbit does not have pages. It has one surface -- the chart -- and five
 * configurations of the instruments mounted around it. Switching mode does not
 * navigate anywhere: it changes which modules are racked, which layers the chart
 * emphasises, and how the chart is framed. The map, the mission clock and the
 * selection all survive the change, because they are the mission and the mode is
 * only how you are looking at it.
 *
 * Two non-obvious things are encoded here.
 *
 * First, `graticule` and `zoomOffset` are separate. They used to be one lever:
 * `MapCanvas` had no camera API, but its scenario effect re-ran on
 * `paint.graticuleStepDeg` and began by recentring, so changing the grid was
 * the only way a direction could re-frame the chart. That worked and was
 * documented, but it meant a grid could not be chosen for legibility without
 * also moving the camera. The map now takes a camera, so `graticule` is a
 * readability choice and `zoomOffset` is how close the mode wants to be.
 *
 * Second, the toggle sets are frozen module-level constants. `MapCanvas` runs a
 * layer-visibility effect keyed on the toggles object identity, so building a
 * fresh object each render would re-set every layer's visibility on every frame
 * of a playback scrub.
 */

import type { LayerToggles } from "../../map/basemap";

export type ModeKey = "observe" | "reconstruct" | "traffic" | "attribute" | "brief";

export interface MissionMode {
  key: ModeKey;
  /** Panel designator. Instruments elsewhere refer to modes by this. */
  code: string;
  label: string;
  /** One line of instrument context. Never a page description. */
  caption: string;
  toggles: LayerToggles;
  /** Graticule spacing, chosen for legibility at this mode's working scale. */
  graticule: number;
  /** How close this mode sits to the scenario datum, in zoom levels. */
  zoomOffset: number;
  /** Instrument keys racked on each rail, in order. */
  left: string[];
  right: string[];
}

/* Every mode's chart emphasis, declared once. */

const OBSERVE_LAYERS: LayerToggles = {
  slick: true,
  contours: true,
  particles: true,
  traffic: true,
  candidates: false,
  targets: true,
  forecast: false,
  labels: true,
  release: true,
};

const RECONSTRUCT_LAYERS: LayerToggles = {
  slick: true,
  contours: true,
  particles: true,
  // The gate has not been applied yet in this mode's argument, so putting
  // traffic on the chart here would imply the field was drawn around a vessel.
  traffic: false,
  candidates: false,
  targets: false,
  forecast: false,
  labels: false,
  release: true,
};

const TRAFFIC_LAYERS: LayerToggles = {
  slick: true,
  contours: true,
  particles: true,
  traffic: true,
  candidates: true,
  targets: true,
  forecast: true,
  labels: true,
  release: true,
};

const ATTRIBUTE_LAYERS: LayerToggles = {
  slick: true,
  contours: true,
  particles: false,
  // Background traffic off: this mode is about the handful the gate kept, and
  // the alternatives have to be legible against the top-ranked one.
  traffic: false,
  candidates: true,
  targets: true,
  forecast: false,
  labels: true,
  release: false,
};

const BRIEF_LAYERS: LayerToggles = {
  slick: true,
  contours: true,
  particles: true,
  traffic: false,
  candidates: false,
  targets: false,
  forecast: true,
  labels: true,
  release: false,
};

export const MODES: MissionMode[] = [
  {
    key: "observe",
    code: "M1",
    label: "Observe",
    caption: "What the radar recorded, and what the geometry of it supports.",
    toggles: OBSERVE_LAYERS,
    graticule: 0.25,
    zoomOffset: 0,
    left: ["acquisition", "geometry", "damping"],
    right: ["scene", "classification", "wind"],
  },
  {
    key: "reconstruct",
    code: "M2",
    label: "Reconstruct",
    caption: "The ensemble run backward. A field over space and time, not a track.",
    toggles: RECONSTRUCT_LAYERS,
    graticule: 0.2,
    zoomOffset: -0.6,
    left: ["age", "convergence", "ensemble"],
    right: ["origin", "field", "horizon"],
  },
  {
    key: "traffic",
    code: "M3",
    label: "Traffic",
    caption: "The event as it ran, and who was in the water while it did.",
    toggles: TRAFFIC_LAYERS,
    graticule: 0.3,
    zoomOffset: -1,
    left: ["playback", "growth", "gate"],
    right: ["contacts", "forecast"],
  },
  {
    key: "attribute",
    code: "M4",
    label: "Attribute",
    caption: "Six weighted terms per candidate, and the ablation that tests them.",
    toggles: ATTRIBUTE_LAYERS,
    graticule: 0.15,
    zoomOffset: 0.7,
    left: ["attribution", "ablation"],
    right: ["evidence"],
  },
  {
    key: "brief",
    code: "M5",
    label: "Brief",
    caption: "Method, limits and the telemetry provenance of every value above.",
    toggles: BRIEF_LAYERS,
    graticule: 0.5,
    zoomOffset: -0.4,
    left: [],
    right: [],
  },
];

export const MODE_KEYS = MODES.map((m) => m.key);

export function modeFor(key: string): MissionMode {
  return MODES.find((m) => m.key === key) ?? MODES[0];
}
