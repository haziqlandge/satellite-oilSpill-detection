"""Credential-free metadata and asset handling for AWS Sentinel-1 GRD COGs."""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any
from urllib.request import urlopen

AWS_S1_STAC_ROOT = "https://sentinel-s1-l1c-stac.s3.amazonaws.com/"


@dataclass(frozen=True, slots=True)
class SarAsset:
    """A selected Sentinel-1 measurement asset from a STAC item."""

    product_id: str
    acquired_at: str
    polarization: str
    href: str


def select_measurement_assets(item: dict[str, Any]) -> list[SarAsset]:
    """Select VV/VH measurement assets from a Sentinel-1 STAC item.

    The static AWS catalog names assets differently across historical records;
    metadata, key names, and titles are all considered rather than assuming one
    key convention.
    """

    product_id = str(item.get("id", ""))
    acquired_at = str(item.get("properties", {}).get("datetime", ""))
    if not product_id or not acquired_at:
        raise ValueError("STAC item must include id and properties.datetime")

    selected: list[SarAsset] = []
    for key, asset in item.get("assets", {}).items():
        text = " ".join(
            str(value)
            for value in (key, asset.get("title", ""), asset.get("description", ""))
        ).lower()
        polarization = "VV" if "vv" in text else "VH" if "vh" in text else None
        href = asset.get("href")
        if polarization is not None and isinstance(href, str):
            selected.append(SarAsset(product_id, acquired_at, polarization, href))
    if not selected:
        raise ValueError(f"no VV/VH measurement assets found in STAC item {product_id}")
    return sorted(selected, key=lambda asset: asset.polarization)


def load_stac_item(item_url: str) -> dict[str, Any]:
    """Load one public STAC item JSON document without cloud credentials."""

    with urlopen(item_url) as response:
        payload = json.load(response)
    if not isinstance(payload, dict):
        raise ValueError("STAC response is not a JSON object")
    return payload


def download_asset(asset: SarAsset, destination: Path) -> Path:
    """Stream one already-selected asset to disk.

    The AWS source may require a Requester Pays-enabled transfer at runtime;
    callers must surface that provider response instead of silently falling back
    to a different scene or date.
    """

    destination.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(asset.href) as response, destination.open("wb") as output:
        shutil.copyfileobj(response, output)
    return destination
