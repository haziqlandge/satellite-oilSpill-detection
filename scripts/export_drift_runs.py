"""Run the real OpenDrift ensemble per scene and export static drift artifacts.

The console's drift has always been a simulated stand-in: an honest one, an
ensemble with diffusion that says `SIM` on every panel, but a stand-in. This
runs the real thing -- OpenDrift's OpenOil, seeded from a real detection, forced
by real ERA5 wind -- and writes what the map needs as plain files.

Static files on purpose: the frontend is a static Vite build, so a JSON per
scene under `frontDemo/public/runs/` is both the simplest thing that works and
exactly what a static host wants later (FUTURE_WORK section 4.2). The live
pipeline behind `POST /api/v1/runs` (`backend/pipeline`) writes the same files
for a run it makes; the seed rule and the frame builder live in
`backend/drift/seedrule.py` and `backend/drift/frames.py` for both.

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
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

from backend.config import REPO_ROOT
from backend.drift.frames import (
    BACKWARD_HOURS,
    FORWARD_HOURS,
    MEMBERS,
    PARTICLES_PER_MEMBER,
    RENDER_PARTICLES,
    drift_payload,
    history_frames,
    json_safe,
    ring_area_km2,
)
from backend.drift.seedrule import (
    EARTH_KM_PER_DEG_LAT,
    FRAME_EDGE_KM,
    MAX_LAND_FRACTION,
    SEED_RULE,
    NoSeedError,
    Seed,
    choose_seed_in,
    detections_bbox,
    km_per_deg_lon,
    land_fraction,
    polygon_parts,
    seed_polygon_in,
    straight_edge_km,
)

__all__ = [
    "BACKWARD_HOURS",
    "EARTH_KM_PER_DEG_LAT",
    "FORWARD_HOURS",
    "FRAME_EDGE_KM",
    "MAX_LAND_FRACTION",
    "MEMBERS",
    "OUT",
    "PARTICLES_PER_MEMBER",
    "RENDER_PARTICLES",
    "SCENES",
    "SEED_RULE",
    "Seed",
    "choose_seed",
    "export_scene",
    "history_frames",
    "json_safe",
    "km_per_deg_lon",
    "land_fraction",
    "polygon_parts",
    "ring_area_km2",
    "scene_acquired_at",
    "scene_bbox",
    "seed_polygon",
    "straight_edge_km",
    "wind_requests",
]

SCENES = REPO_ROOT / "eval" / "final" / "scenes"
OUT = REPO_ROOT / "frontDemo" / "public" / "runs"


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


def choose_seed(path: Path) -> Seed:
    """The detection to hindcast in a detection file: see `SEED_RULE`."""
    try:
        return choose_seed_in(json.loads(path.read_text()))
    except NoSeedError as error:
        raise SystemExit(f"{path.name}: {error}") from error


def seed_polygon(path: Path, seed: Seed) -> Any:
    """The seed detection's own polygon, which the parcels are spread over."""
    try:
        return seed_polygon_in(json.loads(path.read_text()), seed)
    except NoSeedError as error:
        raise SystemExit(f"{path.name}: {error}") from error


def scene_bbox(path: Path) -> tuple[tuple[float, float, float, float], int]:
    """Every ring's extent, and the feature count (`seedrule.detections_bbox`)."""
    try:
        return detections_bbox(json.loads(path.read_text()))
    except NoSeedError as error:
        raise SystemExit(f"{path.name}: {error}") from error


def wind_requests(path: Path, hours: int = BACKWARD_HOURS, forward: int = FORWARD_HOURS) -> tuple[Any, Any]:
    """The two ERA5 requests a scene's runs are forced by: before the pass, and after it.

    `export_real_scenes.py` reads the same cached files for the wind the view
    shows (`era5.run_wind_requests`). The backward window is exactly what the
    first real runs asked for, so its cache key -- and the cached file -- is
    unchanged.
    """
    from backend.ingest.metocean.era5 import run_wind_requests

    acquired = scene_acquired_at(path.stem)
    if acquired is None:
        raise SystemExit(f"{path.stem}: no acquisition time in the scene name")
    bbox, _ = scene_bbox(path)
    return run_wind_requests(bbox, acquired, hours=hours, forward=forward)


def export_scene(path: Path, *, forcing_mode: str, hours: int, verbose: bool = True) -> dict:
    from backend.drift.ensemble import run_ensemble
    from backend.drift.opendrift_runner import Forcing
    from backend.drift.origin_field import build_origin_field
    from backend.drift.seeding import points_in_polygon

    stem = path.stem
    acquired = scene_acquired_at(stem)
    if acquired is None:
        raise SystemExit(f"{stem}: no acquisition time in the scene name")
    seed = choose_seed(path)
    centre = seed.centre
    _, polygons = scene_bbox(path)
    # Every member starts from the same parcels, spread over the detected
    # slick itself. They used to start as a 500 m disc at its centre, so a
    # 9 km streak began the reconstruction -- and the view's T0 -- as a blob.
    seed_lons, seed_lats = points_in_polygon(seed_polygon(path, seed), PARTICLES_PER_MEMBER, seed=0)

    def readers_for(request: Any) -> list[Any] | None:
        if forcing_mode != "era5":
            return None
        from backend.ingest.metocean.cache import fetch_with_cache
        from backend.ingest.metocean.era5 import fetch_era5_wind, wind_only_readers

        if verbose:
            print(f"  ERA5 {request.key()[:8]} ...", flush=True)
        return wind_only_readers(fetch_with_cache(request, fetch_era5_wind))

    back_request, ahead_request = wind_requests(path, hours, FORWARD_HOURS)
    readers = readers_for(back_request)
    # None once real readers carry the forcing; `run_ensemble` takes either.
    forcing: Forcing | None = None if readers else Forcing()

    if verbose:
        print(f"  seeding {len(seed_lons)} parcels over the slick at {centre[0]:.4f}, {centre[1]:.4f}, "
              f"{acquired}Z", flush=True)
    started = time.time()
    result = run_ensemble(
        lon=seed_lons, lat=seed_lats, start=acquired, hours=hours, backward=True,
        members=MEMBERS, particles=PARTICLES_PER_MEMBER, radius_m=0.0,
        forcing=forcing, readers=readers, seed=0,
    )
    elapsed = time.time() - started
    if verbose:
        print(
            f"  ensemble {result.lon_history.shape} in {elapsed:.0f}s, "
            f"{len(result.failures)} member failure(s)",
            flush=True,
        )

    # The forecast: the same parcels and members, forward from the pass, on
    # the ERA5 wind for the hours after it. Oil that reaches the coast strands.
    ahead_readers = readers_for(ahead_request)
    started = time.time()
    ahead = run_ensemble(
        lon=seed_lons, lat=seed_lats, start=acquired, hours=FORWARD_HOURS, backward=False,
        members=MEMBERS, particles=PARTICLES_PER_MEMBER, radius_m=0.0,
        forcing=None if ahead_readers else Forcing(), readers=ahead_readers, seed=0,
    )
    ahead_elapsed = time.time() - started
    if verbose:
        print(f"  forecast {ahead.lon_history.shape} in {ahead_elapsed:.0f}s, "
              f"{len(ahead.failures)} member failure(s)", flush=True)

    payload = drift_payload(
        stem=stem, acquired=acquired, seed=seed, polygons=polygons,
        result=result, ahead=ahead,
        field=build_origin_field(result.lon_history, result.lat_history, result.times),
        ahead_field=build_origin_field(ahead.lon_history, ahead.lat_history, ahead.times),
        forcing_mode=forcing_mode, hours=hours, forward_hours=FORWARD_HOURS,
        elapsed=elapsed, ahead_elapsed=ahead_elapsed,
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
            f"({out_file.stat().st_size / 2**20:.2f} MB, {len(payload['frames'])} frames)",
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
