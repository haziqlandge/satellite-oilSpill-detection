"""Synthetic Indian-waters AIS with authored ground truth (PHASE-05).

Free real AIS covers US waters only, which the problem statement anticipates, so
the Indian-waters half of the dual-region design is generated. The recipe follows
P003 -- normal trajectories with noise injection, abrupt speed changes, irregular
routing and time-series perturbation -- with **one correction that matters**:

> **C10: ground truth is authored, never detector-derived.** P003 auto-labelled
> anomalies with an Isolation Forest and then evaluated against those labels,
> which is circular and makes the reported numbers meaningless. Here the
> discharging MMSI, release position and release window are *written into*
> `ReleaseTruth` by the generator. Nothing in this module infers them back out of
> the trajectories, and nothing downstream may either.

The generated records are ordinary `AisRecord`s in the marinecadastre schema, so
the real loader, cleaner, trajectory builder and behaviour features all apply
unchanged. That is deliberate: the synthetic path is only trustworthy because it
is validated by the same code as the real one (`tests/test_synthetic_ais.py`).

`AisPoint.source` and `AisTrajectory.source` carry `"synthetic"` so a demo can
never silently present generated traffic as real.
"""

from __future__ import annotations

import csv
import io
import math
import random
import zlib
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta

from backend.ingest.ais.clip import BoundingBox
from backend.ingest.ais.loader import AIS_COLUMNS, AisRecord

# MID 419 is India. It also keeps every synthetic MMSI clear of the US real data,
# whose MIDs are 338/366/367, so the two can never be confused in one table.
_MMSI_PREFIX = 419

# One report per minute, matching marinecadastre's filtered cadence so the real
# and synthetic paths present the same sampling to everything downstream.
_STEP = timedelta(minutes=1)

# How much history to generate before the acquisition: the PHASE-04 backward
# drift horizon, so the origin window is always covered.
_HISTORY_HOURS = 48

_KM_PER_DEGREE = 111.32
_KNOTS_TO_KM_PER_MIN = 1.852 / 60.0


@dataclass(frozen=True, slots=True)
class Region:
    """A generation area, with the traffic character that belongs to it."""

    name: str
    bbox: BoundingBox
    description: str


REGIONS: dict[str, Region] = {
    # Ecologically sensitive gulf with heavy tanker traffic to Kandla/Vadinar.
    "gulf_of_kutch": Region(
        name="gulf_of_kutch",
        bbox=BoundingBox(min_lon=68.60, min_lat=22.20, max_lon=70.40, max_lat=23.20),
        description="Gulf of Kutch - tanker approaches to Kandla and Vadinar",
    ),
    # India's main offshore production field: platforms plus dense support traffic.
    "mumbai_high": Region(
        name="mumbai_high",
        bbox=BoundingBox(min_lon=70.60, min_lat=18.90, max_lon=72.60, max_lat=20.20),
        description="Mumbai High - offshore platforms and supply vessels",
    ),
    # Site of the real 2017 Ennore collision and spill, with INCOIS drift studies.
    "ennore_chennai": Region(
        name="ennore_chennai",
        bbox=BoundingBox(min_lon=80.10, min_lat=12.90, max_lon=80.90, max_lat=13.60),
        description="Ennore / Chennai - 2017 spill site, port approaches",
    ),
}

# Scenario -> the region it is generated in. Each mirrors a P004 fixture, or
# covers a case the fixtures cannot (a dark vessel, and a true negative).
SCENARIOS: dict[str, str] = {
    "moving_tanker": "gulf_of_kutch",
    "berthed_discharge": "ennore_chennai",
    "platform_leak": "mumbai_high",
    "dark_vessel": "mumbai_high",
    "null_case": "gulf_of_kutch",
}

# Enough vessels that filtering is actually exercised: "a scenario with three
# vessels does not test filtering" (PHASE-05).
_BACKGROUND_VESSELS = 28

_VESSEL_TYPES = (70, 70, 80, 80, 80, 60, 52, 30, 90)
_NAME_STEMS = (
    "SAGAR", "MAITRI", "KAVERI", "NARMADA", "GODAVARI", "TAPTI", "KRISHNA",
    "ARABIAN", "KONKAN", "MALABAR", "CORAL", "MONSOON", "DECCAN", "SATPURA",
)


@dataclass(frozen=True, slots=True)
class ReleaseTruth:
    """What the generator scripted. **Authored, never derived** (C10).

    `discharging_mmsi` is `None` where no vessel is responsible -- a platform
    leak, or the null case -- and that is a meaningful answer, not missing data.
    """

    scenario: str
    region: str
    has_spill: bool
    discharging_mmsi: int | None
    release_lat: float | None
    release_lon: float | None
    release_start: datetime | None
    release_end: datetime | None
    is_dark_vessel: bool
    expected_answer: str
    notes: str


@dataclass(frozen=True, slots=True)
class SyntheticScenario:
    """Generated traffic plus the sidecar that says what really happened."""

    name: str
    region: str
    records: list[AisRecord]
    truth: ReleaseTruth
    seed: int


def _mmsi(rng: random.Random) -> int:
    return int(f"{_MMSI_PREFIX}{rng.randint(100000, 999999)}")


def _vessel_name(rng: random.Random) -> str:
    return f"{rng.choice(_NAME_STEMS)} {rng.choice(('STAR', 'PRIDE', 'EXPRESS', 'VOYAGER', 'TRADER'))}"


def _offset(lat: float, lon: float, bearing_deg: float, km: float) -> tuple[float, float]:
    """Move a position `km` along a bearing, correcting longitude for latitude."""

    radians = math.radians(bearing_deg)
    delta_lat = (km * math.cos(radians)) / _KM_PER_DEGREE
    scale = math.cos(math.radians(lat)) or 1e-6
    delta_lon = (km * math.sin(radians)) / (_KM_PER_DEGREE * scale)
    return lat + delta_lat, lon + delta_lon


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _record(
    *,
    mmsi: int,
    name: str,
    when: datetime,
    lat: float,
    lon: float,
    sog: float,
    cog: float,
    vessel_type: int,
    draft: float,
) -> AisRecord:
    return AisRecord(
        mmsi=mmsi,
        base_date_time=when,
        lat=round(lat, 5),
        lon=round(lon, 5),
        sog=round(sog, 1),
        cog=round(cog % 360.0, 1),
        heading=round(cog % 360.0, 1),
        vessel_name=name,
        imo=None,
        call_sign=None,
        vessel_type=vessel_type,
        status=None,
        length=None,
        width=None,
        draft=round(draft, 1),
        cargo=None,
        transceiver_class="A",
    )


def _transit_track(
    rng: random.Random,
    region: Region,
    *,
    start: datetime,
    minutes: int,
    mmsi: int | None = None,
    speed_knots: float | None = None,
) -> list[AisRecord]:
    """A vessel under way on a slightly irregular heading.

    Course and speed wander a little each step (P003's noise injection); without
    it every track is a perfect line and the behaviour features are trivially
    separable.
    """

    box = region.bbox
    identifier = mmsi if mmsi is not None else _mmsi(rng)
    name = _vessel_name(rng)
    vessel_type = rng.choice(_VESSEL_TYPES)
    draft = round(rng.uniform(4.0, 14.0), 1)

    lat = rng.uniform(box.min_lat + 0.1, box.max_lat - 0.1)
    lon = rng.uniform(box.min_lon + 0.1, box.max_lon - 0.1)
    cog = rng.uniform(0.0, 360.0)
    sog = speed_knots if speed_knots is not None else rng.uniform(6.0, 14.0)

    records: list[AisRecord] = []
    when = start
    for _ in range(minutes):
        cog += rng.gauss(0.0, 1.2)
        sog = _clamp(sog + rng.gauss(0.0, 0.15), 3.0, 18.0)
        lat, lon = _offset(lat, lon, cog, sog * _KNOTS_TO_KM_PER_MIN)

        # Turn back rather than leave the region, which keeps every track inside
        # the AOI without teleporting a vessel (which the cleaner would reject).
        if not box.contains(lon=lon, lat=lat):
            cog = (cog + 180.0) % 360.0
            lat, lon = _offset(lat, lon, cog, sog * _KNOTS_TO_KM_PER_MIN * 2)
            lat = _clamp(lat, box.min_lat + 0.01, box.max_lat - 0.01)
            lon = _clamp(lon, box.min_lon + 0.01, box.max_lon - 0.01)

        records.append(
            _record(
                mmsi=identifier, name=name, when=when, lat=lat, lon=lon,
                sog=sog, cog=cog, vessel_type=vessel_type, draft=draft,
            )
        )
        when += _STEP
    return records


def _moored_track(
    rng: random.Random,
    region: Region,
    *,
    start: datetime,
    minutes: int,
    mmsi: int,
    at: tuple[float, float],
) -> list[AisRecord]:
    """A vessel holding station, drifting only by GPS jitter.

    Reported SOG stays small but non-zero, as a real moored vessel's does; that
    is what `behaviour.LOITER_SOG_KNOTS` is calibrated against.
    """

    name = _vessel_name(rng)
    draft = round(rng.uniform(6.0, 12.0), 1)
    lat, lon = at
    records: list[AisRecord] = []
    when = start
    for _ in range(minutes):
        jitter_lat = lat + rng.gauss(0.0, 0.00012)
        jitter_lon = lon + rng.gauss(0.0, 0.00012)
        records.append(
            _record(
                mmsi=mmsi, name=name, when=when,
                lat=_clamp(jitter_lat, region.bbox.min_lat, region.bbox.max_lat),
                lon=_clamp(jitter_lon, region.bbox.min_lon, region.bbox.max_lon),
                sog=abs(rng.gauss(0.05, 0.06)), cog=rng.uniform(0.0, 360.0),
                vessel_type=80, draft=draft,
            )
        )
        when += _STEP
    return records


def _background(
    rng: random.Random, region: Region, *, start: datetime, minutes: int, count: int
) -> list[AisRecord]:
    """Ordinary traffic. Each vessel appears for part of the window, not all of it."""

    records: list[AisRecord] = []
    for _ in range(count):
        duration = rng.randint(max(30, minutes // 6), minutes)
        offset = rng.randint(0, max(0, minutes - duration))
        records.extend(
            _transit_track(
                rng, region, start=start + timedelta(minutes=offset), minutes=duration
            )
        )
    return records


def generate_scenario(
    name: str,
    *,
    acquired_at: datetime,
    seed: int = 0,
    history_hours: int = _HISTORY_HOURS,
    background_vessels: int = _BACKGROUND_VESSELS,
) -> SyntheticScenario:
    """Generate one authored scenario ending at `acquired_at`.

    Deterministic for a given `seed`, so an evaluation run is repeatable.
    """

    if name not in SCENARIOS:
        raise ValueError(f"unknown scenario {name!r}; expected one of {sorted(SCENARIOS)}")
    if acquired_at.tzinfo is None:
        raise ValueError("acquired_at must be timezone-aware UTC, got a naive datetime")

    region = REGIONS[SCENARIOS[name]]
    # Mix the scenario name into the seed. Seeding on `seed` alone drew the *same*
    # MMSIs in every scenario, so one identifier was a moving tanker in one and a
    # berthed vessel in another -- and the demo presents these side by side, so a
    # single MMSI would have contradicted itself in one database. `crc32` rather
    # than `hash`, which is randomised per interpreter run and would destroy
    # reproducibility across sessions.
    rng = random.Random(seed * 1_000_003 + zlib.crc32(name.encode("utf-8")))
    minutes = history_hours * 60
    start = acquired_at - timedelta(minutes=minutes - 1)

    records = _background(rng, region, start=start, minutes=minutes, count=background_vessels)
    box = region.bbox
    centre_lat = (box.min_lat + box.max_lat) / 2
    centre_lon = (box.min_lon + box.max_lon) / 2

    truth: ReleaseTruth

    if name == "moving_tanker":
        # Case 2 analogue: a tanker under way, discharging continuously.
        mmsi = _mmsi(rng)
        track = _transit_track(
            rng, region, start=start, minutes=minutes, mmsi=mmsi, speed_knots=9.0
        )
        records.extend(track)
        release_start = acquired_at - timedelta(hours=14)
        at = next(r for r in track if r.base_date_time >= release_start)
        truth = ReleaseTruth(
            scenario=name, region=region.name, has_spill=True, discharging_mmsi=mmsi,
            release_lat=at.lat, release_lon=at.lon,
            release_start=release_start, release_end=acquired_at - timedelta(hours=6),
            is_dark_vessel=False,
            expected_answer=f"rank MMSI {mmsi} first",
            notes="Tanker under way, continuous discharge along track. P004 Case 2 analogue.",
        )

    elif name == "berthed_discharge":
        # Case 3 analogue, the adversarial one: the vessel has not moved.
        mmsi = _mmsi(rng)
        berth = (centre_lat + 0.05, centre_lon - 0.05)
        moored_minutes = int(minutes * 0.75)
        approach = _transit_track(
            rng, region, start=start, minutes=minutes - moored_minutes, mmsi=mmsi,
            speed_knots=7.0,
        )
        records.extend(approach)
        moored = _moored_track(
            rng, region, start=start + timedelta(minutes=minutes - moored_minutes),
            minutes=moored_minutes, mmsi=mmsi, at=berth,
        )
        records.extend(moored)
        truth = ReleaseTruth(
            scenario=name, region=region.name, has_spill=True, discharging_mmsi=mmsi,
            release_lat=berth[0], release_lon=berth[1],
            release_start=moored[0].base_date_time,
            release_end=acquired_at - timedelta(hours=2),
            is_dark_vessel=False,
            expected_answer=f"rank MMSI {mmsi} first despite it never moving",
            notes=(
                "Berthed vessel discharging at its mooring. P004 Case 3 analogue: "
                "proximity and parity terms fail, only a backward-drift field reaching "
                "the berth at the right time can rank it."
            ),
        )

    elif name == "platform_leak":
        # Case 1 analogue: infrastructure leaks; vessels merely transit nearby.
        platform = (centre_lat, centre_lon)
        truth = ReleaseTruth(
            scenario=name, region=region.name, has_spill=True, discharging_mmsi=None,
            release_lat=platform[0], release_lon=platform[1],
            release_start=acquired_at - timedelta(hours=20),
            release_end=acquired_at, is_dark_vessel=False,
            expected_answer="rank the platform above every vessel; name no vessel",
            notes=(
                "Fixed infrastructure leak with unrelated traffic passing. P004 Case 1 "
                "analogue: tests that transiting vessels are filtered out rather than "
                "blamed for being nearby."
            ),
        )

    elif name == "dark_vessel":
        # The discharger transmits nothing. It exists only as a CFAR target.
        mmsi = _mmsi(rng)
        release_lat, release_lon = _offset(centre_lat, centre_lon, 45.0, 12.0)
        truth = ReleaseTruth(
            scenario=name, region=region.name, has_spill=True, discharging_mmsi=mmsi,
            release_lat=release_lat, release_lon=release_lon,
            release_start=acquired_at - timedelta(hours=18),
            release_end=acquired_at - timedelta(hours=9),
            is_dark_vessel=True,
            expected_answer=(
                "report an unattributed CFAR bright target; do NOT name any AIS vessel"
            ),
            notes=(
                "Discharger has AIS switched off and is deliberately absent from the "
                "generated traffic. The correct behaviour is to surface a dark target, "
                "never to substitute the nearest transmitting vessel."
            ),
        )

    else:  # null_case
        # A look-alike, no spill at all. The system must name nobody.
        truth = ReleaseTruth(
            scenario=name, region=region.name, has_spill=False, discharging_mmsi=None,
            release_lat=None, release_lon=None,
            release_start=None, release_end=None, is_dark_vessel=False,
            expected_answer="return insufficient_evidence and name nobody",
            notes=(
                "Biogenic film or low-wind dark patch with ordinary traffic present. "
                "The true negative: any named suspect here is a false accusation."
            ),
        )

    records.sort(key=lambda record: (record.mmsi, record.base_date_time))
    return SyntheticScenario(
        name=name, region=region.name, records=records, truth=truth, seed=seed
    )


def to_csv(records: Sequence[AisRecord]) -> str:
    """Serialise to the marinecadastre CSV the real loader reads.

    Written through the same column set the loader validates against, so a
    schema drift breaks both paths together rather than silently only one.
    """

    header = sorted(AIS_COLUMNS)
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=header, lineterminator="\n")
    writer.writeheader()
    for record in records:
        writer.writerow(
            {
                "MMSI": record.mmsi,
                "BaseDateTime": record.base_date_time.strftime("%Y-%m-%dT%H:%M:%S"),
                "LAT": record.lat,
                "LON": record.lon,
                "SOG": "" if record.sog is None else record.sog,
                "COG": "" if record.cog is None else record.cog,
                "Heading": "" if record.heading is None else record.heading,
                "VesselName": record.vessel_name or "",
                "IMO": record.imo or "",
                "CallSign": record.call_sign or "",
                "VesselType": "" if record.vessel_type is None else record.vessel_type,
                "Status": "" if record.status is None else record.status,
                "Length": "" if record.length is None else record.length,
                "Width": "" if record.width is None else record.width,
                "Draft": "" if record.draft is None else record.draft,
                "Cargo": "" if record.cargo is None else record.cargo,
                "TransceiverClass": record.transceiver_class or "",
            }
        )
    return buffer.getvalue()
