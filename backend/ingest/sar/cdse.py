"""CDSE OData product download, with token refresh and byte-range resume.

`fetch.py` covers the credential-free AWS/STAC path and pulls individual
measurement assets. That is not enough for the SNAP chain: SNAP's Sentinel-1
reader needs a complete `.SAFE` product, because calibration to sigma0 reads
the LUTs under `annotation/calibration/`. A bare measurement band cannot be
calibrated at all.

Two failure modes listed in PHASE-01 "Known failure conditions" are handled
here rather than left to the caller:

* **OAuth token expiry mid-download.** CDSE access tokens live ~10 minutes and
  an IW GRDH product is 1-2 GB, so a single download routinely outlives its
  token. The token is refreshed a minute early, and a 401 mid-stream is
  recovered by refreshing and resuming rather than restarting.
* **Interrupted transfers.** Resume is attempted with a Range request, but
  **CDSE's `Products(id)/$value` endpoint does not honour it** -- confirmed
  2026-08-29, it answers a ranged request with `200` and the whole body rather
  than `206`. Appending that onto a partial file would produce a corrupt archive
  that only fails much later at extract time, so a non-`206` answer discards the
  partial file and restarts. The Range path is kept for the day the endpoint
  gains support, and because mirrors of the same product do honour it.
"""

from __future__ import annotations

import json
import shutil
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

TOKEN_URL = (
    "https://identity.dataspace.copernicus.eu/auth/realms/CDSE"
    "/protocol/openid-connect/token"
)
ODATA_ROOT = "https://download.dataspace.copernicus.eu/odata/v1"

# Refresh this many seconds before the server-stated expiry. A token that
# expires while the request is in flight fails the whole transfer, so trading
# a slightly earlier refresh for that risk is worth it.
TOKEN_SAFETY_MARGIN_S = 60

# Fall back to this lifetime when the token response omits `expires_in`.
DEFAULT_TOKEN_LIFETIME_S = 600

_CHUNK = 1024 * 1024


class CdseError(RuntimeError):
    """CDSE authentication or download failure."""


@dataclass
class CdseClient:
    """Authenticated CDSE OData client.

    Holds one access token and renews it on demand. Not thread-safe; the
    ingest path is sequential by design.
    """

    username: str
    password: str
    _token: str | None = field(default=None, repr=False)
    _expires_at: float = field(default=0.0, repr=False)

    def token(self, *, force_refresh: bool = False) -> str:
        """Return a live access token, renewing it when near expiry."""

        if (
            not force_refresh
            and self._token is not None
            and time.monotonic() < self._expires_at
        ):
            return self._token

        payload = urlencode(
            {
                "grant_type": "password",
                "client_id": "cdse-public",
                "username": self.username,
                "password": self.password,
            }
        ).encode()
        request = Request(
            TOKEN_URL,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        try:
            with urlopen(request, timeout=30) as response:
                document = json.load(response)
        except HTTPError as error:  # pragma: no cover - network failure path
            raise CdseError(
                f"CDSE token request failed with HTTP {error.code}. "
                "Check CDSE_USERNAME / CDSE_PASSWORD in .env."
            ) from error

        access_token = document.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise CdseError("CDSE token response contained no access_token")

        lifetime = document.get("expires_in", DEFAULT_TOKEN_LIFETIME_S)
        lifetime = int(lifetime) if isinstance(lifetime, int | float | str) else DEFAULT_TOKEN_LIFETIME_S
        self._token = access_token
        self._expires_at = time.monotonic() + max(lifetime - TOKEN_SAFETY_MARGIN_S, 0)
        return access_token

    def download_product(
        self,
        product_id: str,
        destination: Path,
        *,
        progress: Callable[[int, int | None], None] | None = None,
    ) -> Path:
        """Download one full product archive, resuming a partial file if present.

        Returns the destination path. The caller decides what to do with the
        archive; nothing is extracted here.
        """

        destination.parent.mkdir(parents=True, exist_ok=True)
        url = f"{ODATA_ROOT}/Products({product_id})/$value"

        for attempt in (1, 2):
            offset = destination.stat().st_size if destination.exists() else 0
            headers = {"Authorization": f"Bearer {self.token()}"}
            if offset:
                headers["Range"] = f"bytes={offset}-"

            try:
                with urlopen(Request(url, headers=headers), timeout=120) as response:
                    # A ranged request answered with 200 means the server is
                    # replying with the entire body. Appending would corrupt
                    # the file, so start clean.
                    resuming = offset > 0 and response.status == 206
                    if offset and not resuming:
                        offset = 0

                    total = _content_length(response, offset)
                    mode = "ab" if resuming else "wb"
                    written = offset if resuming else 0
                    with destination.open(mode) as output:
                        while chunk := response.read(_CHUNK):
                            output.write(chunk)
                            written += len(chunk)
                            if progress is not None:
                                progress(written, total)
                return destination

            except HTTPError as error:
                # One retry, and only for an expired token -- anything else is
                # a real error the caller needs to see rather than a hang.
                if error.code in (401, 403) and attempt == 1:
                    self.token(force_refresh=True)
                    continue
                raise CdseError(
                    f"CDSE download of {product_id} failed with HTTP {error.code}"
                ) from error

        raise CdseError(f"CDSE download of {product_id} failed after token refresh")


def _content_length(response: object, offset: int) -> int | None:
    """Total product size in bytes, if the response states it."""

    headers = getattr(response, "headers", None)
    if headers is None:
        return None
    content_range = headers.get("Content-Range")
    if content_range and "/" in content_range:
        tail = content_range.rsplit("/", 1)[-1].strip()
        if tail.isdigit():
            return int(tail)
    length = headers.get("Content-Length")
    if length and str(length).isdigit():
        return int(length) + offset
    return None


def extract_safe(archive: Path, target_dir: Path) -> Path:
    """Unpack a product archive and return the `.SAFE` directory it produced.

    The `.SAFE` name inside the archive is not the archive's own stem, so the
    new directory is identified by diffing the target before and after. Taking
    the first match instead would report an unrelated product once more than one
    scene has been extracted into the same directory.
    """

    target_dir.mkdir(parents=True, exist_ok=True)
    before = {path.name for path in target_dir.glob("*.SAFE")}
    shutil.unpack_archive(str(archive), str(target_dir))
    created = sorted(
        path for path in target_dir.glob("*.SAFE") if path.name not in before
    )
    if created:
        return created[0]

    # Re-extracting over an existing directory is not an error, but we can no
    # longer identify it by diff, so fall back to the most recently touched.
    existing = sorted(
        target_dir.glob("*.SAFE"), key=lambda p: p.stat().st_mtime, reverse=True
    )
    if not existing:
        raise CdseError(f"no .SAFE directory found after extracting {archive.name}")
    return existing[0]
