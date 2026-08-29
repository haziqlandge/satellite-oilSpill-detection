"""Enable row-level security on every pipeline table.

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-28

Why this exists
---------------
The database moved from a local PostgreSQL to Supabase. Supabase runs PostgREST
over the `public` schema, so tables here sit somewhere that *can* be reached
over HTTPS. Whether they actually are depends on the project's Data API
settings and on grants to the `anon` / `authenticated` roles -- but relying on
that staying shut is not a security posture.

Enabling RLS with **no policies** makes the default deny-all. The `postgres`
role the pipeline connects as has BYPASSRLS, so ingest and querying are
unaffected; only PostgREST-facing roles are shut out.

This matters more than usual here: `ais_points` holds vessel movement data and
`candidates` / `scores` hold provisional accusations of an environmental
offence. Neither should be world-readable because of a default.

If a policy is ever needed (a public read-only demo, say), add it in a later
migration and state who it is for. Do not weaken this one.

Why ENABLE and not FORCE
------------------------
FORCE additionally applies RLS to the table *owner*. Verified against this
project: `postgres` and `service_role` both have `rolbypassrls = true`, while
`anon` and `authenticated` do not. A BYPASSRLS role skips row security whether
or not FORCE is set, so FORCE would buy nothing against the actual threat
(PostgREST-facing roles) while adding a way to lock out a future connecting
role that lacks BYPASSRLS. ENABLE is what does the work here.
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Kept explicit rather than reflected from metadata: a new table should be a
# deliberate decision to add here, not silently inherit protection.
TABLES = (
    "scenes",
    "detections",
    "characterisations",
    "drift_runs",
    "ais_points",
    "ais_tracks",
    "candidates",
    "scores",
    "alembic_version",
)


def upgrade() -> None:
    for table in TABLES:
        op.execute(f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY")


def downgrade() -> None:
    for table in TABLES:
        op.execute(f"ALTER TABLE public.{table} DISABLE ROW LEVEL SECURITY")
