"""The presentation overlay's exported assets (`scripts/export_present_assets.py`).

The overlay's gate beat must show the backend's own gate, not a copy of it, so
`gate_admitted` is the loop `score()` runs, extracted; these tests hold the two
together and pin the values the overlay draws.
"""

from __future__ import annotations

from itertools import pairwise

import numpy as np

from backend.attribute.scoring import gate_admitted, score
from scripts import export_present_assets as present
from tests.test_attribution import _input, _load


def test_gate_admitted_matches_score_count() -> None:
    inp = _input(_load("gom-moving.json.gz"), "integral")
    assert len(gate_admitted(inp)) == score(inp)["gate"]["admitted"] == 22


def test_db_window_is_training_window() -> None:
    got = present.to_u8(np.array([-35.0, -17.5, 0.0, 5.0]))
    assert np.allclose(got, [0, 128, 255, 255], atol=1)


def test_mosaic_skips_tiles_with_land_or_no_data() -> None:
    sea = np.full((64, 64), 120, dtype=np.uint8)
    assert present.usable_tile(sea)
    land = sea.copy()
    land[:10, :] = 255
    assert not present.usable_tile(land)
    hole = sea.copy()
    hole[:, :8] = 0
    assert not present.usable_tile(hole)


def test_case2_terms_order_and_labels() -> None:
    card = present.case2_score()
    assert [t["key"] for t in card["terms"]] == ["drift", "parity", "proximity", "temporality", "behaviour", "prior"]
    assert [t["label"] for t in card["terms"]] == ["Drift", "Parity", "Proximity", "Timing", "Behaviour", "Vessel prior"]
    assert round(card["total"], 3) == 0.757
    assert all(0 < t["weight"] < 1 for t in card["terms"])


def test_ranking_is_case2_top_five_with_the_published_ship_first() -> None:
    rows = present.case2_ranking()
    assert [r["rank"] for r in rows] == [1, 2, 3, 4, 5]
    assert rows[0]["isTruth"] is True
    assert round(rows[0]["total"], 3) == 0.757
    assert all(a["total"] >= b["total"] for a, b in pairwise(rows))
    assert rows[1]["label"].startswith("MMSI 367")
    assert all("•" in r["label"] for r in rows[1:]), "the others stay masked"


def test_case2_candidate_is_the_published_vessel() -> None:
    card = present.case2_score()
    assert card["isTruth"] is True
    assert card["rank"] == 1
    assert card["of"] == 24
    assert card["detail"].startswith("Tanker, 180 m")


def test_case2_candidate_is_shown_by_its_masked_mmsi() -> None:
    # The user, 2026-09-27: the suspect reads as an MMSI, not a ship name.
    card = present.case2_score()
    assert card["label"] == "MMSI 477•••••5"
    assert present.case2_ranking()[0]["label"] == card["label"]
