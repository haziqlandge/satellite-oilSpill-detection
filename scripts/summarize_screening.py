"""Aggregate immutable per-image screening evidence and paired tile uncertainty."""

import json
from pathlib import Path

import numpy as np

from scripts.review_screening import THRESHOLDS

ROOT = Path("eval/screening")


def aggregate(rows, t=0.25):
    s = [r["thresholds"][str(t)] for r in rows]
    tp = sum(x["tp"] for x in s)
    fp = sum(x["fp"] for x in s)
    ng = sum(r["ng"] for r in rows)
    pos = [r for r in rows if r["ng"]]
    neg = [r for r in rows if not r["ng"]]
    look = [r for r in neg if r["lookalike"]]
    nooil = [r for r in neg if "__No_oil__" in r["image"]]
    ga = sum(r["pixels"]["gt_area"] for r in rows)
    pa = sum(r["pixels"]["pred_area"] for r in rows)
    inter = sum(r["pixels"]["intersection"] for r in rows)
    d = dict(
        images=len(rows),
        instances=ng,
        tp=tp,
        fp=fp,
        recall=tp / max(ng, 1),
        precision=tp / max(tp + fp, 1),
        negative_images=len(neg),
        negative_fp_images=sum(r["thresholds"][str(t)]["fp"] > 0 for r in neg),
        negative_fp_instances=sum(r["thresholds"][str(t)]["fp"] for r in neg),
        lookalike_images=len(look),
        lookalike_fp_images=sum(r["thresholds"][str(t)]["fp"] > 0 for r in look),
        lookalike_fp_instances=sum(r["thresholds"][str(t)]["fp"] for r in look),
        no_oil_images=len(nooil),
        no_oil_fp_images=sum(r["thresholds"][str(t)]["fp"] > 0 for r in nooil),
    )
    if t == 0.25:
        d.update(
            dice=float(np.mean([r["pixels"]["dice"] for r in pos])),
            iou=float(np.mean([r["pixels"]["iou"] for r in pos])),
            boundary_f1=float(np.mean([r["pixels"]["boundary_f1"] for r in pos])),
            pixel_precision=inter / max(pa, 1),
            pixel_recall=inter / max(ga, 1),
            area_bias=(pa - ga) / max(ga, 1),
        )
    strata = {}
    for name in ["small", "medium", "large", "elongated", "border"]:
        ids = [
            (r, i)
            for r in pos
            for i in range(r["ng"])
            if (r["sizes"][i] == name if name in ["small", "medium", "large"] else r[name][i])
        ]
        strata[name] = dict(
            instances=len(ids),
            recall=sum(i in r["thresholds"][str(t)]["matched"] for r, i in ids) / max(len(ids), 1),
        )
    d["strata"] = strata
    return d


def main():
    dataset = json.loads((ROOT / "dataset_audit.json").read_text())
    excluded = {
        x.split("/", 1)[1]
        for g in dataset["cross_split_duplicates"]
        for x in g
        if x.startswith("val/")
    }
    result = {}
    raw = {}
    for p in sorted(ROOT.glob("*/summary.json")):
        rows = [json.loads(x) for x in (p.parent / "images.jsonl").read_text().splitlines()]
        assert len(rows) == 585 and len({r["image"] for r in rows}) == 585
        raw[p.parent.name] = sorted(rows, key=lambda r: r["image"])
        result[p.parent.name] = dict(
            standard=json.loads(p.read_text()),
            fixed={str(t): aggregate(rows, t) for t in [0.1, 0.25, 0.5]},
            threshold_sweep={str(t): aggregate(rows, t) for t in THRESHOLDS},
            sources={
                s: aggregate([r for r in rows if r["source"] == s])
                for s in sorted({r["source"] for r in rows})
            },
            excluding_known_duplicates=aggregate([r for r in rows if r["image"] not in excluded]),
        )
    rng = np.random.default_rng(20260915)
    boot = {}
    ref = raw["L1-ciou"]
    for name, rows in raw.items():
        assert [r["image"] for r in rows] == [r["image"] for r in ref]
        b = {}
        for metric in ["dice", "recall", "negative_false_alarm", "lookalike_false_alarm"]:
            inds = [
                i
                for i, r in enumerate(ref)
                if (
                    r["ng"] > 0
                    if metric in ["dice", "recall"]
                    else not r["ng"]
                    and (r["lookalike"] if metric.startswith("lookalike") else True)
                )
            ]

            def values(rr, metric=metric, inds=inds):
                return np.array(
                    [
                        rr[i]["pixels"]["dice"]
                        if metric == "dice"
                        else rr[i]["thresholds"]["0.25"]["tp"]
                        if metric == "recall"
                        else float(rr[i]["thresholds"]["0.25"]["fp"] > 0)
                        for i in inds
                    ]
                )

            diff = values(rows) - values(ref)
            idx = rng.integers(0, len(inds), size=(3000, len(inds)))
            denom = (
                np.array([ref[i]["ng"] for i in inds]) if metric == "recall" else np.ones(len(inds))
            )
            samples = diff[idx].sum(1) / denom[idx].sum(1)
            b[metric] = dict(
                difference=float(diff.sum() / denom.sum()),
                lower=float(np.quantile(samples, 0.025)),
                upper=float(np.quantile(samples, 0.975)),
                n=len(inds),
            )
        boot[name] = b
    (ROOT / "aggregate.json").write_text(json.dumps(result, indent=2))
    (ROOT / "paired_bootstrap.json").write_text(json.dumps(boot, indent=2))
    for name, r in result.items():
        a = r["fixed"]["0.25"]
        print(
            name,
            "AP {:.4f}".format(r["standard"]["metrics"]["metrics/mAP50-95(M)"]),
            "P {:.3f} R {:.3f} Dice {:.3f} BF {:.3f}".format(
                a["precision"], a["recall"], a["dice"], a["boundary_f1"]
            ),
            "neg",
            a["negative_fp_images"],
            "look",
            a["lookalike_fp_images"],
            "size",
            [(k, round(v["recall"], 3)) for k, v in a["strata"].items()],
        )


if __name__ == "__main__":
    main()
