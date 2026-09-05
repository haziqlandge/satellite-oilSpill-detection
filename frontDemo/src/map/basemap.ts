/**
 * MapLibre style and layer construction.
 *
 * MapLibre GL JS is the map. It is the open-source renderer, it needs no API
 * key, and the basemap raster comes from CARTO, which serves tiles without a
 * token. Nothing here reaches a service that could ask for one at demo time.
 *
 * The style is built so the map still reads with the network off: the water
 * colour, the graticule and every data layer are generated locally, and the
 * raster basemap is one layer on top of that. When tiles fail the coastline
 * disappears but the scene, the slick, the origin field and the traffic all
 * still draw. C12 asks the demo to degrade rather than die, and this is that
 * requirement at the map layer.
 */

import type {
  ExpressionSpecification,
  LayerSpecification,
  SourceSpecification,
  StyleSpecification,
} from "maplibre-gl";
import type { MapPaint } from "../theme";

/*
  Basemaps, from Esri's public ArcGIS services.

  These need no key and no account, which is the whole reason for choosing them:
  the demo must not fail because a token expired the week before it is shown.
  CARTO's raster endpoints now answer key-less requests with a tile that reads
  API KEY REQUIRED, stamped across the map; OpenStreetMap's own tiles refuse
  automated clients outright.

  Three services, because the directions want different worlds underneath the
  data. `ocean` is bathymetry, sea-floor relief and depth contours: a chart, and
  what an instrument wants. `canvas` is a dark grey diagram: coastline and
  almost nothing else. `paper` is the light grey canvas, which is what a chart
  reproduced in a document looks like, and is the only one that works on a light
  ground. A fourth option is no basemap at all, where the locally generated
  graticule carries the geography on its own, which is what a console would do.

  Note the tile template: Esri orders its path z/y/x, not z/x/y.
*/
const ESRI = "https://services.arcgisonline.com/ArcGIS/rest/services";

const BASEMAPS = {
  ocean: {
    tiles: [`${ESRI}/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}`],
    labels: [`${ESRI}/Ocean/World_Ocean_Reference/MapServer/tile/{z}/{y}/{x}`],
    maxzoom: 13,
    attribution:
      'Esri, GEBCO, NOAA, National Geographic, Garmin, HERE, and other contributors',
  },
  canvas: {
    tiles: [`${ESRI}/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}`],
    labels: [`${ESRI}/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
    maxzoom: 16,
    attribution: 'Esri, HERE, Garmin, and the GIS user community',
  },
  paper: {
    tiles: [`${ESRI}/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}`],
    labels: [`${ESRI}/Canvas/World_Light_Gray_Reference/MapServer/tile/{z}/{y}/{x}`],
    maxzoom: 16,
    attribution: 'Esri, HERE, Garmin, and the GIS user community',
  },
} as const;

export const SOURCE = {
  graticule: "graticule",
  slick: "slick",
  axis: "slick-axis",
  contour: "origin-contour",
  forecast: "forecast",
  release: "release-extent",
  traffic: "ais-traffic",
  candidates: "ais-candidates",
  suspect: "suspect-track",
  matched: "matched-segment",
  targets: "cfar-targets",
  infrastructure: "infrastructure",
  markers: "markers",
} as const;

/* ------------------------------------------------------------------ *
 * The world under the data
 * ------------------------------------------------------------------ */

/**
 * The raster basemap, the wash over it, and the place names above everything.
 *
 * This is split out of `buildStyle` because these are the only parts of the
 * style that `paint.basemap` and `paint.showLabels` can change, and those two
 * fields became editable from the colour panel. Neither is a paint property:
 * `basemap` decides which tile service the raster source points at, and
 * `showLabels` decides whether a second source exists at all. Changing either
 * therefore means adding and removing sources and layers rather than calling
 * `setPaintProperty`, and `MapCanvas` does exactly that on a live map.
 *
 * The reason to hold the specifications here rather than writing them out
 * again beside that swap is drift. A second copy of the raster layer -- with
 * its own five paint expressions and its own tile template -- would start
 * identical and end up subtly different from the one the map is first built
 * with, and the difference would only ever show up after somebody changed the
 * basemap at runtime, which is the least-travelled path in the component.
 */
export interface WorldSpec {
  /** Keyed by source id. Only ever `basemap` and `labels`. */
  sources: Record<string, SourceSpecification>;
  /**
   * Below the data, directly above the locally drawn ground.
   *
   * In draw order: the raster, then the wash that has to sit over it.
   */
  under: LayerSpecification[];
  /**
   * Above everything, the data layers included.
   *
   * Place names are the one thing on this map that is allowed to cover a
   * result: a coastline name hidden under a credible-region band is not
   * telling anyone anything, and the bands are translucent line work drawn to
   * be read through.
   */
  over: LayerSpecification[];
}

/**
 * Every layer id `worldSpec` can produce, in the order they must be removed.
 *
 * Top-down: MapLibre refuses to remove a source while a layer still references
 * it, and refuses to remove a layer that does not exist, so a teardown that
 * wants to be safe has to walk the whole list and check each one.
 */
export const WORLD_LAYER_IDS = ["labels", "basemap-tint", "basemap"] as const;

/** Every source id `worldSpec` can produce. Removed after the layers. */
export const WORLD_SOURCE_IDS = ["labels", "basemap"] as const;

export function worldSpec(paint: MapPaint): WorldSpec {
  const sources: Record<string, SourceSpecification> = {};
  const under: LayerSpecification[] = [];
  const over: LayerSpecification[] = [];

  if (paint.basemap !== "none") {
    const cfg = BASEMAPS[paint.basemap];
    sources.basemap = {
      type: "raster",
      tiles: [...cfg.tiles],
      tileSize: 256,
      maxzoom: cfg.maxzoom,
      attribution: cfg.attribution,
    };
    under.push({
      id: "basemap",
      type: "raster",
      source: "basemap",
      paint: {
        "raster-opacity": paint.basemapOpacity,
        "raster-saturation": paint.basemapSaturation,
        "raster-contrast": paint.basemapContrast,
        "raster-brightness-min": paint.basemapBrightnessMin,
        "raster-brightness-max": paint.basemapBrightnessMax,
      },
    });

    /*
      Between the world and the data. A direction that wants the coastline in
      its own ink cannot get there through `raster-saturation`: the source is
      neutral grey and there is no chroma in it to saturate. Washing it from
      above is the one move that works, and it has to sit under the data
      layers, which are added on `load` and therefore land above this.

      Built whenever there is a world to wash, even at zero opacity, rather
      than only when the shipped tint is already visible.

      The old gate -- a tint colour set *and* an opacity above zero -- made the
      layer's existence depend on the value of the control that drives it, and
      `MapCanvas` can only re-apply an opacity to a layer that is there. So a
      surface shipping `basemapTintOpacity: 0` had a wash slider that moved a
      number and changed nothing, for ever, with no way back; and once
      `basemap` became editable the same trap opened for the two that do ship a
      tint, because dialling the wash to nothing and then changing world would
      rebuild without it. A fully transparent background layer costs one draw
      call of nothing, which is a great deal less than a control that lies.
    */
    under.push({
      id: "basemap-tint",
      type: "background",
      paint: {
        // `water` as the fallback colour, matching the live re-paint in
        // `MapCanvas`: with no tint named, the honest wash is the ground's own
        // colour at whatever opacity is asked for.
        "background-color": paint.basemapTint ?? paint.water,
        "background-opacity": paint.basemapTintOpacity ?? 0,
      },
    });

    if (paint.showLabels) {
      sources.labels = {
        type: "raster",
        tiles: [...cfg.labels],
        tileSize: 256,
        maxzoom: cfg.maxzoom,
      };
      over.push({
        id: "labels",
        type: "raster",
        source: "labels",
        paint: { "raster-opacity": 0.55 },
      });
    }
  }

  return { sources, under, over };
}

export function buildStyle(paint: MapPaint): StyleSpecification {
  const world = worldSpec(paint);
  return {
    version: 8,
    // No glyph or sprite server. Nothing in this style needs a font, so the map
    // never blocks on an external asset it cannot reach.
    sources: world.sources,
    layers: [
      {
        id: "water",
        type: "background",
        paint: { "background-color": paint.water },
      },
      ...world.under,
    ],
    // `world.over` is deliberately not here. The labels raster belongs above
    // the data layers, and those are added on `load` rather than declared in
    // the style, so the only place it can be put in the right order is after
    // them. The source it needs *is* declared above, so the layer has
    // something to attach to the moment `MapCanvas` adds it.
  };
}

/**
 * Whether the active paint can carry place names at all.
 *
 * `showLabels` is a separate field from `basemap`, but the labels raster is a
 * companion to a specific basemap service -- there is no set of names to draw
 * over a map that is not there. The colour panel uses this to say so rather
 * than offering a switch that silently does nothing.
 */
export function canShowLabels(paint: MapPaint): boolean {
  return paint.basemap !== "none";
}

/** Whether the active paint has a labels source and layer to draw. */
export function hasLabels(paint: MapPaint): boolean {
  return canShowLabels(paint) && paint.showLabels;
}

/** A degree graticule, generated locally so the map is never empty. */
export function graticule(
  bounds: [number, number, number, number],
  step = 0.25,
): GeoJSON.FeatureCollection {
  const [w, s, e, n] = bounds;
  const features: GeoJSON.Feature[] = [];
  const from = (v: number) => Math.floor(v / step) * step;

  for (let lon = from(w); lon <= e; lon += step) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [lon, s],
          [lon, n],
        ],
      },
    });
  }
  for (let lat = from(s); lat <= n; lat += step) {
    features.push({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: [
          [w, lat],
          [e, lat],
        ],
      },
    });
  }
  return { type: "FeatureCollection", features };
}

export const EMPTY: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

/**
 * The mask's ink, keyed on the detected class.
 *
 * Shared with `MapCanvas`'s live re-paint rather than written out at each use:
 * the two classes are the detector's own output and the difference between
 * them is the whole point of the two-class scheme, so an expression that
 * drifted between construction and re-paint would silently start colouring an
 * `oos` mask as an unknown one.
 */
export function slickInk(paint: MapPaint): ExpressionSpecification {
  return [
    "case",
    ["==", ["get", "class"], "oos"],
    paint.slick,
    paint.slickUnknown,
  ];
}

/**
 * Every data layer, in draw order.
 *
 * The order is the one PHASE-07 specifies, bottom to top: basemap, slick,
 * origin contours, AIS, forecast, radar targets. Suspects sit above traffic so
 * the candidate is never buried under the traffic it was picked out of.
 */
export function dataLayers(paint: MapPaint): LayerSpecification[] {
  const k = paint.strokeScale;
  const fill = paint.contourFill;
  const byConfidence: ExpressionSpecification = [
    "interpolate",
    ["linear"],
    ["get", "confidence"],
    0.3,
    0.18,
    0.95,
    0.42,
  ];

  return [
    {
      id: "graticule",
      type: "line",
      source: SOURCE.graticule,
      paint: {
        "line-color": paint.graticule,
        "line-width": 0.5,
        "line-opacity": 0.5,
      },
    },
    {
      id: "forecast-fill",
      type: "fill",
      source: SOURCE.forecast,
      paint: { "fill-color": paint.forecast, "fill-opacity": 0.16 },
    },
    {
      id: "forecast-line",
      type: "line",
      source: SOURCE.forecast,
      paint: {
        "line-color": paint.forecast,
        "line-width": 1,
        "line-dasharray": [3, 2],
        "line-opacity": 0.85,
      },
    },
    {
      // The release, as it actually happened. Drawn in the neutral ink rather
      // than the accent, because the accent is reserved for what the system
      // inferred and this is what the ocean did.
      id: "release-fill",
      type: "fill",
      source: SOURCE.release,
      paint: { "fill-color": paint.target, "fill-opacity": 0.13 },
    },
    {
      id: "release-line",
      type: "line",
      source: SOURCE.release,
      paint: {
        "line-color": paint.target,
        "line-width": 1.2 * k,
        "line-opacity": 0.75,
      },
    },
    {
      id: "contour90-fill",
      type: "fill",
      source: SOURCE.contour,
      filter: ["==", ["get", "band"], 90],
      paint: { "fill-color": paint.contour90, "fill-opacity": fill ? 0.2 : 0.07 },
    },
    {
      id: "contour90-line",
      type: "line",
      source: SOURCE.contour,
      filter: ["==", ["get", "band"], 90],
      paint: {
        "line-color": paint.contour90,
        "line-width": 1.1 * k,
        "line-dasharray": [4, 3],
      },
    },
    {
      id: "contour50-fill",
      type: "fill",
      source: SOURCE.contour,
      filter: ["==", ["get", "band"], 50],
      paint: { "fill-color": paint.contour50, "fill-opacity": fill ? 0.18 : 0.06 },
    },
    {
      id: "contour50-line",
      type: "line",
      source: SOURCE.contour,
      filter: ["==", ["get", "band"], 50],
      paint: { "line-color": paint.contour50, "line-width": 1.4 * k },
    },
    {
      id: "traffic",
      type: "line",
      source: SOURCE.traffic,
      paint: {
        "line-color": paint.traffic,
        "line-width": 0.8 * k,
        "line-opacity": 0.7,
      },
    },
    {
      id: "candidates",
      type: "line",
      source: SOURCE.candidates,
      paint: {
        "line-color": paint.candidate,
        "line-width": 1.4 * k,
        "line-opacity": 0.9,
      },
    },
    {
      id: "suspect-track",
      type: "line",
      source: SOURCE.suspect,
      paint: {
        "line-color": paint.suspect,
        "line-width": 2.6 * k,
        "line-opacity": 0.95,
      },
    },
    {
      id: "matched-segment",
      type: "line",
      source: SOURCE.matched,
      paint: {
        "line-color": paint.suspect,
        "line-width": 7,
        "line-opacity": 0.28,
        "line-blur": 3,
      },
    },
    {
      id: "slick-fill",
      type: "fill",
      source: SOURCE.slick,
      paint: {
        "fill-color": slickInk(paint),
        "fill-opacity": byConfidence,
      },
    },
    {
      id: "slick-line",
      type: "line",
      source: SOURCE.slick,
      paint: {
        "line-color": slickInk(paint),
        "line-width": 1.4 * k,
      },
    },
    {
      id: "slick-axis",
      type: "line",
      source: SOURCE.axis,
      paint: {
        "line-color": paint.target,
        "line-width": 1,
        "line-dasharray": [2, 2],
        "line-opacity": 0.55,
      },
    },
    {
      id: "targets",
      type: "circle",
      source: SOURCE.targets,
      paint: {
        "circle-radius": ["case", ["get", "matched"], 2.6, 5],
        "circle-color": "transparent",
        "circle-stroke-width": ["case", ["get", "matched"], 1, 1.8],
        "circle-stroke-color": [
          "case",
          ["get", "matched"],
          paint.target,
          paint.dark,
        ],
        "circle-stroke-opacity": 0.9,
      },
    },
    {
      id: "infrastructure",
      type: "circle",
      source: SOURCE.infrastructure,
      paint: {
        "circle-radius": 5,
        "circle-color": paint.infrastructure,
        "circle-opacity": 0.25,
        "circle-stroke-width": 1.4,
        "circle-stroke-color": paint.infrastructure,
      },
    },
    {
      id: "markers",
      type: "circle",
      source: SOURCE.markers,
      paint: {
        "circle-radius": ["case", ["==", ["get", "kind"], "head"], 5.5, 4],
        "circle-color": [
          "match",
          ["get", "kind"],
          "head",
          paint.slick,
          "tail",
          paint.slickUnknown,
          "vessel",
          paint.suspect,
          paint.target,
        ],
        "circle-stroke-width": 1.6,
        "circle-stroke-color": paint.water,
      },
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Layer visibility
 * ------------------------------------------------------------------ */

/**
 * Which layers are drawn.
 *
 * These live here rather than beside the map component because a module that
 * exports both a React component and plain values loses Fast Refresh: every
 * edit to the file forces a full invalidate, and a map that is torn down and
 * rebuilt on every keystroke is impossible to develop against.
 */
export interface LayerToggles {
  slick: boolean;
  contours: boolean;
  particles: boolean;
  traffic: boolean;
  candidates: boolean;
  targets: boolean;
  forecast: boolean;
  labels: boolean;
  /** The release itself, played forward from the first hour of the discharge. */
  release: boolean;
}

export const DEFAULT_TOGGLES: LayerToggles = {
  slick: true,
  contours: true,
  particles: true,
  traffic: true,
  candidates: true,
  targets: true,
  forecast: false,
  labels: true,
  release: true,
};
