"""PHASE-06's two recorded comparisons: S_drift max vs integral, and the Case 3 ablation.

On the five authored scenarios, through `backend/attribute` (which reproduces
the console's scorer exactly, `tests/test_attribution.py`):

  * the truth's rank and margin under each S_drift variant;
  * **term ablation** -- S_drift's weight removed and the rest renormalised,
    over the same gated candidates (the console's `rankWithoutDrift`);
  * **field ablation** -- no field at all: every vessel in the traffic is a
    candidate (no gate) and S_drift is removed. That is Cerulean's position,
    geometry standing in for transport, and the fuller test of the claim.

The field ablation needs every vessel, which the committed fixtures do not
carry (they keep the gate's near misses only). Export them first:

    cd frontDemo && npm run export:scoring-fixtures -- --all-vessels <dir>
    .venv/Scripts/python.exe -m scripts.attribution_ablation <dir>
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from typing import Any

from backend.attribute import scoring
from backend.attribute.scoring import DriftVariant
from tests.test_attribution import SCENARIOS, _input, _load

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "eval/attribution/ablation.json"


def truth_row(result: dict[str, Any], key: str) -> dict[str, Any]:
    rows = sorted(result["suspects"], key=lambda s: -s[key])
    truth = next((i for i, s in enumerate(rows) if s["isTruth"]), None)
    if truth is None:
        return {"rank": None, "of": len(rows)}
    other = next((s[key] for s in rows if not s["isTruth"]), None)
    return {"rank": truth + 1, "of": len(rows), "total": round(rows[truth][key], 4),
            "margin": None if other is None else round(rows[truth][key] - other, 4)}


def main() -> int:
    directory = Path(sys.argv[1]) if len(sys.argv) > 1 else None
    if directory is None:
        print(__doc__)
        return 1
    import tests.test_attribution as fixtures

    fixtures.FIXTURES = directory
    report: dict[str, Any] = {"weights": scoring.WEIGHTS, "scenarios": {}}
    for scenario in SCENARIOS:
        fixture = _load(f"{scenario}.json.gz")
        row: dict[str, Any] = {"vessels": len(fixture["input"]["vessels"])}
        variants: tuple[DriftVariant, ...] = ("integral", "max")
        for variant in variants:
            started = time.perf_counter()
            result = scoring.score(_input(fixture, variant))
            row[variant] = {
                **truth_row(result, "total"),
                "refused": (result["insufficientEvidence"] or {}).get("reason"),
                "admitted": result["gate"]["admitted"],
                "seconds": round(time.perf_counter() - started, 3),
            }
        row["termAblation"] = truth_row(scoring.score(_input(fixture, "integral")), "totalWithoutDrift")
        # No field: admit every track with a report (a gate at 0 passes all), rank on
        # the other five terms. A vessel with no report in the window is no candidate.
        unfielded = _input(fixture, "integral")
        unfielded.vessels = [v for v in unfielded.vessels if v.points]
        gate = scoring.GATE_THRESHOLD
        scoring.GATE_THRESHOLD = 0.0
        try:
            row["fieldAblation"] = truth_row(scoring.score(unfielded), "totalWithoutDrift")
        finally:
            scoring.GATE_THRESHOLD = gate
        report["scenarios"][scenario] = row
        print(scenario, json.dumps(row))
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(report, indent=2))
    print(f"wrote {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
