"""Runtime configuration, loaded from environment / .env.

Nothing here reaches the network or the database at import time -- importing
`backend` must stay cheap and side-effect free so the CLI and tests start fast.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

REPO_ROOT = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # --- database ---
    database_url: str = Field(
        default="postgresql+psycopg://oilspill:oilspill@localhost:5432/oilspill",
        alias="DATABASE_URL",
    )

    # --- external services (see PLAN/PREREQUISITES.md) ---
    cdse_client_id: str = Field(default="", alias="CDSE_CLIENT_ID")
    cdse_client_secret: str = Field(default="", alias="CDSE_CLIENT_SECRET")
    cmems_username: str = Field(default="", alias="COPERNICUSMARINE_SERVICE_USERNAME")
    cmems_password: str = Field(default="", alias="COPERNICUSMARINE_SERVICE_PASSWORD")
    cdsapi_url: str = Field(default="", alias="CDSAPI_URL")
    cdsapi_key: str = Field(default="", alias="CDSAPI_KEY")

    # --- paths ---
    data_dir: Path = Field(default=REPO_ROOT / "data", alias="DATA_DIR")
    weights_dir: Path = Field(default=REPO_ROOT / "weights", alias="WEIGHTS_DIR")

    # --- runtime ---
    log_level: str = Field(default="INFO", alias="LOG_LEVEL")
    force_cpu: bool = Field(default=True, alias="FORCE_CPU")

    @property
    def raw_dir(self) -> Path:
        return self.data_dir / "raw"

    @property
    def interim_dir(self) -> Path:
        return self.data_dir / "interim"

    @property
    def processed_dir(self) -> Path:
        return self.data_dir / "processed"

    @property
    def cache_dir(self) -> Path:
        """Met-ocean forcing cache. The demo must run offline from here."""
        return self.data_dir / "cache"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
