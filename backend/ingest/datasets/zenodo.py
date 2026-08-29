"""Zenodo record download and checksum verification.

PHASE-01 requires the training corpus to be "downloaded and verified". Verified
matters here specifically: these archives are multi-gigabyte, the download is
unattended, and a truncated archive does not announce itself -- it surfaces much
later as a short image count or a corrupt read in the middle of training.
Zenodo publishes an MD5 per file in its record metadata, so every file is checked
against it rather than merely being present on disk.

The four records the plan depends on are in `RECORDS` below
(`RESEARCH/topics/datasets-and-data-access.md`). Nothing here is Sentinel-1
specific; it is a general Zenodo client.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ZENODO_API = "https://zenodo.org/api/records"

# Record id -> what it is for. See RESEARCH/topics/datasets-and-data-access.md.
RECORDS: dict[str, str] = {
    "8346860": "Part I -- 1200 S1 sigma0 dB images + masks (primary training source)",
    "8253899": "Part II -- No-Oil / look-alike scenarios (the negative pool)",
    "13761290": "Part III -- held-out test images",
    "15298010": "Refined Deep-SAR SOS -- manually corrected masks (prefer where overlapping)",
}

_CHUNK = 1024 * 1024


class ZenodoError(RuntimeError):
    """Zenodo metadata, download or verification failure."""


@dataclass(frozen=True, slots=True)
class ZenodoFile:
    """One file in a Zenodo record."""

    key: str
    size: int
    checksum: str
    link: str

    @property
    def algorithm(self) -> str:
        """Hash algorithm Zenodo used, e.g. `md5`."""

        return self.checksum.split(":", 1)[0] if ":" in self.checksum else "md5"

    @property
    def digest(self) -> str:
        """Expected hex digest, without the algorithm prefix."""

        return self.checksum.split(":", 1)[1] if ":" in self.checksum else self.checksum


def fetch_record(record_id: str) -> list[ZenodoFile]:
    """List the files in a Zenodo record."""

    url = f"{ZENODO_API}/{record_id}"
    try:
        with urlopen(Request(url, headers={"Accept": "application/json"}), timeout=60) as response:
            document = json.load(response)
    except HTTPError as error:
        raise ZenodoError(
            f"Zenodo record {record_id} metadata request failed with HTTP {error.code}"
        ) from error

    entries = document.get("files")
    if not isinstance(entries, list) or not entries:
        raise ZenodoError(f"Zenodo record {record_id} lists no files")

    files: list[ZenodoFile] = []
    for entry in entries:
        link = entry.get("links", {}).get("self") or entry.get("links", {}).get("download")
        key = entry.get("key")
        if not isinstance(key, str) or not isinstance(link, str):
            continue
        files.append(
            ZenodoFile(
                key=key,
                size=int(entry.get("size", 0) or 0),
                checksum=str(entry.get("checksum", "")),
                link=link,
            )
        )
    if not files:
        raise ZenodoError(f"Zenodo record {record_id} returned no usable file entries")
    return files


def verify(path: Path, entry: ZenodoFile) -> bool:
    """Check one downloaded file against the checksum Zenodo published.

    Size is compared first because it is free and rules out the common case (a
    truncated download) without reading gigabytes.
    """

    if not path.exists():
        return False
    if entry.size and path.stat().st_size != entry.size:
        return False
    if not entry.digest:
        # No published checksum: size is all the assurance available.
        return True

    try:
        digest = hashlib.new(entry.algorithm)
    except ValueError as error:
        raise ZenodoError(f"unsupported checksum algorithm {entry.algorithm!r}") from error

    with path.open("rb") as handle:
        while chunk := handle.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest() == entry.digest


def download_file(
    entry: ZenodoFile,
    destination: Path,
    *,
    progress: Callable[[int, int | None], None] | None = None,
) -> Path:
    """Download one record file. Existing, verified files are left alone."""

    destination.parent.mkdir(parents=True, exist_ok=True)
    if verify(destination, entry):
        return destination

    written = 0
    with urlopen(Request(entry.link), timeout=120) as response, destination.open("wb") as output:
        total = entry.size or None
        while chunk := response.read(_CHUNK):
            output.write(chunk)
            written += len(chunk)
            if progress is not None:
                progress(written, total)

    if not verify(destination, entry):
        raise ZenodoError(
            f"{destination.name} failed checksum verification after download. "
            "Delete it and retry; a silently truncated archive is worse than a missing one."
        )
    return destination
