"""Extract the verified Zenodo archives into a usable directory tree.

`scripts/download_zenodo.py` leaves four records of `.7z` and `.zip` archives on
disk, each checked against Zenodo's published MD5. Nothing downstream can read a
`.7z`, so this is the step that turns them into the directories of images and
masks that PHASE-02 assembles a training set from.

Two properties matter here, and both are carried over from the rest of the
ingest code, where their absence has already cost this project real time:

* **An interrupted extraction must not look finished.** Output is written to a
  `<dest>.partial` directory and renamed only once the extractor has exited
  cleanly, so a killed run cannot leave a half-populated directory under the
  final name for the next run to skip. This is the same discipline
  `sar/preprocess.run_graph` uses for SNAP output and `datasets/zenodo.
  download_file` uses for a `.part` transfer.
* **The extractor is located, not assumed.** `.7z` needs an external tool and
  which one is installed varies by machine; `.zip` needs nothing but the
  standard library. A missing tool is reported once, up front, naming what to
  install -- not discovered 30 GB into a run.
"""

from __future__ import annotations

import os
import shutil
import subprocess
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

# Extraction of a large archive is minutes to tens of minutes. Observed
# 2026-08-31: WinRAR took 174 s for the 6.2 MB / 1200-file Part I mask archive,
# where the per-file cost (Defender scanning each new file) dominates rather
# than the byte count. A full-day ceiling is a runaway guard, not a budget.
DEFAULT_TIMEOUT_S = 24 * 60 * 60

# Candidate `.7z` extractors, in preference order. WinRAR is listed first only
# because it is what is installed on the current training machine; 7-Zip is
# equally acceptable and generally faster.
_SEVEN_ZIP_CANDIDATES: tuple[tuple[str, str], ...] = (
    ("winrar", r"C:\Program Files\WinRAR\WinRAR.exe"),
    ("winrar", r"C:\Program Files (x86)\WinRAR\WinRAR.exe"),
    ("7zip", r"C:\Program Files\7-Zip\7z.exe"),
    ("7zip", r"C:\Program Files (x86)\7-Zip\7z.exe"),
)

# Checked before the fixed paths, so a machine with the tool elsewhere on PATH
# or a deliberate override does not need this file edited.
_ENV_OVERRIDE = "ZENODO_EXTRACTOR"


class ExtractionError(RuntimeError):
    """An archive could not be extracted."""


class ExtractorNotFoundError(ExtractionError):
    """No tool on this machine can read a `.7z`."""


@dataclass(frozen=True, slots=True)
class Extractor:
    """An external command that can unpack a `.7z`.

    `flavour` selects the argument form: WinRAR and 7-Zip spell the destination
    differently, and getting it wrong is quiet -- WinRAR treats an unrecognised
    trailing argument as a filter and extracts nothing while still exiting 0.
    """

    flavour: str
    path: Path

    def command(self, archive: Path, destination: Path) -> list[str]:
        if self.flavour == "winrar":
            # `x` keeps paths, `-ibck` runs without a foreground window, `-y`
            # answers prompts and `-o+` overwrites. The destination MUST carry a
            # trailing separator or WinRAR reads it as a file name filter.
            return [
                str(self.path),
                "x",
                "-ibck",
                "-y",
                "-o+",
                str(archive),
                f"{destination}{os.sep}",
            ]
        if self.flavour == "7zip":
            # 7-Zip takes the destination glued to the flag, with no space.
            return [str(self.path), "x", "-y", f"-o{destination}", str(archive)]
        raise ExtractionError(f"unknown extractor flavour {self.flavour!r}")


def find_extractor(candidates: tuple[tuple[str, str], ...] = _SEVEN_ZIP_CANDIDATES) -> Extractor:
    """Locate a `.7z` extractor, or say precisely what to install.

    Honours the `ZENODO_EXTRACTOR` environment variable first so a machine that
    keeps the tool somewhere unusual needs no code change. The variable must
    name a WinRAR or 7-Zip executable; the flavour is taken from its file name.
    """

    override = os.environ.get(_ENV_OVERRIDE)
    if override:
        path = Path(override)
        if not path.exists():
            raise ExtractorNotFoundError(f"{_ENV_OVERRIDE} points at {path}, which does not exist")
        flavour = "winrar" if "winrar" in path.name.lower() else "7zip"
        return Extractor(flavour=flavour, path=path)

    for flavour, candidate in candidates:
        path = Path(candidate)
        if path.exists():
            return Extractor(flavour=flavour, path=path)

    for flavour, executable in (("7zip", "7z"), ("winrar", "WinRAR")):
        found = shutil.which(executable)
        if found:
            return Extractor(flavour=flavour, path=Path(found))

    raise ExtractorNotFoundError(
        "no .7z extractor found. Install 7-Zip (`winget install 7zip.7zip`) or WinRAR, "
        f"or set {_ENV_OVERRIDE} to the executable."
    )


def _count_files(directory: Path) -> int:
    return sum(1 for entry in directory.rglob("*") if entry.is_file())


def _clear(directory: Path) -> None:
    if directory.exists():
        shutil.rmtree(directory)


def extract_archive(
    archive: Path,
    destination: Path,
    *,
    extractor: Extractor | None = None,
    timeout_s: int = DEFAULT_TIMEOUT_S,
    on_progress: Callable[[str], None] | None = None,
) -> int:
    """Unpack one archive into `destination`, returning the file count.

    `destination` appearing on disk is the signal that extraction finished, so
    the work happens in a `.partial` sibling that is renamed into place last. A
    destination that already exists is left alone and its file count returned --
    re-running is cheap and safe.

    `.zip` is handled by the standard library; `.7z` needs `extractor`.
    """

    if destination.exists():
        return _count_files(destination)

    staging = destination.with_name(destination.name + ".partial")
    _clear(staging)
    staging.mkdir(parents=True, exist_ok=True)

    suffix = archive.suffix.lower()
    try:
        if suffix == ".zip":
            with zipfile.ZipFile(archive) as bundle:
                bundle.extractall(staging)
        elif suffix == ".7z":
            tool = extractor or find_extractor()
            result = subprocess.run(
                tool.command(archive, staging),
                capture_output=True,
                text=True,
                timeout=timeout_s,
            )
            if result.returncode != 0:
                raise ExtractionError(
                    f"{tool.flavour} exited {result.returncode} on {archive.name}: "
                    f"{(result.stderr or result.stdout or '').strip()[:500]}"
                )
        else:
            raise ExtractionError(f"unsupported archive type {archive.suffix!r} for {archive.name}")

        written = _count_files(staging)
        if written == 0:
            # A tool that exits 0 having written nothing is the failure mode
            # this whole module is shaped around. Treat it as an error rather
            # than renaming an empty directory into place.
            raise ExtractionError(f"{archive.name} extracted to an empty directory")

    except BaseException:
        # Includes KeyboardInterrupt and timeouts: whatever went wrong, the
        # half-written tree must not survive under any name a later run trusts.
        _clear(staging)
        raise

    staging.rename(destination)
    if on_progress:
        on_progress(f"{archive.name} -> {destination.name} ({written} files)")
    return written
