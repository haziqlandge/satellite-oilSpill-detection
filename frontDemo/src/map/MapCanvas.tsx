/**
 * The map. MapLibre GL JS, driven from the simulation.
 *
 * One component owns the map instance and pushes GeoJSON into named sources as
 * the scenario, the hour or the selection changes. Every layer is specified in
 * `basemap.ts` and every *data* layer is added once and then only ever
 * repainted, because restyling a live map is where MapLibre integrations
 * usually start flickering.
 *
 * The one exception is the world underneath: `paint.basemap` and
 * `paint.showLabels` choose which tile services the map holds, so changing
 * either genuinely has to add and remove sources and layers. That is done in
 * the smallest possible way -- the three layers of `worldSpec` and nothing
 * else -- rather than through `setStyle`, which would take the whole scene
 * down with it. See the effect that does it for the argument in full.
 *
 * The time slider drives this and the AIS playback from the same `hour` prop,
 * which is the synchronisation PHASE-07 lists as an acceptance criterion. There
 * is no second clock to drift out of step with the first.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "./maplibre";
import type { Map as MapLibreMap } from "maplibre-gl";

import {
  EMPTY,
  FLOW_ARROW,
  SOURCE,
  WORLD_LAYER_IDS,
  WORLD_SOURCE_IDS,
  buildStyle,
  dataLayers,
  graticule,
  hasLabels,
  slickInk,
  worldSpec,
  type LayerToggles,
} from "./basemap";
import { ParticleOverlay } from "./ParticleOverlay";
import { subscribePlayhead, syncPlayhead } from "../lib/playhead";
import type { MapPaint } from "../theme";
import type { LngLat, Run, Suspect } from "../sim/types";
import { positionAt } from "../sim/ais";
import { trackSegments } from "../sim/realAis";
import { pointInPolygon, distanceToPathKm, polygonsOf } from "../sim/geo";
import { detectionFeatures } from "./detectionView";
import { verdictFor } from "../sim/verdict";
import { landImage } from "./offlineLand";
import { FlowCards } from "./FlowCards";
import { flowCells, flowMean, speedToward, spillParts } from "../sim/flow";

const OFFLINE_LAND = "offline-land";

interface Props {
  run: Run;
  paint: MapPaint;
  /** Hours from acquisition. Negative is backward. */
  hour: number;
  /**
   * How much of the event the particle clouds are allowed to draw.
   *
   * `"both"` is the whole run: the release accumulating before the pass, and
   * the ensemble either side of it -- held back to a faint haze while the oil
   * is on screen, because reversal spreads and a backward cloud painted at the
   * weight of the oil claims a spill larger than the one photographed.
   *
   * `"forward"` starts at the pass. Nothing from before acquisition is drawn:
   * no release accumulation, no hindcast haze, only the forecast ensemble and
   * the mask the segmenter returned. A figure about where the oil *goes* should
   * not have the hindcast sitting behind it under a different meaning.
   */
  direction?: "both" | "forward";
  /** Persistent reconstruction checkpoints, independent of playback hour. */
  showHindcastAreas?: boolean;
  toggles: LayerToggles;
  selected: Suspect | null;
  onSelect?: (id: string | null) => void;
  className?: string;
  /**
   * Whether the reader can pan and zoom.
   *
   * Two of the four directions do not want a slippy map. An editorial exhibit
   * and a printed plate are fixed reproductions with a caption and a scale bar;
   * making them draggable invites the reader to lose the framing the figure was
   * composed for, and there is nothing underneath worth exploring.
   */
  interactive?: boolean;
  /**
   * Which of MapLibre's own controls to mount.
   *
   * `"scale"` drops the zoom buttons but keeps the scale bar, which is not
   * chrome: it is measured from the live camera, it cannot be reproduced from
   * outside this component, and every judgement a viewer makes about how far a
   * track passed from a slick depends on it.
   */
  controls?: "full" | "scale" | "none";
  /** The wind, current, drift and ships cards in the top-right corner (`FlowCards`): the console's map only. */
  flowCards?: boolean;
  /**
   * Where the camera should be.
   *
   * A direction whose whole premise is that the map is the product needs to be
   * able to frame it -- on the origin field when the reader is reconstructing,
   * on the matched leg when they are reading a candidate. Without this the only
   * lever a caller has is to change something the scenario effect happens to
   * depend on and let its `jumpTo` fire as a side effect, which is a workaround
   * standing in for an interface.
   *
   * Omit it and the map frames the scenario datum and then leaves the camera
   * alone, which is what a static exhibit wants.
   */
  camera?: { centre?: LngLat; zoom?: number; durationMs?: number } | null;
  /**
   * The live map instance, once it has loaded, and `null` on teardown.
   *
   * A direction that draws its own map furniture -- a crosshair with a live
   * coordinate readout, its own zoom control, its own scale -- needs
   * `unproject`, `getBounds` and `getZoom`, and there is no honest way to
   * reproduce any of them from outside. Without this the only route is the
   * `window.__map` debug handle, which is a development affordance rather than
   * an interface: it assumes exactly one map is mounted, it has no teardown
   * signal, and it turns a rendering detail into a global.
   */
  onMap?: (map: MapLibreMap | null) => void;
}

function line(coords: LngLat[], props: Record<string, unknown> = {}): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: props,
    geometry: { type: "LineString", coordinates: coords },
  };
}

/** A small arrow pointing north, white on clear: tinted by `icon-color` and turned by `icon-rotate`. */
function flowArrowImage(): ImageData {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(14, 10, 4, 19);
  ctx.beginPath();
  ctx.moveTo(16, 2);
  ctx.lineTo(8, 13);
  ctx.lineTo(24, 13);
  ctx.closePath();
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

/**
 * `setPaintProperty` for a property named at run time: the repaint table and the
 * fade-in. MapLibre 6 types the name as a literal key of its paint spec, which
 * a name built from a table (or with `-transition` appended) cannot be.
 */
function setPaint(map: MapLibreMap, layer: string, prop: string, value: unknown): void {
  map.setPaintProperty(layer, prop as never, value as never);
}

function point(p: LngLat, props: Record<string, unknown> = {}): GeoJSON.Feature {
  return {
    type: "Feature",
    properties: props,
    geometry: { type: "Point", coordinates: p },
  };
}

function collection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features };
}

/**
 * Whether the ground under the particles is dark.
 *
 * The particle canvas composites additively, which is what makes overlapping
 * parcels read as density -- on a dark ground. On the paper ground the same
 * blend drives every pixel towards white and the cloud vanishes into the sheet,
 * so the overlay is told to composite normally there instead.
 */
function isDarkGround(colour: string): boolean {
  const hex = colour.trim().replace("#", "");
  if (hex.length !== 6) return true;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  if ([r, g, b].some(Number.isNaN)) return true;
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5;
}

export function MapCanvas({
  run,
  paint,
  hour,
  direction = "both",
  showHindcastAreas = false,
  toggles,
  selected,
  onSelect,
  className = "",
  interactive = true,
  controls = "full",
  flowCards = false,
  camera = null,
  onMap,
}: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const overlayRef = useRef<ParticleOverlay | null>(null);
  const resizeRef = useRef<ResizeObserver | null>(null);
  /**
   * Which world the live style currently holds.
   *
   * `paint.basemap` and `paint.showLabels` are the two `MapPaint` fields that
   * are not paint properties. `basemap` chooses which tile service the raster
   * source points at; `showLabels` decides whether a second source is fetched
   * at all. Neither can be pushed through `setPaintProperty`, so a change to
   * either has to add and remove sources and layers -- and this records what
   * was last applied so that the effect doing so can tell a real change from
   * an unrelated re-render, and can leave the map alone on the first pass,
   * when the style was built from these values already.
   *
   * `labels` here is `hasLabels`, not `showLabels`: with no basemap there is
   * no labels service either, so toggling `showLabels` under `basemap: "none"`
   * is not a change to anything and must not rebuild the world.
   */
  const worldRef = useRef<{
    basemap: MapPaint["basemap"];
    labels: boolean;
  } | null>(null);
  const [ready, setReady] = useState(false);
  const [basemapFailed, setBasemapFailed] = useState(false);
  const layerOpacity = useRef(new Map<string, unknown>());

  /* --- instance ---------------------------------------------------- */

  /**
   * Teardown is deferred by a tick, and a pending teardown is cancelled if the
   * effect runs again.
   *
   * React's StrictMode mounts, unmounts and remounts in development, all in the
   * same tick. Destroying a WebGL map and building another one inside that
   * window leaves MapLibre's worker pool in a state where the second map never
   * fires `load`: no sources are added, no data is pushed, and the console
   * renders as an empty rectangle with no error anywhere. It is intermittent,
   * which is worse than if it failed every time.
   *
   * Deferring the removal by one macrotask lets the remount cancel it and reuse
   * the live instance, while a genuine unmount still tears the map down.
   */
  const pendingTeardown = useRef<number | null>(null);

  // Held in a ref so a caller passing an inline arrow does not have to memoise
  // it to avoid rebuilding the map. The map is constructed once; the callback
  // it fires is whatever the latest render supplied.
  const onMapRef = useRef(onMap);
  onMapRef.current = onMap;

  useEffect(() => {
    if (!holder.current) return;

    if (pendingTeardown.current !== null) {
      window.clearTimeout(pendingTeardown.current);
      pendingTeardown.current = null;
    }

    if (!mapRef.current) {
      const map = new maplibregl.Map({
        container: holder.current,
        style: buildStyle(paint),
        center: run.meta.centre,
        zoom: run.meta.zoom,
        attributionControl: { compact: true },
        // The demo is read from a laptop at a distance. Pitch and rotation buy
        // nothing here and cost orientation.
        pitchWithRotate: false,
        dragRotate: false,
        maxZoom: 15,
        interactive,
      });
      mapRef.current = map;
      // A handle for inspecting the live map while working on it. Set at
      // construction rather than on load, so a map that fails to load is still
      // reachable, which is exactly when you need it.
      (window as unknown as { __map?: unknown }).__map = map;

      if (controls === "full") {
        map.addControl(
          new maplibregl.NavigationControl({ showCompass: false }),
          "top-right",
        );
      }
      if (controls !== "none") {
        map.addControl(
          new maplibregl.ScaleControl({ unit: "metric" }),
          "bottom-left",
        );
      }

      map.on("error", (e) => {
        // A failed basemap tile is expected offline. Everything the demo needs
        // is generated locally, so a tile failure is reported in the corner
        // rather than thrown. Anything else has to be visible: a swallowed
        // style error is exactly how a map ends up silently blank.
        const message = String(e?.error?.message ?? e?.error ?? "");
        if (message.includes("arcgisonline") || message.includes("tile")) {
          setBasemapFailed(true);
          return;
        }
        console.error("[map]", message, e);
      });

      map.on("load", () => {
        map.addSource(SOURCE.graticule, { type: "geojson", data: EMPTY });
        for (const id of [
          SOURCE.slick,
          SOURCE.axis,
          SOURCE.contour,
          SOURCE.forecast,
          SOURCE.hindcast,
          // Omitted here once, which meant `dataLayers` tried to add the two
          // release layers against a source that did not exist. MapLibre
          // rejects the layer and the whole rest of the load handler unwinds,
          // so the map came up with nothing on it at all.
          SOURCE.release,
          SOURCE.traffic,
          SOURCE.candidates,
          SOURCE.suspect,
          SOURCE.matched,
          SOURCE.targets,
          SOURCE.infrastructure,
          SOURCE.markers,
          SOURCE.trackingGap,
          SOURCE.trackingPredicted,
          SOURCE.trackingMarkers,
          SOURCE.flow,
        ]) {
          map.addSource(id, { type: "geojson", data: EMPTY });
        }
        if (!map.hasImage(FLOW_ARROW)) map.addImage(FLOW_ARROW, flowArrowImage(), { sdf: true });
        for (const layer of dataLayers(paint)) map.addLayer(layer);
        // Above the data, which is why it is not in `buildStyle`.
        for (const layer of worldSpec(paint).over) map.addLayer(layer);
        // What the style was actually built from, recorded so the effect below
        // can tell a real `basemap` or `showLabels` change from the first run.
        worldRef.current = { basemap: paint.basemap, labels: hasLabels(paint) };

        overlayRef.current = new ParticleOverlay(map, holder.current!);
        setReady(true);
        onMapRef.current?.(map);
      });

      // The console rearranges itself per direction and per breakpoint. Without
      // this the canvas keeps whatever size it had when the map was created and
      // the map appears cropped or, at zero height, blank.
      const ro = new ResizeObserver(() => map.resize());
      ro.observe(holder.current);
      resizeRef.current = ro;
    }

    return () => {
      pendingTeardown.current = window.setTimeout(() => {
        pendingTeardown.current = null;
        resizeRef.current?.disconnect();
        resizeRef.current = null;
        // The world belongs to the instance being destroyed. Carried into the
        // next one it would claim a basemap the new style has not been built
        // with, and the swap effect would decline to make it true.
        worldRef.current = null;
        overlayRef.current?.dispose();
        overlayRef.current = null;
        const map = mapRef.current;
        mapRef.current = null;
        setReady(false);
        // Signalled before `remove()`, so a consumer holding the instance drops
        // it while it is still valid rather than discovering it mid-teardown.
        onMapRef.current?.(null);
        map?.remove();
      }, 0);
    };
    // Built once. Direction and scenario changes are applied by the effects
    // below rather than by tearing the map down, which would flash the panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* --- theme ------------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    map.setPaintProperty("water", "background-color", paint.water);
    if (map.getLayer("basemap")) {
      map.setPaintProperty("basemap", "raster-opacity", paint.basemapOpacity);
      map.setPaintProperty("basemap", "raster-saturation", paint.basemapSaturation);
      map.setPaintProperty("basemap", "raster-contrast", paint.basemapContrast);
      // The floor as well as the ceiling. `min` is the control that actually
      // greys a dark raster -- see `MapPaint.basemapBrightnessMin` -- and
      // leaving it out of the live path made it the one basemap number that
      // could not be changed without a reload.
      map.setPaintProperty(
        "basemap",
        "raster-brightness-min",
        paint.basemapBrightnessMin,
      );
      map.setPaintProperty(
        "basemap",
        "raster-brightness-max",
        paint.basemapBrightnessMax,
      );
    }
    if (map.getLayer("basemap-tint")) {
      map.setPaintProperty(
        "basemap-tint",
        "background-color",
        paint.basemapTint ?? paint.water,
      );
      map.setPaintProperty(
        "basemap-tint",
        "background-opacity",
        paint.basemapTintOpacity ?? 0,
      );
    }
    overlayRef.current?.setColour(paint.particle);
    overlayRef.current?.setReleaseColour(paint.target);
    overlayRef.current?.setAdditive(isDarkGround(paint.water));

    // Every layer `dataLayers` paints from the theme, not a subset of them.
    //
    // This list used to stop at the contours and the tracks, which meant the
    // slick mask, the release, the CFAR targets and the head/tail markers were
    // painted once at construction and never again -- a paint change appeared
    // to work everywhere except on the two marks the map is most about. The
    // data-driven ones carry the same expressions `dataLayers` builds;
    // `setPaintProperty` takes an expression as happily as a colour.
    const repaint: [string, string, unknown][] = [
      ["contour50-line", "line-color", paint.contour50],
      ["contour50-fill", "fill-color", paint.contour50],
      ["contour90-line", "line-color", paint.contour90],
      ["contour90-fill", "fill-color", paint.contour90],
      ["traffic", "line-color", paint.traffic],
      ["candidates", "line-color", paint.candidate],
      ["suspect-track", "line-color", paint.suspect],
      ["matched-segment", "line-color", paint.suspect],
      ["hindcast-fill", "fill-color", paint.hindcast],
      ["hindcast-line", "line-color", paint.hindcast],
      ["forecast-fill", "fill-color", paint.forecast],
      ["forecast-line", "line-color", paint.forecast],
      ["infrastructure", "circle-color", paint.infrastructure],
      ["infrastructure", "circle-stroke-color", paint.infrastructure],
      ["graticule", "line-color", paint.graticule],

      ["slick-fill", "fill-color", slickInk(paint)],
      ["slick-line", "line-color", slickInk(paint)],
      ["slick-axis", "line-color", paint.target],
      ["release-fill", "fill-color", paint.target],
      ["release-line", "line-color", paint.target],
      [
        "targets",
        "circle-stroke-color",
        ["case", ["get", "matched"], paint.target, paint.dark],
      ],
      [
        "markers",
        "circle-color",
        [
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
      ],
      ["markers", "circle-stroke-color", paint.water],
    ];

    /*
      The two fields of `MapPaint` that are not colours at all.

      `strokeScale` and `contourFill` were both editable in the colour panel
      and both in the export, and neither of them did anything to a running
      map. Every entry in the list above is a colour, and the widths those two
      drive -- `1.4 * k` on the slick outline, `fill ? 0.2 : 0.07` on the 90%
      band -- are evaluated once, inside `dataLayers`, when the layer is first
      added. Moving either control changed a number in an overlay that nothing
      downstream ever read again. That is a worse failure than the missing
      export the rest of this change is about: an absent field is at least
      absent, whereas these two answered.

      The values are pulled back out of `dataLayers(paint)` rather than
      restated here. Writing `1.4 * k` in two files is how the map ends up
      drawn at one weight and re-drawn at another, and the whole reason this
      list is long and explicit is that a previous version of it was short and
      quietly incomplete.
    */
    const built = new Map(
      dataLayers(paint).map((layer) => [
        layer.id,
        ("paint" in layer ? layer.paint : undefined) as
          | Record<string, unknown>
          | undefined,
      ]),
    );
    const scaled: [string, string][] = [
      ["slick-line", "line-width"],
      ["release-line", "line-width"],
      ["contour90-line", "line-width"],
      ["contour50-line", "line-width"],
      ["traffic", "line-width"],
      ["candidates", "line-width"],
      ["suspect-track", "line-width"],
      ["contour90-fill", "fill-opacity"],
      ["contour50-fill", "fill-opacity"],
      ["flow-wind", "icon-color"],
      ["flow-current", "icon-color"],
    ];
    for (const [layer, prop] of scaled) {
      const value = built.get(layer)?.[prop];
      if (value !== undefined) repaint.push([layer, prop, value]);
    }

    for (const [layer, prop, value] of repaint) {
      if (map.getLayer(layer)) setPaint(map, layer, prop, value);
    }
  }, [paint, ready]);

  /* --- the world --------------------------------------------------- */

  /**
   * A live change of basemap, done by swapping three layers rather than the
   * style.
   *
   * `map.setStyle(buildStyle(paint))` is the obvious move and it is the wrong
   * one. Every GeoJSON source on this map -- the slick, the contours, the
   * release, the traffic, the candidates, the suspect, the matched segment,
   * the targets, the infrastructure, the markers, the graticule -- and every
   * layer drawn from them is added imperatively in the `load` handler above,
   * so none of it appears in the style `buildStyle` returns. MapLibre's style
   * diff would therefore read the new style as an instruction to remove all
   * thirteen sources and roughly twenty layers, and the map would go back to
   * an empty rectangle until the load handler, the scenario effect, the time
   * effect, the selection effect and the toggle effect had all been made to
   * run again. That is a teardown and a visible rebuild of the entire scene to
   * change the picture underneath it.
   *
   * What actually differs between two basemaps is one raster source, one
   * raster layer, the background wash over it and the labels raster -- the
   * whole of `worldSpec`. Removing and re-adding exactly those leaves every
   * data layer, every source's data and the particle canvas untouched. The
   * cost that remains is honest and unavoidable: the new service's tiles have
   * to be fetched, so the coastline is missing for as long as that takes and
   * the data floats over the ground colour in the meantime. Nothing else
   * flickers, and nothing has to be re-pushed.
   *
   * It runs on `paint` rather than on the two fields alone so that the
   * rebuilt layers carry the *current* opacity, saturation and tint; the guard
   * on `worldRef` is what keeps it from doing anything when only those moved,
   * because those the theme effect above applies live.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const want = { basemap: paint.basemap, labels: hasLabels(paint) };
    const applied = worldRef.current;
    if (
      applied &&
      applied.basemap === want.basemap &&
      applied.labels === want.labels
    ) {
      return;
    }
    worldRef.current = want;

    // Layers first, then their sources: MapLibre refuses to drop a source that
    // a layer still references.
    for (const id of WORLD_LAYER_IDS) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of WORLD_SOURCE_IDS) {
      if (map.getSource(id)) map.removeSource(id);
    }

    // A different service gets a fresh verdict. The failure notice is about
    // whether *this* world's tiles are reachable, and leaving it up after a
    // switch to a basemap that loads -- or to no basemap at all, which cannot
    // fail -- would be the map reporting a problem it no longer has.
    setBasemapFailed(false);

    const world = worldSpec(paint);
    for (const [id, source] of Object.entries(world.sources)) {
      map.addSource(id, source);
    }

    /*
      Inserted against the ground rather than against a hard-coded data layer.

      Whatever now follows `water` is the first thing the world has to sit
      below, and after `load` that is the first layer `dataLayers` added.
      Naming it here instead would mean this effect silently started drawing
      the basemap over the graticule the day somebody reordered that list.

      Each layer of `under` goes before that same id, so inserting the raster
      and then the wash leaves them in the order `worldSpec` lists them.
    */
    const ids = map.getStyle().layers.map((l) => l.id);
    const firstAboveGround = ids[ids.indexOf("water") + 1];
    for (const layer of world.under) map.addLayer(layer, firstAboveGround);
    // Appended, which puts it above the data -- the same place the load
    // handler puts it.
    for (const layer of world.over) map.addLayer(layer);

    // A layer added here arrives visible, and the effect that owns visibility
    // has no reason to re-run: its dependencies did not change. Without this,
    // turning place labels back on in the colour panel would override a layer
    // switch the operator had deliberately set to off.
    if (map.getLayer("labels")) {
      map.setLayoutProperty(
        "labels",
        "visibility",
        toggles.labels ? "visible" : "none",
      );
    }
  }, [paint, ready, toggles.labels]);

  /**
   * The land from the local GSHHG mask, while the basemap tiles cannot be had
   * (ISSUES F11, `offlineLand.ts`). Redrawn for the view after every move;
   * removed the moment a world that loads is chosen, so it never sits under
   * real tiles.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const drop = () => {
      if (map.getLayer(OFFLINE_LAND)) map.removeLayer(OFFLINE_LAND);
      if (map.getSource(OFFLINE_LAND)) map.removeSource(OFFLINE_LAND);
    };
    if (!basemapFailed) {
      drop();
      return;
    }
    let latest = 0;
    const draw = async () => {
      const mine = ++latest;
      const b = map.getBounds();
      const image = await landImage([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], paint.graticule);
      if (mine !== latest) return;
      if (!image) return drop();
      const source = map.getSource<maplibregl.ImageSource>(OFFLINE_LAND);
      if (source) source.updateImage(image);
      else {
        map.addSource(OFFLINE_LAND, { type: "image", ...image });
        map.addLayer({ id: OFFLINE_LAND, type: "raster", source: OFFLINE_LAND,
          paint: { "raster-opacity": 0.55, "raster-fade-duration": 0 } }, "graticule");
      }
    };
    void draw();
    map.on("moveend", draw);
    return () => {
      latest++;
      map.off("moveend", draw);
    };
  }, [ready, basemapFailed, paint.graticule]);

  /* --- scenario ---------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    map.jumpTo({ center: run.meta.centre, zoom: run.meta.zoom });

    const src = (id: string) => map.getSource(id) as maplibregl.GeoJSONSource;

    // A loop, not Math.min(...): a real scene's detections are tens of
    // thousands of vertices, which a spread passes as arguments.
    let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
    for (const ring of run.detection.parts)
      for (const [lon, lat] of ring) {
        if (lon < west) west = lon;
        if (lon > east) east = lon;
        if (lat < south) south = lat;
        if (lat > north) north = lat;
      }
    src(SOURCE.graticule).setData(
      graticule([west - 1.2, south - 1.2, east + 1.2, north + 1.2], paint.graticuleStepDeg),
    );

    src(SOURCE.axis).setData(collection([line(run.characterisation.medialAxis)]));

    // Infrastructure is deliberately NOT written here. It carries a `selected`
    // flag now, so it is rebuilt by the selection effect below instead -- see
    // the note there for why it is not simply written in both places.

    src(SOURCE.targets).setData(
      collection(
        run.cfarTargets.map((t) =>
          point(t.position, { matched: t.matched, lengthM: t.lengthM }),
        ),
      ),
    );

    src(SOURCE.markers).setData(
      collection([
        point(run.characterisation.head, { kind: "head" }),
        point(run.characterisation.tail, { kind: "tail" }),
      ]),
    );

    // The same reconstructed frames as the animated cloud, retained at every
    // playback hour so past and future footprints can be compared together.
    src(SOURCE.hindcast).setData(collection(
      run.drift.frames
        .filter(f => f.hour < 0 && (f.hour % 12 === 0 || f.hour === -run.drift.backwardHours))
        .flatMap(f => polygonsOf(f.contour90).map(rings => ({
          type: "Feature" as const, properties: { hour: f.hour },
          geometry: { type: "Polygon" as const, coordinates: rings },
        }))),
    ));

    src(SOURCE.forecast).setData(
      collection(
        run.forwardImpact.map((ring) => ({
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [ring] },
        })),
      ),
    );

    // Under `direction: "forward"` the two clouds that only exist before the
    // pass are never handed over at all, rather than being filtered at draw
    // time: the overlay's own weighting rule ("held back while the oil is on
    // screen") is about the pre-pass regime, and the cleanest way to leave that
    // rule intact is to give it nothing from before the pass to reason about.
    const forwardOnly = direction === "forward";
    overlayRef.current?.setFrames(
      run.drift.frames
        .filter((f) => (forwardOnly ? f.hour >= 0 : true))
        .map((f) => ({ hour: f.hour, particles: f.particles })),
    );
    // The oil itself, parcel by parcel. This was `forwardOnly ? [] : []` --
    // both branches empty -- so the accumulating release the overlay documents
    // at length had not been drawn at all. After the pass the oil on screen is
    // the forecast, which the contour layers own, so only the pre-pass frames
    // are handed over.
    overlayRef.current?.setReleaseFrames(
      forwardOnly
        ? []
        : run.release.map((f) => ({ hour: f.hour, particles: f.particles })),
    );
  }, [run, ready, direction, paint.graticuleStepDeg]);

  /* --- time -------------------------------------------------------- */

  /**
   * The canvas follows the fractional playhead, not React state.
   *
   * `hour` is deliberately whole-numbered -- every other consumer rounds, and
   * rebuilding the AIS tracks, the contours and the release extent sixty times
   * a second would be ruinous. The particle cloud is the one layer that
   * interpolates, so it subscribes to the continuous value and repaints from
   * its own loop. See lib/playhead.ts.
   */
  useEffect(() => subscribePlayhead((h) => overlayRef.current?.setHour(h)), []);


  const candidateIds = useMemo(
    () => new Set(run.suspects.map((s) => s.id)),
    [run],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = (id: string) => map.getSource(id) as maplibregl.GeoJSONSource;

    // Discrete changes only; the transport owns the playhead while playing.
    syncPlayhead(hour);
    overlayRef.current?.setColour(hour < 0 ? paint.hindcast : paint.particle);
    const fieldColour = hour < 0 ? paint.hindcast : paint.forecast;
    for (const id of ["contour50-line", "contour90-line"]) if (map.getLayer(id)) map.setPaintProperty(id, "line-color", fieldColour);
    for (const id of ["contour50-fill", "contour90-fill"]) if (map.getLayer(id)) map.setPaintProperty(id, "fill-color", fieldColour);

    // Origin field at this hour. The contours and the particle cloud are the
    // same field shown two ways: the rings say where the credible regions are,
    // the cloud says how the mass is distributed inside them.
    const frame = run.drift.frames.find(f => f.hour === Math.round(hour)) ?? run.drift.frames[0];

    // Grouped by nesting, so a hole in a credible region stays a hole.
    const rings: GeoJSON.Feature[] = [];
    for (const polygon of polygonsOf(frame.contour90)) {
      rings.push({
        type: "Feature",
        properties: { band: 90 },
        geometry: { type: "Polygon", coordinates: polygon },
      });
    }
    for (const polygon of polygonsOf(frame.contour50)) {
      rings.push({
        type: "Feature",
        properties: { band: 50 },
        geometry: { type: "Polygon", coordinates: polygon },
      });
    }
    src(SOURCE.contour).setData(collection(rings));

    // The release, played forward. Before the pass the only thing in the water
    // is the oil released so far; the detection polygon does not exist yet,
    // because the satellite has not been over. After the pass it is the
    // detection that is real and the release is history.
    const releaseFrame =
      run.release.find((f) => f.hour === Math.round(hour)) ?? null;
    src(SOURCE.release).setData(
      releaseFrame && hour === 0
        ? collection(
            (run.meta.id.startsWith("sample") ? run.detection.parts : releaseFrame.extent).map((ring) => ({
              type: "Feature",
              properties: { released: releaseFrame.releasedFraction },
              geometry: { type: "Polygon", coordinates: [ring] },
            })),
          )
        : EMPTY,
    );

    // AIS playback to the same instant. Tracks are drawn up to `at` rather than
    // in full, so scrubbing backward rewinds the traffic instead of leaving the
    // whole voyage on screen at every hour.
    const at = run.meta.acquiredAt + hour * 3600_000;
    const traffic: GeoJSON.Feature[] = [];
    const candidates: GeoJSON.Feature[] = [];
    const vessels: GeoJSON.Feature[] = [];
    const trackingGap: GeoJSON.Feature[] = [];
    const trackingPredicted: GeoJSON.Feature[] = [];
    const trackingMarkers: GeoJSON.Feature[] = [];

    for (const v of run.vessels) {
      const pts = v.points.filter((p) => p.t <= at);
      if (pts.length < 2) continue;
      // Broken where reports stop. A reception gap on a real track is drawn as
      // a gap: bridging it would be a straight line nobody observed.
      const parts = trackSegments(pts);
      if (!parts.length) continue;
      const isCandidate = candidateIds.has(v.mmsi);
      // Where the vessel is NOW -- only if it reported near now. `positionAt`
      // clamps to a track's ends, so without this a ship that left the scene
      // hours ago is drawn parked at its exit, and every lane end collects a
      // cluster of vessels that are not there.
      // The estimate still drives the going-dark rendering below, which is
      // precisely about a vessel that is NOT reporting.
      const reporting = v.points.some((p) => Math.abs(p.t - at) <= 15 * 60_000);
      const now = positionAt(v, at);
      const nearField = now ? pointInPolygon(now, run.detection.parts) || distanceToPathKm(now, run.characterisation.medialAxis).km < 12 : false;
      const dark = isCandidate && nearField && v.points.some((p, i) => i > 0 && p.t - v.points[i - 1].t > 2700_000);
      const feature: GeoJSON.Feature = parts.length === 1
        ? line(parts[0], { mmsi: v.mmsi })
        : { type: "Feature", properties: { mmsi: v.mmsi }, geometry: { type: "MultiLineString", coordinates: parts } };
      if (isCandidate) candidates.push(feature); else traffic.push(feature);
      if (dark) for (let i = 1; i < v.points.length; i++) {
        const a=v.points[i-1], b=v.points[i], gapH=(b.t-a.t)/3600_000;
        if (gapH <= 0.75 || a.t > at) continue;
        const pa: LngLat=[a.lon,a.lat], pb: LngLat=[b.lon,b.lat];
        trackingGap.push(line([pa,pb], {mmsi:v.mmsi}));
        if (a.t <= at) trackingPredicted.push(line([pa, b.t <= at ? pb : (now ?? pb)], {mmsi:v.mmsi}));
        trackingMarkers.push(point(pa,{kind:"tracking-off",mmsi:v.mmsi}));
        if (b.t <= at) trackingMarkers.push(point(pb,{kind:"tracking-on",mmsi:v.mmsi}));
      }
      if (now && reporting && isCandidate) vessels.push(point(now, { kind: "vessel" }));
    }

    src(SOURCE.traffic).setData(collection(traffic));
    src(SOURCE.candidates).setData(collection(candidates));
    src(SOURCE.trackingGap).setData(collection(trackingGap));
    src(SOURCE.trackingPredicted).setData(collection(trackingPredicted));
    src(SOURCE.trackingMarkers).setData(collection(trackingMarkers));

    src(SOURCE.markers).setData(
      collection([
        point(run.characterisation.head, { kind: "head" }),
        point(run.characterisation.tail, { kind: "tail" }),
        ...vessels,
      ]),
    );
  }, [hour, run, ready, candidateIds, paint]);

  /* --- camera ------------------------------------------------------ */

  /**
   * Eased rather than jumped, and only when the caller asks for a camera.
   *
   * The scenario effect above still jumps to the scenario datum when the run
   * changes, because that is a different scene and easing between two unrelated
   * places is disorienting. This one is a move within a scene, so it animates --
   * and it is deliberately not in the scenario effect's dependency list, so
   * re-framing does not rebuild every source.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !camera) return;
    const centre = camera.centre ?? run.meta.centre;
    const zoom = camera.zoom ?? run.meta.zoom;
    const duration = camera.durationMs ?? 900;

    if (duration <= 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      map.jumpTo({ center: centre, zoom });
    } else {
      map.easeTo({ center: centre, zoom, duration });
    }
    // Compared by value: a caller that rebuilds the object every render must not
    // restart the ease on every render.
  }, [
    ready,
    camera?.centre?.[0],
    camera?.centre?.[1],
    camera?.zoom,
    camera?.durationMs,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    run.meta.id,
  ]);

  /* --- selection --------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = (id: string) => map.getSource(id) as maplibregl.GeoJSONSource;

    /*
      The selected candidate's track, clipped to the playhead like every other
      track on the map.

      It used to be drawn in full, from its own effect keyed on the selection
      alone, while the `candidates` and `traffic` layers a few lines above were
      already cut at `at`. The selected track is the widest, brightest line on
      the map, so the one track that ignored the clock was also the one the eye
      goes to: at T-36 it ran across the scene and through the water the oil
      only reaches after T0, which reads as the console asserting that a vessel
      was somewhere it had not yet been. A hindcast pane showing a candidate's
      future is the wrong claim in the wrong direction.

      `Suspect.id` is the vessel's MMSI, which is what makes the timed fixes
      recoverable here -- `track` itself is bare coordinates. Infrastructure has
      no track and no MMSI, so it falls through to the unclipped branch and
      draws nothing, as before.
    */
    const at = run.meta.acquiredAt + hour * 3600_000;
    const timed = selected ? run.vessels.find((v) => v.mmsi === selected.id) : undefined;
    // Broken at reception gaps, like every other track.
    const suspectParts = timed
      ? trackSegments(timed.points.filter((p) => p.t <= at))
      : selected?.track && selected.track.length > 1 ? [selected.track] : [];
    src(SOURCE.suspect).setData(
      suspectParts.length ? collection(suspectParts.map((part) => line(part))) : EMPTY,
    );
    src(SOURCE.matched).setData(
      selected?.evidence.matchedSegment
        ? collection([line(selected.evidence.matchedSegment)])
        : EMPTY,
    );

    /*
      Infrastructure is rebuilt here rather than in the scenario effect above,
      because its features now carry the selection flag the layer's paint reads.

      Writing it in both places was the alternative and it is worse: the two
      effects would race on a scenario change -- both fire, and whichever runs
      last wins -- so a run whose new selection happened to be an installation
      would render selected or unselected depending on effect order, which is
      exactly the kind of bug that only shows up on one scenario. One writer
      cannot disagree with itself.

      It is two features. Rebuilding them on every selection change is cheaper
      than the `feature-state` machinery that would avoid it, which would need
      stable feature ids on a source that has none.

      `run.infrastructure` is in the dependency list so a scenario change still
      reaches this; `selected` alone would not, because a new run whose top
      candidate is the same object identity is not a thing React can see.
    */
    src(SOURCE.infrastructure).setData(
      collection(
        run.infrastructure.map((i) =>
          point(i.position, { label: i.label, selected: i.id === selected?.id }),
        ),
      ),
    );
    // The hour is a dependency now: the suspect track is cut at the playhead.
  }, [selected, ready, run.infrastructure, run.vessels, run.meta.acquiredAt, hour]);

  /* --- toggles ----------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const set = (layer: string, on: boolean) => {
      const definition = map.getLayer(layer);
      if (!definition) return;
      const before = map.getLayoutProperty(layer, "visibility");
      const property = definition.type === "fill" ? "fill-opacity" : definition.type === "line" ? "line-opacity" : definition.type === "circle" ? "circle-opacity" : null;
      if (property && !layerOpacity.current.has(layer)) layerOpacity.current.set(layer, map.getPaintProperty(layer, property) ?? 1);
      map.setLayoutProperty(layer, "visibility", on ? "visible" : "none");
      if (on && before === "none" && property && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setPaint(map, layer, property + "-transition", { duration: 0 });
        setPaint(map, layer, property, 0);
        window.requestAnimationFrame(() => {
          if (!map.getLayer(layer)) return;
          setPaint(map, layer, property + "-transition", { duration: 700 });
          setPaint(map, layer, property, layerOpacity.current.get(layer));
        });
      }
    };

    /*
      The detected mask is drawn at every hour, not only from the pass onward.

      It used to appear at T-0.5h, on the argument that the detection is what
      the satellite recorded at the pass and showing it earlier is showing the
      answer before the question. That argument is sound and it is why the
      layer was built this way -- but it is an argument about the logic of the
      investigation, and what a first-time viewer sees is a spill that was not
      there a moment ago and now is. They read it as the oil appearing, which
      is the wrong story entirely: the oil was in the water the whole time and
      the satellite is what arrived.

      Whoever already knows the pipeline loses nothing by having the outline on
      screen early, because the timeline states the hour and the pass is marked
      on it. A new viewer loses the whole frame. The toggle is still there for
      anyone who wants the strict reading back.
    */
    const detected = toggles.slick;
    set("slick-fill", detected);
    set("slick-line", detected);
    set("slick-axis", detected);
    set("release-fill", toggles.release && hour <= 0.5);
    set("release-line", toggles.release && hour <= 0.5);
    set("contour50-fill", toggles.contours);
    set("contour50-line", toggles.contours);
    set("contour90-fill", toggles.contours);
    set("contour90-line", toggles.contours);
    set("traffic", toggles.traffic);
    set("candidates", toggles.candidates);
    set("suspect-track", toggles.candidates);
    set("matched-segment", toggles.candidates);
    set("tracking-gap", toggles.darkVessel);
    set("tracking-predicted", toggles.darkVessel);
    set("tracking-markers", toggles.darkVessel);
    set("targets", toggles.targets);
    set("infrastructure", toggles.targets);
    set("markers", detected || toggles.candidates);
    if (map.getLayer("markers")) map.setFilter("markers", ["in", ["get", "kind"], ["literal", [
      ...(detected ? ["head", "tail"] : []), ...(toggles.candidates ? ["vessel"] : []),
    ]]]);
    set("hindcast-fill", showHindcastAreas);
    set("hindcast-line", showHindcastAreas);
    set("forecast-fill", toggles.forecast);
    set("forecast-line", toggles.forecast);
    set("labels", toggles.labels);
    set("flow-wind", toggles.windArrows);
    set("flow-current", toggles.currentArrows);
    // One toggle each, rather than an OR across both. Ored together, turning
    // the ensemble off did nothing at all as long as the release was on, which
    // is a control that lies about what it controls.
    overlayRef.current?.setVisible(toggles.particles);
    overlayRef.current?.setReleaseVisible(toggles.release);
  }, [toggles, ready, hour, showHindcastAreas]);

  /* --- flow arrows -------------------------------------------------- */

  // Cells once per run, over the slick and every hour's 90% region, hindcast
  // and forecast alike (`flowCells`); each arrow is its cell's mean flow at the
  // playhead.
  const cells = useMemo(
    () => (run.flow ? flowCells([...spillParts(run.detection), ...run.drift.frames.flatMap((f) => f.contour90)]) : null),
    [run],
  );
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const source = map.getSource(SOURCE.flow) as maplibregl.GeoJSONSource | undefined;
    if (!source) return;
    const flow = run.flow;
    const features: GeoJSON.Feature[] = [];
    if (flow && cells) {
      for (const cell of cells) {
        for (const kind of ["wind", "current"] as const) {
          const vector = flowMean(flow, kind, cell.bbox, hour);
          if (!vector) continue;
          const { speed, towardDeg } = speedToward(vector);
          features.push(point(cell[kind], { kind, speed, towardDeg }));
        }
      }
    }
    source.setData(collection(features));
  }, [run, cells, hour, ready]);

  /* --- detections -------------------------------------------------- */

  // Separate from the scenario effect, so a verdict change redraws the
  // polygons without moving the camera. A real scene draws its seed alone.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    (map.getSource(SOURCE.slick) as maplibregl.GeoJSONSource).setData(
      collection(
        detectionFeatures(run.detection).map(({ ring, confidence }) => ({
          type: "Feature",
          properties: { class: verdictFor(run).verdict, confidence },
          geometry: { type: "Polygon", coordinates: [ring] },
        })),
      ),
    );
  }, [run, ready]);

  /* --- picking ----------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !onSelect) return;

    const onClick = (e: maplibregl.MapMouseEvent) => {
      const hits = map.queryRenderedFeatures(e.point, {
        layers: ["candidates", "suspect-track"],
      });
      const mmsi = hits[0]?.properties?.mmsi;
      onSelect(typeof mmsi === "string" ? mmsi : null);
    };

    map.on("click", onClick);
    return () => {
      map.off("click", onClick);
    };
  }, [ready, onSelect]);

  return (
    <div className={`relative ${className}`}>
      {/* Sized rather than positioned. MapLibre's own stylesheet sets
          `.maplibregl-map { position: relative }` and loads after Tailwind, so
          an absolutely positioned holder collapses to zero height the moment
          the map initialises. */}
      <div ref={holder} className="h-full w-full" />
      {showHindcastAreas && (
        <div className="absolute bottom-10 left-3 z-10 flex gap-4 bg-base-2/90 px-2 py-1 font-mono text-[10px]" aria-label="Area legend">
          <span style={{ color: paint.hindcast }}>▱ Hindcast · before T0</span>
          <span style={{ color: paint.forecast }}>▱ Forecast · after T0</span>
        </div>
      )}
      {flowCards && <FlowCards run={run} hour={hour} paint={paint} />}
      {basemapFailed && (
        <div
          className="border-line bg-base-2/90 text-dim absolute bottom-3 left-3 z-10 max-w-[30ch] border px-3 py-2 font-mono text-[10.5px] leading-relaxed backdrop-blur"
          role="status"
        >
          Basemap tiles unreachable. The land is drawn from the local GSHHG
          mask the drift uses (no place names); the scene and every result
          layer are generated locally and still correct.
        </div>
      )}
    </div>
  );
}
