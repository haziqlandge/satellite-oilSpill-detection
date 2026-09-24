"""The live pipeline's parts: pass one of two-pass detection, the precomputed contract,
the forcing cache's covering lookup, the seed rule's floor, and how a refusal ends a run.

The whole chain on a real scene takes minutes (OpenDrift) and is measured, not
unit-tested: `scripts/measure_two_pass.py` and the run recorded in
`PREVIOUS_WORK.md`.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import pytest
import rasterio
from affine import Affine
from rasterio.transform import from_origin

from backend.pipeline.precomputed import decode_runs, entry_detections, find_precomputed
from backend.pipeline.run import StageRefusedError, acquisition_time, position_at
from backend.pipeline.screen import MIN_FACTOR, read_overview, screen_overview


def test_acquisition_time_comes_from_the_name_then_the_tag_then_the_operator(tmp_path: Path) -> None:
    named = tmp_path / "S1A_IW_GRDH_1SDV_20230409T000206_x.tif"
    assert acquisition_time(named, {}, None) == (datetime(2023, 4, 9, 0, 2, 6), "the Sentinel-1 product name")
    tagged, source = acquisition_time(tmp_path / "x.tif", {"TIFFTAG_DATETIME": "2023:05:15 00:02:08"}, None)
    assert tagged == datetime(2023, 5, 15, 0, 2, 8) and "TIFFTAG_DATETIME" in source
    asserted, source = acquisition_time(tmp_path / "x.tif", {}, datetime(2023, 1, 1, 12, tzinfo=UTC))
    assert asserted == datetime(2023, 1, 1, 12) and asserted.tzinfo is None and "operator" in source
    with pytest.raises(StageRefusedError) as refusal:
        acquisition_time(tmp_path / "x.tif", {}, None)
    assert refusal.value.outcome == "no_time"


def test_an_event_carrying_a_refused_age_is_still_valid_json(tmp_path: Path) -> None:
    from backend.pipeline.run import Events

    events = Events(tmp_path / "events.jsonl")
    events("origin_field", "done", data={"age": {"age_hours": {"low": float("nan"), "best": float("nan")}}})
    line = (tmp_path / "events.jsonl").read_text().strip()
    assert json.loads(line)["data"]["age"]["age_hours"] == {"low": None, "best": None}


def test_a_vessel_position_at_the_pass_is_interpolated_and_clamped() -> None:
    t, lon, lat = [-600, 0, 600], [0.0, 1.0, 3.0], [10.0, 10.0, 12.0]
    assert position_at(t, lon, lat, 300) == (2.0, 11.0)
    assert position_at(t, lon, lat, -900) == (0.0, 10.0)
    assert position_at(t, lon, lat, 900) == (3.0, 12.0)


# ---- two-pass, pass one --------------------------------------------------------

def _sea(height: int, width: int, seed: int = 0) -> np.ndarray:
    """Linear sigma0 of an averaged sea: -12 dB with a little residual speckle."""
    rng = np.random.default_rng(seed)
    return 10 ** (-1.2) * rng.gamma(64, 1 / 64, (height, width))


def test_the_screen_sends_only_the_tiles_over_a_dark_region() -> None:
    overview = _sea(64, 96)
    overview[20:26, 70:80] *= 10 ** (-0.6)  # a 6 dB slick
    screen = screen_overview(overview, 16, width=96 * 16, height=64 * 16, tile_size=1024, overlap=0.1,
                             pixel_deg=9e-5, lat=28.5)
    assert screen.regions == 1
    assert 0 < len(screen.selected) < screen.tiles
    # Every selected tile overlaps the slick; the slick's tiles are all selected.
    for row, col in screen.selected:
        assert row < 26 * 16 and row + 1024 > 20 * 16 and col < 80 * 16 and col + 1024 > 70 * 16


def test_a_uniform_sea_sends_nothing_and_a_speck_is_not_a_region() -> None:
    overview = _sea(64, 96, seed=1)
    overview[30, 40] *= 0.1  # one dark overview pixel: speckle, not a slick
    screen = screen_overview(overview, 16, width=96 * 16, height=64 * 16, tile_size=1024, overlap=0.1,
                             pixel_deg=9e-5, lat=28.5)
    assert screen.regions == 0 and screen.selected == frozenset()
    assert screen.as_dict()["tilesSelected"] == 0


def test_the_overview_averages_linear_power_and_ignores_the_fill(tmp_path: Path) -> None:
    path = tmp_path / "scene.tif"
    data = np.full((2, 32, 32), -10.0, dtype=np.float32)
    data[1, :, :16] = -20.0
    data[1, :8, :8] = 0.0  # SNAP's zero fill: no data, not dark water
    data[1, 8:16, 16:24] = np.where(np.arange(8)[None, :] % 2 == 0, -10.0, -20.0)
    with rasterio.open(path, "w", driver="GTiff", width=32, height=32, count=2, dtype="float32", crs="EPSG:4326",
                       transform=from_origin(-89.5, 28.5, 9e-5, 9e-5)) as out:
        out.write(data)
    overview, factor, _ = read_overview(path, 2)
    assert factor == MIN_FACTOR and overview.shape == (4, 4)
    assert np.isnan(overview[0, 0])
    assert overview[2, 0] == pytest.approx(0.01)
    # Half -10 dB and half -20 dB is the mean of the POWERS, not -15 dB.
    assert overview[1, 2] == pytest.approx((0.1 + 0.01) / 2)


# ---- the precomputed contract ----------------------------------------------------

def _entry(tmp_path: Path, *, model: str = "onnx-sha") -> tuple[Path, Path]:
    mask = np.zeros((6, 8), dtype=np.uint8)
    mask[1:3, 1:4] = 1
    mask[4:6, 5:8] = 1
    flat = mask.ravel()
    runs, value, length = [], 0, 0
    for v in flat:
        if v == value:
            length += 1
        else:
            runs.append(length)
            value, length = int(v), 1
    runs.append(length)
    directory = tmp_path / "precomputed"
    directory.mkdir(parents=True)
    entry = {"version": 1, "file": "x.tif", "sha256": "abc", "width": 8, "height": 6, "maskRuns": runs,
             "model": {"name": "L1", "sha256": model}, "engine": "wasm", "computedAt": "2026-09-23T00:00:00Z",
             "inferMs": 5, "tiles": 1,
             "detections": [{"box": [1, 1, 4, 3], "score": 0.7, "pixels": 6}, {"box": [5, 4, 8, 6], "score": 0.4,
                                                                               "pixels": 6}]}
    (directory / "x.json").write_text(json.dumps(entry))
    (directory / "index.json").write_text(json.dumps({"version": 1, "entries": {"abc": "x.json"}}))
    manifest = tmp_path / "onnx.json"
    manifest.write_text(json.dumps({"sha256": "onnx-sha", "source_weights_sha256": "weights-sha"}))
    return directory, manifest


def test_run_lengths_decode_as_the_browser_encodes_them() -> None:
    assert decode_runs([2, 3, 1], 6).tolist() == [0, 0, 1, 1, 1, 0]
    assert decode_runs([0, 2], 2).tolist() == [1, 1]
    with pytest.raises(ValueError):
        decode_runs([2, 3], 6)


def test_a_stored_result_is_used_only_for_these_bytes_and_this_model(tmp_path: Path) -> None:
    directory, manifest = _entry(tmp_path)
    ok = find_precomputed("abc", weights_sha256="weights-sha", directory=directory, onnx_manifest=manifest)
    assert ok.ok
    for sha, weights, why in (("zzz", "weights-sha", "no precomputed result exists"),
                              ("abc", "other", "not exported from the release weights")):
        refused = find_precomputed(sha, weights_sha256=weights, directory=directory, onnx_manifest=manifest)
        assert not refused.ok and why in refused.reason
    stale, stale_manifest = _entry(tmp_path / "stale", model="an-older-model")
    refused = find_precomputed("abc", weights_sha256="weights-sha", directory=stale, onnx_manifest=stale_manifest)
    assert "different model" in refused.reason


def test_a_stored_mask_becomes_georeferenced_detections_with_their_scores(tmp_path: Path) -> None:
    from shapely.geometry import shape

    directory, manifest = _entry(tmp_path)
    entry = find_precomputed("abc", weights_sha256="weights-sha", directory=directory, onnx_manifest=manifest).entry
    assert entry is not None
    transform = Affine(0.001, 0, -89.0, 0, -0.001, 29.0)
    document = entry_detections(entry, transform)
    assert len(document["features"]) == 2
    by_score = sorted(document["features"], key=lambda f: -f["properties"]["confidence"])
    assert [f["properties"]["confidence"] for f in by_score] == [0.7, 0.4]
    assert shape(by_score[0]["geometry"]).bounds == pytest.approx((-88.999, 28.997, -88.996, 28.999))
    assert all(f["properties"]["class_name"] == "slick" for f in by_score)


# ---- the forcing cache's covering lookup -----------------------------------------

def test_a_cached_file_covering_a_smaller_request_answers_it(tmp_path: Path) -> None:
    import xarray as xr

    from backend.ingest.metocean.cache import covering_path
    from backend.ingest.metocean.era5 import wind_request

    times = np.array([np.datetime64("2023-04-05T00:00") + np.timedelta64(h, "h") for h in range(120)])
    lats, lons = np.arange(30.5, 27.24, -0.25), np.arange(-90.75, -87.49, 0.25)
    shape = (times.size, lats.size, lons.size)
    ds = xr.Dataset({"u10": (("valid_time", "latitude", "longitude"), np.zeros(shape)),
                     "v10": (("valid_time", "latitude", "longitude"), np.zeros(shape))},
                    coords={"valid_time": times, "latitude": lats, "longitude": lons})
    ds.to_netcdf(tmp_path / "era5-wind_scene.nc")
    inside = wind_request(west=-89.7, south=29.5, east=-89.6, north=29.6,
                          start=datetime(2023, 4, 6), end=datetime(2023, 4, 9))
    # The box asks for 30.6 N; the file stops at 30.5 as CDS snapped it: one grid step is tolerated.
    assert covering_path(inside, cache_dir=tmp_path) == tmp_path / "era5-wind_scene.nc"
    too_late = wind_request(west=-89.7, south=29.5, east=-89.6, north=29.6,
                            start=datetime(2023, 4, 8), end=datetime(2023, 4, 11))
    assert covering_path(too_late, cache_dir=tmp_path) is None
    elsewhere = wind_request(west=-80.0, south=29.5, east=-79.9, north=29.6,
                             start=datetime(2023, 4, 6), end=datetime(2023, 4, 9))
    assert covering_path(elsewhere, cache_dir=tmp_path) is None


# ---- the seed rule's floor -------------------------------------------------------

def test_a_detection_too_small_to_characterise_is_never_the_seed() -> None:
    pytest.importorskip("roaring_landmask")
    from backend.drift.seedrule import MIN_SEED_KM2, NoSeedError, choose_seed_in
    from tests.test_export_drift_runs import PIXEL, SEA

    def square(lon: float, lat: float, px: int) -> list[list[float]]:
        d = px * PIXEL
        # A diamond: no edge along the pixel grid, so only its size can rule it out.
        return [[lon, lat - d], [lon + d, lat], [lon, lat + d], [lon - d, lat], [lon, lat - d]]

    tiny = {"type": "FeatureCollection", "features": [
        {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [square(*SEA, 3)]},
         "properties": {"confidence": 0.9}}]}
    with pytest.raises(NoSeedError, match=f"under {MIN_SEED_KM2} km2"):
        choose_seed_in(tiny)
    tiny["features"].insert(0, {"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [
        square(SEA[0] + 0.05, SEA[1], 40)]}, "properties": {"confidence": 0.5}})
    seed = choose_seed_in(tiny)
    assert seed.feature == 0 and seed.small == 1 and seed.as_dict()["passedOver"]["tooSmall"] == 1


# ---- a refusal ends the run as a result --------------------------------------------

def test_a_refused_stage_skips_the_rest_and_the_run_still_finishes(tmp_path: Path) -> None:
    from backend.pipeline.run import WEIGHTS, run_pipeline

    if not WEIGHTS.exists():
        pytest.skip("the release weights are not on this machine")
    raster = tmp_path / "S1A_IW_GRDH_1SDV_20230409T000206_x.tif"
    with rasterio.open(raster, "w", driver="GTiff", width=16, height=16, count=2, dtype="float32", crs="EPSG:4326",
                       transform=from_origin(-89.5, 28.5, 9e-5, 9e-5)) as out:
        out.write(np.full((2, 16, 16), -20.0, dtype=np.float32))
    summary = run_pipeline(raster, tmp_path / "run", use_precomputed=True)
    assert summary["outcome"] == "no_precomputed"
    events = [json.loads(line) for line in (tmp_path / "run" / "events.jsonl").read_text().splitlines()]
    states = {e["stage"]: e["state"] for e in events if e["state"] != "progress"}
    assert states["input"] == "done" and states["screen"] == "skipped" and states["detect"] == "refused"
    assert states["seed"] == states["write"] == "skipped"
    assert events[-1]["stage"] == "run" and events[-1]["state"] == "done"
    assert json.loads((tmp_path / "run" / "run.json").read_text())["outcome"] == "no_precomputed"
