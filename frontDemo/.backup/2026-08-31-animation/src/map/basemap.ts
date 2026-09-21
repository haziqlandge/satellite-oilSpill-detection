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
  StyleSpecification,
} from "maplibre-gl";
import type { MapPaint } from "../design";

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

export function buildStyle(paint: MapPaint): StyleSpecification {
  const sources: StyleSpecification["sources"] = {};
  const layers: LayerSpecification[] = [
    {
      id: "water",
      type: "background",
      paint: { "background-color": paint.water },
    },
  ];

  if (paint.basemap !== "none") {
    const cfg = BASEMAPS[paint.basemap];
    sources.basemap = {
      type: "raster",
      tiles: [...cfg.tiles],
      tileSize: 256,
      maxzoom: cfg.maxzoom,
      attribution: cfg.attribution,
    };
    layers.push({
      id: "basemap",
      type: "raster",
      source: "basemap",
      paint: {
        "raster-opacity": paint.basemapOpacity,
        "raster-saturation": paint.basemapSaturation,
        "raster-contrast": paint.basemapContrast,
        "raster-brightness-max": paint.basemapBrightnessMax,
      },
    });

    if (paint.showLabels) {
      sources.labels = {
        type: "raster",
        tiles: [...cfg.labels],
        tileSize: 256,
        maxzoom: cfg.maxzoom,
      };
    }
  }

  return {
    version: 8,
    // No glyph or sprite server. Nothing in this style needs a font, so the map
    // never blocks on an external asset it cannot reach.
    sources,
    layers,
  };
}

/** Whether the active direction has a labels source to draw. */
export function hasLabels(paint: MapPaint): boolean {
  return paint.basemap !== "none" && paint.showLabels;
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
        "fill-color": [
          "case",
          ["==", ["get", "class"], "oos"],
          paint.slick,
          paint.slickUnknown,
        ],
        "fill-opacity": byConfidence,
      },
    },
    {
      id: "slick-line",
      type: "line",
      source: SOURCE.slick,
      paint: {
        "line-color": [
          "case",
          ["==", ["get", "class"], "oos"],
          paint.slick,
          paint.slickUnknown,
        ],
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
