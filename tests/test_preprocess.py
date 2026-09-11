"""SNAP invocation logic that must hold without a SNAP install present."""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from backend.ingest.sar.preprocess import (
    DEFAULT_GRAPH,
    EXPECTED_EPSG,
    SnapNotFoundError,
    build_command,
    check_has_data,
    find_gpt,
    partial_target,
    summarise_snap_failure,
)


def test_default_graph_exists_and_is_the_p004_chain() -> None:
    """The graph shipped in the repo must be the one the module defaults to."""

    assert DEFAULT_GRAPH.is_file(), f"missing graph at {DEFAULT_GRAPH}"
    text = DEFAULT_GRAPH.read_text(encoding="utf-8")
    for operator in (
        "Apply-Orbit-File",
        "Calibration",
        "Speckle-Filter",
        "Land-Sea-Mask",
        "Terrain-Correction",
    ):
        assert operator in text, f"graph is missing the {operator} step"
    assert "${source}" in text and "${target}" in text


def test_build_command_passes_graph_parameters_and_heap(tmp_path: Path) -> None:
    gpt = tmp_path / "gpt.exe"
    source = tmp_path / "scene.SAFE"
    target = tmp_path / "out" / "scene.tif"

    command = build_command(gpt, source, target, max_heap_gb=6)

    assert command[0] == str(gpt)
    assert command[1] == str(DEFAULT_GRAPH)
    assert f"-Psource={source}" in command
    # gpt writes to `<target>.partial`; `run_graph` renames on success only, so a
    # killed run cannot leave something the skip-if-exists path treats as done.
    assert f"-Ptarget={partial_target(target)}" in command
    assert "-J-Xmx6G" in command, "heap must be set explicitly, not left to the SNAP default"
    assert not any("snap.userdir" in part for part in command), (
        "snap.userdir is SNAP's home, not a cache override -- setting it to the output "
        "directory scatters auxdata/etc/var among the results and re-downloads every DEM tile"
    )


def test_find_gpt_rejects_an_explicit_path_that_does_not_exist(tmp_path: Path) -> None:
    with pytest.raises(SnapNotFoundError, match="not found at the given path"):
        find_gpt(tmp_path / "nope" / "gpt.exe")


def test_find_gpt_reports_a_bad_snap_gpt_env_var(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("SNAP_GPT", str(tmp_path / "missing_gpt.exe"))
    with pytest.raises(SnapNotFoundError, match="SNAP_GPT is set"):
        find_gpt()


def test_find_gpt_prefers_snap_gpt_env_var(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    stub = tmp_path / "gpt.exe"
    stub.write_text("", encoding="utf-8")
    monkeypatch.setenv("SNAP_GPT", str(stub))

    assert find_gpt() == stub


def test_check_has_data_rejects_an_empty_raster(tmp_path: Path) -> None:
    """An all-zero output passed every geometry check once. Never again."""

    import numpy as np
    import rasterio
    from rasterio.transform import from_origin

    path = tmp_path / "empty.tif"
    with rasterio.open(
        path, "w", driver="GTiff", width=64, height=64, count=1,
        dtype="float32", transform=from_origin(-90, 29, 0.001, 0.001),
    ) as dst:
        dst.write(np.zeros((64, 64), dtype="float32"), 1)

    ok, description = check_has_data(path)
    assert ok is False
    assert "zero" in description


def test_check_has_data_accepts_a_populated_raster(tmp_path: Path) -> None:
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin

    path = tmp_path / "full.tif"
    data = np.full((64, 64), -12.5, dtype="float32")
    with rasterio.open(
        path, "w", driver="GTiff", width=64, height=64, count=1,
        dtype="float32", transform=from_origin(-90, 29, 0.001, 0.001),
    ) as dst:
        dst.write(data, 1)

    ok, _ = check_has_data(path)
    assert ok is True


def test_discard_partial_removes_a_truncated_output(tmp_path: Path) -> None:
    """A timeout leaves a partial product that would be skipped as 'done'."""

    from backend.ingest.sar.preprocess import _discard_partial

    partial = tmp_path / "scene_s0db.tif"
    partial.write_bytes(b"truncated")

    _discard_partial(partial)

    assert not partial.exists()


def test_discard_partial_is_safe_when_nothing_is_there(tmp_path: Path) -> None:
    from backend.ingest.sar.preprocess import _discard_partial

    _discard_partial(tmp_path / "never_written.tif")  # must not raise


def test_default_timeout_allows_a_full_iw_scene() -> None:
    """One hour is not enough: a real scene was still running at 60 minutes."""

    from backend.ingest.sar.preprocess import DEFAULT_TIMEOUT_S

    assert DEFAULT_TIMEOUT_S >= 2 * 60 * 60


def test_expected_epsg_is_4326() -> None:
    """AIS is lon/lat; anything else silently breaks proximity scoring."""

    assert EXPECTED_EPSG == 4326


def test_map_projection_is_snaps_crs_name_not_an_epsg_string() -> None:
    """`EPSG:4326` in `mapProjection` silently produces a zero-size target.

    SNAP wants its own CRS name. With an "EPSG:nnnn" string it builds a
    degenerate CRS and fails at graph init with `/ by zero`, which looks like
    a data or install problem and is neither. Cost hours once; never again.
    """

    text = DEFAULT_GRAPH.read_text(encoding="utf-8")
    # Match the element value only; the surrounding comment explains the trap
    # and necessarily mentions "EPSG:" itself.
    values = re.findall(r"<mapProjection>([^<]*)</mapProjection>", text)

    assert values, "graph declares no mapProjection"
    for value in values:
        assert value == "WGS84(DD)", f"mapProjection must be WGS84(DD), got {value!r}"


def test_terrain_correction_keeps_sea_pixels() -> None:
    """`nodataValueAtSea` defaults to true and would null the whole scene.

    SRTM has no data over water, so on a marine scene the default produces an
    output that is correctly sized, correctly georeferenced and entirely zero.
    The sea is the signal here.
    """

    text = DEFAULT_GRAPH.read_text(encoding="utf-8")
    tc_block = text.split("Terrain-Correction", 1)[1].split("</node>", 1)[0]
    assert "<nodataValueAtSea>false</nodataValueAtSea>" in tc_block


def test_land_sea_mask_has_no_geometry_parameter() -> None:
    """`geometry` applies only when useSRTM is false.

    With useSRTM=true SNAP parses the value as a band-arithmetic expression, so
    a placeholder there fails the whole graph with "Undefined symbol". This
    actually happened on the Case 1 fixture.
    """

    text = DEFAULT_GRAPH.read_text(encoding="utf-8")
    land_mask_block = text.split("Land-Sea-Mask", 1)[1].split("</node>", 1)[0]
    assert "<geometry>" not in land_mask_block


def test_summarise_snap_failure_surfaces_the_cause_not_the_stack() -> None:
    """A plain tail of gpt output shows only `at org.esa...` frames."""

    output = "\n".join(
        [
            "INFO: starting",
            "Error: [NodeId: Land-Sea-Mask] expression: Undefined symbol '0,0'.",
            "org.esa.snap.core.gpf.graph.GraphException: [NodeId: Land-Sea-Mask] boom",
            *[f"\tat org.esa.snap.core.jexp.impl.ParserImpl.parse{n}(ParserImpl.java:{n})" for n in range(40)],
        ]
    )

    summary = summarise_snap_failure(output)

    assert "Undefined symbol '0,0'" in summary
    assert "at org.esa" not in summary


def test_summarise_snap_failure_falls_back_to_the_tail() -> None:
    """Unrecognised output must still produce something, not an empty string."""

    summary = summarise_snap_failure("weird\noutput\nwith no markers")
    assert "output" in summary


def test_graph_is_well_formed_xml() -> None:
    """A malformed graph must fail here, not four hours into a scene.

    Caught for real on 2026-08-30: a `--` inside an XML comment (illegal in XML)
    made `gpt` die at graph init with an XStream parser trace. Nothing in the
    suite parsed the graph, so the only way to find it was to start a run.
    """

    import xml.etree.ElementTree as ElementTree

    ElementTree.parse(DEFAULT_GRAPH)


def _graph_chain() -> list[str]:
    """Node ids in source order, plus the source each node reads from."""

    import xml.etree.ElementTree as ElementTree

    root = ElementTree.parse(DEFAULT_GRAPH).getroot()
    return [node.get("id", "") for node in root.findall("node")]


def test_db_conversion_is_the_last_step_before_write() -> None:
    """sigma0 -> dB must happen after speckle filtering and terrain correction.

    Speckle is multiplicative in the linear domain, which is what Refined Lee
    assumes, and Terrain-Correction resamples -- averaging power in dB is a
    geometric mean and biases interpolated pixels low. Recorded in
    PLAN/CONSTRAINTS.md, decided with the user 2026-08-30.
    """

    chain = _graph_chain()

    assert "LinearToFromdB" in chain, "the chain no longer converts sigma0 to dB"
    assert chain.index("LinearToFromdB") > chain.index("Speckle-Filter")
    assert chain.index("LinearToFromdB") > chain.index("Terrain-Correction")
    assert chain[-1] == "Write" and chain[-2] == "LinearToFromdB"


def test_write_reads_from_the_db_node() -> None:
    """Appending a node is not enough -- Write must actually consume it."""

    import xml.etree.ElementTree as ElementTree

    root = ElementTree.parse(DEFAULT_GRAPH).getroot()
    write = next(n for n in root.findall("node") if n.get("id") == "Write")
    source = write.find("sources/sourceProduct")
    assert source is not None
    assert source.get("refid") == "LinearToFromdB"


def test_calibration_does_not_ask_for_db_output() -> None:
    """`outputImageScaleInDb=true` is silently ignored by SNAP.

    Measured 2026-08-30 on the Case 1 fixture: calibrating a subset with the
    flag true and with it false produced byte-identical rasters, both linear.
    The graph must not claim a conversion that does not happen -- the real one
    is the LinearToFromdB node at the end.
    """

    import xml.etree.ElementTree as ElementTree

    root = ElementTree.parse(DEFAULT_GRAPH).getroot()
    calibration = next(n for n in root.findall("node") if n.get("id") == "Calibration")
    flag = calibration.find("parameters/outputImageScaleInDb")
    assert flag is not None and (flag.text or "").strip() == "false"


def test_run_graph_writes_through_a_partial_name(tmp_path: Path) -> None:
    """An externally killed run must not leave a file that looks finished.

    Happened for real on 2026-08-30: the batch process was killed 69 minutes into
    Case 1, leaving a 3.46 GB truncated raster where a complete one is ~5.6 GB.
    `_discard_partial` only runs on timeout or a non-zero exit -- a SIGKILL to the
    parent bypasses every handler -- and `preprocess_fixtures.py` skips any target
    that already exists, so the truncation would have been silently accepted as
    the finished product.

    Writing to `<target>.partial` and renaming only after the CRS and data checks
    pass makes the final name unreachable unless the run actually completed.
    """

    from backend.ingest.sar.preprocess import build_command

    gpt = tmp_path / "gpt.exe"
    gpt.write_text("")
    target = tmp_path / "scene_s0db.tif"

    command = build_command(gpt, tmp_path / "in.SAFE", target)

    written = next(arg for arg in command if arg.startswith("-Ptarget="))
    assert written != f"-Ptarget={target}", (
        "gpt must write to a partial name; the final name is claimed only on success"
    )
    assert ".partial" in written
    assert written.endswith(".tif"), "SNAP appends the format extension if one is missing"


def test_partial_target_keeps_the_extension() -> None:
    """SNAP appends the format extension if the name lacks one.

    `scene_s0db.tif.partial` became `scene_s0db.tif.partial.tif` on disk, so
    `run_graph` could not find the file it had just told gpt to write.
    """

    partial = partial_target(Path("data/processed/sar/scene_s0db.tif"))

    assert partial.suffix == ".tif"
    assert partial.name == "scene_s0db.partial.tif"
