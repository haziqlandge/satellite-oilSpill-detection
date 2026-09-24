"""One detection's characterisation: geometry, damping, wind gate, age prior (PHASE-03).

`INTERFACES.md` §1 names the stage `characterize(detection_id)`, reading and
writing the database. The database tests cannot run on the session machine
(the Supabase pooler, ISSUES X1), and the API that would call the stage does
not exist yet (FUTURE_WORK §3), so this is the pure core the stage will wrap:
outline in, `Characterisation` out. `as_row()` gives the `characterisations`
columns (`backend/db/models.py`); `as_console()` gives the console's
`Characterisation` (`frontDemo/src/sim/types.ts`) plus what only the backend
measures.

What is NOT here, on purpose: which end is the head (the drift field decides,
PHASE-04), an age (drift convergence gives that; the morphology prior is only a
bound on it), and a thickness (C2).
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from backend.characterize.age import MorphologyAgePrior, morphology_prior
from backend.characterize.damping import Damping
from backend.characterize.geometry import SlickGeometry, measure
from backend.characterize.windgate import WindSample


@dataclass(frozen=True, slots=True)
class Characterisation:
    geometry: SlickGeometry
    #: None when there was no sigma-0 to measure it from.
    damping: Damping | None
    #: None when there was no wind field for the place and time.
    wind: WindSample | None
    age_prior: MorphologyAgePrior

    @property
    def damping_ratio_db(self) -> float | None:
        return None if self.damping is None else self.damping.ratio_db

    @property
    def wind_gate_multiplier(self) -> float | None:
        return None if self.wind is None else self.wind.gate

    def as_row(self) -> dict[str, Any]:
        """The `characterisations` columns, head and tail as WKT (EPSG:4326)."""

        g = self.geometry
        return {
            "area_km2": g.area_km2,
            "length_km": g.length_km,
            "width_m_mean": g.width_m_mean,
            "width_m_profile": list(g.width_m_profile),
            "orientation_deg": g.orientation_deg,
            "elongation": g.elongation,
            "compactness": g.compactness,
            "fragmentation": g.fragmentation,
            "head": f"SRID=4326;POINT({g.head[0]} {g.head[1]})",
            "tail": f"SRID=4326;POINT({g.tail[0]} {g.tail[1]})",
            "damping_ratio_db": self.damping_ratio_db,
            "damping_confidence": "low",
            "wind_speed_ms": None if self.wind is None else self.wind.speed_ms,
            "wind_gate_multiplier": self.wind_gate_multiplier,
        }

    def as_console(self, detection_id: str) -> dict[str, Any]:
        """The console's `Characterisation`, JSON-safe (no NaN), with the backend's extras."""

        g = self.geometry

        def r(value: float, places: int) -> float:
            return round(float(value), places)

        def point(p: tuple[float, float]) -> list[float]:
            return [r(p[0], 6), r(p[1], 6)]

        damping = self.damping
        wind = self.wind
        prior = self.age_prior
        return {
            "detectionId": detection_id,
            "areaKm2": r(g.area_km2, 4),
            "lengthKm": r(g.length_km, 3),
            "widthMMean": r(g.width_m_mean, 1),
            "widthMProfile": [r(w, 1) for w in g.width_m_profile],
            "orientationDeg": r(g.orientation_deg, 1),
            "elongation": r(g.elongation, 2),
            "compactness": r(g.compactness, 4),
            "fragmentation": g.fragmentation,
            "head": point(g.head),
            "tail": point(g.tail),
            "headTailResolvedBy": g.head_tail_resolved_by,
            "medialAxis": [point(p) for p in g.medial_axis],
            "dampingRatioDb": None if self.damping_ratio_db is None else r(self.damping_ratio_db, 2),
            "dampingConfidence": "low",
            "windSpeedMs": None if wind is None else r(wind.speed_ms, 2),
            "windGateMultiplier": None if self.wind_gate_multiplier is None else r(self.wind_gate_multiplier, 4),
            "perimeterKm": r(g.perimeter_km, 3),
            "gapKm": r(g.gap_km, 3),
            "hullDeficiency": r(g.hull_deficiency, 4),
            "resolutionM": r(g.resolution_m, 1),
            "damping": None if damping is None else {
                "ratioDb": None if damping.ratio_db is None else r(damping.ratio_db, 2),
                "insideDb": None if damping.inside_db is None else r(damping.inside_db, 2),
                "annulusDb": None if damping.annulus_db is None else r(damping.annulus_db, 2),
                "insidePx": damping.inside_px,
                "annulusPx": damping.annulus_px,
                "standoffM": damping.standoff_m,
                "annulusM": damping.annulus_m,
                "note": damping.note,
            },
            "wind": None if wind is None else {
                "speedMs": r(wind.speed_ms, 2),
                "fromDeg": r(wind.from_deg, 1),
                "gridPoint": [r(wind.grid_lon, 3), r(wind.grid_lat, 3)],
                "validTime": wind.valid_time.isoformat() + "Z",
                "offsetS": r(wind.offset_s, 0),
                "source": wind.source,
            },
            "agePrior": {
                "lowHours": r(prior.low_hours, 2),
                "bestHours": r(prior.best_hours, 2),
                "highHours": r(prior.high_hours, 2),
                "widthM": r(prior.width_m, 1),
                "method": prior.method,
                "confidence": prior.confidence,
                "explanation": prior.explanation,
            },
        }


def characterise_outline(
    outline: Any,
    *,
    damping: Damping | None = None,
    wind: WindSample | None = None,
) -> Characterisation:
    """Characterise a lon/lat outline, with the damping and wind measured by the caller.

    Damping needs the sigma-0 raster and wind needs a forcing file, which live
    in different places for an upload, a processed scene and (later) the API;
    the caller reads them (`damping.damping_ratio`, `windgate.sample_wind`) and
    this assembles the record.
    """

    geometry = measure(outline)
    if damping is not None and damping.ratio_db is not None and not math.isfinite(damping.ratio_db):
        raise ValueError("a damping ratio must be finite or None")
    return Characterisation(
        geometry=geometry,
        damping=damping,
        wind=wind,
        age_prior=morphology_prior(geometry.width_m_profile),
    )
