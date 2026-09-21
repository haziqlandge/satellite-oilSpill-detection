/**
 * The four directions.
 *
 * A direction here is not a theme. It is a separate product: its own shell, its
 * own navigation, its own routes, its own page compositions, its own component
 * family, its own typography and its own animation language. Nothing in
 * `designs/signal` is imported by `designs/terminal`, and there is deliberately
 * no shared `Panel`, `PageHeader` or `Stat` for them to converge on.
 *
 * What lives here is only the part that genuinely crosses all four: which
 * direction is active, how the shared map should be painted for it, and the
 * font stacks that reach CSS. The colour tokens themselves are re-pointed under
 * `[data-design]` in `index.css`.
 *
 * The previous version of this file carried a `ui` object of shared knobs --
 * panel type, density, console arrangement, button shape. That object was the
 * mechanism by which five directions stayed one website: every component
 * branched on it, so every component had one shape with five paint jobs. It is
 * gone on purpose.
 */

export type DesignKey = "signal" | "terminal" | "orbit" | "dossier";

export interface MapPaint {
  /** Ground under everything, drawn locally so the map is never blank. */
  water: string;
  /**
   * Which world the direction wants underneath its data.
   *
   * `ocean` is Esri's bathymetric base: sea-floor relief and depth contours, a
   * chart. `canvas` is their dark grey canvas, a diagram. `paper` is the light
   * grey canvas, which is what a printed exhibit looks like. `none` draws no
   * world at all and leaves the locally generated graticule to carry the
   * geography, which is what an operations console would do.
   */
  basemap: "ocean" | "canvas" | "paper" | "none";
  basemapOpacity: number;
  basemapSaturation: number;
  basemapContrast: number;
  /** Clamps the raster's dynamic range. Low values push it into the background. */
  basemapBrightnessMax: number;
  showLabels: boolean;

  slick: string;
  slickUnknown: string;
  contour50: string;
  contour90: string;
  particle: string;
  /** Tracks the gate rejected. */
  traffic: string;
  /**
   * Tracks that survived the gate.
   *
   * Kept close to the rejected traffic on purpose. A busy scene can leave
   * twenty-odd candidates, and painting all of them in a bright ink turns the
   * map into white spaghetti in which the one selected track -- the only thing
   * on screen the reader is being asked to look at -- is completely lost. The
   * separation that matters is candidate versus *selected*, not candidate
   * versus traffic; the list beside the map carries the rest.
   */
  candidate: string;
  suspect: string;
  target: string;
  dark: string;
  infrastructure: string;
  forecast: string;

  /**
   * The degree grid.
   *
   * Its own ink rather than a reuse of the rejected-traffic colour. Terminal
   * draws no basemap at all, so the graticule is the only geography on its
   * chart, and painting it one step off the ground made the map read as empty.
   * The directions that do have a world underneath want it fainter than that.
   */
  graticule: string;
  /** Line weights. A printed exhibit and an instrument draw differently. */
  strokeScale: number;
  /** Whether credible-region bands are filled or left as line work. */
  contourFill: boolean;
  graticuleStepDeg: number;
}

export interface DesignDef {
  key: DesignKey;
  /** Publication-style numbering, used by the switcher and by three of the shells. */
  index: string;
  name: string;
  /** What kind of product this is. Shown in the demo switcher, nowhere else. */
  discipline: string;
  accent: string;
  /** Font stacks, set as CSS variables on the design root. */
  fonts: { display: string; body: string; mono: string };
  map: MapPaint;
}

const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';
const GROTESK = '"Archivo Variable", ui-sans-serif, system-ui, sans-serif';
const SERIF = '"Newsreader Variable", ui-serif, Georgia, serif';
const TECH = '"Chakra Petch", ui-sans-serif, system-ui, sans-serif';
const GEO = '"Manrope Variable", ui-sans-serif, system-ui, sans-serif';

export const DESIGNS: DesignDef[] = [
  {
    key: "signal",
    index: "01",
    name: "Signal",
    discipline: "Investigative publication",
    accent: "#ff7a2f",
    // Grotesk headline over a serif reading column: a magazine. Dossier
    // inverts exactly this pairing, which is why neither reads as the other.
    fonts: { display: GROTESK, body: SERIF, mono: MONO },
    map: {
      water: "#0d0c0a",
      basemap: "canvas",
      basemapOpacity: 0.44,
      basemapSaturation: -1,
      basemapContrast: 0.6,
      basemapBrightnessMax: 0.5,
      showLabels: true,
      slick: "#ff7a2f",
      slickUnknown: "#8a7f74",
      contour50: "#ffb27a",
      contour90: "#8a5c33",
      particle: "#ffa860",
      traffic: "#38342e",
      graticule: "#3f3a33",
      candidate: "#7a7266",
      suspect: "#ff7a2f",
      target: "#f4f1ea",
      dark: "#ff4d4d",
      infrastructure: "#f0c419",
      forecast: "#6b4a2a",
      strokeScale: 1,
      contourFill: false,
      graticuleStepDeg: 0.25,
    },
  },

  {
    key: "terminal",
    index: "02",
    name: "Terminal",
    discipline: "Operations workstation",
    accent: "#4fe08a",
    fonts: { display: MONO, body: MONO, mono: MONO },
    map: {
      water: "#050706",
      basemap: "none",
      basemapOpacity: 0,
      basemapSaturation: -1,
      basemapContrast: 0,
      basemapBrightnessMax: 0.4,
      showLabels: false,
      slick: "#4fe08a",
      slickUnknown: "#4d6a5c",
      contour50: "#8bffc4",
      contour90: "#2f7d55",
      particle: "#4fe08a",
      traffic: "#18241e",
      graticule: "#2c4a3b",
      candidate: "#3f6b55",
      suspect: "#4fe08a",
      target: "#cfdad3",
      dark: "#ff5f56",
      infrastructure: "#ffbd2e",
      forecast: "#24503a",
      strokeScale: 0.8,
      contourFill: false,
      graticuleStepDeg: 0.1,
    },
  },

  {
    key: "orbit",
    index: "03",
    name: "Orbit",
    discipline: "Mission control",
    accent: "#4fd8e8",
    fonts: { display: TECH, body: GEO, mono: MONO },
    map: {
      water: "#060a11",
      basemap: "ocean",
      basemapOpacity: 0.74,
      basemapSaturation: -0.1,
      basemapContrast: 0.08,
      basemapBrightnessMax: 0.62,
      showLabels: true,
      slick: "#4fd8e8",
      slickUnknown: "#5e7684",
      contour50: "#7ae9f4",
      contour90: "#2b7684",
      particle: "#5fe3f0",
      traffic: "#212c36",
      graticule: "#2a3945",
      candidate: "#5a7183",
      suspect: "#4fd8e8",
      target: "#e2ecf5",
      dark: "#ff7a7a",
      infrastructure: "#ffc857",
      forecast: "#1f4a55",
      strokeScale: 1.2,
      contourFill: true,
      graticuleStepDeg: 0.25,
    },
  },

  {
    // The only light direction, and not for variety's sake: a case file is
    // paper, and every forensic convention this design borrows -- exhibit
    // stamps, ruled margins, footnotes, redaction -- is a convention of ink on
    // a light ground. Inverting it would be borrowing the vocabulary and
    // throwing away the grammar. It is also the single largest structural
    // difference available in grayscale, which is the test the brief sets.
    key: "dossier",
    index: "04",
    name: "Dossier",
    discipline: "Evidence archive",
    accent: "#b8221f",
    fonts: { display: SERIF, body: GROTESK, mono: MONO },
    map: {
      water: "#ded8cc",
      basemap: "paper",
      basemapOpacity: 0.85,
      basemapSaturation: -0.85,
      basemapContrast: 0.15,
      basemapBrightnessMax: 1,
      showLabels: true,
      slick: "#b8221f",
      slickUnknown: "#8d8579",
      contour50: "#8a3330",
      contour90: "#5c534a",
      particle: "#a83b2c",
      traffic: "#bdb5a5",
      graticule: "#b3aa98",
      candidate: "#8a8073",
      suspect: "#b8221f",
      target: "#211d18",
      dark: "#8a5a00",
      infrastructure: "#7a6410",
      forecast: "#9a8d7a",
      strokeScale: 0.95,
      contourFill: false,
      graticuleStepDeg: 0.25,
    },
  },
];

export const DEFAULT_DESIGN: DesignKey = "signal";

export function designFor(key: DesignKey): DesignDef {
  return DESIGNS.find((d) => d.key === key) ?? DESIGNS[0];
}

const STORAGE_KEY = "slickline:design";

export function readStoredDesign(): DesignKey {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && DESIGNS.some((d) => d.key === saved)) return saved as DesignKey;
  } catch {
    /* private mode or blocked storage: the default is fine */
  }
  return DEFAULT_DESIGN;
}

export function writeStoredDesign(key: DesignKey) {
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* not worth surfacing */
  }
}
