"""Download the three P004 fixture scenes as full `.SAFE` products from CDSE.

`download_cdse_fixture_vv.py` fetched only the VV measurement band, which is
enough to look at but **not** enough to process: calibration to sigma0 reads the
LUTs under `annotation/calibration/`, and SNAP's Sentinel-1 reader wants a whole
`.SAFE` product. This pulls the complete archives so the SNAP graph in
`graphs/s1_grd_preprocess.xml` has something it can actually open.

Run from the repository root:

    .venv/Scripts/python.exe scripts/download_cdse_fixture_safe.py

Safe to re-run: a completed archive is skipped, and a partial one resumes.
"""

from __future__ import annotations

import sys
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

from backend.ingest.sar.cdse import CdseClient, CdseError, extract_safe

# (P004 case label, CDSE product id, archive stem)
#
# These are the **classic** GRD products, not the `_COG` variants CDSE also
# publishes for the same acquisitions. SNAP warns "The calibration LUT for this
# product could be incorrect and therefore the calibration result may not be
# reliable" on the COG packaging but not on the classic one, and an unreliable
# sigma0 undermines everything downstream. ~1.62 GB against ~0.87 GB.
#
# This is *not* what causes SNAP 14's geocoding failure -- that hits the classic
# products identically. See PHASE-01 "Confirmed on this hardware".
FIXTURES = (
    (
        "Case 1  2023-04-09  platform leak, no vessel within 5 km",
        "a00e7296-27a1-42a0-8d66-4be2d3e5eca0",
        "S1A_IW_GRDH_1SDV_20230409T000206_048012_05C552_27F2",
    ),
    (
        "Case 2  2023-05-15  moving tanker, ~19 km slick (headline)",
        "3cd83cf9-7a61-450a-a9ae-63c8f3bba1d4",
        "S1A_IW_GRDH_1SDV_20230515T000208_048537_05D69B_35AF",
    ),
    (
        "Case 3  2023-12-05  vessel berthed since 3 Dec (adversarial)",
        "104dd7cc-f057-406f-98c1-4116590f9e9f",
        "S1A_IW_GRDH_1SDV_20231205T000214_051512_0637C7_66B8",
    ),
)

TARGET = Path("data/raw/sar/safe")


class Credentials(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    cdse_username: str = ""
    cdse_password: str = ""


def _progress(label: str):
    state = {"pct": -1}

    def report(written: int, total: int | None) -> None:
        if not total:
            return
        pct = int(written * 100 / total)
        if pct != state["pct"] and pct % 5 == 0:
            state["pct"] = pct
            gb = total / 1024**3
            print(f"    {label}: {pct:3d}%  of {gb:.2f} GB", flush=True)

    return report


def main() -> int:
    credentials = Credentials()
    if not credentials.cdse_username or not credentials.cdse_password:
        print("CDSE_USERNAME / CDSE_PASSWORD missing from .env", file=sys.stderr)
        return 2

    client = CdseClient(
        username=credentials.cdse_username,
        password=credentials.cdse_password,
    )
    TARGET.mkdir(parents=True, exist_ok=True)

    for label, product_id, stem in FIXTURES:
        archive = TARGET / f"{stem}.zip"
        safe_dir = TARGET / f"{stem}.SAFE"
        print(f"\n{label}")

        if safe_dir.exists():
            print(f"    already extracted: {safe_dir.name}")
            continue

        print(f"    downloading {product_id}")
        try:
            client.download_product(product_id, archive, progress=_progress(stem[:24]))
        except CdseError as error:
            print(f"    FAILED: {error}", file=sys.stderr)
            return 1

        size_gb = archive.stat().st_size / 1024**3
        print(f"    downloaded {archive.name} ({size_gb:.2f} GB), extracting")
        try:
            extracted = extract_safe(archive, TARGET)
        except (CdseError, OSError) as error:
            print(f"    FAILED to extract: {error}", file=sys.stderr)
            return 1
        print(f"    extracted {extracted.name}")

    print("\nall fixture products present")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
