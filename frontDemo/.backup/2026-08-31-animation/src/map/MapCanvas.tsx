/**
 * The map. MapLibre GL JS, driven from the simulation.
 *
 * One component owns the map instance and pushes GeoJSON into named sources as
 * the scenario, the hour or the selection changes. Layers are declared once in
 * `basemap.ts`; nothing in here adds or removes a layer at runtime, because
 * restyling a live map is where MapLibre integrations usually start flickering.
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
  buildStyle,
  dataLayers,
  graticule,
  hasLabels,
  type LayerToggles,
} from "./basemap";
import { ParticleOverlay } from "./ParticleOverlay";
import type { MapPaint } from "../design";
import type { LngLat, Run, Suspect } from "../sim/types";
import { positionAt } from "../sim/ais";

interface Props {
  run: Run;
  paint: MapPaint;
  /** Hours from acquisition. Negative is backward. */
  hour: number;
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

export function MapCanvas({
  run,
  paint,
  hour,
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
        if (hasLabels(paint)) {
          map.addLayer({
            id: "labels",
            type: "raster",
            source: "labels",
            paint: { "raster-opacity": 0.55 },
          });
        }

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
      map.setPaintProperty(
        "basemap",
        "raster-brightness-max",
        paint.basemapBrightnessMax,
      );
    }
    overlayRef.current?.setColour(paint.particle);
    overlayRef.current?.setReleaseColour(paint.target);

    const repaint: [string, string, string][] = [
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
    ];
    for (const [layer, prop, value] of repaint) {
      if (map.getLayer(layer)) map.setPaintProperty(layer, prop, value);
    }
  }, [paint, ready]);

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

    src(SOURCE.infrastructure).setData(
      collection(run.infrastructure.map((i) => point(i.position, { label: i.label }))),
    );

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

    overlayRef.current?.setFrames(
      run.drift.frames.map((f) => ({ hour: f.hour, particles: f.particles })),
    );
    overlayRef.current?.setReleaseFrames(
      run.release.map((f) => ({ hour: f.hour, particles: f.particles })),
    );
  }, [run, ready, paint.graticuleStepDeg]);

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
  }, [selected, ready]);

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
    overlayRef.current?.setVisible(toggles.particles || toggles.release);
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
