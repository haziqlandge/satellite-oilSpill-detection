"""The demo's offline snapshot, from one command (PHASE-09).

    .venv/Scripts/python.exe -m scripts.export_snapshot            # write demo/data/snapshot.zip + demo/snapshot.json
    .venv/Scripts/python.exe -m scripts.export_snapshot --check    # on the demo machine: is every file there, unchanged?

The API is file-backed (ISSUES X12), so the snapshot PHASE-09 asks for is not a
database dump: it is the set of files the console and the API read, most of
which git does not carry (weights, the ONNX model, the real-run views, cached
ERA5/CMEMS forcing, the upload windows, the parsed AIS days, the API's runs).
`demo/data/snapshot.zip` holds those, to unzip at the repository root of a
clean checkout. `demo/snapshot.json` (tracked) lists EVERY file the offline
demo needs, git-carried or not, with its size and SHA-256, so `--check` says
exactly what a machine is missing or holds a different version of.

Re-export as the last step before a demo, never an early one: a pipeline re-run
afterwards makes the snapshot stale, and `--check` is how you find out.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from backend.config import REPO_ROOT

ZIP = REPO_ROOT / "demo" / "data" / "snapshot.zip"
MANIFEST = REPO_ROOT / "demo" / "snapshot.json"

#: What the offline demo reads, as globs from the repository root. `False`: git carries it.
SOURCES: tuple[tuple[str, bool], ...] = (
    ("weights/L1-ciou-research.pt", True),
    ("weights/L1-ciou-research.json", False),
    ("frontDemo/public/models/L1-ciou-research.onnx", True),
    ("frontDemo/public/models/L1-ciou-research.json", False),
    ("frontDemo/public/runs/*/drift.json", True),
    ("frontDemo/public/runs/*/scene.json", True),
    ("frontDemo/public/ais/*.json", False),
    ("frontDemo/public/precomputed/*", False),
    ("frontDemo/public/landmask/*.bin", False),
    ("eval/final/scenes/*.geojson", False),
    ("data/cache/metocean/*.nc", True),
    ("data/processed/sar/windows/*.tif", True),
    ("data/interim/ais/*.npz", True),
    ("data/runs/*/*", True),
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def collect() -> list[tuple[Path, bool]]:
    found: list[tuple[Path, bool]] = []
    for pattern, packed in SOURCES:
        matches = sorted(p for p in REPO_ROOT.glob(pattern) if p.is_file() and p.suffix != ".partial")
        if not matches:
            raise SystemExit(f"nothing matches {pattern}: the snapshot would be incomplete")
        found += [(p, packed) for p in matches]
    return found


def export() -> int:
    files = collect()
    entries: list[dict[str, Any]] = []
    ZIP.parent.mkdir(parents=True, exist_ok=True)
    staging = ZIP.with_suffix(".zip.partial")
    with zipfile.ZipFile(staging, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for path, packed in files:
            name = path.relative_to(REPO_ROOT).as_posix()
            entries.append({"path": name, "bytes": path.stat().st_size, "sha256": sha256(path), "inZip": packed})
            if packed:
                archive.write(path, name)
    staging.replace(ZIP)
    manifest = {
        "exportedAt": datetime.now(UTC).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "unzipAt": "the repository root",
        "zipBytes": ZIP.stat().st_size,
        "files": entries,
    }
    MANIFEST.write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")
    zipped = [e for e in entries if e["inZip"]]
    print(f"{len(entries)} files ({sum(e['bytes'] for e in entries) / 2**20:.0f} MB); "
          f"{len(zipped)} not in git -> {ZIP.relative_to(REPO_ROOT).as_posix()} ({ZIP.stat().st_size / 2**20:.0f} MB)")
    print(f"manifest: {MANIFEST.relative_to(REPO_ROOT).as_posix()}")
    return 0


def check() -> int:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    missing, changed = [], []
    for entry in manifest["files"]:
        path = REPO_ROOT / entry["path"]
        if not path.is_file():
            missing.append(entry["path"])
        elif path.stat().st_size != entry["bytes"] or sha256(path) != entry["sha256"]:
            changed.append(entry["path"])
    for name in missing:
        print(f"MISSING {name}")
    for name in changed:
        print(f"CHANGED {name}")
    total = len(manifest["files"])
    print(f"{total - len(missing) - len(changed)} of {total} files match the snapshot of {manifest['exportedAt']}")
    if missing:
        print(f"unzip {ZIP.relative_to(REPO_ROOT).as_posix()} at the repository root")
    return 1 if missing or changed else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--check", action="store_true", help="verify this machine against demo/snapshot.json")
    args = parser.parse_args(argv)
    return check() if args.check else export()


if __name__ == "__main__":
    sys.exit(main())
