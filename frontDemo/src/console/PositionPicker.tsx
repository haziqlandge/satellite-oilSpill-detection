/**
 * Click a map to say where an upload is.
 *
 * The panel used to ask for a centre latitude and a centre longitude as two
 * number fields. That is the correct data and a poor question: an operator
 * holding a SAR tile knows the stretch of coast it came from, not its decimal
 * degrees, and a typo in the first digit puts the scene in another ocean
 * without anything looking wrong. Asking on a map turns the same answer into a
 * thing you can see is right.
 *
 * The footprint box matters as much as the pin. Scale cannot be read off an
 * unreferenced raster either, and a slick's size is the difference between a
 * vessel a kilometre away and one thirty kilometres away -- so the box shows
 * exactly how much ground the image is being claimed to cover, and it is
 * adjusted until it looks like the right amount of sea.
 *
 * The same Esri basemap as the console. The drift itself is tested against the
 * GSHHG coastline OpenDrift uses (`sim/landmask.ts`), not against this picture,
 * so the line under the pin says what THAT coastline makes of the position:
 * the run refuses a scene placed on land, and it is better to see why before
 * pressing the button than after.
 */

import { useEffect, useRef, useState } from "react";
import { ensureLandmask, isLand } from "../sim/landmask";
import maplibregl from "maplibre-gl";
import type { Map as MapLibreMap } from "maplibre-gl";
import { KM_PER_DEG_LAT, kmPerDegLon } from "../sim/geo";
import type { LngLat } from "../sim/types";

const TILES =
  "https://services.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}";

/** The footprint as a GeoJSON box, so the operator sees the ground they claim. */
function footprint(centre: LngLat, acrossKm: number): GeoJSON.Feature {
  const halfLon = acrossKm / 2 / Math.max(1, kmPerDegLon(centre[1]));
  const halfLat = acrossKm / 2 / KM_PER_DEG_LAT;
  const west = centre[0] - halfLon;
  const east = centre[0] + halfLon;
  const south = centre[1] - halfLat;
  const north = centre[1] + halfLat;
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
    },
  };
}

export function PositionPicker({
  centre,
  acrossKm,
  onChange,
}: {
  centre: LngLat;
  acrossKm: number;
  onChange: (next: LngLat) => void;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<maplibregl.Marker | null>(null);
  // The latest handler, so the map's own listener never closes over a stale one.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  // The latest position, for the load handler, which runs after mount and
  // would otherwise draw the footprint where the scene was when the map began.
  const latest = useRef({ centre, acrossKm });
  latest.current = { centre, acrossKm };
  const [ashore, setAshore] = useState<boolean | null>(null);

  useEffect(() => {
    if (!holder.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: holder.current,
      style: {
        version: 8,
        sources: { base: { type: "raster", tiles: [TILES], tileSize: 256, maxzoom: 13 } },
        layers: [{ id: "base", type: "raster", source: "base" }],
      },
      center: centre,
      zoom: 5,
      attributionControl: false,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.on("load", () => {
      map.addSource("footprint", {
        type: "geojson",
        data: footprint(latest.current.centre, latest.current.acrossKm),
      });
      map.addLayer({
        id: "footprint-fill",
        type: "fill",
        source: "footprint",
        paint: { "fill-color": "#4ade80", "fill-opacity": 0.15 },
      });
      map.addLayer({
        id: "footprint-line",
        type: "line",
        source: "footprint",
        paint: { "line-color": "#4ade80", "line-width": 1.5 },
      });
    });
    map.on("click", (event) => {
      onChangeRef.current([+event.lngLat.lng.toFixed(4), +event.lngLat.lat.toFixed(4)]);
    });
    const marker = new maplibregl.Marker({ color: "#4ade80", draggable: true })
      .setLngLat(centre)
      .addTo(map);
    marker.on("dragend", () => {
      const at = marker.getLngLat();
      onChangeRef.current([+at.lng.toFixed(4), +at.lat.toFixed(4)]);
    });
    mapRef.current = map;
    markerRef.current = marker;
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Mount once. Position and footprint are pushed by the effect below, which
    // is what keeps a click from tearing the map down and rebuilding it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    markerRef.current?.setLngLat(centre);
    if (!map) return;
    const source = map.getSource("footprint") as maplibregl.GeoJSONSource | undefined;
    source?.setData(footprint(centre, acrossKm));
    // A position that arrived from outside the map -- typed, or read from a
    // GeoTIFF -- has to be brought into view, or the pin moves off-screen and
    // the map keeps showing somewhere else. A click is already in view, so it
    // never pans under the operator's cursor.
    if (!map.getBounds().contains(centre)) {
      map.jumpTo({ center: centre, zoom: Math.max(map.getZoom(), 7) });
    }
  }, [centre, acrossKm]);

  useEffect(() => {
    let alive = true;
    setAshore(null);
    ensureLandmask(centre, 1)
      .then(() => { if (alive) setAshore(isLand(centre[0], centre[1])); })
      .catch(() => { if (alive) setAshore(null); });
    return () => { alive = false; };
  }, [centre]);

  return (
    <div>
      <div
        ref={holder}
        className="h-44 w-full border"
        style={{ borderColor: "var(--line)" }}
        aria-label="Click the map to place the scene"
      />
      <p className="mt-1 num text-[10px]" style={{ color: "var(--ink-faint)" }}>
        {centre[1].toFixed(4)}°, {centre[0].toFixed(4)}° · {acrossKm.toFixed(1)} km across
        {ashore !== null && <span style={{ color: ashore ? "var(--alarm)" : "var(--accent)" }} data-picker-ashore={ashore}>
          {ashore ? " · on land — move the pin onto water" : " · water"}</span>}
      </p>
    </div>
  );
}
