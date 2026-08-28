# Database setup - Supabase

**Decision, 2026-08-28:** the project uses **Supabase** (hosted Postgres + PostGIS) instead
of a local PostgreSQL or Docker container. User's call, made with the trade-offs below on
the table.

Supabase is Postgres, so the schema in `backend/db/models.py` and the alembic baseline
transfer essentially unchanged. PostGIS is available as an extension.

---

## 1. The project already exists

Created 2026-08-28 via the Supabase MCP connector. **Do not create a second one.**

| Field | Value |
|---|---|
| Name | **`oilSpill-Detect`** |
| Project ref | `hbctpozvofhxlioywcjw` |
| Organisation | ACM (`jpeeoezyysgtfndmxozv`) |
| Region | `ap-south-1` (Mumbai) |
| Postgres | 17.6 |
| PostGIS | 3.3 (enabled, `USE_GEOS=1 USE_PROJ=1`) |
| Cost | Free tier, $0/month |
| Database host | `db.hbctpozvofhxlioywcjw.supabase.co` |

**You still need to set the database password.** The project was created through the API,
which does not surface one. In the dashboard go to
**Project Settings > Database > Database password > Reset database password**, generate one,
and save it in a password manager. That is the password for the `postgres` role in the
connection string below.

## 2. PostGIS is already enabled

Done at creation. Verify any time with:

```sql
select postgis_version();
```

`extensions` is already on the `search_path` for this project
(`"$user", public, extensions`), so geometry types resolve without extra configuration.

## 3. Get the connection string

Dashboard: **Project Settings > Database > Connection string > URI**.

Supabase offers more than one, and **the difference matters**:

| Connection | Port | Use for |
|---|---|---|
| **Direct** (`db.<ref>.supabase.co`) | 5432 | **Alembic migrations, bulk ingest** |
| **Session pooler** (Supavisor) | 5432 | Long-lived app connections |
| **Transaction pooler** (Supavisor) | 6543 | Short serverless queries |

**Use the direct connection (or session pooler) for migrations.** The transaction pooler
does not support prepared statements, and both alembic and psycopg3 rely on them; pointing
alembic at port 6543 fails in confusing ways.

Copy the URI exactly from the dashboard - do not hand-assemble the hostname.

## 4. Configure the project

In `.env` (git-ignored), convert the URI to the psycopg3 driver form by replacing the
`postgresql://` scheme with `postgresql+psycopg://`, and append `sslmode=require`:

```
DATABASE_URL=postgresql+psycopg://postgres:<password>@db.hbctpozvofhxlioywcjw.supabase.co:5432/postgres?sslmode=require
DB_CONNECT_TIMEOUT=15
```

`DB_CONNECT_TIMEOUT` defaults to 15 s for a remote database. The local-Postgres default of
3 s was tuned for a socket on the same machine and will spuriously fail against Supabase,
especially on a free-tier project waking from pause.

URL-encode any special characters in the password (`@` becomes `%40`, and so on).

## 5. Apply the schema

```bash
.venv/Scripts/python.exe -m alembic upgrade head
```

Then verify:

```bash
.venv/Scripts/python.exe -m backend.cli doctor
```

`doctor` should report the database as ok with a PostGIS version.

---

## Trade-offs accepted with this choice

Recorded so nobody rediscovers these as surprises. These are real and were raised before
the decision; the decision stands, and these are the mitigations.

### The demo is no longer offline-capable by default

PHASE-09 originally required the whole demo to run with networking disabled, because
network dependence is the most common way a live demo dies. With a hosted database that
guarantee is gone: venue wifi failing now takes out the entire demo, not just live data.

**Mitigation, to build in PHASE-09:** export the demo result set to a local SQLite or
Postgres snapshot and add a `DEMO_OFFLINE=1` path that reads from it. The result set after
PHASE-08 is small (scenes, detections, drift contours, ranked candidates), so this is
cheap. See `PLAN/phases/PHASE-09.md`.

### Storage ceiling versus AIS volume

marinecadastre daily national files run to millions of rows. Free tier is **500 MB**; Pro
is **8 GB**. `ais_points` is the table that will hit this first.

**Mitigations:**
- Clip AIS to the **AOI bounding box and the acquisition time window** at ingest, before
  insert. We only ever query traffic near a detection, so nationwide rows are dead weight.
- Keep raw AIS CSVs on local disk under `data/raw/`; only load the clipped subset.
- Watch table size in the dashboard; `ais_points` is the one to check.

### Bulk ingest is slower over the network

Local `COPY` runs at disk speed. The same insert to a hosted instance is bound by
bandwidth and round trips.

**Mitigation:** use `COPY ... FROM STDIN` through psycopg's `cursor.copy()` rather than
row-by-row `INSERT`, and batch. Clipping first (above) is what makes this tractable.

### Free-tier projects pause

A free Supabase project pauses after about a week of inactivity and must be resumed from
the dashboard. If `doctor` reports a connection timeout after a quiet period, check the
dashboard before debugging anything else.

### Tables become reachable through the auto-generated REST API

This did not exist with a local Postgres and is easy to miss. Supabase runs PostgREST over
the `public` schema, so our tables sit in a schema that **can** be reached over HTTPS.

Two separate gates decide whether they actually are:

1. **Table exposure** - whether the `anon` / `authenticated` roles have been granted access.
   Depending on the project's Data API settings, newly created tables are not always
   exposed automatically, and may need an explicit `GRANT`.
2. **Row-level security** - which rows are visible *once* a table is reachable.

Do not rely on gate 1 staying shut. Enable RLS on every table in `public` regardless, as
defence in depth, **before loading any real data**:

- **Enable RLS with no policies** on every table. With RLS on and no policy, the default
  is deny-all:
  ```sql
  alter table public.ais_points enable row level security;
  ```
  Repeat per table. The `postgres` role the pipeline connects as bypasses RLS, so ingest
  and querying are unaffected.
- **Or** move the pipeline tables into a schema that is not exposed (Settings > API >
  Exposed schemas) and point alembic at it. Cleaner, since none of this data is meant to
  be served to browsers directly.

Check the project's current setting at **Dashboard > Integrations > Data API > Settings**
before assuming either way.

Run `get_advisors` (security) after `alembic upgrade head` - it flags exactly this.

### Secrets

`DATABASE_URL` now contains a real password to a hosted service. It lives in `.env`, which
is git-ignored, and must not be committed, pasted into an issue, or included in a shared
zip. Rotate it from the dashboard if it leaks.

---

## Superseded

`docker-compose.yml` in the repository root still defines a `postgis` service. It is no
longer the supported path and is kept only as a fallback if the Supabase decision is ever
reversed. The `ingest` service in that file is still relevant - it exists for ESA SNAP, not
for the database.
