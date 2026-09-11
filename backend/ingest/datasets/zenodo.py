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
    resume: bool = True,
) -> Path:
    """Download one record file. Existing, verified files are left alone.

    The corpus is ~91 GB in four archives, the largest 37.9 GB, over a link that
    may drop. Bytes land in a sibling `.part` file and are resumed with a Range
    request, so an interruption costs the remainder rather than the whole
    transfer; the final name only ever appears once the checksum has passed, so
    a truncated archive can never be mistaken for a finished one on the next run.
    """

    destination.parent.mkdir(parents=True, exist_ok=True)
    if verify(destination, entry):
        return destination

    partial = destination.with_name(destination.name + ".part")
    have = partial.stat().st_size if (resume and partial.exists()) else 0
    if entry.size and have >= entry.size:
        # A .part at or beyond the published size is not a resumable prefix.
        have = 0

    headers = {}
    if have:
        headers["Range"] = f"bytes={have}-"

    with urlopen(Request(entry.link, headers=headers), timeout=120) as response:
        # A server free to ignore Range answers 200 with the *whole* file.
        # Appending that onto the bytes already held would yield an archive of
        # plausible size and corrupt content, so only 206 may be appended to.
        ranged = have > 0 and getattr(response, "status", 200) == 206
        written = have if ranged else 0
        with partial.open("ab" if ranged else "wb") as output:
            total = entry.size or None
            while chunk := response.read(_CHUNK):
                output.write(chunk)
                written += len(chunk)
                if progress is not None:
                    progress(written, total)

    if not verify(partial, entry):
        partial.unlink(missing_ok=True)
        raise ZenodoError(
            f"{destination.name} failed checksum verification after download. "
            "A silently truncated archive is worse than a missing one; retry."
        )

    partial.replace(destination)
    return destination


# --- parallel segmented download ------------------------------------------
#
# Whether parallel byte ranges help here is **unproven**, and the default is 1.
#
# A short probe on 2026-08-31 suggested Zenodo throttles per connection (4
# disjoint ranges hit 19.4 MB/s against a contended 0.7). Acting on it produced
# the opposite: 2-3 MB/s sustained. **That comparison was invalid** -- the
# serial transfer it was supposed to replace had not actually stopped, so the
# two runs were competing for the same link and neither figure means anything.
#
# What *is* measured, cleanly, is the serial path alone: **~9 MB/s / 78 Mbps**
# on a 300 Mbps line, reproduced twice. So parallel is kept, tested, and off by
# default. Before turning it on, stop the serial download and confirm it is
# gone -- `TaskStop`-style shell termination does not kill the Python process,
# which is exactly how the bad measurement happened.
#
# Zenodo does answer a ranged request with **206**, so disjoint segments are
# safe here -- unlike CDSE, which answers 200 with the whole file (see
# `sar/cdse.py`). That is why the 206 check below is an assertion and not a
# formality: appending a whole-file response into a segment would produce an
# archive of plausible size and corrupt content.

DEFAULT_CONNECTIONS = 1

# Below this a file is not worth splitting -- the per-connection setup costs
# more than the parallelism returns, and the mask archives are tens of MB.
MIN_PARALLEL_BYTES = 64 * 1024 * 1024


class _SegmentError(ZenodoError):
    """One segment of a parallel download failed."""


def _fetch_segment(
    link: str,
    path: Path,
    start: int,
    end: int,
    counter: Callable[[int], None],
) -> None:
    """Fetch `[start, end]` inclusive into `path`, resuming if partly present.

    Each segment resumes from its own length, so an interrupted parallel run
    costs only the unfetched remainder of each segment rather than the file.
    """

    have = path.stat().st_size if path.exists() else 0
    want = end - start + 1
    if have >= want:
        counter(have)
        return

    request = Request(link, headers={"Range": f"bytes={start + have}-{end}"})
    with urlopen(request, timeout=120) as response:
        if getattr(response, "status", 200) != 206:
            raise _SegmentError(
                f"server answered {getattr(response, 'status', '?')} to a ranged request; "
                "refusing to treat a whole-file response as a segment"
            )
        counter(have)
        with path.open("ab") as output:
            remaining = want - have
            while remaining > 0 and (chunk := response.read(min(_CHUNK, remaining))):
                output.write(chunk)
                remaining -= len(chunk)
                counter(len(chunk))


def download_file_parallel(
    entry: ZenodoFile,
    destination: Path,
    *,
    connections: int = DEFAULT_CONNECTIONS,
    progress: Callable[[int, int | None], None] | None = None,
    resume: bool = True,
) -> Path:
    """Download one record file over several parallel byte ranges.

    Falls back to `download_file` when splitting cannot help or is unsafe: an
    unknown size, a small file, one connection, or a server that will not honour
    Range. The correctness guarantees are unchanged -- the assembled file is
    checked against Zenodo's MD5 and the final name appears only once that
    passes.

    An existing contiguous `.part` from a serial run is kept and treated as a
    finished prefix, so switching to this path mid-transfer costs nothing.
    """

    import threading

    destination.parent.mkdir(parents=True, exist_ok=True)
    if verify(destination, entry):
        return destination

    if connections < 2 or not entry.size or entry.size < MIN_PARALLEL_BYTES:
        return download_file(entry, destination, progress=progress, resume=resume)

    partial = destination.with_name(destination.name + ".part")
    have = partial.stat().st_size if (resume and partial.exists()) else 0
    if have >= entry.size:
        have = 0
        partial.unlink(missing_ok=True)

    remaining = entry.size - have
    if remaining < MIN_PARALLEL_BYTES:
        return download_file(entry, destination, progress=progress, resume=resume)

    span = remaining // connections
    bounds = []
    for index in range(connections):
        start = have + index * span
        end = have + (index + 1) * span - 1 if index < connections - 1 else entry.size - 1
        bounds.append((index, start, end))

    # Progress is reported as one number across every segment, so the caller
    # sees the file advancing rather than four unrelated counters.
    lock = threading.Lock()
    state = {"written": have}

    def counter(delta: int) -> None:
        with lock:
            state["written"] += delta
            if progress is not None:
                progress(state["written"], entry.size)

    segments = [destination.with_name(f"{destination.name}.seg{i}") for i, _, _ in bounds]
    errors: list[BaseException] = []

    def worker(index: int, start: int, end: int) -> None:
        try:
            _fetch_segment(entry.link, segments[index], start, end, counter)
        except BaseException as error:
            errors.append(error)

    threads = [threading.Thread(target=worker, args=bound) for bound in bounds]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    if errors:
        # Segments are left on disk: they are valid prefixes of their own ranges
        # and a retry resumes from them. Only the assembled file is discarded.
        raise _SegmentError(f"{destination.name}: {errors[0]}") from errors[0]

    # Assemble in order. Anything out of order here produces a file of exactly
    # the right size and entirely wrong content, which is what the MD5 catches.
    with partial.open("ab" if have else "wb") as output:
        for segment in segments:
            with segment.open("rb") as source:
                while chunk := source.read(_CHUNK):
                    output.write(chunk)

    if not verify(partial, entry):
        partial.unlink(missing_ok=True)
        for segment in segments:
            segment.unlink(missing_ok=True)
        raise ZenodoError(
            f"{destination.name} failed checksum verification after a parallel download. "
            "A silently truncated archive is worse than a missing one; retry."
        )

    for segment in segments:
        segment.unlink(missing_ok=True)
    partial.replace(destination)
    return destination
