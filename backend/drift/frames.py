"""A drift run as the console draws it: hourly frames and the `drift.json` payload.

Moved here from `scripts/export_drift_runs.py` when the live pipeline
(`backend/pipeline`) became its second writer, so an API run and an exported
real run are the same file, read by the same view. The script re-exports every
name.

`times` DESCENDS on a backward run: row 0 is the observation, row k is k steps
BEFORE it. The sign of an hour comes from the direction, never from the row.
"""

from __future__ import annotations

import math
from datetime import datetime, timedelta
from typing import Any

import numpy as np

from backend.drift.seedrule import EARTH_KM_PER_DEG_LAT, Seed, km_per_deg_lon

# The real-run ensemble: every exported real run and every live pipeline run.
BACKWARD_HOURS = 72
# The forecast: the same parcels, run forward from the pass (FUTURE_WORK §1.3).
FORWARD_HOURS = 72
MEMBERS = 10
PARTICLES_PER_MEMBER = 200

# Rendered particles per frame. The statistics always use every particle; this
# is only what travels to the browser.
RENDER_PARTICLES = 1200


def history_frames(result: Any, field: Any, *, forward: bool) -> list[dict[str, Any]]:
    """One frame per hour of an ensemble history: rendered parcels, the 50/90% cells, spread.

    `times` descends on a backward run -- row 0 is the observation, row k is k
    steps BEFORE it -- and ascends on a forward one, so the sign of the hour
    comes from the direction, never from the row. The forward run's row 0 is
    the pass itself, which the backward run already holds; it is skipped.
    """
    from backend.drift.origin_field import contour_geojson

    times = result.times
    step_h = abs((times[1] - times[0]).total_seconds()) / 3600.0 if len(times) > 1 else 1.0
    rows_per_hour = max(1, round(1.0 / step_h))
    stride = max(1, result.lon_history.shape[1] // RENDER_PARTICLES)
    total = result.lon_history.shape[1]

    frames: list[dict[str, Any]] = []
    for row in range(0, len(times), rows_per_hour):
        hour = round(row * step_h) * (1 if forward else -1)
        if forward and hour == 0:
            continue
        adrift = np.isfinite(result.lon_history[row]) & np.isfinite(result.lat_history[row])
        lons = result.lon_history[row, ::stride]
        lats = result.lat_history[row, ::stride]
        finite = np.isfinite(lons) & np.isfinite(lats)
        lons, lats = lons[finite], lats[finite]
        if lons.size == 0:
            if forward:
                # Every parcel has stranded. The forecast says so to its horizon
                # rather than ending early: nothing afloat, so no area and no spread.
                frames.append(dict(hour=hour, particles=[], contour50=[], contour90=[], area50Km2=0.0,
                                   area90Km2=0.0, spreadKm=0.0,
                                   strandedPct=round(100.0 * (1.0 - float(adrift.sum()) / total), 2)))
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
        frame = dict(
            hour=hour,
            particles=particles,
            contour50=c50,
            contour90=c90,
            area50Km2=round(sum(ring_area_km2(r) for r in c50), 4),
            area90Km2=round(sum(ring_area_km2(r) for r in c90), 4),
            spreadKm=round(spread, 4),
        )
        if forward:
            # Parcels OpenDrift took out of the water: on a forward run with
            # `stranding`, the ones that reached the coast.
            frame["strandedPct"] = round(100.0 * (1.0 - float(adrift.sum()) / total), 2)
        frames.append(frame)
    return frames


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


def json_safe(value: Any) -> Any:
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


def on_land_pct(result: Any) -> float:
    """OpenDrift's own answer to "is this parcel ashore", over every position the run produced.

    The GSHHG polygons its landmask reader tests. The frontend's 1/240-degree
    raster cannot resolve a pass narrower than a cell, so it is not the arbiter
    of whether the physics left its coast (ISSUES F13).
    """
    from roaring_landmask import RoaringLandmask

    all_lon = result.lon_history.ravel()
    all_lat = result.lat_history.ravel()
    finite = np.isfinite(all_lon) & np.isfinite(all_lat)
    ashore = RoaringLandmask.new().contains_many(
        all_lon[finite].astype(np.float64), all_lat[finite].astype(np.float64)
    )
    return float(100.0 * np.mean(ashore)) if ashore.size else 0.0


def forcing_note(forcing_mode: str, start: datetime) -> str:
    """What forced a run, in the words every artifact carries (`forcingNote`)."""
    from backend.drift.ensemble import WIND_PHASE_SHIFT_H

    timing = f" Each member's wind is shifted in time by up to {WIND_PHASE_SHIFT_H:g} h either way (ISSUES X9)."
    if forcing_mode == "era5+cmems":
        from backend.ingest.metocean.cmems import HOURLY_DATASET, dataset_for

        dataset = dataset_for(start)
        cadence = "hourly" if dataset == HOURLY_DATASET else "daily-mean"
        return f"ERA5 10 m wind and CMEMS {cadence} surface currents ({dataset}, 1/12 deg)." + timing
    if forcing_mode == "era5":
        return "ERA5 10 m wind only; no current field (ISSUES X2)." + timing
    return "Constant forcing. With no spatially varying flow there is no convergence minimum."


def drift_payload(
    *,
    stem: str,
    acquired: datetime,
    seed: Seed,
    polygons: int,
    result: Any,
    ahead: Any,
    field: Any,
    ahead_field: Any,
    forcing_mode: str,
    hours: int,
    forward_hours: int,
    elapsed: float,
    ahead_elapsed: float,
) -> dict[str, Any]:
    """The `drift.json` a real-run view reads, from a backward and a forward ensemble."""
    from backend.drift.convergence import ConvergenceError, estimate_age

    members = result.member_count
    per_member = result.particles_per_member
    times = result.times
    step_h = abs((times[1] - times[0]).total_seconds()) / 3600.0 if len(times) > 1 else 1.0
    backward_frames = history_frames(result, field, forward=False)
    forward_frames = history_frames(ahead, ahead_field, forward=True)
    frames = sorted(backward_frames + forward_frames, key=lambda f: f["hour"])

    age: dict[str, object]
    try:
        age = estimate_age(field).as_dict()
    except ConvergenceError as error:
        # A refusal is a result (C1/C3). It is exported, not swallowed.
        age = {"method": "indeterminate", "reason": str(error)}

    return dict(
        scene=stem,
        acquiredAtIso=acquired.isoformat() + "Z",
        seed=[round(seed.centre[0], 6), round(seed.centre[1], 6)],
        seedDetection=seed.as_dict(),
        detectionPolygons=polygons,
        engine="OpenDrift OpenOil",
        forcing=forcing_mode,
        forcingNote=forcing_note(forcing_mode, acquired - timedelta(hours=hours)),
        members=members,
        particlesPerMember=per_member,
        particlesRendered=len(frames[0]["particles"]) // 2 if frames else 0,
        backwardHours=hours,
        forwardHours=forward_hours,
        seeding=(
            f"{per_member} parcels per member, spread uniformly over the seed "
            "detection's polygon; the same positions for every member"
        ),
        forwardForcingNote=(
            f"For the {forward_hours} h after the pass: {forcing_note(forcing_mode, acquired)} "
            "Parcels that reach the coast strand (OpenDrift coastline_action 'stranding')."
            if forcing_mode != "constant"
            else "Constant forcing."
        ),
        forwardMemberFailures=list(ahead.failures),
        stepMinutes=round(step_h * 60),
        memberFailures=list(result.failures),
        onLandPct=round(on_land_pct(result), 3),
        elapsedSeconds=round(elapsed, 1),
        forwardElapsedSeconds=round(ahead_elapsed, 1),
        age=age,
        # The backward field only: convergence and age are about the origin.
        convergence=[
            dict(hour=f["hour"], area90Km2=f["area90Km2"], spreadKm=f["spreadKm"]) for f in backward_frames
        ],
        frames=frames,
    )


# The view's detection rings: ~20 m, two Sentinel-1 pixels, topology preserved --
# invisible at any zoom the console uses, and 1.6-12 MB files become small.
SIMPLIFY_DEG = 0.0002


def detection_rings(document: dict[str, Any], seed: Seed, *, simplify_deg: float = SIMPLIFY_DEG) -> list[dict[str, object]]:
    """Every polygon part of a detection file as the view draws it, each saying what it is."""
    from backend.drift.seedrule import FRAME_EDGE_KM, polygon_parts, straight_edge_km

    out: list[dict[str, object]] = []
    for fi, pi, polygon, confidence in polygon_parts(document):
        simple = polygon.simplify(simplify_deg, preserve_topology=True)
        if simple.is_empty or simple.geom_type != "Polygon":
            continue
        ring = [[round(x, 5), round(y, 5)] for x, y in simple.exterior.coords]
        out.append({
            "ring": ring,
            # Which detection this part belongs to: a MultiPolygon is one
            # detection in several parts, and the view counts detections.
            "feature": fi,
            "confidence": round(confidence, 4),
            # A mask that filled its inference box (ISSUES Q5): the same
            # straight-edge test the seed rule applies, on the unsimplified part.
            "boxCut": straight_edge_km(polygon) >= FRAME_EDGE_KM,
            # The same polygon the drift seeded from, by position.
            "seed": (fi, pi) == (seed.feature, seed.part),
        })
    return out
