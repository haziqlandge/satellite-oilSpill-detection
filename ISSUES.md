# ISSUES

Everything currently open, in one place. Closed work lives in
`PREVIOUS_WORK.md`; planned work lives in `FUTURE_WORK.md`.

Each row names its evidence. If you close one, delete the row — do not annotate
it in place, or this file becomes the thing it replaced.

---

## 1. Blocked on a decision

| # | Issue | Evidence |
|---|---|---|
| B1 | **Two-class `oos`/`slick_unknown` labels do not exist.** Zero of 355 instances across the 24-tile pilot are confirmed. Every polygon in the repository is class index `0`. | `eval/phase2-closure/pilot-verification.json`; `data/processed/dataset/*/labels/` |
| B2 | **The proposer cannot propose `oos` at all.** `relabel.py` only proposes `oos` when `is_linear AND vessel_adjacent`, but `bright_target_distance_px` is `-1.0` for all 355 instances because no CFAR bright targets were supplied. 14 instances exceed the linearity threshold and all 14 were deferred to the ship-wake branch. | `backend/ingest/datasets/relabel.py:275`, `:287` |
| B3 | **Part II look-alike negatives were never downloaded.** Only the two mask archives are on disk (426 KB + 417 KB); the two ~21 GB image archives are absent. The 2026-08-31 decision to skip them was explicitly conditional — fetch only if the baseline over-triggers on look-alikes — and it now does (see §2). | `data/raw/datasets/zenodo/8253899/` |

## 2. Model quality — open acceptance gates

Phase 02 stands at **9/13 acceptance items**. All four open items are quality gates.

| # | Issue | Numbers |
|---|---|---|
| Q1 | **mAP50 target not met, and not close.** Plan target >= .90; achieved **.363622** on the held-out test. The .942 figure from the anchor paper is *bounding-box* AP on a different dataset and cannot guarantee a segmentation target. | `eval/final/INDEPENDENT_AUDIT.md` |
| Q2 | **Look-alike false alarms are high.** 8 of 11 named look-alike test tiles raised an alarm; 13 of 23 on validation. The "strictly fewer look-alike FPs than baseline" gate is **unproven** — at matched recall the comparison is a tradeoff, not a win. | same |
| Q3 | **Per-class mAP cannot be reported** — there is only one class. Blocked on B1. | — |
| Q4 | **Small-instance recall is .1096** on test. Median mask component area is 9 px; the corpus is heavily speckled. | same |

Bootstrap detail worth not re-deriving: at confidence .25, the L1-minus-control
look-alike alarm-rate difference is **+.130435**, 95% interval
**[-.043478, +.304348]** — it crosses zero. A universal "L1 leads all
operational measures" claim is unsupported.

## 3. Data integrity

| # | Issue | Evidence |
|---|---|---|
| D1 | **Absolute paths point at a machine that does not exist here.** The annotation pack, `inventory.json`, all eleven `final-v*` split lists and `release.json` are rooted at the training machine's home directory. Bytes are present and hash-verified (48/48 SHA-256, 3,837/3,837 images); only the prefix is wrong. | `DATA.md` |
| D2 | **Two exact cross-split duplicates** survived into training: train `8346860__Oil__00357` and val `Oil__00356`, plus train `Oil__01339` and val `Oil__00007`. CRC32 tile splitting does not guarantee scene independence. | `eval/screening/dataset_audit.json` |
| D3 | **Part III was redistributed into internal train/val splits**, so historical results are *not* an untouched official Part III benchmark. | `eval/phase2-closure/STATUS.md` |
| D4 | **The held-out test split is consumed.** Evaluated exactly once. Any new generalisation claim needs a freshly frozen, independently labelled holdout. | `eval/final/INDEPENDENT_AUDIT.md` |
| D5 | **SAR GeoTIFF bands are unnamed.** The band-2 VV/dB assumption is recorded, not verified from metadata. Band 1 is VH and carries 0.51 dB of contrast — effectively no signal. | `PREVIOUS_WORK.md` |
| D6 | **The corpus mixes two intensity scalings.** Part I and Part III go through the fixed `DB_WINDOW = (-35.0, 0.0)`; Refined SOS PNGs were pre-scaled by their authors under an unknown rule (per-image means spread 36–146) and are linked unchanged. | `ml/datasets/oos_dataset.py` |
| D7 | **Refined SOS is mixed-sensor.** 48% is ALOS PALSAR (L-band) against this pipeline's Sentinel-1 C-band. Excluded by default via `sensors=("sentinel",)`, which is the right call, but the exclusion is not recorded in the weights manifest. | same |

## 4. Experiments that cannot support their intended claim

| # | Issue |
|---|---|
| E1 | **The six MPDIoU runs have a grid/pixel scale mismatch** — box corners in grid units, image normalisation in pixels, so the distance penalty is underweighted by stride squared (64/256/1024). The rows are valid as-implemented results; they are **not** evidence about intended MPDIoU. The patch is now corrected and tested, but the old runs were never re-run. |
| E2 | **`runs/ablation/none-ciou` has `run.json` but no checkpoint or CSV.** Completion is recorded; expanded metrics are unavailable. `runs/segment/baseline-screen` is **not** a substitute — it loaded a pretrained head and is a different experiment. |
| E3 | **L4 is an architectural reserve, not a deployable artifact.** Its retained training used an FP32 recovery and its original saved model is unsuitable for release. |
| E4 | **Augmentation prose and reality disagree.** Documentation says mirroring only; runs actually used mosaic, scale, translation and HSV. The optimiser was auto-selected AdamW at lr .002. All runs are seed 0 across mixed GPUs and physical batches — `nbs=32` is not numerical equivalence. |

## 5. Environment and integration

| # | Issue |
|---|---|
| X1 | **Six database tests skip** — the configured Supabase session pooler returns *tenant or user not found*. Recorded gotcha: the direct host is IPv6-only, so use the **session pooler on 5432**, not the transaction pooler on 6543. Historical database population claims were never re-verified. |
| X2 | **CMEMS credentials are absent.** `.env.example` declares the Copernicus Marine username and password; the real `.env` has neither. `CDSAPI_KEY` for ERA5 *is* set. Real current forcing cannot be fetched until an account exists. |
| X3 | **There is no ERA5/GFS/CMEMS fetcher.** `backend/ingest/metocean/cache.py` is a complete caching layer whose `fetcher` callable has **no implementation anywhere**. Only constant forcing works today. |
| X4 | **There is no API.** `backend/app/__init__.py` is 0 bytes. `PLAN/INTERFACES.md` §3 specifies ten endpoints; none exist. |
| X5 | **Nothing serialises drift output.** The ensemble produces the particle arrays an animation needs, but `drift_runs.origin_field_path` implies a NetCDF that no writer creates. |
| X6 | **No web-ready imagery.** A processed scene is a 3.58 GB BigTIFF. There is no COG pyramid, no tile server and no blob storage. |
| X7 | **Case 3 fixture mismatch.** The available December GeoTIFF is `20231205T000214`; the published case requires `2023-12-05 23:57:19 UTC`. Reconcile acquisition and footprint before any Case 3 claim. |
| X8 | **External Aikido scan not performed** — source transfer was never authorised. No external security result is claimed. |

## 6. Frontend

| # | Issue |
|---|---|
| F1 | **Upload is theatre.** `SampleImagePanel.tsx` fingerprints uploads against six supplied JPGs and runs four hardcoded 5-second stages. |
| F2 | **`lib/reconstruction.ts` fakes the hindcast.** Hand-tuned per-scene constants are applied to negative-hour frames and presented as a reconstruction. Cosmetic, not physical. |
| F3 | **Nothing is wired to a backend.** All content comes from `src/sim/`. The shapes already mirror `PLAN/INTERFACES.md`, so this is a transport change, not a rewrite. |
| F4 | **Animation reads as stiff** — square `fillRect` particles, linear interpolation between whole-hour frames only, `clearRect` every frame, no per-particle variation. |
| F5 | **Age interval is degenerate** — `[0, 0, 0]` for four of five scenarios. Presented honestly, but the `source_coincidence` estimator needs revisiting. |
| F6 | **`--panel-scale` is inert.** Every leaf text node computes to the same font size at 300, 430 and 760 px, while the dock body's own font-size does move. Two docblocks assert the opposite. A sweeping px-to-em refactor was already rejected, so the fix is probably to delete the mechanism or correct the claims. |
| F7 | **Smooth scrolling ignores reduced-motion.** `site/Nav.tsx` calls `window.scrollTo({ behavior: "smooth" })` in two places with no guard; CSS cannot reach an explicit `behavior`. |
| F8 | **Scenario copy is unverified against the data.** Three separate sessions each found a place where the console states something its own numbers contradict. Treat every `summary`, `short`, `provenance` and `tests` string in `scenarios.ts` as an unchecked assertion. |
| F9 | **No test harness exists in `frontDemo/`.** |
| F10 | **Basemap requires network.** Everything else renders locally; the map reports a tile failure and the other layers still draw (C12). |

## 7. What must not be claimed

Stated plainly so nobody has to reconstruct it under pressure:

- The 24-tile pilot is **0.7%** of the 3,455 positive tiles and **2.0%** of the
  17,402 instances. It measures annotation feasibility, not dataset readiness.
- Current weights are **one class, `slick`**. They must never be presented as
  `oos`/`slick_unknown`. The manifest says so and the loader enforces it.
- Research detections must not be promoted automatically to operational
  accusations.
- The border evaluation stratum is **invalid** for source-tile boundaries — it
  tests padded tensor edges. Its zero count does not mean zero border objects.
- Overlap quarantine is not proof of scene-independent generalisation.
- Only 11 named look-alike test tiles exist. That is a sparse sample.
