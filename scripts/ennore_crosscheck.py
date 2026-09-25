"""PHASE-10's cross-check: the drift engine against the published Ennore spill (January 2017).

    .venv/Scripts/python.exe -m scripts.ennore_crosscheck

The reference is INCOIS's own assessment: Prasad, Balakrishnan Nair, Rahaman,
Shenoi and Vijayalakshmi (2018), "An assessment on oil spill trajectory
prediction: Case study on oil spill off Ennore Port", J. Earth Syst. Sci.
127:111, doi:10.1007/s12040-018-1015-3. Two tankers collided two nautical
miles off Ennore port at 04:00 IST on 28 January 2017. The oil went SOUTH along
the coast: about 6 km of coast affected by 14:00 on the 28th (10 h), about 15 km
on Sentinel-1 by 06:00 on the 29th (26 h), about 18 km by 23:00 on the 29th
(43 h). INCOIS ran GNOME on analysed currents with 3% windage.

This runs the project's own engine on that event: OpenDrift OpenOil, the same
10-member ensemble the real runs use, forced by ERA5 wind and the CMEMS global
reanalysis currents (daily means; the hourly analysis starts in 2022), forward
48 h from the collision with stranding on. It reports how far south of the
source the oil reaches (floating or stranded) at 10, 26 and 43 h. The
published figures are lengths of affected coast, so the comparison is of
reach and direction, not a point-by-point trajectory; no machine-readable
trajectory was published.

Writes `eval/ennore/crosscheck.json`.
"""

from __future__ import annotations

import json
import math
import sys
from datetime import datetime, timedelta

import numpy as np

from backend.config import REPO_ROOT

OUT = REPO_ROOT / "eval" / "ennore" / "crosscheck.json"
# Two nautical miles east of the Kamarajar (Ennore) port breakwater.
SOURCE = (80.375, 13.245)
# 04:00 IST on 28 January 2017, in naive UTC as the engine wants it.
COLLISION = datetime(2017, 1, 27, 22, 30)
HOURS = 48
PUBLISHED_KM = {10: 6.0, 26: 15.0, 43: 18.0}  # coast affected, south of the port (Prasad et al. 2018)
BOX = (79.9, 12.4, 81.2, 14.0)


def south_reach_km(lat_history: np.ndarray) -> float:
    """How far south of the source the oil has reached by the last row, along the meridian.

    Cumulative over the rows given, so oil that stranded (and is no longer
    afloat, NaN from then on) still counts where it came ashore -- which is
    what "coast affected" means. The coast here runs within 15 deg of north.
    """
    finite = lat_history[np.isfinite(lat_history)]
    return max(0.0, (SOURCE[1] - float(finite.min())) * 111.19) if finite.size else 0.0


def main() -> int:
    from dotenv import load_dotenv

    from backend.drift.ensemble import run_ensemble
    from backend.ingest.metocean.cache import resolve
    from backend.ingest.metocean.cmems import current_request, dataset_for, fetch_cmems_currents
    from backend.ingest.metocean.era5 import PAD_H, drift_readers, fetch_era5_wind, wind_request

    load_dotenv(REPO_ROOT / ".env")
    west, south, east, north = BOX
    start, end = COLLISION - timedelta(hours=PAD_H), COLLISION + timedelta(hours=HOURS + PAD_H)
    wind, wind_how = resolve(wind_request(west=west, south=south, east=east, north=north, start=start, end=end),
                             fetch_era5_wind, fetched_from="the Copernicus CDS")
    current, current_how = resolve(current_request(west=west, south=south, east=east, north=north, start=start, end=end),
                                   fetch_cmems_currents, fetched_from="Copernicus Marine")
    print(f"ERA5: {wind_how}; CMEMS {dataset_for(COLLISION)}: {current_how}", flush=True)

    result = run_ensemble(
        lon=SOURCE[0], lat=SOURCE[1], start=COLLISION, hours=HOURS, backward=False,
        members=10, particles=200, radius_m=200.0,
        readers=lambda m: drift_readers(wind, current, wind_shift_h=m.wind_phase_shift_h), seed=0,
    )
    rows = []
    for hour, published in PUBLISHED_KM.items():
        index = min(range(len(result.times)), key=lambda i: abs((result.times[i] - COLLISION).total_seconds() / 3600 - hour))
        lon, lat = result.lon_history[: index + 1], result.lat_history[: index + 1]
        # Where each parcel last was: afloat now, or where it came ashore.
        last = [np.flatnonzero(np.isfinite(lat[:, k])) for k in range(lat.shape[1])]
        ends = np.array([[lon[i[-1], k], lat[i[-1], k]] for k, i in enumerate(last) if i.size])
        east_km = (ends[:, 0].mean() - SOURCE[0]) * 111.32 * math.cos(math.radians(SOURCE[1]))
        north_km = (ends[:, 1].mean() - SOURCE[1]) * 111.19
        rows.append({
            "hoursAfterCollision": hour,
            "modelSouthReachKm": round(south_reach_km(lat), 1),
            "publishedCoastAffectedKm": published,
            "afloatPct": round(100 * float(np.isfinite(result.lat_history[index]).mean()), 1),
            "centreBearingDeg": round((math.degrees(math.atan2(east_km, north_km)) + 360) % 360, 0),
        })
    report = {
        "reference": "Prasad et al. 2018, J. Earth Syst. Sci. 127:111, doi:10.1007/s12040-018-1015-3",
        "engine": "OpenDrift OpenOil, 10 members x 200 parcels, 3% (2-4%) windage, stranding",
        "forcing": {"wind": "ERA5 10 m", "currents": dataset_for(COLLISION)},
        "source": SOURCE, "start_utc": COLLISION.isoformat() + "Z", "rows": rows,
        "memberFailures": list(result.failures),
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    for row in rows:
        print(f"+{row['hoursAfterCollision']:>2} h: model reaches {row['modelSouthReachKm']:5.1f} km south "
              f"(oil centre toward {row['centreBearingDeg']:.0f} deg, {row['afloatPct']}% afloat); published coast affected "
              f"~{row['publishedCoastAffectedKm']:.0f} km")
    print(f"wrote {OUT.relative_to(REPO_ROOT).as_posix()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
