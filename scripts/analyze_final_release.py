"""Read-only analysis of saved validation predictions; never runs inference."""

import json
from pathlib import Path

import numpy as np

ROOT = Path("eval/final/operational")


def matched_recall(rows, target):
    ng = sum(row["ng"] for row in rows)
    matches = sorted((c for row in rows for c in row["matched_confidences"]), reverse=True)
    rank = int(np.ceil(ng * target))
    if not 0 < rank <= len(matches):
        return {"unattainable": True}
    threshold = matches[rank - 1]
    tp = sum(c >= threshold for c in matches)
    predictions = sum(c >= threshold for row in rows for c in row["confidences"])
    look = [row for row in rows if not row["ng"] and row["lookalike"]]
    return dict(
        threshold=threshold,
        recall=tp / ng,
        precision=tp / predictions,
        lookalike_images=len(look),
        lookalike_fp_images=sum(any(c >= threshold for c in row["confidences"]) for row in look),
        lookalike_fp_instances=sum(c >= threshold for row in look for c in row["confidences"]),
    )


def main():
    rows = {
        name: sorted(
            [
                json.loads(line)
                for line in (ROOT / f"{name}-val-sweep" / "images.jsonl").read_text().splitlines()
            ],
            key=lambda row: row["image"],
        )
        for name in ("L1", "none")
    }
    assert [r["image"] for r in rows["L1"]] == [r["image"] for r in rows["none"]]
    output = dict(
        matched_recall={
            name: {str(t): matched_recall(rr, t) for t in (0.3, 0.35, 0.4)}
            for name, rr in rows.items()
        },
        comparison="L1 minus none, confidence .25, paired validation tiles only",
        limitations="Tile bootstrap excludes unknown scene dependence, seed variability and selection bias. Border flags refer to padded tensor boundaries and are not valid tile-border recall.",
        bootstrap={},
    )
    rng = np.random.default_rng(20260917)
    for metric in ("dice", "recall", "lookalike_alarm"):
        indices = [
            i
            for i, row in enumerate(rows["L1"])
            if (
                row["ng"] > 0 if metric != "lookalike_alarm" else not row["ng"] and row["lookalike"]
            )
        ]
        values = {}
        for name, rr in rows.items():
            values[name] = np.array(
                [
                    rr[i]["pixels"]["dice"]
                    if metric == "dice"
                    else rr[i]["thresholds"]["0.25"]["tp"]
                    if metric == "recall"
                    else float(rr[i]["thresholds"]["0.25"]["fp"] > 0)
                    for i in indices
                ]
            )
        diff = values["L1"] - values["none"]
        denom = (
            np.array([rows["L1"][i]["ng"] for i in indices])
            if metric == "recall"
            else np.ones(len(indices))
        )
        sampled = rng.integers(0, len(indices), size=(3000, len(indices)))
        distribution = diff[sampled].sum(1) / denom[sampled].sum(1)
        output["bootstrap"][metric] = dict(
            difference=float(diff.sum() / denom.sum()),
            lower=float(np.quantile(distribution, 0.025)),
            upper=float(np.quantile(distribution, 0.975)),
            n=len(indices),
        )
    (ROOT / "validation_comparison.json").write_text(json.dumps(output, indent=2))
    print(json.dumps(output, indent=2))


if __name__ == "__main__":
    main()
