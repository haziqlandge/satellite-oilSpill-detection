# PHASE-02 ablation — LSK placement x IoU loss

Screened at **60 epochs**, not the 100 of P004 §2.7. **A screened grid is not a 100-epoch grid** and these numbers are not directly comparable to Zhao et al. Table 1 without saying so.

Segmentation mask metrics (`M`), single `slick` class — this is a **binary baseline**, not the two-class `oos` / `slick_unknown` model, which needs the human relabelling pass first.

`workers` deviates from the paper's 8 to keep machine-wide RAM under a 24 GB ceiling; it affects wall-clock only, not results.

## Read the noise floor before reading the table

Measured 2026-09-01 from the first two completed CIoU runs: the **detrended epoch-to-epoch standard deviation** of mask mAP50-95 over the last ten epochs is **+/-0.0012**. Two cells differing by less than roughly **0.004** are not distinguishable by this grid.

> `none` and `L1` differ by **0.00036** -- about a third of a single run's own jitter. **That is not a result, and no number of further cells resolves variants separated by less than the noise floor of one run.** If the grid comes in flat, report it as flat: `SYNTHESIS.md` section 9 Q1 states that a negative result is a legitimate finding.

The completed `L2-ciou` screen is **0.00769 below `none-ciou`** and **0.00806 below `L1-ciou`** on mask mAP50-95. Both gaps exceed the ~0.004 within-run distinguishability threshold, so L2 is a materially worse CIoU placement in this single-seed screen. This is a screening result, not a multi-seed significance claim.

**Screening depth is not reducible.** The first two 60-epoch reference runs peak at epoch **59 of 60** with every validation loss still falling -- the models are under-trained, not over-trained, so a shorter screen would rank an unconverged curve.

**Progress: 3 of 12 screening cells complete; `L3-ciou` is checkpointed at 43/60.**

| LSK | Loss | mAP50-95 (M) | mAP50 (M) | batch | workers |
|---|---|---|---|---|---|
| none | CIOU | 0.198 | 0.429 | 8 | 4 |
| L1 | CIOU | 0.199 | 0.431 | 8 | 3 |
| L2 | CIOU | 0.190 | 0.420 | 8 | 2 |
