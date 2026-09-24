"""What the API reads: the pipeline's artifacts on disk.

`ARCHITECTURE.md` puts PostGIS between the pipeline and the API. On this
machine the hosted database is unreachable (the Supabase pooler answers
"tenant/user not found", ISSUES X1), and every result the demo shows already
exists as files, so the API reads those files -- the same ones the console
reads -- and nothing else:

  * `eval/final/scenes/<scene>.geojson` -- the release model's full-scene detections;
  * `frontDemo/public/runs/<scene>/{drift,scene}.json` -- the real OpenDrift runs
    and the seed's characterisation (`export_drift_runs`, `export_real_scenes`);
  * `frontDemo/public/ais/real-<yyyymmdd>.json` -- the traffic around them;
  * `data/runs/<run>/` -- every run `POST /api/v1/runs` has made, in the same shapes.

Identifiers are stable across restarts because they are derived, not stored:
a scene's id is a UUID5 of its name (an API run's, of its run id), a
detection's a UUID5 of its scene's id and its index in the detection file.
Nothing here writes; the only writer is the pipeline.
"""

from __future__ import annotations

import json
import re
import threading
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from functools import cached_property
from pathlib import Path
from typing import Any

from backend.config import REPO_ROOT

#: The namespace every derived id lives in. Fixed: changing it renames everything.
NAMESPACE = uuid.UUID("5d0c7f3e-9a41-4c2b-8f6e-2a7b1e0d4c93")

SCENES_DIR = REPO_ROOT / "eval" / "final" / "scenes"
PUBLIC_RUNS = REPO_ROOT / "frontDemo" / "public" / "runs"
PUBLIC_AIS = REPO_ROOT / "frontDemo" / "public" / "ais"
API_RUNS = REPO_ROOT / "data" / "runs"
SAR_DIR = REPO_ROOT / "data" / "processed" / "sar"
AIS_DAYS = REPO_ROOT / "data" / "interim" / "ais"

# The Gulf AOI the AIS cache is cut to (`backend/ingest/ais/clip.py`), for naming a region.
GULF = (-98.0, 18.0, -80.0, 31.0)


def scene_uuid(name: str) -> uuid.UUID:
    return uuid.uuid5(NAMESPACE, f"scene:{name}")


def detection_uuid(scene_id: uuid.UUID, index: int) -> uuid.UUID:
    return uuid.uuid5(scene_id, f"detection:{index}")


def acquired_from_name(name: str) -> datetime | None:
    match = re.search(r"(\d{8})T(\d{6})", name)
    if not match:
        return None
    return datetime.strptime("".join(match.groups()), "%Y%m%d%H%M%S").replace(tzinfo=UTC)


class _FileCache:
    """Parsed JSON by path, re-read when the file changes. Artifacts are MB-sized; parse once."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._items: dict[tuple[Path, str], tuple[float, Any]] = {}

    def get(self, path: Path, build: Any = None, key: str = "") -> Any:
        mtime = path.stat().st_mtime
        with self._lock:
            hit = self._items.get((path, key))
            if hit is not None and hit[0] == mtime:
                return hit[1]
        value = json.loads(path.read_text(encoding="utf-8"))
        if build is not None:
            value = build(value)
        with self._lock:
            self._items[(path, key)] = (mtime, value)
        return value


@dataclass(frozen=True)
class SceneEntry:
    """One scene the API knows: an exported real run, or a run the API made."""

    id: uuid.UUID
    name: str
    acquired_at: datetime | None
    detections_path: Path
    run_dir: Path | None
    raster_path: Path | None
    ais_path: Path | None
    origin: str  # "release-export" | "api-run"
    run_id: str | None = None

    @cached_property
    def label(self) -> str:
        when = f"{self.acquired_at:%Y-%m-%d %H:%M} UTC" if self.acquired_at else "time unknown"
        return f"{'API run' if self.origin == 'api-run' else 'Sentinel-1'} · {when}"


class ArtifactStore:
    def __init__(
        self,
        *,
        scenes_dir: Path = SCENES_DIR,
        public_runs: Path = PUBLIC_RUNS,
        public_ais: Path = PUBLIC_AIS,
        api_runs: Path = API_RUNS,
        sar_dir: Path = SAR_DIR,
        ais_days: Path = AIS_DAYS,
    ) -> None:
        self.scenes_dir = scenes_dir
        self.public_runs = public_runs
        self.public_ais = public_ais
        self.api_runs = api_runs
        self.sar_dir = sar_dir
        self.ais_days = ais_days
        self.files = _FileCache()

    # ---- scenes -----------------------------------------------------------
    def scenes(self) -> list[SceneEntry]:
        found: list[SceneEntry] = []
        for path in sorted(self.scenes_dir.glob("*.geojson")):
            acquired = acquired_from_name(path.stem)
            run_dir = self.public_runs / path.stem
            ais = self.public_ais / f"real-{acquired:%Y%m%d}.json" if acquired else None
            raster = self.sar_dir / f"{path.stem}.tif"
            found.append(SceneEntry(
                id=scene_uuid(path.stem), name=path.stem, acquired_at=acquired, detections_path=path,
                run_dir=run_dir if (run_dir / "drift.json").exists() else None,
                raster_path=raster if raster.exists() else None,
                ais_path=ais if ais is not None and ais.exists() else None,
                origin="release-export",
            ))
        for run_dir in sorted(self.api_runs.glob("*/")):
            detections = run_dir / "detections.geojson"
            summary_path = run_dir / "run.json"
            if not detections.exists() or not summary_path.exists():
                continue
            summary = self.files.get(summary_path)
            acquired_iso = (summary.get("input") or {}).get("acquiredAt")
            acquired = datetime.fromisoformat(acquired_iso.replace("Z", "+00:00")) if acquired_iso else None
            request = run_dir / "request.json"
            source = self.files.get(request).get("source") if request.exists() else None
            given: Path | None = (REPO_ROOT / source) if source else None
            found.append(SceneEntry(
                id=scene_uuid(f"run:{run_dir.name}"), name=summary.get("source") or run_dir.name,
                acquired_at=acquired.astimezone(UTC) if acquired else None, detections_path=detections,
                run_dir=run_dir if (run_dir / "drift.json").exists() else None,
                raster_path=given if given is not None and given.exists() else None,
                ais_path=run_dir / "ais.json" if (run_dir / "ais.json").exists() else None,
                origin="api-run", run_id=run_dir.name,
            ))
        return found

    def scene(self, scene_id: uuid.UUID) -> SceneEntry | None:
        return next((s for s in self.scenes() if s.id == scene_id), None)

    # ---- files --------------------------------------------------------------
    def detection_document(self, scene: SceneEntry) -> dict[str, Any]:
        document: dict[str, Any] = self.files.get(scene.detections_path)
        return document

    def drift_file(self, scene: SceneEntry) -> dict[str, Any] | None:
        if scene.run_dir is None:
            return None
        drift: dict[str, Any] = self.files.get(scene.run_dir / "drift.json")
        return drift

    def scene_file(self, scene: SceneEntry) -> dict[str, Any] | None:
        if scene.run_dir is None or not (scene.run_dir / "scene.json").exists():
            return None
        record: dict[str, Any] = self.files.get(scene.run_dir / "scene.json")
        return record

    def traffic(self, scene: SceneEntry) -> dict[str, Any] | None:
        if scene.ais_path is None:
            return None
        traffic: dict[str, Any] = self.files.get(scene.ais_path)
        return traffic

    def seed_feature(self, scene: SceneEntry) -> int | None:
        """The detection the drift was seeded from, by its index in the detection file."""
        record = self.scene_file(scene)
        if record is None:
            return None
        return next((int(d["feature"]) for d in record.get("detections", []) if d.get("seed")), None)

    def find_detection(self, detection_id: uuid.UUID) -> tuple[SceneEntry, int] | None:
        for scene in self.scenes():
            count = len(self.detection_document(scene).get("features", []))
            for index in range(count):
                if detection_uuid(scene.id, index) == detection_id:
                    return scene, index
        return None

    # ---- AIS by vessel ------------------------------------------------------
    def ais_day(self, day: datetime) -> dict[str, Any] | None:
        path = self.ais_days / f"AIS_{day:%Y_%m_%d}_gulf.npz"
        return _npz_cache.get(path) if path.exists() else None

    def vessel_track(self, mmsi: int, start: datetime, end: datetime) -> tuple[dict[str, Any], list[str]]:
        """Every report of `mmsi` between `start` and `end` from the Gulf AIS days on disk, and the days read."""
        import numpy as np

        days, missing = [], []
        day = datetime(start.year, start.month, start.day, tzinfo=UTC)
        while day <= end:
            data = self.ais_day(day)
            if data is None:
                missing.append(f"{day:%Y-%m-%d}")
            else:
                days.append(data)
            day += timedelta(days=1)
        lo, hi = int(start.timestamp()), int(end.timestamp())
        columns: dict[str, list[Any]] = {k: [] for k in ("t", "lon", "lat", "sog", "cog")}
        for data in days:
            keep = (data["mmsi"] == mmsi) & (data["t"] >= lo) & (data["t"] <= hi)
            for key in columns:
                columns[key].append(data[key][keep])
        merged = {k: (np.concatenate(v) if v else np.array([])) for k, v in columns.items()}
        order = np.argsort(merged["t"], kind="stable")
        return {k: v[order] for k, v in merged.items()}, missing


class _NpzCache:
    """The last few AIS days, loaded whole: a day is ~1.5 M rows and a track query reads all of it."""

    def __init__(self, size: int = 4) -> None:
        self.size = size
        self._lock = threading.Lock()
        self._items: dict[Path, dict[str, Any]] = {}

    def get(self, path: Path) -> dict[str, Any]:
        import numpy as np

        with self._lock:
            if path in self._items:
                value = self._items.pop(path)
                self._items[path] = value
                return value
        with np.load(path) as data:
            value = {name: data[name] for name in ("mmsi", "t", "lon", "lat", "sog", "cog")}
        with self._lock:
            self._items[path] = value
            while len(self._items) > self.size:
                self._items.pop(next(iter(self._items)))
        return value


_npz_cache = _NpzCache()
