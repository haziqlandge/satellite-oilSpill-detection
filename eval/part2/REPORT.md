# Zenodo Part II negatives: look-alike false alarms, release vs final-v12 (2026-09-25)

FUTURE_WORK.md §0, job 1. RTX 4060 Ti 8 GB. **Look-alike false alarms are reported beside
mAP, never folded into it (C8).** The consumed test split was not read.

## What was compared

| | Release | v12 |
|---|---|---|
| Checkpoint | `weights/L1-ciou-research.pt` (`d4a749…fc6c`) | `runs/final_v12_l1/L1-ciou/weights/best-fp32.pt` (`ccaad1…3399`) |
| Data | final-v11: 3,355 train | final-v12: 4,227 train (+872 Part II Lookalike/No_oil, 28.4% of train empty) |
| Config | L1-ciou, 100 epochs, batch 4 (nbs 32), workers 2, seed 0, AMP, AdamW lr .002, mirroring only, FP32-safe save | identical; best epoch 77; 4.32 h; resumed once at the 240-min boundary (epoch 93) |

The comparison attributes differences to data. Before training, `scripts/train_v12.py --smoke`
regenerated the lost shared initial head, and one epoch on final-v11 reproduced the release's
epoch-1 row to 5 dp on all 12 losses and metrics (`runs/smoke_v11_l1/smoke.json`).

Validation is final-v11's 482 tiles, byte for byte. The **holdout** (`holdout.json`) was frozen
before any Part II training: 189 Part II tiles (87 Lookalike, 102 No_oil) in 105 geographic
families. None is within 0.1° of a v11 train footprint, and none SIFT-matches a training tile.
The evaluator is `evaluate_final_release`'s `AuditValidator` with the same settings (conf floor
.001, max_det 1000, operating point = max pooled val F1). It reproduces the audit exactly: the
release selects .20 and gives 13/23.

## Results

At each model's own validation-selected operating point:

| | Release (.20) | v12 (.15) |
|---|---:|---:|
| Val mask mAP50-95 / mAP50 | .1545 / .3560 | .1493 / .3447 |
| Val instance R / P / F1 | .337 / .535 / .414 | .349 / .473 / .401 |
| Val positive-tile Dice / boundary F1 | .761 / .465 | .755 / .496 |
| Val small-instance recall | .118 | .124 |
| **Val look-alike alarm tiles** (FP instances) | **13/23** (38) | **2/23** (2) |
| Val background alarm tiles | 19/53 | 7/53 |
| **Holdout look-alike alarm tiles** (FP instances) | **55/87** (127) | **4/87** (6) |
| Holdout No_oil alarm tiles | 17/102 | 8/102 |

Holdout look-alike alarm-rate difference, v12 minus release, paired tile bootstrap (3,000
resamples): **−0.586, 95% CI [−0.690, −0.471]**.

At matched validation recall, where the thresholds come from validation and never from the
holdout:

| Val recall | Val P, release / v12 | Val look-alike | Val background | Holdout look-alike | Holdout No_oil |
|---|---|---|---|---|---|
| .30 | .609 / .603 | 11 → 0 of 23 | 17 → 5 of 53 | 49 → 2 of 87 | 11 → 5 of 102 |
| .35 | .502 / .469 | 13 → 2 of 23 | 21 → 7 of 53 | 59 → 4 of 87 | 17 → 8 of 102 |
| .40 | .392 / .364 | 14 → 3 of 23 | 26 → 12 of 53 | 69 → 6 of 87 | 27 → 12 of 102 |

## Reading it

- **Look-alike alarms fall at every matched recall, on both strata.** Val look-alikes are Part
  III, a different Zenodo part from the Part II training tiles, and they fall too. So the gain is
  not only the model recognising Part II's own tiles.
- **The cost is on positive tiles.** Mask mAP50-95 is −.005 and mAP50 −.011. At matched recall
  .35/.40 precision is ~3 points lower, and since negative-tile false positives fell, the extra
  false positives are inside oil tiles. It is a tradeoff, and a lopsided one.

## Limits

- Part II is Zenodo's own tiling. It is **not an independently labelled scene set**, and the
  holdout is geographically disjoint from training, not acquisition-verified.
- The model could partly have learned "Zenodo Part II / III radiometry = no oil". The Part III
  val result argues against that being the whole story; it cannot rule it out.
- Val look-alikes are 23 tiles. Single seed. Its thresholds are validation-selected.
- Box-fill on full scenes (ISSUES Q5) is not measured here. That needs full-scene inference
  (job 2).
- This compares L1 against L1, the effect of negatives. It is **not** the PHASE-02 gate "strictly
  fewer look-alike FPs than baseline YOLO-seg", which compares against the plain-YOLO control.

Artifacts: `comparison.json` (all figures), `{release,v12}-{val,holdout}/summary.json`,
`verification.json`, `holdout.json`, `overlaps.json`, `build.json`. The per-image rows
(`images.jsonl`) are gitignored. Reproduce with `python -m scripts.evaluate_v12 report`.

**Not promoted.** Promotion to `weights/` and the browser is the user's decision (job 1, step 6).
