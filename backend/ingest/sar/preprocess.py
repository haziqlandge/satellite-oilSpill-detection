"""Run the SNAP GPT graph over a Sentinel-1 GRD product.

SNAP is invoked as an external process through `gpt`, the Graph Processing Tool,
rather than through `esa_snappy`. `CONSTRAINTS.md` requires SNAP in a Linux
container because **`esa_snappy` on Windows is a known install hazard** -- that
hazard is specific to the Python bindings. `gpt` is a plain Java CLI with no
Python binding involved, so driving it by subprocess honours the intent of that
constraint without a container. Recorded as a deviation in `CONSTRAINTS.md`.

Three failure conditions listed in PHASE-01 are handled here rather than left
to fail obscurely at runtime:

* **JVM heap exhaustion on large IW scenes.** A full IW GRDH scene is ~25k x
  17k px and the SNAP default heap does not survive Refined Lee over it, so the
  heap is set explicitly and is configurable.
* **Terrain correction silently reprojecting to a UTM zone.** The graph asks
  for EPSG:4326, but a silent reprojection would corrupt every downstream
  pixel<->geo mapping without raising anything. The written product is read back
  and its CRS asserted.
* **Missing SNAP install.** Resolved with a clear, actionable error naming the
  override rather than a bare `FileNotFoundError` from `subprocess`.
"""

from __future__ import annotations

import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_GRAPH = REPO_ROOT / "graphs" / "s1_grd_preprocess.xml"

# Where the Windows installer and the common Linux/macOS packages put `gpt`.
# `SNAP_GPT` overrides all of them.
_GPT_CANDIDATES = (
    Path(r"C:\Program Files\esa-snap\bin\gpt.exe"),
    Path(r"C:\Program Files\snap\bin\gpt.exe"),
    Path(r"C:\Program Files\esa-snap\bin\gpt.bat"),
    Path.home() / "esa-snap" / "bin" / "gpt",
    Path("/opt/esa-snap/bin/gpt"),
    Path("/usr/local/snap/bin/gpt"),
)

# Refined Lee over a full IW GRDH scene needs materially more heap than the
# SNAP default. Tuned for a 16 GB machine; lower it on a smaller box.
DEFAULT_MAX_HEAP_GB = 8

# Measured 2026-08-29 on an RTX 4060 Ti desktop: a full IW GRDH scene
# (25896 x 16734) through Refined Lee and Terrain-Correction at 10 m had written
# 2.5 GB and was still going at the 1-hour mark. An hour is not enough; four is
# a ceiling that catches a genuine hang without killing honest work.
DEFAULT_TIMEOUT_S = 4 * 60 * 60

EXPECTED_EPSG = 4326


class SnapNotFoundError(RuntimeError):
    """SNAP's `gpt` executable could not be located."""


class SnapProcessingError(RuntimeError):
    """The SNAP graph ran but did not succeed."""


@dataclass(frozen=True, slots=True)
class PreprocessResult:
    """Outcome of one scene passing through the graph."""

    source: Path
    target: Path
    epsg: int | None


def find_gpt(explicit: Path | str | None = None) -> Path:
    """Locate SNAP's `gpt`, preferring an explicit path then `SNAP_GPT` then PATH."""

    if explicit is not None:
        candidate = Path(explicit)
        if candidate.is_file():
            return candidate
        raise SnapNotFoundError(f"SNAP gpt not found at the given path: {candidate}")

    from_env = os.environ.get("SNAP_GPT")
    if from_env:
        candidate = Path(from_env)
        if candidate.is_file():
            return candidate
        raise SnapNotFoundError(f"SNAP_GPT is set but does not point at a file: {candidate}")

    on_path = shutil.which("gpt")
    if on_path:
        return Path(on_path)

    for candidate in _GPT_CANDIDATES:
        if candidate.is_file():
            return candidate

    raise SnapNotFoundError(
        "SNAP's gpt executable was not found. Install ESA SNAP "
        "(winget install EuropeanSpaceAgency.SNAP), or set SNAP_GPT to its full path, "
        r"e.g. SNAP_GPT=C:\Program Files\esa-snap\bin\gpt.exe"
    )


def build_command(
    gpt: Path,
    source: Path,
    target: Path,
    *,
    graph: Path = DEFAULT_GRAPH,
    max_heap_gb: int = DEFAULT_MAX_HEAP_GB,
) -> list[str]:
    """Assemble the `gpt` argument vector for one scene.

    Split out from `run_graph` so the command can be asserted in tests without
    a SNAP install present.
    """

    return [
        str(gpt),
        str(graph),
        f"-Psource={source}",
        f"-Ptarget={target}",
        f"-J-Xmx{max_heap_gb}G",
        # Deliberately NOT setting `snap.userdir`. It is SNAP's home directory,
        # not a cache override: pointing it at the output directory scatters
        # `auxdata/`, `etc/` and `var/` among the results and forces every DEM
        # tile to be downloaded again on each run. Leave it at ~/.snap so the
        # auxdata cache persists.
        "-q",
        str(max(os.cpu_count() or 2, 2)),
    ]


# Lines worth showing from a gpt failure. SNAP prints the real cause once and
# then dozens of `at org.esa...` frames, so a plain tail of the output shows
# only stack noise and hides the message that says what actually went wrong.
_ERROR_MARKERS = (
    "Error:",
    "Caused by:",
    "Exception:",
    "GraphException",
    "OperatorException",
    "IllegalArgumentException",
)


def summarise_snap_failure(output: str, *, max_lines: int = 12) -> str:
    """Extract the meaningful error lines from gpt's output."""

    lines = [line.rstrip() for line in output.splitlines() if line.strip()]
    signal = [
        line
        for line in lines
        if any(marker in line for marker in _ERROR_MARKERS)
        and not line.lstrip().startswith("at ")
    ]
    chosen = signal or lines[-max_lines:]

    seen: set[str] = set()
    unique: list[str] = []
    for line in chosen:
        if line not in seen:
            seen.add(line)
            unique.append(line)
    return "\n".join(unique[:max_lines])


def read_epsg(product: Path) -> int | None:
    """EPSG code of a written product, or None if it declares no CRS.

    `to_epsg()` needs PROJ's database to identify the CRS, so it returns None
    when `PROJ_LIB` points at a stale copy -- see `check_geographic_wgs84`.
    """

    import rasterio

    with rasterio.open(product) as dataset:
        crs = dataset.crs
        return None if crs is None else crs.to_epsg()


def _discard_partial(target: Path) -> None:
    """Remove a half-written product so it is not mistaken for a finished one.

    Callers skip targets that already exist, which is the right behaviour for a
    completed scene and exactly the wrong one for a truncated file left behind by
    a timeout or a crash.
    """

    try:
        if target.exists():
            target.unlink()
    except OSError:
        # Losing the cleanup is not worth masking the original failure.
        pass


def check_has_data(product: Path, *, sample: int = 1024) -> tuple[bool, str]:
    """Confirm a written product actually contains non-zero pixels.

    SNAP exits 0 after producing a correctly sized, correctly georeferenced,
    entirely zero raster -- that is what `nodataValueAtSea=true` does to a marine
    scene. Geometry checks alone pass it, so the emptiness only surfaces much
    later as a model that will not train. Read a decimated overview rather than
    the full raster; a scene is tens of thousands of pixels across.
    """

    import numpy as np
    import rasterio

    with rasterio.open(product) as dataset:
        overview = dataset.read(
            1,
            out_shape=(1, min(sample, dataset.height), min(sample, dataset.width)),
        ).astype("float64")

    finite_nonzero = np.isfinite(overview) & (overview != 0)
    fraction = float(finite_nonzero.mean())
    if not finite_nonzero.any():
        return False, "every sampled pixel is zero or non-finite"
    return True, f"{fraction * 100:.1f}% of sampled pixels carry data"


def check_geographic_wgs84(product: Path) -> tuple[bool, str]:
    """Confirm a written product is geographic WGS84. Returns (ok, description).

    The risk this guards against is terrain correction silently emitting a UTM
    zone, which looks fine and corrupts every pixel<->geo mapping downstream.

    Identifying the CRS by EPSG code is the clearest check but it is not
    reliable on its own: `to_epsg()` consults PROJ's database, and a
    PostgreSQL/PostGIS install that sets a stale machine-level `PROJ_LIB`
    makes it return None for a perfectly good EPSG:4326 product. Since a
    projected CRS is exactly what we are trying to detect, fall back to the
    structural facts -- geographic vs projected, and the datum -- which come
    from the file's own WKT and need no database.
    """

    import rasterio

    with rasterio.open(product) as dataset:
        crs = dataset.crs

    if crs is None:
        return False, "product declares no CRS at all"

    epsg = crs.to_epsg()
    if epsg == EXPECTED_EPSG:
        return True, f"EPSG:{epsg}"
    if epsg is not None:
        return False, f"EPSG:{epsg}"

    # No EPSG identification available -- judge it structurally instead.
    if crs.is_projected:
        return False, f"projected CRS, not geographic: {crs.to_string()[:80]}"

    wkt = (crs.to_wkt() or "").upper()
    if crs.is_geographic and ("WGS_1984" in wkt or "WGS 84" in wkt or "WGS84" in wkt):
        return True, "geographic WGS84 by WKT (EPSG lookup unavailable -- check PROJ_LIB)"

    return False, f"unrecognised CRS: {crs.to_string()[:80]}"


def run_graph(
    source: Path,
    target: Path,
    *,
    graph: Path = DEFAULT_GRAPH,
    gpt: Path | str | None = None,
    max_heap_gb: int = DEFAULT_MAX_HEAP_GB,
    timeout_s: int = DEFAULT_TIMEOUT_S,
    verify_crs: bool = True,
) -> PreprocessResult:
    """Preprocess one Sentinel-1 GRD product end to end.

    `source` is a `.SAFE` directory or its `manifest.safe`; a bare measurement
    band cannot be calibrated and SNAP will reject it.
    """

    if not source.exists():
        raise FileNotFoundError(f"source product does not exist: {source}")
    if not graph.is_file():
        raise FileNotFoundError(f"SNAP graph not found: {graph}")

    executable = find_gpt(gpt)
    target.parent.mkdir(parents=True, exist_ok=True)
    command = build_command(
        executable, source, target, graph=graph, max_heap_gb=max_heap_gb
    )

    try:
        # Fixed argument vector, never a shell string.
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=timeout_s,
            check=False,
        )
    except subprocess.TimeoutExpired as error:
        # A killed gpt leaves a partial product behind. Callers skip targets that
        # already exist, so leaving it would let a truncated raster be mistaken
        # for a finished one on the next run.
        _discard_partial(target)
        raise SnapProcessingError(
            f"SNAP graph timed out after {timeout_s}s on {source.name}. "
            "A full IW scene through Refined Lee takes hours; raise timeout_s "
            "rather than assuming a hang. The partial output has been removed."
        ) from error

    if completed.returncode != 0:
        _discard_partial(target)
        output = f"{completed.stdout or ''}\n{completed.stderr or ''}"
        detail = summarise_snap_failure(output)
        hint = ""
        if "OutOfMemory" in output or "heap space" in output.lower():
            hint = (
                f"\nHeap was {max_heap_gb} G. Raise max_heap_gb, or process a subset "
                "-- Refined Lee over a full IW scene is memory-hungry."
            )
        raise SnapProcessingError(
            f"SNAP graph failed (exit {completed.returncode}) on {source.name}:\n{detail}{hint}"
        )

    if not target.exists():
        raise SnapProcessingError(
            f"SNAP reported success but wrote no output for {source.name} at {target}"
        )

    epsg: int | None = None
    if verify_crs:
        ok, description = check_geographic_wgs84(target)
        if not ok:
            # Silent reprojection to a UTM zone is the documented trap: it
            # looks fine and corrupts every pixel<->geo mapping downstream.
            raise SnapProcessingError(
                f"terrain correction produced {description}, expected geographic "
                f"EPSG:{EXPECTED_EPSG}. Check the Terrain-Correction mapProjection "
                "parameter in the graph -- it must be WGS84(DD), not an EPSG string."
            )
        epsg = read_epsg(target)

        has_data, data_description = check_has_data(target)
        if not has_data:
            raise SnapProcessingError(
                f"SNAP wrote {target.name} with valid geometry but no data "
                f"({data_description}). The usual cause is Terrain-Correction's "
                "`nodataValueAtSea`, which defaults to true and nulls a marine scene "
                "because SRTM has no data over water. It must be false here."
            )

    return PreprocessResult(source=source, target=target, epsg=epsg)
