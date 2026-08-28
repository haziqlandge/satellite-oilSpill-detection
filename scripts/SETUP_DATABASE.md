# Setting up PostGIS

The plan assumed Docker. Docker is **not installed on this machine**, so the two
supported routes are below. PostGIS is not needed until PHASE-01 — the PHASE-00 scaffold
and its tests run without it.

Verify either route with:

```bash
.venv/Scripts/python.exe -m backend.cli doctor
```

---

## Route A — native Windows install (recommended here, no Docker)

1. Install **PostgreSQL 16** from the EDB installer:
   <https://www.enterprisedb.com/downloads/postgres-postgresql-downloads>
   Keep the default port `5432`. Remember the `postgres` superuser password.

2. At the end of the installer, launch **Stack Builder** and install
   **Spatial Extensions → PostGIS 3.4 Bundle**. If you skipped it, re-run
   `"C:\Program Files\PostgreSQL\16\bin\stackbuilder.exe"`.

3. Create the role and database:

```bash
"/c/Program Files/PostgreSQL/16/bin/psql" -U postgres -c "CREATE ROLE oilspill LOGIN PASSWORD 'oilspill';"
```

```bash
"/c/Program Files/PostgreSQL/16/bin/psql" -U postgres -c "CREATE DATABASE oilspill OWNER oilspill;"
```

```bash
"/c/Program Files/PostgreSQL/16/bin/psql" -U postgres -d oilspill -c "CREATE EXTENSION postgis;"
```

4. Confirm, then apply migrations:

```bash
.venv/Scripts/python.exe -m alembic upgrade head
```

---

## Route B — Docker (if you install it later)

`docker-compose.yml` in the repo root is ready to use:

```bash
docker compose up -d postgis
```

```bash
.venv/Scripts/python.exe -m alembic upgrade head
```

---

## Notes

- `DATABASE_URL` in `.env` is the single source of truth for the connection string —
  `alembic.ini` reads it from there, so there is nothing to keep in sync.
- `backend/db/session.py` sets `connect_timeout=3`. Without it, psycopg retries every
  address `localhost` resolves to (`::1`, then `127.0.0.1`) on a very long default, and a
  probe against an absent server blocks for **over four minutes** — which is what it did
  before the timeout was added.
- Tests marked `integration` skip automatically when no database is reachable, so
  `pytest` stays green either way.
