"""SQLAlchemy models. Schemas are defined in PLAN/INTERFACES.md section 2.

Several constraints from PLAN/CONSTRAINTS.md are enforced *structurally* here
rather than left to convention, because they are correctness requirements that
are easy to violate under demo pressure:

  C1  age is never a bare scalar   -> three NOT NULL columns + a required method
  C2  damping is relative only     -> no thickness column exists; confidence is fixed
  C3  diffuse field must degrade   -> `insufficient_evidence` is a real state
  C4  scores decompose             -> terms and weights stored, not just the total
"""

from __future__ import annotations

import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import (
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship

SRID = 4326


class Base(DeclarativeBase):
    pass


def _pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


# --------------------------------------------------------------------------- #
# Imagery
# --------------------------------------------------------------------------- #
class Scene(Base):
    __tablename__ = "scenes"

    id: Mapped[uuid.UUID] = _pk()
    product_id: Mapped[str] = mapped_column(String(255), unique=True)
    platform: Mapped[str] = mapped_column(String(32), default="sentinel-1")
    mode: Mapped[str] = mapped_column(String(16), default="IW")
    polarisation: Mapped[str] = mapped_column(String(8), default="VV")
    acquired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    region: Mapped[str | None] = mapped_column(String(64))
    footprint = mapped_column(Geometry("POLYGON", srid=SRID))
    raster_path: Mapped[str | None] = mapped_column(Text)
    processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    detections: Mapped[list[Detection]] = relationship(back_populates="scene")

    __table_args__ = (Index("ix_scenes_footprint", "footprint", postgresql_using="gist"),)


# --------------------------------------------------------------------------- #
# Detection + characterisation
# --------------------------------------------------------------------------- #
class Detection(Base):
    """One slick instance. Classes follow P004: seawater is background, not a class."""

    __tablename__ = "detections"

    id: Mapped[uuid.UUID] = _pk()
    scene_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("scenes.id", ondelete="CASCADE"))
    class_name: Mapped[str] = mapped_column(String(32))
    confidence: Mapped[float] = mapped_column(Float)
    geom = mapped_column(Geometry("MULTIPOLYGON", srid=SRID))
    acquired_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    scene: Mapped[Scene] = relationship(back_populates="detections")
    characterisation: Mapped[Characterisation | None] = relationship(
        back_populates="detection", uselist=False
    )

    __table_args__ = (
        CheckConstraint("class_name IN ('oos', 'slick_unknown')", name="ck_detection_class"),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="ck_detection_conf"),
        Index("ix_detections_geom", "geom", postgresql_using="gist"),
    )


class Characterisation(Base):
    __tablename__ = "characterisations"

    id: Mapped[uuid.UUID] = _pk()
    detection_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("detections.id", ondelete="CASCADE"), unique=True
    )

    area_km2: Mapped[float] = mapped_column(Float)
    length_km: Mapped[float] = mapped_column(Float)
    width_m_mean: Mapped[float] = mapped_column(Float)
    width_m_profile: Mapped[list[float]] = mapped_column(JSONB)
    orientation_deg: Mapped[float] = mapped_column(Float)
    elongation: Mapped[float] = mapped_column(Float)
    compactness: Mapped[float] = mapped_column(Float)
    fragmentation: Mapped[int] = mapped_column(Integer)

    # Head/tail orientation is ambiguous from geometry alone; both are stored and
    # the drift field disambiguates (PHASE-03).
    head = mapped_column(Geometry("POINT", srid=SRID))
    tail = mapped_column(Geometry("POINT", srid=SRID))

    # C2: relative contrast only. There is deliberately no thickness column.
    damping_ratio_db: Mapped[float | None] = mapped_column(Float)
    damping_confidence: Mapped[str] = mapped_column(String(8), default="low")

    # C9: continuous multiplier, surfaced in the UI -- never a silent hard cut.
    wind_speed_ms: Mapped[float | None] = mapped_column(Float)
    wind_gate_multiplier: Mapped[float | None] = mapped_column(Float)

    detection: Mapped[Detection] = relationship(back_populates="characterisation")

    __table_args__ = (
        CheckConstraint("damping_confidence = 'low'", name="ck_damping_conf_low"),
        CheckConstraint(
            "wind_gate_multiplier IS NULL OR "
            "(wind_gate_multiplier >= 0 AND wind_gate_multiplier <= 1)",
            name="ck_wind_gate_range",
        ),
    )


# --------------------------------------------------------------------------- #
# Drift
# --------------------------------------------------------------------------- #
class DriftRun(Base):
    __tablename__ = "drift_runs"

    id: Mapped[uuid.UUID] = _pk()
    detection_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("detections.id", ondelete="CASCADE"))
    direction: Mapped[str] = mapped_column(String(8))
    horizon_hours: Mapped[int] = mapped_column(Integer)
    ensemble_size: Mapped[int] = mapped_column(Integer)
    particle_count: Mapped[int] = mapped_column(Integer)

    origin_field_path: Mapped[str | None] = mapped_column(Text)
    contours: Mapped[dict] = mapped_column(JSONB, default=dict)
    convergence: Mapped[list] = mapped_column(JSONB, default=list)

    # C1: age is a triple plus a method. A single scalar cannot be stored.
    age_hours_low: Mapped[float | None] = mapped_column(Float)
    age_hours_best: Mapped[float | None] = mapped_column(Float)
    age_hours_high: Mapped[float | None] = mapped_column(Float)
    age_method: Mapped[str | None] = mapped_column(String(32))
    temporal_state: Mapped[str | None] = mapped_column(String(16))

    # C3: a diffuse origin field is a legitimate result, not a failure.
    insufficient_evidence: Mapped[bool] = mapped_column(default=False)
    origin_area_km2: Mapped[float | None] = mapped_column(Float)

    __table_args__ = (
        CheckConstraint("direction IN ('backward', 'forward')", name="ck_drift_direction"),
        CheckConstraint("ensemble_size >= 1", name="ck_drift_ensemble"),
        CheckConstraint(
            "age_method IS NULL OR age_method IN "
            "('drift_convergence', 'source_coincidence', 'beyond_horizon')",
            name="ck_age_method",
        ),
        CheckConstraint(
            "temporal_state IS NULL OR temporal_state IN "
            "('ongoing', 'recent', 'legacy', 'indeterminate')",
            name="ck_temporal_state",
        ),
        # C1 enforced structurally: all three bounds together, or none.
        CheckConstraint(
            "(age_hours_low IS NULL AND age_hours_best IS NULL AND age_hours_high IS NULL)"
            " OR (age_hours_low IS NOT NULL AND age_hours_best IS NOT NULL"
            "     AND age_hours_high IS NOT NULL AND age_method IS NOT NULL)",
            name="ck_age_triple_complete",
        ),
        CheckConstraint(
            "age_hours_low IS NULL OR"
            " (age_hours_low <= age_hours_best AND age_hours_best <= age_hours_high)",
            name="ck_age_ordered",
        ),
    )


# --------------------------------------------------------------------------- #
# AIS
# --------------------------------------------------------------------------- #
class AisPoint(Base):
    """marinecadastre schema (PLAN/INTERFACES.md section 5).

    Real and synthetic records share this table; `source` distinguishes them so
    a demo can never silently present synthetic traffic as real.
    """

    __tablename__ = "ais_points"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    mmsi: Mapped[int] = mapped_column(Integer)
    base_date_time: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    geom = mapped_column(Geometry("POINT", srid=SRID))
    sog: Mapped[float | None] = mapped_column(Float)
    cog: Mapped[float | None] = mapped_column(Float)
    heading: Mapped[float | None] = mapped_column(Float)
    vessel_name: Mapped[str | None] = mapped_column(String(128))
    imo: Mapped[str | None] = mapped_column(String(32))
    call_sign: Mapped[str | None] = mapped_column(String(32))
    vessel_type: Mapped[int | None] = mapped_column(Integer)
    status: Mapped[int | None] = mapped_column(Integer)
    length: Mapped[float | None] = mapped_column(Float)
    width: Mapped[float | None] = mapped_column(Float)
    draft: Mapped[float | None] = mapped_column(Float)
    cargo: Mapped[int | None] = mapped_column(Integer)
    transceiver_class: Mapped[str | None] = mapped_column(String(8))
    source: Mapped[str] = mapped_column(String(16), default="real")

    __table_args__ = (
        UniqueConstraint("mmsi", "base_date_time", "source", name="uq_ais_point"),
        CheckConstraint("source IN ('real', 'synthetic')", name="ck_ais_source"),
        Index("ix_ais_points_geom", "geom", postgresql_using="gist"),
        Index("ix_ais_points_time", "base_date_time", postgresql_using="brin"),
        Index("ix_ais_points_mmsi", "mmsi"),
    )


class AisTrack(Base):
    """Per-vessel trajectory. LINESTRING M carries epoch seconds in the M ordinate,
    so a spatiotemporal gate is a single PostGIS operation."""

    __tablename__ = "ais_tracks"

    id: Mapped[uuid.UUID] = _pk()
    mmsi: Mapped[int] = mapped_column(Integer)
    vessel_name: Mapped[str | None] = mapped_column(String(128))
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    geom = mapped_column(Geometry("LINESTRINGM", srid=SRID))
    behaviour: Mapped[dict] = mapped_column(JSONB, default=dict)
    source: Mapped[str] = mapped_column(String(16), default="real")

    __table_args__ = (
        Index("ix_ais_tracks_geom", "geom", postgresql_using="gist"),
        Index("ix_ais_tracks_mmsi", "mmsi"),
    )


# --------------------------------------------------------------------------- #
# Attribution
# --------------------------------------------------------------------------- #
class Candidate(Base):
    __tablename__ = "candidates"

    id: Mapped[uuid.UUID] = _pk()
    drift_run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("drift_runs.id", ondelete="CASCADE"))
    kind: Mapped[str] = mapped_column(String(16))
    mmsi: Mapped[int | None] = mapped_column(Integer)
    vessel_name: Mapped[str | None] = mapped_column(String(128))
    geom = mapped_column(Geometry(srid=SRID))

    score: Mapped[SuspectScore | None] = relationship(back_populates="candidate", uselist=False)

    __table_args__ = (
        CheckConstraint(
            "kind IN ('ais_vessel', 'dark_vessel', 'infrastructure')", name="ck_candidate_kind"
        ),
        # Dark vessels have no identity and must never be named.
        CheckConstraint(
            "kind <> 'dark_vessel' OR (mmsi IS NULL AND vessel_name IS NULL)",
            name="ck_dark_vessel_anonymous",
        ),
        Index("ix_candidates_geom", "geom", postgresql_using="gist"),
    )


class SuspectScore(Base):
    """C4: the total alone is not a storable result. Terms, weights and the
    evidence card are required columns."""

    __tablename__ = "scores"

    id: Mapped[uuid.UUID] = _pk()
    candidate_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("candidates.id", ondelete="CASCADE"), unique=True
    )
    total: Mapped[float] = mapped_column(Float)
    rank: Mapped[int] = mapped_column(Integer)
    terms: Mapped[dict] = mapped_column(JSONB)
    weights: Mapped[dict] = mapped_column(JSONB)
    weights_version: Mapped[str] = mapped_column(String(32))
    evidence: Mapped[dict] = mapped_column(JSONB)

    candidate: Mapped[Candidate] = relationship(back_populates="score")

    __table_args__ = (
        CheckConstraint("total >= 0 AND total <= 1", name="ck_score_range"),
        CheckConstraint("rank >= 1", name="ck_score_rank"),
    )
