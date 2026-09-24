"""A vessel's AIS track by MMSI, from the Gulf AIS days on this machine.

Served locally only (the API binds to 127.0.0.1): the published files under
`frontDemo/public/ais/` withhold identities on purpose, and this endpoint does
not change that -- it reads `data/interim/ais/`, which never leaves the
machine, and carries no names because the cache holds none. AIS may be
commercially sensitive (`CONSTRAINTS.md`, ethics 5).
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import APIRouter, Query

from backend.app.deps import Store
from backend.app.problems import ProblemError
from backend.app.schemas import VesselTrack

router = APIRouter(tags=["vessels"])

MAX_WINDOW = timedelta(days=7)


def _instant(value: str, name: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise ProblemError(422, "invalid-request", "Not an ISO-8601 time", f"{name}={value!r}") from error
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed.astimezone(UTC)


@router.get("/vessels/{mmsi}/track", response_model=VesselTrack)
def vessel_track(
    mmsi: int,
    store: Store,
    start: str = Query(..., alias="from", description="ISO-8601 UTC"),
    end: str = Query(..., alias="to", description="ISO-8601 UTC"),
) -> dict[str, Any]:
    t0, t1 = _instant(start, "from"), _instant(end, "to")
    if t1 <= t0:
        raise ProblemError(422, "invalid-request", "Empty window", "`to` must be after `from`")
    if t1 - t0 > MAX_WINDOW:
        raise ProblemError(422, "invalid-request", "Window too long", f"at most {MAX_WINDOW.days} days per request")
    track, missing = store.vessel_track(mmsi, t0, t1)
    days = (t1.date() - t0.date()).days + 1
    if len(missing) == days:
        raise ProblemError(404, "no-ais", "No AIS on this machine for that window",
                           f"no Gulf AIS day is cached for {', '.join(missing)} (data/interim/ais)")
    points = [
        {"t": datetime.fromtimestamp(int(t), UTC).isoformat().replace("+00:00", "Z"),
         "lon": round(float(lon), 6), "lat": round(float(lat), 6),
         "sog": None if sog != sog or sog >= 102.2 else round(float(sog), 1),  # NaN or "not available"
         "cog": None if cog != cog else round(float(cog), 1)}
        for t, lon, lat, sog, cog in zip(track["t"], track["lon"], track["lat"], track["sog"], track["cog"], strict=True)
    ]
    coordinates = [[p["lon"], p["lat"]] for p in points]
    geometry = ({"type": "LineString", "coordinates": coordinates} if len(coordinates) >= 2
                else {"type": "Point", "coordinates": coordinates[0]} if coordinates else None)
    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": {
            "mmsi": mmsi,
            "from": t0.isoformat().replace("+00:00", "Z"),
            "to": t1.isoformat().replace("+00:00", "Z"),
            "count": len(points),
            "points": points,
            "days_missing": missing,
            "source": "marinecadastre.gov AIS (US Coast Guard NAIS), BOEM/NOAA; the Gulf AOI cache on this machine",
            "note": "raw reports, unsimplified; a gap between reports is not evidence (C7). No vessel name is held.",
        },
    }
