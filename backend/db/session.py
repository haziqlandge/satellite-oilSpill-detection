"""Database engine and session handling.

The engine is created lazily so that importing `backend` never touches the
network or a socket -- the CLI, tests and docs generation must all work with no
database present. See PLAN/PHASE-00.md.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache

from sqlalchemy import Engine, create_engine, text
from sqlalchemy.orm import Session, sessionmaker

from backend.config import get_settings


@lru_cache(maxsize=1)
def get_engine() -> Engine:
    """Engine for the hosted database.

    An explicit connect timeout is essential: without one, psycopg retries every
    address the host resolves to on a very long default, so an unreachable
    server blocks for minutes and makes the test suite unusable. The value is
    configurable because the right number differs by an order of magnitude
    between a local socket and a hosted instance (see DB_CONNECT_TIMEOUT).

    pool_recycle guards against a hosted provider dropping idle connections
    server-side and leaving a stale handle in the pool.
    """
    settings = get_settings()
    return create_engine(
        settings.database_url,
        pool_pre_ping=True,
        pool_recycle=1800,
        future=True,
        connect_args={"connect_timeout": settings.db_connect_timeout},
    )


@lru_cache(maxsize=1)
def get_session_factory() -> sessionmaker[Session]:
    return sessionmaker(bind=get_engine(), expire_on_commit=False, future=True)


@contextmanager
def session_scope() -> Iterator[Session]:
    session = get_session_factory()()
    try:
        yield session
        session.commit()
    except Exception:
        session.rollback()
        raise
    finally:
        session.close()


def check_connection() -> tuple[bool, str]:
    """Probe the database without raising.

    Returns (ok, detail). Used by `oilspill doctor` and by tests to decide
    whether to skip integration cases.
    """
    try:
        with get_engine().connect() as conn:
            version = conn.execute(text("SELECT version()")).scalar_one()
            try:
                postgis = conn.execute(text("SELECT PostGIS_Version()")).scalar_one()
            except Exception:
                return False, f"connected, but PostGIS extension is missing ({version})"
            return True, f"PostGIS {postgis}"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"
