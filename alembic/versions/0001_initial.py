"""Initial schema: PostGIS extension and all core tables.

Revision ID: 0001
Revises:
Create Date: PHASE-00

This baseline migration builds the schema directly from the SQLAlchemy metadata
rather than transcribing every column by hand. There was no live database to
autogenerate against when it was written, and hand-transcription of eight tables
with their CHECK constraints would risk silently diverging from
`backend/db/models.py` -- which is the source of truth for the schema
(PLAN/INTERFACES.md section 2).

Subsequent migrations should be produced with `alembic revision --autogenerate`
against a database at this baseline, which will then diff correctly.
"""

from __future__ import annotations

from collections.abc import Sequence

import geoalchemy2  # noqa: F401  (registers the Geometry type)

from alembic import op
from backend.db.models import Base

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
    # The postgis extension is deliberately left in place: other schemas in the
    # same database may depend on it.
