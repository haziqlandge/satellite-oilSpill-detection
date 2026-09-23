"""Run the real OpenDrift ensemble per scene and export static drift artifacts.

The console's drift has always been a simulated stand-in: an honest one, an
ensemble with diffusion that says `SIM` on every panel, but a stand-in. This
runs the real thing -- OpenDrift's OpenOil, seeded from a real detection, forced
by real ERA5 wind -- and writes what the map needs as plain files.

Static files on purpose. There is no API (ISSUES X4) and for a local demo there
does not need to be: the frontend is a static Vite build, so a JSON per scene
under `frontDemo/public/runs/` is both the simplest thing that works now and
exactly what a static host wants later (FUTURE_WORK section 4.2).

FOUR TRAPS THIS CODE IS SHAPED AROUND, all of them already paid for:

  * **`times` DESCENDS on a backward run.** `times[0]` is the observation and
    `times[-1]` is the earliest reconstructed instant. Code that assumes an
    ascending axis builds the origin field back to front, and the error is
    invisible -- the animation simply runs the wrong way.
  * **The engine requires NAIVE UTC datetimes** (ISSUES X10). A tz-aware value
    dies deep inside pandas with a comparison error that names neither the
    argument nor the cause. Acquisition times parsed from a file name are
    naturally aware, so they are stripped here.
  * **Wind only.** CMEMS has no credentials (ISSUES X2), so there is no current
    field. Every artifact records `forcing` so the interface can say so rather
    than implying a full metocean field.
  * **The ensemble is the point** (C5). Ten members differing in wind drift
    factor and diffusivity, stacked -- never one trajectory.

    .venv/Scripts/python.exe -m scripts.export_drift_runs --list
    .venv/Scripts/python.exe -m scripts.export_drift_runs --all
"""

from __future__ import annotations

import argparse
import json
import math
import time
from dataclasses import dataclass
from datetime import datetime, timedelta
from itertools import pairwise
from pathlib import Path
from typing import Any

import numpy as np
from dotenv import load_dotenv

from backend.config import REPO_ROOT

SCENES = REPO_ROOT / "eval" / "final" / "scenes"
OUT = REPO_ROOT / "frontDemo" / "public" / "runs"

BACKWARD_HOURS = 72
MEMBERS = 10
PARTICLES_PER_MEMBER = 200
# Rendered particles per frame. The statistics always use every particle; this
# is only what travels to the browser.
RENDER_PARTICLES = 1200
EARTH_KM_PER_DEG_LAT = 110.574


def km_per_deg_lon(lat: float) -> float:
    return 111.320 * math.cos(math.radians(lat))


def scene_acquired_at(stem: str) -> datetime | None:
    """Naive UTC acquisition time from a Sentinel-1 scene name."""
    import re

    match = re.search(r"(\d{8})T(\d{6})", stem)
    if not match:
        return None
    day, clock = match.groups()
    return datetime(
        int(day[0:4]), int(day[4:6]), int(day[6:8]),
        int(clock[0:2]), int(clock[2:4]), int(clock[4:6]),
    )


# A traced slick's outline follows the pixel grid in short steps. It runs
# straight along a row or a column for a kilometre only where something cut it:
# YOLO-seg crops every mask to its predicted box, so a mask that filled its box
# -- the model found dark water but no edge to it -- ends in straight,
# axis-aligned sides. Over the three Gulf scenes 90% of detections have no
# straight run longer than ~60 px (~0.6 km); the filled boxes run 380-959 px.
FRAME_EDGE_KM = 1.2
# At sea on OpenDrift's own coastline (GSHHG): a seed ashore is not a seed, and
# OpenDrift has to move its particles off land before it can start.
MAX_LAND_FRACTION = 0.1

SEED_RULE = (
    "the largest detection at sea (GSHHG: centre offshore, at most "
    f"{MAX_LAND_FRACTION:.0%} of it on land) whose outline never runs straight along the "
    f"pixel grid for {FRAME_EDGE_KM} km or more -- an edge that straight is the model's "
    "box, not a slick's edge"
)


@dataclass(frozen=True, slots=True)
class Seed:
    """The detection a backward run starts from, and what was passed over for it."""

    centre: tuple[float, float]
    feature: int
    part: int
    area_km2: float
    confidence: float
    straight_edge_km: float
    land_fraction: float
    frame_cut: int
    ashore: int
    candidates: int

    def as_dict(self) -> dict[str, Any]:
        return dict(
            rule=SEED_RULE,
            areaKm2=round(self.area_km2, 3),
            confidence=round(self.confidence, 4),
            straightEdgeKm=round(self.straight_edge_km, 3),
            landFraction=round(self.land_fraction, 3),
            passedOver=dict(frameCut=self.frame_cut, ashore=self.ashore),
            of=self.candidates,
        )


def polygon_parts(document: dict[str, Any]) -> list[tuple[int, int, Any, float]]:
    """(feature, part, polygon, confidence) for every polygon in a detection file."""
    from shapely.geometry import shape

    parts = []
    for fi, feature in enumerate(document.get("features", [])):
        geometry = shape(feature["geometry"])
        polygons = list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]
        confidence = float(feature.get("properties", {}).get("confidence", 0.0))
        for pi, polygon in enumerate(polygons):
            parts.append((fi, pi, polygon, confidence))
    return parts


def straight_edge_km(polygon: Any) -> float:
    """The longest run of any ring along one pixel row or column, in km."""
    best = 0.0
    for ring in [polygon.exterior, *polygon.interiors]:
        coords = list(ring.coords)
        run = 0.0
        line: tuple[str, float] | None = None
        for (x0, y0), (x1, y1) in pairwise(coords):
            if y0 == y1 and x0 != x1:
                here = ("row", y0)
                length = abs(x1 - x0) * km_per_deg_lon(y0)
            elif x0 == x1 and y0 != y1:
                here = ("col", x0)
                length = abs(y1 - y0) * EARTH_KM_PER_DEG_LAT
            else:
                run, line = 0.0, None
                continue
            # Consecutive edges on the same row or column are one straight run.
            run = run + length if here == line else length
            line = here
            best = max(best, run)
    return best


def land_fraction(polygon: Any, landmask: Any) -> float:
    """Share of the polygon on GSHHG land, sampled on a grid over its extent."""
    from shapely import contains_xy

    west, south, east, north = polygon.bounds
    grid_x, grid_y = np.meshgrid(np.linspace(west, east, 30), np.linspace(south, north, 30))
    xs, ys = grid_x.ravel(), grid_y.ravel()
    inside = contains_xy(polygon, xs, ys)
    if inside.sum() < 5:
        point = polygon.representative_point()
        return float(landmask.contains(point.x, point.y))
    return float(np.mean(landmask.contains_many(xs[inside], ys[inside])))


def choose_seed(path: Path) -> Seed:
    """The detection to hindcast: see `SEED_RULE`.

    This used to be "the ring with the biggest bounding box". In every processed
    Gulf scene that was a box the model had filled -- whole tiles of sheltered
    or wind-calmed water, and in December an inland water body (ISSUES Q5). A
    bounding box rewards exactly that shape. The rule is fixed before any run,
    and nothing is ranked from these fields, so it cannot be steering an answer.
    """
    from roaring_landmask import RoaringLandmask

    landmask = RoaringLandmask.new()
    parts = polygon_parts(json.loads(path.read_text()))
    frame_cut = ashore = 0
    for fi, pi, polygon, confidence in sorted(parts, key=lambda p: -p[2].area):
        edge = straight_edge_km(polygon)
        if edge >= FRAME_EDGE_KM:
            frame_cut += 1
            continue
        centroid = polygon.centroid
        centre = centroid if polygon.contains(centroid) else polygon.representative_point()
        share = land_fraction(polygon, landmask)
        if landmask.contains(centre.x, centre.y) or share > MAX_LAND_FRACTION:
            ashore += 1
            continue
        area = polygon.area * km_per_deg_lon(centre.y) * EARTH_KM_PER_DEG_LAT
        return Seed(
            centre=(float(centre.x), float(centre.y)),
            feature=fi, part=pi, area_km2=area, confidence=confidence,
            straight_edge_km=edge, land_fraction=share,
            frame_cut=frame_cut, ashore=ashore, candidates=len(parts),
        )
    raise SystemExit(
        f"{path.name}: no detection meets the seed rule ({frame_cut} box-cut, "
        f"{ashore} ashore, of {len(parts)})"
    )


def scene_bbox(path: Path) -> tuple[tuple[float, float, float, float], int]:
    """Every ring's extent, and the feature count.

    The ERA5 request is made for this box and its cache is keyed on it, so it
    stays exactly what the first real runs asked for, whichever detection seeds.
    """
    document = json.loads(path.read_text())
    features = document.get("features", [])
    if not features:
        raise SystemExit(f"{path.name}: no polygons to seed from")
    west = south = math.inf
    east = north = -math.inf
    for feature in features:
        geometry = feature["geometry"]
        coordinates = geometry["coordinates"]
        rings = coordinates if geometry["type"] == "Polygon" else [r for p in coordinates for r in p]
        for ring in rings:
            xs = [c[0] for c in ring]
            ys = [c[1] for c in ring]
            west, east = min(west, *xs), max(east, *xs)
            south, north = min(south, *ys), max(north, *ys)
    return (west, south, east, north), len(features)


def ring_area_km2(ring: list[list[float]]) -> float:
    """Shoelace on a local km projection. Good enough at scene scale."""
    if len(ring) < 4:
        return 0.0
    lat0 = sum(p[1] for p in ring) / len(ring)
    kx = km_per_deg_lon(lat0)
    total = 0.0
    for i in range(len(ring) - 1):
        x1, y1 = ring[i][0] * kx, ring[i][1] * EARTH_KM_PER_DEG_LAT
        x2, y2 = ring[i + 1][0] * kx, ring[i + 1][1] * EARTH_KM_PER_DEG_LAT
        total += x1 * y2 - x2 * y1
    return abs(total) / 2.0


def json_safe(value):
    """Replace every non-finite number with null, recursively.

    `json.dumps` emits a bare `NaN` for a float NaN, which Python reads back
    happily and `JSON.parse` refuses outright -- so an artifact containing one
    is unloadable in the browser it was written for, and the failure appears as
    a syntax error a long way from its cause.

    They are not hypothetical here. `estimate_age` returns a NaN triple when the
    field never converges, which is its honest refusal (C1 keeps the age a
    triple even when it has no value to put in it), so the very case the
    interface most needs to render is the one that breaks the file.
    """
    if isinstance(value, dict):
        return {k: json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [json_safe(v) for v in value]
    if isinstance(value, float) and not math.isfinite(value):
        return None
    return value


def export_scene(path: Path, *, forcing_mode: str, hours: int, verbose: bool = True) -> dict:
    from backend.drift.convergence import ConvergenceError, estimate_age
    from backend.drift.ensemble import run_ensemble
    from backend.drift.opendrift_runner import Forcing
    from backend.drift.origin_field import build_origin_field, contour_geojson

    stem = path.stem
    acquired = scene_acquired_at(stem)
    if acquired is None:
        raise SystemExit(f"{stem}: no acquisition time in the scene name")
    seed = choose_seed(path)
    centre = seed.centre
    bbox, polygons = scene_bbox(path)

    readers = None
    # None once real readers carry the forcing; `run_ensemble` takes either.
    forcing: Forcing | None = Forcing()
    if forcing_mode == "era5":
        from backend.ingest.metocean.cache import fetch_with_cache
        from backend.ingest.metocean.era5 import era5_reader, fetch_era5_wind, wind_request

        request = wind_request(
            west=bbox[0], south=bbox[1], east=bbox[2], north=bbox[3],
            # One hour past the observation so the reader brackets it rather
            # than ending exactly on it.
            start=acquired - timedelta(hours=hours + 1),
            end=acquired + timedelta(hours=1),
        )
        if verbose:
            print(f"  ERA5 {request.key()[:8]} ...", flush=True)
        wind_path = fetch_with_cache(request, fetch_era5_wind)

        # OpenOil needs more than wind. It requires currents and a land mask,
        # and refuses to start without a reader for each -- "every ensemble
        # member failed" is what a missing one looks like.
        #
        # Order is priority: ERA5 answers the wind, OpenDrift's own global
        # landmask answers the coast, and the constant reader answers what is
        # left, which is the currents. Those are ZERO, because CMEMS has no
        # credentials (ISSUES X2) -- so this is a wind-driven reconstruction and
        # the artifact says so rather than implying a full metocean field.
        #
        # The landmask is OpenDrift's own, not the frontend's: hand-rolling
        # coastline handling inside the physics is exactly what C6 forbids.
        from opendrift.readers import reader_global_landmask

        readers = [
            era5_reader(wind_path),
            reader_global_landmask.Reader(),
            Forcing().as_reader(),
        ]
        forcing = None

    if verbose:
        print(f"  seeding {centre[0]:.4f}, {centre[1]:.4f} at {acquired}Z", flush=True)
    started = time.time()
    result = run_ensemble(
        lon=centre[0], lat=centre[1], start=acquired, hours=hours, backward=True,
        members=MEMBERS, particles=PARTICLES_PER_MEMBER, radius_m=500.0,
        forcing=forcing, readers=readers, seed=0,
    )
    elapsed = time.time() - started
    if verbose:
        print(
            f"  ensemble {result.lon_history.shape} in {elapsed:.0f}s, "
            f"{len(result.failures)} member failure(s)",
            flush=True,
        )

    field = build_origin_field(result.lon_history, result.lat_history, result.times)

    # OpenDrift's own answer to "is this parcel ashore", over every position the
    # run produced: the GSHHG polygons its landmask reader tests. The frontend's
    # 1/240-degree raster cannot resolve a pass narrower than a cell, so it is
    # not the arbiter of whether the physics left its coast (ISSUES F13).
    from roaring_landmask import RoaringLandmask

    all_lon = result.lon_history.ravel()
    all_lat = result.lat_history.ravel()
    finite = np.isfinite(all_lon) & np.isfinite(all_lat)
    ashore = RoaringLandmask.new().contains_many(
        all_lon[finite].astype(np.float64), all_lat[finite].astype(np.float64)
    )
    on_land_pct = float(100.0 * np.mean(ashore)) if ashore.size else 0.0

    # `times` descends: row 0 is the observation, row k is k steps BEFORE it.
    times = result.times
    step_h = abs((times[1] - times[0]).total_seconds()) / 3600.0 if len(times) > 1 else 1.0
    rows_per_hour = max(1, round(1.0 / step_h))
    stride = max(1, result.lon_history.shape[1] // RENDER_PARTICLES)

    frames: list[dict[str, Any]] = []
    for row in range(0, len(times), rows_per_hour):
        hour = -round(row * step_h)
        lons = result.lon_history[row, ::stride]
        lats = result.lat_history[row, ::stride]
        finite = np.isfinite(lons) & np.isfinite(lats)
        lons, lats = lons[finite], lats[finite]
        if lons.size == 0:
            continue
        particles: list[float] = []
        for lon, lat in zip(lons, lats, strict=True):
            particles.append(round(float(lon), 5))
            particles.append(round(float(lat), 5))

        contours = contour_geojson(field, row)
        by_level: dict[str, list[list[list[float]]]] = {}
        for feature in contours["features"]:
            level = str(feature["properties"].get("level"))
            rings = feature["geometry"]["coordinates"]
            polys = rings if feature["geometry"]["type"] == "MultiPolygon" else [rings]
            by_level.setdefault(level, []).extend(
                [[[round(c[0], 5), round(c[1], 5)] for c in ring] for poly in polys for ring in poly]
            )
        c50 = by_level.get("0.5", [])
        c90 = by_level.get("0.9", [])

        centre_lon = float(np.mean(lons))
        centre_lat = float(np.mean(lats))
        kx = km_per_deg_lon(centre_lat)
        spread = float(
            np.mean(
                np.hypot((lons - centre_lon) * kx, (lats - centre_lat) * EARTH_KM_PER_DEG_LAT)
            )
        )
        frames.append(
            dict(
                hour=hour,
                particles=particles,
                contour50=c50,
                contour90=c90,
                area50Km2=round(sum(ring_area_km2(r) for r in c50), 4),
                area90Km2=round(sum(ring_area_km2(r) for r in c90), 4),
                spreadKm=round(spread, 4),
            )
        )
    frames.sort(key=lambda f: f["hour"])

    age: dict[str, object]
    try:
        estimate = estimate_age(field)
        age = estimate.as_dict()
    except ConvergenceError as error:
        # A refusal is a result (C1/C3). It is exported, not swallowed.
        age = {"method": "indeterminate", "reason": str(error)}

    payload = dict(
        scene=stem,
        acquiredAtIso=acquired.isoformat() + "Z",
        seed=[round(centre[0], 6), round(centre[1], 6)],
        seedDetection=seed.as_dict(),
        detectionPolygons=polygons,
        engine="OpenDrift OpenOil",
        forcing=forcing_mode,
        forcingNote=(
            "ERA5 10 m wind only; no current field, because CMEMS has no credentials (ISSUES X2)."
            if forcing_mode == "era5"
            else "Constant forcing. With no spatially varying flow there is no convergence minimum."
        ),
        members=MEMBERS,
        particlesPerMember=PARTICLES_PER_MEMBER,
        particlesRendered=len(frames[0]["particles"]) // 2 if frames else 0,
        backwardHours=hours,
        forwardHours=0,
        stepMinutes=round(step_h * 60),
        memberFailures=list(result.failures),
        onLandPct=round(on_land_pct, 3),
        elapsedSeconds=round(elapsed, 1),
        age=age,
        convergence=[
            dict(hour=f["hour"], area90Km2=f["area90Km2"], spreadKm=f["spreadKm"]) for f in frames
        ],
        frames=frames,
    )

    destination = OUT / stem
    destination.mkdir(parents=True, exist_ok=True)
    out_file = destination / "drift.json"
    # allow_nan=False turns a missed non-finite into an immediate error here
    # rather than an unparseable file discovered in the browser later.
    out_file.write_text(
        json.dumps(json_safe(payload), separators=(",", ":"), allow_nan=False),
        encoding="utf-8",
    )
    if verbose:
        print(
            f"  wrote {out_file.relative_to(REPO_ROOT)} "
            f"({out_file.stat().st_size / 2**20:.2f} MB, {len(frames)} frames)",
            flush=True,
        )
    return payload


def main() -> int:
    load_dotenv(REPO_ROOT / ".env")
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--list", action="store_true")
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--scene", help="substring of a scene name")
    parser.add_argument("--forcing", choices=("era5", "constant"), default="era5")
    parser.add_argument("--hours", type=int, default=BACKWARD_HOURS)
    args = parser.parse_args()

    scenes = sorted(SCENES.glob("*.geojson"))
    if args.list or not (args.all or args.scene):
        for path in scenes:
            seed = choose_seed(path)
            print(
                f"{path.stem}\n  seed {seed.centre[0]:.4f}, {seed.centre[1]:.4f}: "
                f"{seed.area_km2:.2f} km2, conf {seed.confidence:.2f}; passed over "
                f"{seed.frame_cut} box-cut and {seed.ashore} ashore of {seed.candidates}"
            )
        if not (args.all or args.scene):
            print("\npass --all, or --scene <substring>")
        return 0

    chosen = scenes if args.all else [p for p in scenes if args.scene in p.name]
    if not chosen:
        print(f"no scene matched {args.scene!r}")
        return 1
    for path in chosen:
        print(path.stem, flush=True)
        export_scene(path, forcing_mode=args.forcing, hours=args.hours)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
