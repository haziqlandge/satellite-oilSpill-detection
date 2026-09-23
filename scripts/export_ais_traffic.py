"""Export real AIS traffic for the frontend's Gulf of Mexico scenes.

WHY. Every vessel the console drew was synthetic: a straight corridor
centreline plus a lateral offset and a 0.35 km sine. Real ships turn, stop,
loiter, call at platforms and drop out of reception, and an attribution gate is
only tested if it has to filter traffic that behaves like traffic. The three
Gulf scenes sit on exactly the three days of marinecadastre AIS already on disk
(`data/raw/ais/2023/`), so for those scenes nothing needs simulating.

WHAT. For each scene: the national daily files covering its window are read
once and cut to the Gulf AOI (cached under `data/interim/ais/`), then cut to a
box around the scene and the window, cleaned with the backend's own
`clean_records`, grouped into per-vessel tracks, simplified, and written to
`frontDemo/public/ais/<scene>.json`.

THREE RULES THE FILE KEEPS.

* **No identities.** Real MMSIs and names never enter the file. Each vessel gets
  a sequential id that keeps only the three-digit MID (the flag state, which is
  useful and not identifying); the UI masks even that. A demo has no business
  printing a real ship's identity beside the word "suspected".
* **The published vessel is flagged, not named.** Zhao et al. 2025 name the
  vessel for Cases 2 and 3. Its track is marked `published: true`, which is how
  the frontend knows which track is the case's ground truth. The truth comes
  from the publication, not from a detector (C10).
* **Time is kept honest.** Tracks are simplified with synchronised-distance
  Douglas-Peucker (TD-TR), which bounds the error of the position AT EACH
  INSTANT, not just the path -- the drift gate asks where a vessel was at a
  given hour, so a path-only simplification would be the wrong guarantee.
  Reception gaps longer than `GAP_MIN` are never bridged: a gap is evidence
  (C7), and interpolating across it would invent positions.

Run from the repository root (the first run parses the 8 national days the
windows need, ~12 min;
later runs read the cache):

    .venv/Scripts/python.exe -m scripts.export_ais_traffic
"""

from __future__ import annotations

import argparse
import json
import math
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

import numpy as np

from backend.config import REPO_ROOT
from backend.ingest.ais.clean import clean_records
from backend.ingest.ais.clip import GULF_OF_MEXICO
from backend.ingest.ais.loader import AisRecord, LoadStats, iter_ais_records

RAW = REPO_ROOT / "data" / "raw" / "ais" / "2023"
CACHE = REPO_ROOT / "data" / "interim" / "ais"
OUT = REPO_ROOT / "frontDemo" / "public" / "ais"

TOLERANCE_KM = 0.1
# A gap this long is kept as a gap. Class A transponders report every few
# seconds underway and marinecadastre thins that to one a minute, so fifteen
# minutes without a report is a reception gap, not a sampling interval.
GAP_MIN = 15
KM_PER_DEG_LAT = 110.574


@dataclass(frozen=True)
class Scene:
    acquired: datetime
    centre: tuple[float, float]
    backward_h: int
    published_mmsi: int | None
    note: str
    half_width_deg: float = 0.85
    half_height_deg: float = 0.65
    before_h: int = 6
    after_h: int = 12


# Mirrors `frontDemo/src/sim/scenarios.ts`; `check:realais` asserts the two
# agree, so a scene moved there without re-exporting here fails loudly.
SCENES: dict[str, Scene] = {
    "gom-platform": Scene(
        acquired=datetime(2023, 4, 9, 0, 2, 0),
        centre=(-89.77, 28.31),
        backward_h=30,
        published_mmsi=None,
        note="Case 1: a platform leak; the published case reports no vessel within 5 km",
    ),
    "gom-moving": Scene(
        acquired=datetime(2023, 5, 15, 0, 2, 0),
        centre=(-89.28, 28.28),
        backward_h=30,
        published_mmsi=477636500,
        note="Case 2: the vessel the published case names, underway",
    ),
    "gom-berthed": Scene(
        acquired=datetime(2023, 12, 5, 23, 57, 19),
        centre=(-88.96, 28.90),
        backward_h=36,
        published_mmsi=367697440,
        note="Case 3: the vessel the published case names, berthed for two days",
    ),
}


RUNS = REPO_ROOT / "frontDemo" / "public" / "runs"
REAL_RUN_BACKWARD_MAX_H = 72
# Beyond the drift's own reach: the console's 10 km contact radius, plus room.
REAL_RUN_MARGIN_KM = 15.0


def _day_on_disk(day: datetime) -> bool:
    return (RAW / f"AIS_{day:%Y_%m_%d}.zip").exists() or (CACHE / f"AIS_{day:%Y_%m_%d}_gulf.npz").exists()


def real_run_scenes() -> dict[str, Scene]:
    """One scene per exported real OpenDrift run, derived from the run itself.

    The real-run views pair OpenDrift's backward field with the traffic that
    was actually around it, so the box is centred on the run's own seed (the
    model's largest detection in the full scene) and the acquisition time is
    the run's. The backward window reaches as far as the AIS days on disk allow
    and no further: 48 h for April and May, 72 h for December. The drift reaches
    72 h back in all three, and the interface says where the traffic stops.

    Nobody is named and nothing is ranked in these views -- the fields never
    converge -- so there is no published vessel to flag.

    The box is the drift's own reach -- every 90% contour over the whole
    hindcast -- plus `REAL_RUN_MARGIN_KM`, not the authored scenes' fixed
    1.7 x 1.3 degrees: around the Mississippi mouth that fixed box holds over a
    thousand vessels, nearly all of them nowhere near the oil.
    """
    scenes: dict[str, Scene] = {}
    for path in sorted(RUNS.glob("*/drift.json")):
        run = json.loads(path.read_text(encoding="utf-8"))
        acquired = datetime.fromisoformat(run["acquiredAtIso"].replace("Z", "+00:00")).replace(tzinfo=None)
        cx, cy = float(run["seed"][0]), float(run["seed"][1])
        xs = [p[0] for frame in run["frames"] for ring in frame["contour90"] for p in ring] or [cx]
        ys = [p[1] for frame in run["frames"] for ring in frame["contour90"] for p in ring] or [cy]
        km_lon = 111.32 * math.cos(math.radians(cy))
        earliest = datetime(acquired.year, acquired.month, acquired.day)
        while _day_on_disk(earliest - timedelta(days=1)):
            earliest -= timedelta(days=1)
        if not _day_on_disk(earliest):
            continue
        available_h = int((acquired - earliest).total_seconds() // 3600)
        scenes[f"real-{acquired:%Y%m%d}"] = Scene(
            acquired=acquired,
            centre=(cx, cy),
            half_width_deg=round(max(cx - min(xs), max(xs) - cx) + REAL_RUN_MARGIN_KM / km_lon, 3),
            half_height_deg=round(max(cy - min(ys), max(ys) - cy) + REAL_RUN_MARGIN_KM / KM_PER_DEG_LAT, 3),
            backward_h=min(REAL_RUN_BACKWARD_MAX_H, available_h),
            published_mmsi=None,
            note=(
                "Real run: the traffic around the model's largest detection in the full scene. "
                "Context only; no vessel is ranked, because the backward field never converges."
            ),
            before_h=0,
            after_h=2,
        )
    return scenes


# AIS ship-type codes (ITU-R M.1371) to the classes the scorer knows. Codes
# 90-99 are "other" and in the Gulf are mostly offshore supply and crew boats,
# but the code does not say so, so they stay "Other" rather than being guessed.
def kind_for(code: int | None) -> str:
    if code is None or code <= 0:
        return "Unknown"
    if code == 30:
        return "Fishing"
    if code in (31, 32, 52):
        return "Tug"
    if code in (36, 37):
        return "Pleasure craft"
    if code in (33, 34, 35, 50, 51, 53, 54, 55, 58):
        return "Service vessel"
    if 60 <= code <= 69:
        return "Passenger"
    if 70 <= code <= 79:
        return "Cargo"
    if 80 <= code <= 89:
        return "Tanker"
    return "Other"


# --------------------------------------------------------------------------- #
# Stage 1: national day -> Gulf AOI, cached
# --------------------------------------------------------------------------- #

FIELDS = ("mmsi", "t", "lat", "lon", "sog", "cog", "type", "length", "draft")


def cached_day(day: datetime) -> dict[str, np.ndarray]:
    """One national day cut to the Gulf AOI, parsed once and cached."""
    path = CACHE / f"AIS_{day:%Y_%m_%d}_gulf.npz"
    if path.exists():
        with np.load(path) as data:
            return {name: data[name] for name in FIELDS}
    source = RAW / f"AIS_{day:%Y_%m_%d}.zip"
    if not source.exists():
        raise FileNotFoundError(f"{source} is missing; the window needs every day it spans")
    started = time.monotonic()
    stats = LoadStats()
    box = GULF_OF_MEXICO
    rows: list[AisRecord] = [
        r
        for r in iter_ais_records(source, stats=stats)
        if box.min_lon <= r.lon <= box.max_lon and box.min_lat <= r.lat <= box.max_lat
    ]

    def column(values: list[float | None], dtype: type) -> np.ndarray:
        return np.array([np.nan if v is None else v for v in values], dtype=dtype)

    data = {
        "mmsi": np.array([r.mmsi for r in rows], dtype=np.int64),
        "t": np.array([int(r.base_date_time.replace(tzinfo=UTC).timestamp()) for r in rows], dtype=np.int64),
        "lat": np.array([r.lat for r in rows], dtype=np.float64),
        "lon": np.array([r.lon for r in rows], dtype=np.float64),
        "sog": column([r.sog for r in rows], np.float32),
        "cog": column([r.cog for r in rows], np.float32),
        "type": np.array([-1 if r.vessel_type is None else r.vessel_type for r in rows], dtype=np.int16),
        "length": column([r.length for r in rows], np.float32),
        "draft": column([r.draft for r in rows], np.float32),
    }
    CACHE.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(path, **data)
    print(
        f"  cached {source.name}: {stats.total:,} national -> {len(rows):,} in the Gulf AOI "
        f"({time.monotonic() - started:.0f}s)",
        flush=True,
    )
    return data


# --------------------------------------------------------------------------- #
# Stage 2: simplification that keeps time honest
# --------------------------------------------------------------------------- #


def simplify(t: np.ndarray, x: np.ndarray, y: np.ndarray, tolerance: float) -> np.ndarray:
    """Indices kept by synchronised-distance Douglas-Peucker (TD-TR).

    A point's error is its distance from where the straight segment between the
    kept neighbours says the vessel was AT THAT POINT'S TIME. Bounding that
    bounds the position error at every instant, which is what a spatiotemporal
    gate reads. Iterative, so a 3,000-point track cannot hit a recursion limit.
    """
    n = t.size
    if n <= 2:
        return np.arange(n)
    keep = np.zeros(n, dtype=bool)
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        span = t[b] - t[a]
        inner = np.arange(a + 1, b)
        f = (t[inner] - t[a]) / span if span > 0 else np.zeros(inner.size)
        ex = x[a] + (x[b] - x[a]) * f
        ey = y[a] + (y[b] - y[a]) * f
        error = np.hypot(x[inner] - ex, y[inner] - ey)
        worst = int(np.argmax(error))
        if error[worst] > tolerance:
            split = int(inner[worst])
            keep[split] = True
            stack.append((a, split))
            stack.append((split, b))
    return np.flatnonzero(keep)


def segments(t: np.ndarray, gap_s: int) -> list[tuple[int, int]]:
    """[start, end) runs with no reception gap longer than `gap_s` inside them."""
    breaks = np.flatnonzero(np.diff(t) > gap_s) + 1
    edges = np.concatenate(([0], breaks, [t.size]))
    return [(int(edges[i]), int(edges[i + 1])) for i in range(edges.size - 1)]


def median_or_none(values: np.ndarray) -> float | None:
    finite = values[np.isfinite(values) & (values > 0)]
    return float(np.median(finite)) if finite.size else None


# --------------------------------------------------------------------------- #
# Stage 3: one scene
# --------------------------------------------------------------------------- #


def export_scene(name: str, scene: Scene) -> dict[str, object]:
    start = scene.acquired - timedelta(hours=scene.backward_h + scene.before_h)
    end = scene.acquired + timedelta(hours=scene.after_h)
    days = []
    day = datetime(start.year, start.month, start.day)
    while day <= end:
        if _day_on_disk(day):
            days.append(day)
        elif day < scene.acquired:
            # The backward window is what the gate reads; a hole in it is a
            # confident answer computed from partial traffic, so refuse.
            raise FileNotFoundError(f"{name}: AIS for {day:%Y-%m-%d} is missing and the backward window needs it")
        day += timedelta(days=1)
    parts = [cached_day(d) for d in days]
    data = {k: np.concatenate([p[k] for p in parts]) for k in FIELDS}

    t0 = int(scene.acquired.replace(tzinfo=UTC).timestamp())
    lo_t = int(start.replace(tzinfo=UTC).timestamp())
    hi_t = int(end.replace(tzinfo=UTC).timestamp())
    cx, cy = scene.centre
    west, east = cx - scene.half_width_deg, cx + scene.half_width_deg
    south, north = cy - scene.half_height_deg, cy + scene.half_height_deg
    inside = (
        (data["t"] >= lo_t) & (data["t"] <= hi_t)
        & (data["lon"] >= west) & (data["lon"] <= east)
        & (data["lat"] >= south) & (data["lat"] <= north)
    )
    rows_in_box = int(inside.sum())
    data_end = int(data["t"].max()) if data["t"].size else t0

    records = [
        AisRecord(
            mmsi=int(data["mmsi"][i]),
            base_date_time=datetime.fromtimestamp(int(data["t"][i]), UTC).replace(tzinfo=None),
            lat=float(data["lat"][i]), lon=float(data["lon"][i]),
            # 102.3 kn is AIS for "speed not available", not a speed.
            sog=None if math.isnan(data["sog"][i]) or data["sog"][i] >= 102.2 else float(data["sog"][i]),
            cog=None if math.isnan(data["cog"][i]) else float(data["cog"][i]),
            heading=None, vessel_name=None, imo=None, call_sign=None,
            vessel_type=None if data["type"][i] < 0 else int(data["type"][i]),
            status=None,
            length=None if math.isnan(data["length"][i]) else float(data["length"][i]),
            width=None,
            draft=None if math.isnan(data["draft"][i]) else float(data["draft"][i]),
            cargo=None, transceiver_class=None,
        )
        for i in np.flatnonzero(inside)
    ]
    # `clean_records` expects per-vessel chronological order.
    records.sort(key=lambda r: (r.mmsi, r.base_date_time))
    cleaned = list(clean_records(records))

    by_mmsi: dict[int, list[AisRecord]] = defaultdict(list)
    for r in cleaned:
        by_mmsi[r.mmsi].append(r)

    km_per_deg_lon = 111.32 * math.cos(math.radians(cy))
    serial: dict[str, int] = defaultdict(int)
    vessels = []
    kept_points = 0
    published_found = False
    for mmsi in sorted(by_mmsi, key=lambda m: (by_mmsi[m][0].base_date_time, m)):
        points = by_mmsi[mmsi]
        if len(points) < 2:
            continue
        t = np.array([int(p.base_date_time.replace(tzinfo=UTC).timestamp()) - t0 for p in points])
        lon = np.array([p.lon for p in points])
        lat = np.array([p.lat for p in points])
        x = (lon - cx) * km_per_deg_lon
        y = (lat - cy) * KM_PER_DEG_LAT
        kept: list[int] = []
        # Where reports genuinely stop, as indices into the kept arrays. The
        # frontend cannot infer this from time spacing: simplification leaves
        # hours between kept points on a straight leg that was never silent.
        breaks: list[int] = []
        for a, b in segments(t, GAP_MIN * 60):
            if kept:
                breaks.append(len(kept))
            kept.extend(int(a + i) for i in simplify(t[a:b], x[a:b], y[a:b], TOLERANCE_KM))
        idx = np.array(kept)
        sog = np.array([np.nan if p.sog is None else p.sog for p in points])[idx]
        cog = np.array([np.nan if p.cog is None else p.cog for p in points])[idx]
        mid = str(mmsi)[:3] if len(str(mmsi)) == 9 else "000"
        serial[mid] += 1
        code = next((p.vessel_type for p in points if p.vessel_type), None)
        published = scene.published_mmsi == mmsi
        published_found |= published
        vessels.append({
            "id": f"{mid}{serial[mid]:06d}",
            "kind": kind_for(code),
            "aisType": code,
            "lengthM": median_or_none(np.array([p.length or np.nan for p in points])),
            "draftM": median_or_none(np.array([p.draft or np.nan for p in points])),
            "published": published,
            "breaks": breaks,
            "t": t[idx].tolist(),
            "lon": np.round(lon[idx], 5).tolist(),
            "lat": np.round(lat[idx], 5).tolist(),
            # Absent speed/course stays absent (null), never a made-up 0.
            "sog": [None if math.isnan(v) else round(float(v), 1) for v in sog],
            "cog": [None if math.isnan(v) else round(float(v)) for v in cog],
        })
        kept_points += int(idx.size)

    if scene.published_mmsi is not None and not published_found:
        raise RuntimeError(f"{name}: the published vessel is not in the box and window")

    return {
        "scene": name,
        "source": "marinecadastre.gov AIS (US Coast Guard NAIS), BOEM/NOAA",
        "note": scene.note,
        "acquiredAt": scene.acquired.replace(tzinfo=UTC).isoformat().replace("+00:00", "Z"),
        "centre": list(scene.centre),
        "box": [west, south, east, north],
        "window": {
            "startS": lo_t - t0,
            "endS": min(hi_t, data_end) - t0,
            "dataEndsS": data_end - t0,
        },
        "simplification": {"method": "synchronised-distance Douglas-Peucker", "toleranceKm": TOLERANCE_KM, "gapMin": GAP_MIN},
        "rows": {"inBoxAndWindow": rows_in_box, "afterClean": len(cleaned), "kept": kept_points},
        "identities": "withheld: ids are sequential per scene and keep only the three-digit MID",
        "vessels": vessels,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--only", help="export one scene")
    parser.add_argument(
        "--real-runs", action="store_true",
        help="export the traffic around each real OpenDrift run in frontDemo/public/runs instead",
    )
    args = parser.parse_args()

    scenes = real_run_scenes() if args.real_runs else SCENES
    if args.only and args.only not in scenes:
        parser.error(f"--only {args.only}: choose from {', '.join(sorted(scenes))}")
    OUT.mkdir(parents=True, exist_ok=True)
    for name, scene in scenes.items():
        if args.only and name != args.only:
            continue
        started = time.monotonic()
        print(f"{name}: {scene.acquired:%Y-%m-%d %H:%M} UTC, centre {scene.centre}", flush=True)
        payload = export_scene(name, scene)
        path = OUT / f"{name}.json"
        path.write_text(json.dumps(payload, separators=(",", ":"), allow_nan=False), encoding="utf-8")
        rows = payload["rows"]
        vessels = payload["vessels"]
        assert isinstance(rows, dict) and isinstance(vessels, list)
        print(
            f"  {len(vessels)} vessels, {rows['inBoxAndWindow']:,} reports -> {rows['kept']:,} kept "
            f"({path.stat().st_size / 1024:.0f} KB, {time.monotonic() - started:.0f}s)",
            flush=True,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
