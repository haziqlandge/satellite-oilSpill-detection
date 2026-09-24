"""Write a reviewer's downloaded decisions into a review pack's JSONs.

The review page (`scripts/cfar_review_pack.py`, `index.html`) cannot write
files, so it downloads one bundle of decisions. This applies it, and refuses
the WHOLE bundle if any part of it is wrong -- an unknown decision, a label the
pack does not have, no reviewer -- because a half-applied review is worse than
none: nobody can tell which half.

Only `oos` and `slick_unknown` become `confirmed_class`, the two classes the
scheme has (`relabel.CLASS_SCHEME`). A rejection (a ship wake, a look-alike, a
mis-drawn mask) or a deferral is recorded in `review_decision` and leaves
`confirmed_class` null, so `load_confirmed` never turns it into a label. Every
file is read back through `load_confirmed` after writing.

    .venv/Scripts/python.exe -m scripts.apply_review_decisions decisions.json \
        --pack eval/phase2-closure/annotation-pilot-cfar
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from backend.config import REPO_ROOT
from backend.ingest.datasets.relabel import load_confirmed

# decision -> the confirmed class it makes, if any
DECISIONS: dict[str, str | None] = {
    "oos": "oos",
    "slick_unknown": "slick_unknown",
    "reject_wake": None,
    "reject_lookalike": None,
    "reject_mask_error": None,
    "defer": None,
}
CONFIDENCE = {"low", "medium", "high"}


class ReviewBundleError(ValueError):
    """The bundle cannot be applied as it stands; nothing was written."""


def apply_bundle(bundle: dict[str, Any], pack: Path) -> dict[str, int]:
    """Apply every decision, or none. Returns counts of confirmed, rejected and deferred."""

    if bundle.get("version") != 1:
        raise ReviewBundleError(f"unknown bundle version {bundle.get('version')!r}")
    reviewer = bundle.get("reviewer")
    if not isinstance(reviewer, str) or not reviewer.strip():
        raise ReviewBundleError("the bundle names no reviewer; an unattributed label is an auto-label")
    decisions = bundle.get("decisions")
    if not isinstance(decisions, list):
        raise ReviewBundleError("the bundle has no decisions list")

    documents: dict[str, dict[str, Any]] = {}
    counts = {"confirmed": 0, "rejected": 0, "deferred": 0}
    for entry in decisions:
        source = entry.get("source")
        path = pack / "reviews" / f"{source}.json"
        if not isinstance(source, str) or not path.exists():
            raise ReviewBundleError(f"no review for source {source!r} in {pack}")
        document = documents.setdefault(source, json.loads(path.read_text(encoding="utf-8")))
        record = next((r for r in document["instances"] if r["label"] == entry.get("label")), None)
        if record is None:
            raise ReviewBundleError(f"{source}: no instance {entry.get('label')!r}")
        decision = entry.get("decision")
        if decision not in DECISIONS:
            raise ReviewBundleError(f"{source} #{record['label']}: unknown decision {decision!r}")
        confidence = entry.get("confidence")
        if confidence is not None and confidence not in CONFIDENCE:
            raise ReviewBundleError(f"{source} #{record['label']}: confidence must be one of {sorted(CONFIDENCE)}")
        confirmed = DECISIONS[decision]
        record["review_decision"] = decision
        record["confirmed_class"] = confirmed
        record["confirmed_by"] = reviewer.strip() if confirmed else None
        record["confirmed_confidence"] = confidence
        record["notes"] = str(entry.get("notes") or "")
        counts["confirmed" if confirmed else "deferred" if decision == "defer" else "rejected"] += 1

    for source, document in documents.items():
        path = pack / "reviews" / f"{source}.json"
        path.write_text(json.dumps(document, indent=2) + "\n", encoding="utf-8")
        load_confirmed(path)  # the same gate training uses; raises on anything it would refuse
    return counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("bundle", type=Path)
    parser.add_argument("--pack", type=Path, default=REPO_ROOT / "eval/phase2-closure/annotation-pilot-cfar")
    args = parser.parse_args()
    counts = apply_bundle(json.loads(args.bundle.read_text(encoding="utf-8")), args.pack)
    print(json.dumps(counts))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
