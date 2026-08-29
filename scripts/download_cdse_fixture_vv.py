"""Download the unambiguous Case-1 and Case-2 Sentinel-1 VV COGs from CDSE."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from pydantic_settings import BaseSettings, SettingsConfigDict


class Credentials(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    cdse_username: str = ""
    cdse_password: str = ""


def get_token() -> str:
    credentials = Credentials()
    payload = urlencode(
        {
            "grant_type": "password",
            "client_id": "cdse-public",
            "username": credentials.cdse_username,
            "password": credentials.cdse_password,
        }
    ).encode()
    request = Request(
        "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token",
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urlopen(request, timeout=30) as response:
        return json.load(response)["access_token"]


PRODUCTS = (
    ("f0fde4fc-1ddb-4fe9-8860-396cc2a4ca79", "S1A_IW_GRDH_1SDV_20230409T000206_20230409T000231_048012_05C552_0592_COG.SAFE", "s1a-iw-grd-vv-20230409t000206-20230409t000231-048012-05c552-001-cog.tiff"),
    ("12eedebb-cfa9-4c9b-bbe6-b1b5a35e4a17", "S1A_IW_GRDH_1SDV_20230515T000208_20230515T000233_048537_05D69B_7E55_COG.SAFE", "s1a-iw-grd-vv-20230515t000208-20230515t000233-048537-05d69b-001-cog.tiff"),
    ("c0095618-3d10-4dc4-bcd2-92f24281b067", "S1A_IW_GRDH_1SDV_20231205T000214_20231205T000239_051512_0637C7_0A45_COG.SAFE", "s1a-iw-grd-vv-20231205t000214-20231205t000239-051512-0637c7-001-cog.tiff"),
)


def main() -> None:
    token = get_token()
    target = Path("data/raw/sar")
    target.mkdir(parents=True, exist_ok=True)
    for product_id, root, filename in PRODUCTS:
        destination = target / filename
        if destination.exists() and destination.stat().st_size > 0:
            print(f"already present: {destination.name}", flush=True)
            continue
        url = (
            f"https://download.dataspace.copernicus.eu/odata/v1/Products({product_id})/"
            f"Nodes({root})/Nodes(measurement)/Nodes({filename})/$value"
        )
        with (
            urlopen(Request(url, headers={"Authorization": f"Bearer {token}"}), timeout=120) as response,
            destination.open("wb") as output,
        ):
            shutil.copyfileobj(response, output, length=1024 * 1024)
        print(f"downloaded: {destination.name} ({destination.stat().st_size} bytes)", flush=True)


if __name__ == "__main__":
    main()
