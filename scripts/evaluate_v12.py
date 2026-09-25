"""Release vs final-v12 model: validation, and the frozen Part II look-alike holdout (C8).

    .venv/Scripts/python.exe -m scripts.evaluate_v12 release   # needs only final-v12 on disk
    .venv/Scripts/python.exe -m scripts.evaluate_v12 v12       # after training
    .venv/Scripts/python.exe -m scripts.evaluate_v12 report

Same evaluator, settings and threshold policy as `scripts/evaluate_final_release.py`
(`AuditValidator`, confidence floor .001, max_det 1000, max pooled validation F1).
Validation here is final-v11's validation split, byte for byte. The consumed test
split is never read. Each (model, set) stage runs once: a `started.json` is created
exclusively, so a crashed holdout stage needs a person, not a silent retry.

Look-alike false alarms are reported beside mAP, never folded into it (C8).
"""

from __future__ import annotations

import json
import random
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import numpy as np
import torch

from ml.models.yolo_seg_lsk import register_lsk
from scripts.evaluate_final_release import SETTINGS, digest, operating_metrics, select_threshold
from scripts.review_screening import THRESHOLDS, AuditValidator

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "eval/part2"
V12 = ROOT / "data/processed/dataset/final-v12"
MODELS = {
    "release": ROOT / "weights/L1-ciou-research-v11.pt",  # promoted over 2026-09-25
    "v12": ROOT / "runs/final_v12_l1/L1-ciou/weights/best-fp32.pt",
}
SETS = {"val": V12 / "data.yaml", "holdout": V12 / "holdout.yaml"}
RELEASE_CONFIDENCE = 0.2  # eval/final/operational/frozen.json
MATCHED_RECALL = (0.30, 0.35, 0.40)


def stage(model: str, subset: str) -> list[dict[str, Any]]:
    out = OUT / f"{model}-{subset}"
    rows_path = out / "images.jsonl"
    identity = dict(
        model=digest(MODELS[model]),
        data=digest(SETS[subset]),
        listing=digest(V12 / ("val.txt" if subset == "val" else "holdout.txt")),
        settings=SETTINGS,
    )
    if (out / "summary.json").exists():
        summary = json.loads((out / "summary.json").read_text(encoding="utf-8"))
        if summary["identity"] != identity or digest(rows_path) != summary["rows_sha256"]:
            raise RuntimeError(f"{out} was made from different inputs")
        return [json.loads(line) for line in rows_path.read_text().splitlines()]
    out.mkdir(parents=True, exist_ok=True)
    with (out / "started.json").open("x", encoding="utf-8") as handle:
        json.dump(dict(identity=identity, started_at=datetime.now(UTC).isoformat()), handle)
    validator: Any = AuditValidator(
        args=dict(SETTINGS, model=str(MODELS[model]), data=str(SETS[subset]), split="val"),
        save_dir=out,
    )
    validator.audit_rows = []
    validator.audit_thresholds = THRESHOLDS
    validator.pixel_threshold = RELEASE_CONFIDENCE
    validator()
    rows: list[dict[str, Any]] = validator.audit_rows
    expected = len(
        (V12 / ("val.txt" if subset == "val" else "holdout.txt")).read_text().splitlines()
    )
    if len(rows) != expected or len({r["image"] for r in rows}) != expected:
        raise RuntimeError("dataset coverage/uniqueness mismatch")
    rows_path.write_text("".join(json.dumps(r) + "\n" for r in rows))
    summary = dict(
        identity=identity,
        completed_at=datetime.now(UTC).isoformat(),
        metrics=validator.metrics.results_dict,
        rows_sha256=digest(rows_path),
    )
    (out / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    return rows


def at(rows: list[dict[str, Any]], t: float) -> dict[str, Any]:
    """Counts at any confidence, from each row's own confidences (not only the sweep grid)."""
    ng = sum(r["ng"] for r in rows)
    tp = sum(sum(c >= t for c in r["matched_confidences"]) for r in rows)
    fp = sum(sum(c >= t for c in r["confidences"]) for r in rows) - tp
    neg = [r for r in rows if not r["ng"]]
    look = [r for r in neg if r["lookalike"]]
    nooil = [r for r in neg if "__No_oil__" in r["image"]]

    def alarms(group: list[dict[str, Any]]) -> int:
        return sum(any(c >= t for c in r["confidences"]) for r in group)

    return dict(
        confidence=round(t, 4),
        recall=tp / ng if ng else None,
        precision=tp / (tp + fp) if tp + fp else None,
        lookalike_alarm_tiles=alarms(look),
        lookalike_tiles=len(look),
        lookalike_fp_instances=sum(sum(c >= t for c in r["confidences"]) for r in look),
        no_oil_alarm_tiles=alarms(nooil),
        no_oil_tiles=len(nooil),
        negative_alarm_tiles=alarms(neg),
        negative_tiles=len(neg),
    )


def threshold_for_recall(rows: list[dict[str, Any]], target: float) -> float:
    """Highest confidence at which validation instance recall reaches `target`."""
    matched = sorted((c for r in rows for c in r["matched_confidences"]), reverse=True)
    need = int(np.ceil(target * sum(r["ng"] for r in rows)))
    return matched[need - 1] if 0 < need <= len(matched) else 0.0


def bootstrap(a: list[bool], b: list[bool], n: int = 3000) -> list[float]:
    """Paired tile bootstrap of the alarm-rate difference b - a (seed fixed)."""
    rng = random.Random(20260924)
    pairs = list(zip(a, b, strict=True))
    diffs = []
    for _ in range(n):
        sample = [pairs[rng.randrange(len(pairs))] for _ in pairs]
        diffs.append(
            sum(y for _, y in sample) / len(sample) - sum(x for x, _ in sample) / len(sample)
        )
    diffs.sort()
    return [diffs[int(0.025 * n)], diffs[int(0.975 * n)]]


def report() -> int:
    rows = {(m, s): stage(m, s) for m in MODELS for s in SETS}
    chosen = {m: select_threshold(rows[(m, "val")])[0] for m in MODELS}
    if chosen["release"] != RELEASE_CONFIDENCE:
        raise RuntimeError(
            f"re-run release selects {chosen['release']}, frozen was {RELEASE_CONFIDENCE}"
        )
    result: dict[str, Any] = dict(
        operating_confidence=chosen, models={k: digest(v) for k, v in MODELS.items()}
    )
    for model in MODELS:
        summary = json.loads((OUT / f"{model}-val" / "summary.json").read_text())["metrics"]
        result[model] = dict(
            val_map=dict(
                mask_map50_95=summary["metrics/mAP50-95(M)"],
                mask_map50=summary["metrics/mAP50(M)"],
                box_map50_95=summary["metrics/mAP50-95(B)"],
            ),
            val_operating=operating_metrics(rows[(model, "val")], chosen[model]),
            val_at_operating=at(rows[(model, "val")], chosen[model]),
            holdout_at_operating=at(rows[(model, "holdout")], chosen[model]),
            common={
                str(t): dict(
                    val=at(rows[(model, "val")], t), holdout=at(rows[(model, "holdout")], t)
                )
                for t in (0.2, 0.25)
            },
            matched_recall={
                str(r): dict(
                    val=at(rows[(model, "val")], threshold_for_recall(rows[(model, "val")], r)),
                    holdout=at(
                        rows[(model, "holdout")], threshold_for_recall(rows[(model, "val")], r)
                    ),
                )
                for r in MATCHED_RECALL
            },
        )

    def look_alarms(model: str, t: float) -> dict[str, bool]:
        return {
            r["image"]: any(c >= t for c in r["confidences"])
            for r in rows[(model, "holdout")]
            if r["lookalike"]
        }

    old, new = look_alarms("release", chosen["release"]), look_alarms("v12", chosen["v12"])
    names = sorted(old)
    result["holdout_lookalike_alarm_rate_difference_v12_minus_release"] = dict(
        point=(sum(new[n] for n in names) - sum(old[n] for n in names)) / len(names),
        ci95=bootstrap([old[n] for n in names], [new[n] for n in names]),
        note="each model at its own validation-selected operating point; paired over holdout look-alike tiles",
    )
    (OUT / "comparison.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(json.dumps({k: v for k, v in result.items() if k in ("operating_confidence",)}, indent=2))
    for model in MODELS:
        m, v, h = (
            result[model]["val_map"],
            result[model]["val_at_operating"],
            result[model]["holdout_at_operating"],
        )
        print(
            f"{model:8} conf {chosen[model]:.3f}  val mask AP50-95 {m['mask_map50_95']:.4f} AP50 {m['mask_map50']:.4f}"
            f"  val R {v['recall']:.4f} P {v['precision']:.4f}"
            f"  val look-alike {v['lookalike_alarm_tiles']}/{v['lookalike_tiles']}"
            f"  holdout look-alike {h['lookalike_alarm_tiles']}/{h['lookalike_tiles']}"
            f"  holdout No_oil {h['no_oil_alarm_tiles']}/{h['no_oil_tiles']}"
        )
    print(json.dumps(result["holdout_lookalike_alarm_rate_difference_v12_minus_release"], indent=2))
    return 0


def main() -> int:
    torch.set_num_threads(6)
    register_lsk()
    if not torch.cuda.is_available():
        raise RuntimeError("CUDA unavailable: refusing to evaluate on the CPU")
    which = sys.argv[1] if len(sys.argv) > 1 else "report"
    if which in MODELS:
        for subset in SETS:
            rows = stage(which, subset)
            print(which, subset, len(rows), "tiles")
        return 0
    return report()


if __name__ == "__main__":
    sys.exit(main())
