"""The live pipeline behind `POST /api/v1/runs`: one raster in, a real run out.

detect (two-pass) -> seed -> wind -> characterise -> CFAR -> backward and
forward OpenDrift ensembles -> origin field and age -> AIS -> verdict ->
attribution -> write. Every stage is a real computation; each one reports as it
starts and as it ends, with what it measured and how long it took, as a line
of JSON in `events.jsonl` in the run's directory. The API streams that file
(SSE); nothing about progress is timed or invented.

The run writes the SAME files the offline real-run export writes --
`drift.json` and `scene.json` (`scripts/export_drift_runs.py`,
`scripts/export_real_scenes.py`), plus `ais.json` in the shape of
`frontDemo/public/ais/real-*.json` -- so the console reads an API run with the
view it already has for the three real runs.

WHAT IT REFUSES, as results rather than errors (C3):

  * no detection meets the seed rule -> nothing to drift, and it says why;
  * attribution -> nobody is ranked. The backend's attribution engine is
    PHASE-06, not built; and the field is wind-only (no currents, ISSUES X2),
    which could not carry a ranking anyway.

Run it directly, as the API does:

    .venv/Scripts/python.exe -m backend.pipeline.run --source <raster.tif> --run-dir data/runs/<id>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import time
import traceback
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from backend.config import REPO_ROOT

WEIGHTS = REPO_ROOT / "weights" / "L1-ciou-research.pt"
EVENTS = "events.jsonl"

#: Every stage, in order, with the label the console shows before it starts.
STAGES: tuple[tuple[str, str], ...] = (
    ("input", "Read the raster"),
    ("screen", "Overview screen (pass 1)"),
    ("detect", "Segment the candidate tiles (pass 2)"),
    ("seed", "Choose the seed detection"),
    ("wind", "ERA5 wind before and after the pass"),
    ("characterise", "Characterise the seed"),
    ("cfar", "Bright targets near the seed (CFAR)"),
    ("drift_backward", "Backward ensemble (OpenDrift)"),
    ("drift_forward", "Forward forecast (OpenDrift)"),
    ("origin_field", "Origin field, convergence, age"),
    ("ais", "Real AIS around the seed"),
    ("verdict", "oos verdict"),
    ("attribute", "Rank candidates"),
    ("write", "Write the run"),
)


class StageRefusedError(RuntimeError):
    """A stage reached an honest refusal: the run ends as a result, not a failure."""

    def __init__(self, reason: str, *, outcome: str) -> None:
        super().__init__(reason)
        self.outcome = outcome


class Events:
    """Append-only JSON lines, flushed per event, so a reader tailing the file sees each one."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.seq = 0
        #: The stage last started, so a refusal or a failure can mark the rest skipped.
        self.current = "input"
        path.parent.mkdir(parents=True, exist_ok=True)

    def __call__(self, stage: str, state: str, **fields: Any) -> None:
        from backend.drift.frames import json_safe

        self.seq += 1
        event = {"seq": self.seq, "at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
                 "stage": stage, "state": state, **{k: v for k, v in fields.items() if v is not None}}
        # An unconverged age is a NaN triple (C1's honest refusal); JSON has no NaN, so it travels as null.
        line = json.dumps(json_safe(event), separators=(",", ":"), allow_nan=False)
        with self.path.open("a", encoding="utf-8") as stream:
            stream.write(line + "\n")
        print(line, flush=True)


@dataclass
class StageBox:
    """What a stage's body hands back to the event it ends with."""

    detail: str | None = None
    data: dict[str, Any] = field(default_factory=dict)
    state: str = "done"


@contextmanager
def stage(events: Events, key: str) -> Iterator[StageBox]:
    label = dict(STAGES)[key]
    started = time.perf_counter()
    events.current = key
    events(key, "running", label=label)
    box = StageBox()
    try:
        yield box
    except StageRefusedError as refusal:
        events(key, "refused", label=label, ms=round((time.perf_counter() - started) * 1000),
               detail=str(refusal), data=box.data or None)
        raise
    except Exception as error:
        events(key, "failed", label=label, ms=round((time.perf_counter() - started) * 1000),
               detail=f"{type(error).__name__}: {error}")
        raise
    events(key, box.state, label=label, ms=round((time.perf_counter() - started) * 1000),
           detail=box.detail, data=box.data or None)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def acquisition_time(path: Path, tags: dict[str, str], asserted: datetime | None) -> tuple[datetime, str]:
    """Naive UTC acquisition time, and where it came from.

    A Sentinel-1 product name carries it; a GeoTIFF may carry it as
    `TIFFTAG_DATETIME`; otherwise the operator asserts it and the run says so.
    A raster with none of the three cannot be drifted: the wind and the hours
    both hang off the pass.
    """
    match = re.search(r"(\d{8})T(\d{6})", path.stem)
    if match:
        day, clock = match.groups()
        return datetime.strptime(day + clock, "%Y%m%d%H%M%S"), "the Sentinel-1 product name"
    stamp = tags.get("TIFFTAG_DATETIME")
    if stamp:
        try:
            return datetime.strptime(stamp.strip(), "%Y:%m:%d %H:%M:%S"), "the GeoTIFF's TIFFTAG_DATETIME (UTC assumed)"
        except ValueError:
            pass
    if asserted is not None:
        naive = asserted.astimezone(UTC).replace(tzinfo=None) if asserted.tzinfo else asserted
        return naive, "asserted by the operator, not read from the file"
    raise StageRefusedError(
        "no acquisition time: not in the file name (a Sentinel-1 product name carries it), not in "
        "TIFFTAG_DATETIME, and none was given", outcome="no_time",
    )


def run_pipeline(
    source: Path,
    run_dir: Path,
    *,
    use_precomputed: bool = False,
    acquired_at: datetime | None = None,
    display_name: str | None = None,
    emit: Events | None = None,
) -> dict[str, Any]:
    """Run every stage on `source`, writing the run into `run_dir`. Returns the run summary."""
    import rasterio

    from backend.drift.frames import (
        BACKWARD_HOURS,
        FORWARD_HOURS,
        MEMBERS,
        PARTICLES_PER_MEMBER,
        SIMPLIFY_DEG,
        detection_rings,
        drift_payload,
        json_safe,
    )
    from backend.drift.seedrule import NoSeedError, choose_seed_in, detections_bbox, seed_polygon_in
    from backend.ingest.sar.geo import require_wgs84
    from ml.export.export import read_manifest

    events = emit or Events(run_dir / EVENTS)
    run_dir.mkdir(parents=True, exist_ok=True)
    name = display_name or source.name
    summary: dict[str, Any] = {"source": name, "outcome": "failed", "stages": {}}
    started_all = time.perf_counter()
    events("run", "running", label="Pipeline", data={"stages": [{"key": k, "label": v} for k, v in STAGES],
                                                     "source": name, "usePrecomputed": use_precomputed})

    def finish(outcome: str, detail: str) -> dict[str, Any]:
        summary["outcome"] = outcome
        summary["detail"] = detail
        summary["seconds"] = round(time.perf_counter() - started_all, 1)
        (run_dir / "run.json").write_text(json.dumps(json_safe(summary), indent=1, allow_nan=False), encoding="utf-8")
        events("run", "done" if outcome != "failed" else "failed", label="Pipeline",
               ms=round(summary["seconds"] * 1000), detail=detail, data={"outcome": outcome})
        return summary

    def skip_rest(after: str, why: str) -> None:
        keys = [k for k, _ in STAGES]
        for key in keys[keys.index(after) + 1:]:
            events(key, "skipped", label=dict(STAGES)[key], detail=why)

    manifest = read_manifest(WEIGHTS, expected_classes=("slick",))
    try:
        # ---- input ------------------------------------------------------------
        with stage(events, "input") as box:
            with rasterio.open(source) as raster:
                require_wgs84(raster.crs)
                width, height, count = raster.width, raster.height, raster.count
                bounds = raster.bounds
                tags = raster.tags()
                transform = raster.transform
            wanted = int(manifest["raster"]["band"])
            if count >= wanted:
                band, band_note = wanted, f"band {wanted} of {count}, taken as VV sigma0 dB (DATA.md D5)"
            else:
                band = 1
                band_note = ("its only band, taken as VV sigma0 dB"
                             + (f" (cut from band {tags['SOURCE_BAND']} of {tags.get('SOURCE_SCENE', 'a scene')})"
                                if tags.get("SOURCE_BAND") else ""))
            acquired, acquired_from = acquisition_time(source, tags, acquired_at)
            digest = sha256_file(source)
            summary["input"] = {
                "name": name, "sha256": digest, "bytes": source.stat().st_size, "width": width, "height": height,
                "bands": count, "band": band, "bandNote": band_note,
                "bounds": [bounds.left, bounds.bottom, bounds.right, bounds.top],
                "acquiredAt": acquired.isoformat() + "Z", "acquiredFrom": acquired_from,
            }
            box.data = summary["input"]
            box.detail = f"{width} x {height} px, {band_note}; acquired {acquired:%Y-%m-%d %H:%M:%S} UTC from {acquired_from}"

        # ---- detect: precomputed, or two passes -------------------------------
        tiling = manifest["tiling"]
        document: dict[str, Any]
        if use_precomputed:
            from backend.pipeline.precomputed import entry_detections, find_precomputed

            with stage(events, "screen") as box:
                box.state = "skipped"
                box.detail = "a precomputed segmentation was requested for this file"
            with stage(events, "detect") as box:
                found = find_precomputed(digest, weights_sha256=manifest["sha256"])
                if found.entry is None:
                    raise StageRefusedError(found.reason, outcome="no_precomputed")
                entry = found.entry
                document = entry_detections(entry, transform)
                document["properties"] = {
                    "precomputed": {"engine": entry["engine"], "computedAt": entry["computedAt"],
                                    "model": entry["model"], "file": entry["file"], "inferMs": entry["inferMs"]},
                    "tiles": entry["tiles"],
                }
                detection_source = (f"PRECOMPUTED: the browser segmenter ({entry['engine']}) on this exact file, "
                                    f"{entry['computedAt']}, model {entry['model']['name']} "
                                    f"{entry['model']['sha256'][:12]}; rings simplified to {SIMPLIFY_DEG} deg")
                box.detail = (f"PRECOMPUTED {entry['computedAt'][:19]}Z by {entry['engine']}: "
                              f"{len(document['features'])} detection(s)")
                box.data = {"detections": len(document["features"]), "precomputed": document["properties"]["precomputed"]}
        else:
            from backend.detect.yolo_lsk.infer import infer_scene
            from backend.device import resolve_device
            from backend.pipeline.screen import screen_raster

            with stage(events, "screen") as box:
                screened = screen_raster(source, band, tile_size=tiling["tile_size"], overlap=tiling["overlap"])
                box.data = screened.as_dict()
                box.detail = (f"{screened.regions} dark region(s) at 1/{screened.factor}; "
                              f"{len(screened.selected)} of {screened.tiles} tiles go to the model")
            with stage(events, "detect") as box:
                device = resolve_device().device
                infer_started = time.perf_counter()

                def progress(done: int, total: int) -> None:
                    events("detect", "progress", done=done, total=total,
                           ms=round((time.perf_counter() - infer_started) * 1000))

                document = infer_scene(
                    source, WEIGHTS, research=True, device="0" if device == "cuda" else "cpu",
                    progress=progress, assume_vv_db_band=band, band=band, select=screened.admits,
                )
                properties = document["properties"]
                properties["scene"] = name
                properties["screen"] = screened.as_dict()
                detection_source = (f"release model (L1-ciou research) on {name}, two-pass: "
                                    f"{properties['tiles']} of {screened.tiles} tiles after the overview screen, "
                                    f"on {device}; rings simplified to {SIMPLIFY_DEG} deg")
                box.data = {"detections": len(document["features"]), "tilesRun": properties["tiles"],
                            "tiles": screened.tiles, "device": device, "seconds": round(properties["seconds"], 2)}
                box.detail = (f"{len(document['features'])} detection(s) on {properties['tiles']} of "
                              f"{screened.tiles} tiles ({device})")
        (run_dir / "detections.geojson").write_text(json.dumps(document), encoding="utf-8")
        summary["detections"] = len(document["features"])
        summary["detectionSource"] = detection_source

        # ---- seed ------------------------------------------------------------
        with stage(events, "seed") as box:
            try:
                seed = choose_seed_in(document)
            except NoSeedError as error:
                raise StageRefusedError(f"{error}: nothing to drift", outcome="no_seed") from error
            seed_outline = seed_polygon_in(document, seed)
            bbox, polygon_count = detections_bbox(document)
            summary["seed"] = seed.as_dict() | {"centre": list(seed.centre)}
            box.data = summary["seed"]
            box.detail = (f"{seed.area_km2:.2f} km2 at {seed.centre[0]:.4f}, {seed.centre[1]:.4f}, conf "
                          f"{seed.confidence:.2f}; passed over {seed.frame_cut} box-cut, {seed.ashore} ashore")

        # ---- wind ------------------------------------------------------------
        with stage(events, "wind") as box:
            back_nc, ahead_nc, wind_from = forcing_files(bbox, acquired, hours=BACKWARD_HOURS, forward=FORWARD_HOURS)
            box.data = {"backward": back_nc.name, "forward": ahead_nc.name, "from": wind_from}
            box.detail = f"ERA5 10 m wind, {wind_from}; no current field (ISSUES X2)"

        # ---- characterise ----------------------------------------------------
        with stage(events, "characterise") as box:
            from backend.characterize.onraster import characterise_seed_on

            character = characterise_seed_on(document, seed, raster=source, wind_nc=back_nc, acquired=acquired,
                                             detection_id=f"{run_dir.name}-seed")
            box.data = {k: character[k] for k in ("lengthKm", "widthMMean", "areaKm2", "elongation", "dampingRatioDb",
                                                  "windSpeedMs", "windGateMultiplier")}
            box.detail = (f"{character['lengthKm']} km long, {character['widthMMean']} m wide, damping "
                          f"{character['dampingRatioDb']} dB (relative, C2), wind {character['windSpeedMs']} m/s, "
                          f"gate {character['windGateMultiplier']}")

        # ---- CFAR ------------------------------------------------------------
        with stage(events, "cfar") as box:
            from backend.characterize.onraster import CFAR_RADIUS_KM, cfar_near_seed

            radar = cfar_near_seed(source, seed.centre)
            targets = radar["targets"]
            assert isinstance(targets, list)
            box.data = {"targets": len(targets), "radiusKm": CFAR_RADIUS_KM}
            box.detail = f"{len(targets)} bright target(s) within {CFAR_RADIUS_KM:g} km of the seed, on this raster"

        # ---- drift -------------------------------------------------------------
        from backend.drift.ensemble import run_ensemble
        from backend.drift.origin_field import build_origin_field
        from backend.drift.seeding import points_in_polygon
        from backend.ingest.metocean.era5 import wind_only_readers

        seed_lons, seed_lats = points_in_polygon(seed_outline, PARTICLES_PER_MEMBER, seed=0)

        def members(key: str) -> Callable[[int, int], None]:
            t0 = time.perf_counter()

            def report(done: int, total: int) -> None:
                events(key, "progress", done=done, total=total, ms=round((time.perf_counter() - t0) * 1000))

            return report

        with stage(events, "drift_backward") as box:
            t0 = time.time()
            result = run_ensemble(
                lon=seed_lons, lat=seed_lats, start=acquired, hours=BACKWARD_HOURS, backward=True,
                members=MEMBERS, particles=PARTICLES_PER_MEMBER, radius_m=0.0,
                readers=wind_only_readers(back_nc), seed=0, progress=members("drift_backward"),
            )
            elapsed = time.time() - t0
            box.data = {"shape": list(result.lon_history.shape), "failures": len(result.failures)}
            box.detail = (f"{MEMBERS} members x {PARTICLES_PER_MEMBER} parcels, {BACKWARD_HOURS} h back, "
                          f"{len(result.failures)} member failure(s)")
        with stage(events, "drift_forward") as box:
            t0 = time.time()
            ahead = run_ensemble(
                lon=seed_lons, lat=seed_lats, start=acquired, hours=FORWARD_HOURS, backward=False,
                members=MEMBERS, particles=PARTICLES_PER_MEMBER, radius_m=0.0,
                readers=wind_only_readers(ahead_nc), seed=0, progress=members("drift_forward"),
            )
            ahead_elapsed = time.time() - t0
            box.data = {"shape": list(ahead.lon_history.shape), "failures": len(ahead.failures)}
            box.detail = f"the same parcels {FORWARD_HOURS} h forward, {len(ahead.failures)} member failure(s)"

        with stage(events, "origin_field") as box:
            payload = drift_payload(
                stem=run_dir.name, acquired=acquired, seed=seed, polygons=polygon_count,
                result=result, ahead=ahead,
                field=build_origin_field(result.lon_history, result.lat_history, result.times),
                ahead_field=build_origin_field(ahead.lon_history, ahead.lat_history, ahead.times),
                forcing_mode="era5", hours=BACKWARD_HOURS, forward_hours=FORWARD_HOURS,
                elapsed=elapsed, ahead_elapsed=ahead_elapsed,
            )
            (run_dir / "drift.json").write_text(
                json.dumps(json_safe(payload), separators=(",", ":"), allow_nan=False), encoding="utf-8")
            age = payload["age"]
            frames = payload["frames"]
            at_pass = next(f for f in frames if f["hour"] == 0)
            horizon = frames[0]
            last = frames[-1]
            box.data = {"age": age, "area90AtPassKm2": at_pass["area90Km2"], "area90AtHorizonKm2": horizon["area90Km2"],
                        "strandedPct": last.get("strandedPct"), "onLandPct": payload["onLandPct"]}
            converged = age.get("status") == "converged"
            triple = age.get("age_hours") or {}
            box.detail = (
                (f"converges: age {triple.get('low')} / {triple.get('best')} / {triple.get('high')} h "
                 f"({age.get('age_method')})" if converged
                 else f"never converges ({age.get('status') or age.get('method')}): no age (C1)")
                + f"; 90% region {at_pass['area90Km2']:.1f} km2 at the pass, {horizon['area90Km2']:.0f} km2 at "
                  f"{horizon['hour']} h"
            )
            summary["age"] = age

        # ---- AIS -------------------------------------------------------------
        with stage(events, "ais") as box:
            traffic = real_traffic(payload, acquired, run_dir.name)
            if traffic is None:
                box.state = "skipped"
                box.detail = ("no real AIS on this machine for these days in the Gulf AOI; marinecadastre covers "
                              "US waters only (ISSUES F14), so no vessel is shown")
            else:
                (run_dir / "ais.json").write_text(json.dumps(traffic, separators=(",", ":"), allow_nan=False),
                                                  encoding="utf-8")
                box.data = {"vessels": len(traffic["vessels"]), "rows": traffic["rows"]}
                box.detail = f"{len(traffic['vessels'])} real vessels around the seed, identities withheld"

        # ---- verdict ---------------------------------------------------------
        with stage(events, "verdict") as box:
            verdict = seed_verdict(character, targets, traffic, acquired)
            box.data = {"verdict": verdict["verdict"], "support": verdict["support"]}
            box.detail = verdict["summary"]

        # ---- attribute -------------------------------------------------------
        with stage(events, "attribute") as box:
            box.state = "refused"
            reasons = [
                "the backend attribution engine (PHASE-06) is not built",
                "the field is wind-only -- no current field (ISSUES X2) -- and could not carry a ranking",
            ]
            if age.get("status") != "converged":
                reasons.append("the backward field never converges, so there is no age to gate candidates on (C1)")
            box.detail = "Nobody is ranked (C3): " + "; ".join(reasons) + "."
            summary["attribution"] = {"ranked": 0, "insufficientEvidence": True, "reasons": reasons}
            box.data = summary["attribution"]

        # ---- write -----------------------------------------------------------
        with stage(events, "write") as box:
            scene_payload = {
                "scene": run_dir.name,
                "detections": detection_rings(document, seed),
                "cfar": radar,
                "characterisation": character,
                "detectionSource": detection_source,
                "wind": wind_series_for(back_nc, ahead_nc, seed.centre, acquired, BACKWARD_HOURS, FORWARD_HOURS),
                "verdict": verdict,
                "input": summary["input"],
            }
            (run_dir / "scene.json").write_text(
                json.dumps(json_safe(scene_payload), separators=(",", ":"), allow_nan=False), encoding="utf-8")
            written = sorted(p.name for p in run_dir.iterdir() if p.suffix in {".json", ".geojson"})
            box.data = {"files": written}
            box.detail = ", ".join(written)
        return finish("complete", "the run is complete; nobody is ranked (see attribute)")
    except StageRefusedError as refusal:
        skip_rest(events.current, f"not run: {refusal}")
        return finish(refusal.outcome, str(refusal))
    except Exception as error:
        summary["error"] = traceback.format_exc(limit=6)
        skip_rest(events.current, f"not run: {events.current} failed")
        return finish("failed", f"{type(error).__name__}: {error}")


def forcing_files(
    bbox: tuple[float, float, float, float], acquired: datetime, *, hours: int, forward: int
) -> tuple[Path, Path, str]:
    """The ERA5 files a run is forced by: an exact cache hit, a covering cached file, or a CDS fetch.

    A window cut from a processed scene asks for a smaller box than the scene's
    own runs did, so its exact key is new; the scene's cached file covers it
    (`cache.covering_path`), which keeps such a run offline-capable. Only a
    true miss goes to CDS, and `DEMO_OFFLINE=1` forbids even that.
    """
    from backend.ingest.metocean.cache import cached_path, covering_path, fetch_with_cache
    from backend.ingest.metocean.era5 import fetch_era5_wind, run_wind_requests

    paths: list[Path] = []
    how: list[str] = []
    for request in run_wind_requests(bbox, acquired, hours=hours, forward=forward):
        exact = cached_path(request)
        if exact is not None:
            paths.append(exact)
            how.append("cached")
            continue
        covering = covering_path(request)
        if covering is not None:
            paths.append(covering)
            how.append(f"cached in a covering request ({covering.name})")
            continue
        paths.append(fetch_with_cache(request, fetch_era5_wind))
        how.append("fetched from the Copernicus CDS")
    return paths[0], paths[1], "; ".join(dict.fromkeys(how))


def wind_series_for(back: Path, ahead: Path, seed: tuple[float, float], acquired: datetime,
                    hours: int, forward: int) -> dict[str, object]:
    from backend.characterize.onraster import wind_series

    return wind_series(back, ahead, seed, acquired, hours=hours, forward=forward)


def real_traffic(payload: dict[str, Any], acquired: datetime, name: str) -> dict[str, Any] | None:
    """Real AIS around the run's own reach, as `export_ais_traffic --real-runs` cuts it; None if not on disk.

    The box is every 90% contour over the hindcast plus a margin, the window as
    far back as the AIS days on this machine allow -- the same derivation the
    three exported real runs use (`real_run_scenes`).
    """
    import math
    from datetime import timedelta

    from scripts.export_ais_traffic import (
        KM_PER_DEG_LAT,
        REAL_RUN_BACKWARD_MAX_H,
        REAL_RUN_MARGIN_KM,
        Scene,
        _day_on_disk,
        export_scene,
    )

    cx, cy = float(payload["seed"][0]), float(payload["seed"][1])
    xs = [p[0] for frame in payload["frames"] for ring in frame["contour90"] for p in ring] or [cx]
    ys = [p[1] for frame in payload["frames"] for ring in frame["contour90"] for p in ring] or [cy]
    km_lon = 111.32 * math.cos(math.radians(cy))
    earliest = datetime(acquired.year, acquired.month, acquired.day)
    if not _day_on_disk(earliest):
        return None
    while _day_on_disk(earliest - timedelta(days=1)):
        earliest -= timedelta(days=1)
    available_h = int((acquired - earliest).total_seconds() // 3600)
    scene = Scene(
        acquired=acquired,
        centre=(cx, cy),
        half_width_deg=round(max(cx - min(xs), max(xs) - cx) + REAL_RUN_MARGIN_KM / km_lon, 3),
        half_height_deg=round(max(cy - min(ys), max(ys) - cy) + REAL_RUN_MARGIN_KM / KM_PER_DEG_LAT, 3),
        backward_h=min(REAL_RUN_BACKWARD_MAX_H, available_h),
        published_mmsi=None,
        note=("Live API run: the traffic around the seed. Context only; nobody is ranked, "
              "because the backend attribution engine is not built and the field is wind-only."),
        before_h=0,
        after_h=2,
    )
    try:
        return export_scene(f"api-{name}", scene)
    except FileNotFoundError:
        return None


def seed_verdict(character: dict[str, Any], targets: list[Any], traffic: dict[str, Any] | None,
                 acquired: datetime) -> dict[str, Any]:
    """The §2.4 verdict on the seed (`backend/characterize/verdict.py`), from this run's own evidence.

    A CFAR target is AIS-matched when a real vessel that reported within 10
    minutes of the pass was within 0.5 km of it then -- the console's rule
    (`realRun.ts`), on the export's kept track points. No installations are
    listed for these waters, and no vessel was scored against the origin field.
    """
    from backend.characterize.verdict import (
        VerdictInputs,
        haversine_km,
        nearest_end_target,
        verdict_from,
    )

    passing: list[tuple[float, float]] = []
    for vessel in (traffic or {}).get("vessels", []):
        t = vessel["t"]
        if not any(abs(v) <= 600 for v in t):
            continue
        passing.append(position_at(t, vessel["lon"], vessel["lat"], 0))
    matched_targets = [
        (tuple(target["position"]), any(haversine_km(tuple(target["position"]), p) <= 0.5 for p in passing))
        for target in targets
    ]
    end = nearest_end_target(tuple(character["head"]), tuple(character["tail"]), matched_targets)  # type: ignore[arg-type]
    wind = character["windSpeedMs"]
    verdict = verdict_from(VerdictInputs(
        elongation=float(character["elongation"]),
        length_km=float(character["lengthKm"]),
        width_profile_m=list(character["widthMProfile"]),
        end_target=end,
        wind_speed_ms=float(wind) if wind is not None else float("nan"),
        wind_gate=float(character["windGateMultiplier"] or 0.0),
        damping_ratio_db=character["dampingRatioDb"],
        best_vessel_drift=None,
    ))
    return {
        "verdict": verdict.verdict,
        "support": round(verdict.support, 4),
        "caution": verdict.caution,
        "summary": verdict.summary,
        "terms": [{"key": t.key, "label": t.label, "value": None if t.value is None else round(t.value, 4),
                   "detail": t.detail} for t in verdict.terms],
        "source": "backend/characterize/verdict.py, the console's verdict twin; thresholds uncalibrated (ISSUES F19)",
    }


def position_at(t: list[int], lon: list[float], lat: list[float], at: int) -> tuple[float, float]:
    """Linear between the kept points either side of `at`, clamped at the ends (`ais.ts` `positionAt`)."""
    if at <= t[0]:
        return lon[0], lat[0]
    if at >= t[-1]:
        return lon[-1], lat[-1]
    for i in range(1, len(t)):
        if t[i] >= at:
            f = (at - t[i - 1]) / max(1, t[i] - t[i - 1])
            return lon[i - 1] + (lon[i] - lon[i - 1]) * f, lat[i - 1] + (lat[i] - lat[i - 1]) * f
    return lon[-1], lat[-1]


def main(argv: list[str] | None = None) -> int:
    from dotenv import load_dotenv

    load_dotenv(REPO_ROOT / ".env")
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", type=Path, required=True, help="a georeferenced sigma0 dB GeoTIFF (EPSG:4326)")
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--use-precomputed", action="store_true",
                        help="use the stored segmentation for this exact file and model (FUTURE_WORK §1.5)")
    parser.add_argument("--acquired-at", help="ISO-8601 UTC, when neither the name nor the file carries it")
    parser.add_argument("--name", help="the name to show for the input")
    args = parser.parse_args(argv)
    asserted = datetime.fromisoformat(args.acquired_at.replace("Z", "+00:00")) if args.acquired_at else None
    summary = run_pipeline(args.source, args.run_dir, use_precomputed=args.use_precomputed,
                           acquired_at=asserted, display_name=args.name)
    return 0 if summary["outcome"] != "failed" else 1


if __name__ == "__main__":
    sys.exit(main())
