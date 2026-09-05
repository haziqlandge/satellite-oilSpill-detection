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
import maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";

import {
  EMPTY,
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
import type { MapPaint } from "../theme";
import type { LngLat, Run, Suspect } from "../sim/types";
import { positionAt } from "../sim/ais";

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
  toggles,
  selected,
  onSelect,
  className = "",
  interactive = true,
  controls = "full",
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
        ]) {
          map.addSource(id, { type: "geojson", data: EMPTY });
        }
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
    ];
    for (const [layer, prop] of scaled) {
      const value = built.get(layer)?.[prop];
      if (value !== undefined) repaint.push([layer, prop, value]);
    }

    for (const [layer, prop, value] of repaint) {
      if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value);
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

  /* --- scenario ---------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    map.jumpTo({ center: run.meta.centre, zoom: run.meta.zoom });

    const src = (id: string) => map.getSource(id) as maplibregl.GeoJSONSource;

    const lons = run.detection.parts.flatMap((r) => r.map((p) => p[0]));
    const lats = run.detection.parts.flatMap((r) => r.map((p) => p[1]));
    src(SOURCE.graticule).setData(
      graticule(
        [
          Math.min(...lons) - 1.2,
          Math.min(...lats) - 1.2,
          Math.max(...lons) + 1.2,
          Math.max(...lats) + 1.2,
        ],
        paint.graticuleStepDeg,
      ),
    );

    src(SOURCE.slick).setData(
      collection(
        run.detection.parts.map((ring) => ({
          type: "Feature",
          properties: {
            class: run.detection.className,
            confidence: run.detection.confidence,
          },
          geometry: { type: "Polygon", coordinates: [ring] },
        })),
      ),
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
    overlayRef.current?.setReleaseFrames(
      forwardOnly
        ? []
        : run.release.map((f) => ({ hour: f.hour, particles: f.particles })),
    );
  }, [run, ready, direction, paint.graticuleStepDeg]);

  /* --- time -------------------------------------------------------- */

  const candidateIds = useMemo(
    () => new Set(run.suspects.map((s) => s.id)),
    [run],
  );

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const src = (id: string) => map.getSource(id) as maplibregl.GeoJSONSource;

    overlayRef.current?.setHour(hour);

    // Origin field at this hour. The contours and the particle cloud are the
    // same field shown two ways: the rings say where the credible regions are,
    // the cloud says how the mass is distributed inside them.
    const frame =
      run.drift.frames.find((f) => f.hour === Math.round(hour)) ??
      run.drift.frames[0];

    const rings: GeoJSON.Feature[] = [];
    for (const ring of frame.contour90) {
      rings.push({
        type: "Feature",
        properties: { band: 90 },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    }
    for (const ring of frame.contour50) {
      rings.push({
        type: "Feature",
        properties: { band: 50 },
        geometry: { type: "Polygon", coordinates: [ring] },
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
      releaseFrame && hour <= 0.5
        ? collection(
            releaseFrame.extent.map((ring) => ({
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

    for (const v of run.vessels) {
      const pts = v.points.filter((p) => p.t <= at);
      if (pts.length < 2) continue;
      const coords = pts.map((p) => [p.lon, p.lat] as LngLat);
      const isCandidate = candidateIds.has(v.mmsi);
      const feature = line(coords, { mmsi: v.mmsi });
      if (isCandidate) candidates.push(feature);
      else traffic.push(feature);

      const now = positionAt(v, at);
      if (now && isCandidate) vessels.push(point(now, { kind: "vessel" }));
    }

    src(SOURCE.traffic).setData(collection(traffic));
    src(SOURCE.candidates).setData(collection(candidates));

    src(SOURCE.markers).setData(
      collection([
        point(run.characterisation.head, { kind: "head" }),
        point(run.characterisation.tail, { kind: "tail" }),
        ...vessels,
      ]),
    );
  }, [hour, run, ready, candidateIds]);

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

    src(SOURCE.suspect).setData(
      selected?.track ? collection([line(selected.track)]) : EMPTY,
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
  }, [selected, ready, run.infrastructure]);

  /* --- toggles ----------------------------------------------------- */

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const set = (layer: string, on: boolean) => {
      if (map.getLayer(layer)) {
        map.setLayoutProperty(layer, "visibility", on ? "visible" : "none");
      }
    };

    // The detection is what the satellite recorded at the pass. Showing it
    // during the hours before the pass would be showing the answer before the
    // question.
    const detected = toggles.slick && hour >= -0.5;
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
    set("targets", toggles.targets);
    set("infrastructure", toggles.targets);
    set("forecast-fill", toggles.forecast);
    set("forecast-line", toggles.forecast);
    set("labels", toggles.labels);
    // One toggle each, rather than an OR across both. Ored together, turning
    // the ensemble off did nothing at all as long as the release was on, which
    // is a control that lies about what it controls.
    overlayRef.current?.setVisible(toggles.particles);
    overlayRef.current?.setReleaseVisible(toggles.release);
  }, [toggles, ready, hour]);

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
      {basemapFailed && (
        <div
          className="border-line bg-base-2/90 text-dim absolute bottom-3 left-3 z-10 max-w-[30ch] border px-3 py-2 font-mono text-[10.5px] leading-relaxed backdrop-blur"
          role="status"
        >
          Basemap tiles unreachable. The world is missing; the graticule, the
          scene and every result layer are generated locally and still correct.
        </div>
      )}
    </div>
  );
}
