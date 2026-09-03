/**
 * The two surfaces of SlickTrace.
 *
 * This file replaces `design.ts`, which carried four independent products and
 * the machinery for switching between them. That study is over: Terminal became
 * the console, Signal's structure and Orbit's and Dossier's figures became the
 * home page, and what is left is one product with two rooms.
 *
 * A surface is not a theme. `site` is a document you read and `console` is a
 * room you stand in, and they differ in composition, density and navigation
 * before they differ in colour. What lives here is only the part that genuinely
 * crosses both: how the shared map should be painted for each, and the font
 * stacks that reach CSS. The colour tokens themselves are re-pointed under
 * `[data-surface]` in `index.css`.
 */

export type SurfaceKey = "site" | "console";

export interface MapPaint {
  /** Ground under everything, drawn locally so the map is never blank. */
  water: string;
  /**
   * Which world the surface wants underneath its data.
   *
   * `ocean` is Esri's bathymetric base: sea-floor relief and depth contours, a
   * chart. `canvas` is their dark grey canvas, a diagram. `paper` is the light
   * grey canvas. `none` draws no world at all and leaves the locally generated
   * graticule to carry the geography.
   */
  basemap: "ocean" | "canvas" | "paper" | "none";
  basemapOpacity: number;
  basemapSaturation: number;
  basemapContrast: number;
  /**
   * The raster's dynamic range.
   *
   * `Max` alone only caps the top, which is why lowering it pushes a basemap
   * back without ever making it greyer -- an already-dark raster has nothing
   * above the cap to clamp. `Min` is the control that lifts the floor, and it
   * is the one that turns Esri's near-black canvas into a grey diagram.
   */
  basemapBrightnessMin: number;
  basemapBrightnessMax: number;
  /**
   * A wash laid over the world, under the data.
   *
   * Esri's rasters are close to neutral grey, and `raster-saturation` cannot
   * put colour into a source that has none -- there is no chroma there to
   * rotate. The sea is therefore tinted from above, with a translucent
   * background layer between the raster and the data layers.
   *
   * The tint belongs to the water, not to the surface's accent. Both surfaces
   * wash the world in the same blue; what differs above it is the ink the data
   * is drawn in, which is the only thing that should differ.
   */
  basemapTint?: string;
  basemapTintOpacity?: number;
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
   * map into spaghetti in which the one selected track -- the only thing on
   * screen the reader is being asked to look at -- is completely lost. The
   * separation that matters is candidate versus *selected*.
   */
  candidate: string;
  suspect: string;
  target: string;
  dark: string;
  infrastructure: string;
  forecast: string;

  /** The degree grid. Its own ink rather than a reuse of the traffic colour. */
  graticule: string;
  /** Line weights. */
  strokeScale: number;
  /** Whether credible-region bands are filled or left as line work. */
  contourFill: boolean;
  graticuleStepDeg: number;
}

export interface SurfaceDef {
  key: SurfaceKey;
  name: string;
  accent: string;
  fonts: { display: string; body: string; mono: string };
  map: MapPaint;
}

const MONO = '"IBM Plex Mono", ui-monospace, SFMono-Regular, monospace';
const GROTESK = '"Archivo Variable", ui-sans-serif, system-ui, sans-serif';
const SERIF = '"Newsreader Variable", ui-serif, Georgia, serif';

export const SURFACES: Record<SurfaceKey, SurfaceDef> = {
  /**
   * HOME -- warm newsprint negative.
   *
   * Signal's ground, kept whole: a grotesk headline over a serif reading column
   * is a magazine, and the home page is read rather than operated. Dossier's
   * plates and Orbit's instruments are re-pointed into this palette rather than
   * bringing their own.
   *
   * The basemap block below is deliberately identical to the console's. One
   * product has one sea: a home page whose map is a different colour from the
   * console's is two products sharing a header. What separates the surfaces is
   * the ink over the water -- orange oil here, phosphor there -- not the water.
   *
   * This is a change of position, not a tidy-up. The world used to be held
   * back to a 0.44 wash so it could not compete with the reading column; it is
   * now the same legible grey-blue chart the console runs, at full opacity,
   * and the figures sit on a map rather than over a texture.
   */
  site: {
    key: "site",
    name: "SlickTrace",
    accent: "#ff7a2f",
    fonts: { display: GROTESK, body: SERIF, mono: MONO },
    map: {
      water: "#1a2e21",
      basemap: "canvas",
      basemapOpacity: 0.92,
      basemapSaturation: -0.49,
      basemapContrast: 0.67,
      basemapBrightnessMin: 0.26,
      basemapBrightnessMax: 0.67,
      basemapTint: "#083b73",
      basemapTintOpacity: 0.18,
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

  /**
   * CONSOLE -- phosphor on graphite.
   *
   * Terminal's ink, but the ground is deliberately lifted off near-black. The
   * old values (`water: #050706`, `basemapBrightnessMax: 0.28`, a 40% green
   * tint) made a console that read as a hole in the screen: the coastline was
   * technically drawn and practically invisible, and the green cast sat on
   * everything. The world is now a grey diagram held back rather than crushed.
   *
   * The wash over it is blue rather than green, and that is the point of it.
   * Every mark this console makes is phosphor; a green sea put the ground in
   * the same hue as the data standing on it, so the map read as one green
   * field with slightly greener marks in it. Blue is the one wash that appears
   * nowhere else in the palette, which is what gives the slick, the contours
   * and the tracks a ground to be read against rather than absorbed into.
   *
   * The constraint this trades against: the 50% and 90% credible contours are
   * low-opacity line work, and lifting the ground eats their separation from
   * it. Both are given more weight below to pay for the lift, rather than the
   * ground going back to black.
   */
  console: {
    key: "console",
    name: "SlickTrace Console",
    accent: "#4fe08a",
    fonts: { display: MONO, body: MONO, mono: MONO },
    map: {
      water: "#1a2e21",
      basemap: "canvas",
      basemapOpacity: 0.92,
      // Set from the colour panel rather than derived. `raster-saturation` acts
      // only on chroma the source already carries, so how far this reaches
      // depends on the tile; the blue laid over it is doing most of the work.
      basemapSaturation: -0.49,
      // Contrast is only safe once the floor is up. On its own it crushes
      // Esri's already near-black canvas to solid black, which is how a basemap
      // ends up loading correctly and rendering as nothing -- that is why this
      // sat at zero for a long time. With `brightnessMin` holding the floor at
      // 0.26 it does the opposite job and separates the coastline from the
      // water instead of swallowing both.
      basemapContrast: 0.67,
      // The floor, not the ceiling, is what greys this map. Measured in the
      // browser: with `min` at 0 the console stayed near-black no matter what
      // `max` was set to, because Esri's dark canvas over open ocean has almost
      // no bright pixels for a ceiling to act on.
      basemapBrightnessMin: 0.26,
      basemapBrightnessMax: 0.67,
      basemapTint: "#083b73",
      basemapTintOpacity: 0.18,
      showLabels: true,
      slick: "#4fe08a",
      slickUnknown: "#6f8c7d",
      // Both contours brightened against the lifted ground. On the old
      // near-black these read at #8bffc4 / #2f7d55; the 90% band in particular
      // would have disappeared into graphite at its previous value.
      contour50: "#a4ffd5",
      contour90: "#57b585",
      particle: "#4fe08a",
      traffic: "#2c3733",
      graticule: "#3d5a4c",
      candidate: "#5f8f77",
      suspect: "#4fe08a",
      target: "#dbe6de",
      dark: "#ff6b62",
      infrastructure: "#ffc94d",
      forecast: "#3a7458",
      strokeScale: 0.85,
      contourFill: false,
      graticuleStepDeg: 0.1,
    },
  },
};

export function surfaceFor(key: SurfaceKey): SurfaceDef {
  return SURFACES[key];
}

/** The repository this demo belongs to. Linked from both surfaces. */
export const REPO_URL =
  "https://github.com/haziqlandge/satellite-oilSpill-detection";
