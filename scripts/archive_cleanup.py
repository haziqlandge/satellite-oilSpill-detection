"""FUTURE_WORK §2.6: which dataset archives can go, each verified against its extraction first. Deletes nothing.

    .venv/Scripts/python.exe -m scripts.archive_cleanup

The repository's own layout: every archive under `data/raw/datasets/zenodo/<record>/`
against its extraction under `data/interim/datasets/zenodo/<record>/`. The RTX
4060 Ti machine keeps the archives elsewhere; point at them:

    .venv/Scripts/python.exe -m scripts.archive_cleanup --raw C:/Users/adi/Downloads/oilSpil2l16/oilSpil2l/data/raw/datasets/zenodo --pair "E:/temp downloads" "E:/temp downloads"

An archive is listed for deletion only when its extracted tree holds every entry
the archive lists, at the listed size, and a fixed-seed sample of SAMPLE
entries matches the archive's CRC32 (the plan's "spot-check against the
manifests"; Part II and the Parts I/III move had full CRC passes on
2026-09-25, `eval/part2/verification.json` and DATA.md §2). Anything that fails,
or has no extraction, stays and says why.

Writes `eval/cleanup/delete_list.json`, whose paths are the machine it ran on.
Deleting is the user's step, after reading the list.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
import zlib
from dataclasses import dataclass
from pathlib import Path

from backend.config import REPO_ROOT

RAW = REPO_ROOT / "data/raw/datasets/zenodo"
INTERIM = REPO_ROOT / "data/interim/datasets/zenodo"
OUT = REPO_ROOT / "eval/cleanup/delete_list.json"
SAMPLE = 25
ARCHIVE_SUFFIXES = {".7z", ".zip"}


@dataclass(frozen=True, slots=True)
class Entry:
    name: str
    size: int
    crc32: int | None


def entries(archive: Path) -> list[Entry]:
    """Every file an archive lists: name, uncompressed size, CRC32. Reads headers only."""
    if archive.suffix.lower() == ".zip":
        import zipfile

        with zipfile.ZipFile(archive) as packed:
            return [Entry(i.filename, i.file_size, i.CRC) for i in packed.infolist() if not i.is_dir()]
    import py7zr

    with py7zr.SevenZipFile(archive) as packed:
        return [Entry(i.filename, i.uncompressed, i.crc32) for i in packed.list() if not i.is_directory]


def crc32(path: Path) -> int:
    value = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            value = zlib.crc32(block, value)
    return value & 0xFFFFFFFF


def locate(entry: Entry, extracted: Path, stem: str) -> Path | None:
    """An entry's extracted file: archives unpack either into their own folder or beside it."""
    for candidate in (extracted / stem / entry.name, extracted / entry.name):
        if candidate.is_file():
            return candidate
    return None


def check(archive: Path, extracted: Path) -> dict[str, object]:
    stem = archive.name.rsplit(".", 1)[0]
    row: dict[str, object] = {"archive": str(archive), "bytes": archive.stat().st_size, "extracted": str(extracted)}
    if not extracted.is_dir():
        return row | {"verdict": "keep", "why": "no extraction to check against"}
    listed = entries(archive)
    found = {e.name: locate(e, extracted, stem) for e in listed}
    missing = [n for n, p in found.items() if p is None]
    wrong_size = [e.name for e in listed if found[e.name] is not None and found[e.name].stat().st_size != e.size]  # type: ignore[union-attr]
    sample = random.Random(archive.name).sample(listed, min(SAMPLE, len(listed)))
    wrong_crc = [e.name for e in sample
                 if e.crc32 is not None and found[e.name] is not None and crc32(found[e.name]) != e.crc32]  # type: ignore[arg-type]
    row |= {"entries": len(listed), "missing": missing[:20], "missing_count": len(missing),
            "size_mismatch": wrong_size[:20], "crc_sampled": len(sample), "crc_mismatch": wrong_crc}
    if missing or wrong_size or wrong_crc:
        return row | {"verdict": "keep", "why": "the extraction does not match the archive"}
    return row | {"verdict": "delete", "why": f"all {len(listed)} entries present at their size; {len(sample)} CRC32 match"}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--raw", type=Path, default=RAW, help="archives, one folder per Zenodo record")
    parser.add_argument("--interim", type=Path, default=INTERIM, help="extractions, one folder per record")
    parser.add_argument("--pair", nargs=2, type=Path, action="append", default=[], metavar=("ARCHIVES", "EXTRACTED"),
                        help="another archive folder and where it was extracted")
    args = parser.parse_args(argv)

    jobs: list[tuple[Path, Path]] = []
    if args.raw.is_dir():
        for record in sorted(p for p in args.raw.iterdir() if p.is_dir()):
            jobs += [(a, args.interim / record.name) for a in sorted(record.iterdir())
                     if a.suffix.lower() in ARCHIVE_SUFFIXES]
    for folder, extracted in args.pair:
        jobs += [(a, extracted) for a in sorted(folder.iterdir()) if a.suffix.lower() in ARCHIVE_SUFFIXES]

    seen: set[str] = set()
    rows = []
    for archive, extracted in jobs:
        real = os.path.realpath(archive)  # a junction can show one archive twice
        if real in seen:
            continue
        seen.add(real)
        print(f"checking {archive.name} ({archive.stat().st_size / 2**30:.2f} GB) ...", flush=True)
        rows.append(check(archive, extracted))

    delete = [r for r in rows if r["verdict"] == "delete"]
    freed = sum(int(r["bytes"]) for r in delete)  # type: ignore[call-overload]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"delete": delete, "keep": [r for r in rows if r["verdict"] == "keep"],
                               "freed_bytes": freed}, indent=1), encoding="utf-8")
    print()
    for r in rows:
        print(f"{str(r['verdict']).upper():7} {int(r['bytes']) / 2**30:7.2f} GB  {r['archive']}  -- {r['why']}")  # type: ignore[call-overload]
    print(f"\n{len(delete)} archive(s) verified deletable, {freed / 2**30:.1f} GB. Nothing was deleted. "
          f"The list: {OUT.relative_to(REPO_ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
