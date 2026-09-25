"""The region registry (PHASE-10): every AOI-dependent extent, read from one file.

`frontDemo/src/sim/regions.json` is shared with the console (`sim/regions.ts`),
so a zone's box, its AIS footprint and its caveats cannot drift apart between
the two. Boxes are (west, south, east, north), degrees.
"""

from __future__ import annotations

import json
from functools import lru_cache
from typing import Any

from backend.config import REPO_ROOT

REGISTRY = REPO_ROOT / "frontDemo" / "src" / "sim" / "regions.json"

Box = tuple[float, float, float, float]


@lru_cache(maxsize=1)
def regions() -> tuple[dict[str, Any], ...]:
    return tuple(json.loads(REGISTRY.read_text(encoding="utf-8"))["regions"])


def region(region_id: str) -> dict[str, Any]:
    for entry in regions():
        if entry["id"] == region_id:
            return entry
    raise KeyError(f"no region {region_id!r} in {REGISTRY.name}")


def box(entry: dict[str, Any], key: str = "aoi") -> Box:
    west, south, east, north = entry[key]
    return float(west), float(south), float(east), float(north)


def zone_of(bbox: Box) -> str | None:
    """The first zone whose AOI holds the whole of `bbox`, or None."""
    west, south, east, north = bbox
    for entry in regions():
        w, s, e, n = box(entry)
        if w <= west and east <= e and s <= south and north <= n:
            return str(entry["id"])
    return None
