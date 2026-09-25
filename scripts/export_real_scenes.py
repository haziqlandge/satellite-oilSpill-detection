"""Export what a real-run view needs besides the drift: detections and wind.

`export_drift_runs.py` writes OpenDrift's backward field for each full scene in
`eval/final/scenes/`. A console view of that run also needs the slicks the
model actually found in the scene, and the wind the drift actually ran
through, so both are written beside it as `frontDemo/public/runs/<scene>/scene.json`.

* **Detections** are the release model's full-scene output, every polygon with
  its confidence. They follow pixel edges, which makes the files 1.6-12 MB; each
  ring is simplified to 0.0002 degrees (~20 m, two Sentinel-1 pixels) with its
  topology preserved, which is invisible at any zoom the console uses. The
  polygon the drift was seeded from (`choose_seed`) is flagged, and so is every
  polygon that filled its inference box (`boxCut`, ISSUES Q5), so the view can
  tell a traced slick from a rectangle.
* **Radar targets** come from CA-CFAR (`backend/detect/cfar`) on the processed
  sigma0 scene, band 2, within 15 km of the seed: the bright returns a vessel or
  an installation makes, which the downstream oos verdict looks for at the ends
  of the slick (`frontDemo/src/sim/verdict.ts`). Needs the 3.6 GB scene; without
  it the file says CFAR was not run rather than that nothing was there.
* **Wind** is read from the SAME cached ERA5 requests the drift used -- the
  72 h before the pass for the hindcast, the 72 h after it for the forecast
  (`wind_requests`) -- at the seed, hour by hour. `DEMO_OFFLINE=1` is set so this can only read the cache:
  a wind series that was fetched separately would not be the wind the particles
  felt. What moved the water is the drift's own `forcingNote` (CMEMS currents,
  or none, ISSUES X2), never zeros that look like a measurement.
* **Characterisation** of the seed detection is the backend's PHASE-03 record
  (`backend/characterize`): geometry measured from the unsimplified polygon in
  an equal-area projection, the damping ratio against clean sea on the same
  processed scene and band (land from GSHHG, every other detection and SNAP's
  zero fill kept out of the annulus), and the wind gate from the backward
  request's ERA5 at the seed at the pass. Without the scene the damping is
  written as not measured, never as a number.

    .venv/Scripts/python.exe -m scripts.export_real_scenes
"""

from __future__ import annotations

import json
import os
from datetime import timedelta
from pathlib import Path

from backend.characterize.onraster import (
    CFAR_RADIUS_KM,
    cfar_near_seed,
    characterise_seed_on,
    seed_damping,
    wind_series,
)
from backend.drift.frames import SIMPLIFY_DEG, detection_rings
from scripts.export_drift_runs import (
    BACKWARD_HOURS,
    FORWARD_HOURS,
    OUT,
    SCENES,
    choose_seed,
    scene_acquired_at,
    wind_requests,
)

__all__ = ["CFAR_RADIUS_KM", "cfar_near_seed", "characterise_seed", "detections", "seed_damping", "wind"]

SAR = Path(__file__).resolve().parents[1] / "data" / "processed" / "sar"


def characterise_seed(path: Path, *, raster: Path | None = None) -> dict[str, object]:
    """The backend characterisation (PHASE-03) of the detection the drift was seeded from."""

    from backend.ingest.metocean.cache import resolve
    from backend.ingest.metocean.era5 import fetch_era5_wind

    seed = choose_seed(path)
    acquired = scene_acquired_at(path.stem)
    assert acquired is not None
    raster = raster if raster is not None else SAR / f"{path.stem}.tif"
    back, _ = wind_requests(path)
    os.environ["DEMO_OFFLINE"] = "1"
    return characterise_seed_on(
        json.loads(path.read_text()), seed, raster=raster,
        wind_nc=resolve(back, fetch_era5_wind, fetched_from="CDS")[0], acquired=acquired, detection_id=f"{path.stem}-seed",
    )


def detections(path: Path) -> list[dict[str, object]]:
    return detection_rings(json.loads(path.read_text()), choose_seed(path), simplify_deg=SIMPLIFY_DEG)


def wind(path: Path, current_note: str) -> dict[str, object]:
    from backend.ingest.metocean.cache import resolve
    from backend.ingest.metocean.era5 import fetch_era5_wind

    acquired = scene_acquired_at(path.stem)
    assert acquired is not None
    # Exactly the requests `export_drift_runs.export_scene` made.
    back, ahead = wind_requests(path)
    os.environ["DEMO_OFFLINE"] = "1"
    return wind_series(
        resolve(back, fetch_era5_wind, fetched_from="CDS")[0], resolve(ahead, fetch_era5_wind, fetched_from="CDS")[0],
        choose_seed(path).centre, acquired, hours=BACKWARD_HOURS, forward=FORWARD_HOURS, current_note=current_note,
    )


def flow(path: Path, drift: dict[str, object]) -> dict[str, object]:
    """Wind and current around the run for the console's arrows, from the files the drift ran on (`backend/drift/flow.py`)."""
    from backend.drift.flow import flow_grid
    from backend.ingest.metocean.cache import resolve
    from backend.ingest.metocean.cmems import currents_for, source_label
    from backend.ingest.metocean.era5 import fetch_era5_wind

    acquired = scene_acquired_at(path.stem)
    assert acquired is not None
    back, ahead = wind_requests(path)
    os.environ["DEMO_OFFLINE"] = "1"
    back_current = ahead_current = None
    if drift.get("forcing") == "era5+cmems":
        from scripts.export_drift_runs import scene_bbox

        bbox, _ = scene_bbox(path)
        back_current, ahead_current, _ = currents_for(bbox, acquired, hours=BACKWARD_HOURS, forward=FORWARD_HOURS)
    return flow_grid(
        drift,
        back_wind=resolve(back, fetch_era5_wind, fetched_from="CDS")[0],
        ahead_wind=resolve(ahead, fetch_era5_wind, fetched_from="CDS")[0],
        back_current=back_current, ahead_current=ahead_current,
        current_source=source_label(acquired - timedelta(hours=BACKWARD_HOURS)),
    )


def main() -> int:
    for path in sorted(SCENES.glob("*.geojson")):
        target = OUT / path.stem
        if not (target / "drift.json").exists():
            print(f"{path.stem[:32]}: no drift.json; run export_drift_runs first")
            continue
        found = detections(path)
        drift = json.loads((target / "drift.json").read_text())
        series = wind(path, drift["forcingNote"])
        radar = cfar_near_seed(SAR / f"{path.stem}.tif", choose_seed(path).centre)
        character = characterise_seed(path)
        payload = {
            "scene": path.stem,
            "detections": found,
            "cfar": radar,
            "characterisation": character,
            "detectionSource": "release model (L1-ciou research) on the full scene, eval/final/scenes; "
                               f"rings simplified to {SIMPLIFY_DEG} deg",
            "wind": series,
            "flow": flow(path, drift),
        }
        out = target / "scene.json"
        out.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False), encoding="utf-8")
        seeds = sum(1 for d in found if d["seed"])
        hours = series["hours"]
        assert isinstance(hours, list)
        features = len({d["feature"] for d in found})
        boxes = sum(1 for d in found if d["boxCut"])
        print(f"{path.stem[17:32]}: seed {character['lengthKm']} km long, {character['widthMMean']} m wide, "
              f"damping {character['dampingRatioDb']} dB, wind {character['windSpeedMs']} m/s "
              f"(gate {character['windGateMultiplier']}), Fay prior "
              f"{character['agePrior']['lowHours']}-{character['agePrior']['highHours']} h")  # type: ignore[index]
        print(f"{path.stem[17:32]}: CFAR {radar['status']}, {len(radar['targets'])} targets within "  # type: ignore[arg-type]
              f"{CFAR_RADIUS_KM:.0f} km of the seed")
        print(f"{path.stem[17:32]}: {features} detections, {len(found)} polygons ({seeds} seed, {boxes} box-filled), "
              f"{len(hours)} wind hours, {out.stat().st_size / 1024:.0f} KB")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
