# DATA

Where everything lives, which copy is authoritative, and what is cheap to
regenerate versus irreplaceable. `data/`, `runs/` and model checkpoints are
gitignored — a clean clone has the code and none of this.

Current footprint: **`data/` 158 GB, `runs/` 1.8 GB, `eval/` ~70 GB tracked
portion excluded** (see §6). Free space on this machine at last check: 225 GB.

---

## 1. The stale-path problem — fixed 2026-09-22, recurs with new artifacts

**Current state:** `scripts/repath_artifacts.py` rewrote every reference below to
repo-relative form, and `python -m scripts.repath_artifacts --check` reported on
2026-09-23 that every artifact resolves. Re-run it after copying anything new
from the training machine. The history below is why.

Artifacts produced on the training machine embed absolute paths rooted at

```
C:\Users\adi\Downloads\oilSpil2l16\oilSpil2l\
```

That directory does not exist on this machine
(`C:\Users\admin\Desktop\oilSpil2l16\oilSpil2l\`). **The bytes are all present
and hash-verified** — 48 of 48 annotation-pack SHA-256 checks match, and 3,837
of 3,837 inventory images resolve once the prefix is remapped. Only the prefix
is wrong.

Known affected:

| Path | What breaks |
|---|---|
| `eval/phase2-closure/annotation-pilot/reviews/*.json` | `original_image` / `original_mask` |
| `eval/phase2-closure/annotation-pilot/inventory.json` | every tile reference |
| `data/processed/dataset/final-v*/data.yaml` | `path:` root — YOLO cannot find the dataset |
| `data/processed/dataset/final-v*/{train,val,test}.txt` | every split line |
| `runs/final_l1_fp32_release/L1-ciou/release.json` | recorded provenance |
| `.venv/pyvenv.cfg` | **fixed 2026-09-22** — repointed to local Python 3.12 |

Anything reading these verbatim fails with a missing-file error that reads like
a corrupt dataset rather than a path problem. Prefer making them repo-relative
over patching per machine.

## 2. Source corpora — `data/interim/datasets/zenodo/`

| Record | Name | On disk | Contents |
|---|---|---|---|
| `8346860` | Part I | **53 GB** | 1,200 oil-positive scenes + masks. The SCENES are **2-band float32 sigma-0 dB, 2048², and georeferenced EPSG:4326**; the MASKS are the 1-band `{0,1}` uint8 rasters with no transform. See §2.1 — this row described the masks and was applied to both. |
| `13761290` | Part III | **16 GB** | 150 each of `Oil`, `Lookalike`, `No oil`, plus `Mask/` |
| `15298010` | Refined Deep-SAR SOS | **1.4 GB** | 6,455 train + 1,615 val pairs, 3-band RGB 256², values `{0,255}` |
| `8253899` | Part II | **56 GB extracted, verified 2026-09-24** | 685 `Lookalike` + 685 `No_oil` scenes, 2-band float32 dB, 2048², georeferenced EPSG:4326 (~0.18° tiles, worldwide); masks all empty. On the 4060 Ti machine it lives OUTSIDE the repo, in `E:\temp downloads` (four folders + archives; C: cannot hold it). All four archives match Zenodo's MD5 and all 2,740 extracted files match their archive CRC32 (`eval/part2/verification.json`, `scripts/part_two.py verify`) |

**On the 4060 Ti machine, Parts I and III live on E:** (moved 2026-09-25 to free
C:): `E:\oilSpil2l-data\data\{raw,interim}\datasets\zenodo\{8346860,13761290}`.
They were verified after the copy (archives against Zenodo's MD5, all 3,300
extracted files against their archive CRC32) before the C: originals were
removed. The old paths under `C:\Users\adi\Downloads\oilSpil2l16\oilSpil2l\data\`
are directory junctions to them, so every path in this file still resolves. E:
is a 5400 rpm HDD, so it is fine for reading once and slow for random access.
Training reads none of it (only `data/processed/dataset`). Since 2026-09-25 the
repo's own `data/interim/datasets` is a directory junction to the old
directory's, so repo-relative corpus paths (the ONNX parity scene, precomputed
upload sources, `ZENODO_DIR`-free checks) resolve here too.

### 2.1 The source scenes ARE georeferenced — corrected 2026-09-22

This document said Part I was "not georeferenced". That is true of the **mask**
files and false of the **scenes**, and the two sit in sibling directories under
the same file name, so the claim survived unchallenged.

Measured with rasterio over a random sample of each:

| | georeferenced | bands | dtype |
|---|---|---|---|
| `01_Train_Val_Oil_Spill_images/Oil/*.tif` | **4 of 4** | 2 | float32 |
| `01_Train_Val_Oil_Spill_mask/Mask_oil/*.tif` | 0 of 4 | 1 | uint8 |
| `02_Test_images_and_ground_truth/Images/Oil/*.tif` | **4 of 4** | 2 | float32 |

The scenes carry EPSG:4326 and real world positions, and the corpus is global
rather than regional: sampled south-west corners landed in the Gulf of Guinea
(11.19, −4.78), the Red Sea (39.22, 20.24), the Mediterranean (33.07, 33.28),
the **Gulf of Mexico** (−90.49, 26.96) and off Borneo (116.47, −3.87).

**What this changes.** Anything working from the derived PNGs under
`data/processed/dataset/` genuinely has no position — the geotransform is lost
when the tiles are written — but anything that can read the source TIFF has a
measured one. The console's upload path reads it
(`frontDemo/src/sim/geotiff.ts`), which is the difference between a position an
operator asserted and a position the file states.

**Two traps that come with them.** The dB range is NOT inside the corpus window
of −35 to 0: measured scenes span −49.5 to −20.1 dB and −39.0 to −27.3 dB, so
mapping them through the fixed window clips most of the scene to black. That is
a **band 1** (VH) effect: over 60 scenes the window clips more than a fifth of
band 1 in 27, and of band 2 (VV) in none — at most 2.3% of its pixels.

**Wider spread is not more signal.** This section used to say the band order was
inconsistent because band 1 had the larger standard deviation in one scene and
band 2 in another. The console's upload path acted on that and showed whichever
band had the larger sd. On Part I that is band 1, VH near the noise floor, where
the spread is speckle and the oil is invisible. Measured against the masks over
60 scenes, band 2 carries more oil contrast in all 60 (median 5.5 dB against
0.5 dB on Part I), and it is the brighter band by median in every one (by 4.0 dB
at the least, 12.4 dB typically), as the co-polarised return over the sea is. The upload path now takes the
brighter band. `frontDemo/scripts/check-geotiff.ts` guards it.

It is not a law: train scene 00818 shows its slick about equally in both bands
(7.2 dB in band 1, 6.7 in band 2). Band 2 is still the right one to hand the
model, which was trained on it; the check fails only when the chosen band shows
the oil at less than half the strength of the other.

**Zero is no-data, and it must be excluded before the medians are taken.**
Scenes cut at a swath edge are zero-filled (the release manifest's
`masked_zero: true`): 14 of 121 Part I scenes sampled, 3 of them more than half
empty. Counted as data, a 61%-empty scene has a median of 0 dB in both bands,
and the tie picked band 1 — train 01034 then came back 22.6% "slick" at
precision .04. Excluding zeros, the brighter band is band 2 in all 121, and
01034 segments at precision .999, identical to `infer_scene`.

Every record disagrees with the others on every convention that matters, and
each disagreement is silent. The traps are documented in `PREVIOUS_WORK.md`;
all are handled in `ml/datasets/oos_dataset.py` and guarded by tests.

**Refined SOS is mixed-sensor**: 48% is ALOS PALSAR (L-band). Only the
`sentinel_*` subset is used by default — 4,193 of 8,070 images.

## 3. Assembled datasets — `data/processed/dataset/`

| Path | Status |
|---|---|
| `oos/` | Raw pre-dedup build. 4,606 train / 585 val / 627 test PNGs, 2048² 8-bit greyscale, ~2.4 MB each |
| `final-v1` … `final-v10` | Superseded dedup/quarantine generations. Keep for provenance; do not train on |
| **`final-v11/`** | **Authoritative for the release.** The frozen split the release was trained on |
| `part2/` | Zenodo Part II as 8-bit PNG (band 2, fixed dB window), `images/{train,holdout}` + empty labels; presized `.npy` cache for the kept train tiles. 3.2 GB. `scripts/part_two.py build` |
| **`final-v12/`** | final-v11 **unchanged** (val and test lists byte-identical) plus 872 Part II tiles in train only: **4,227 train / 482 val / 627 test**, 28.4% of train empty. 309 Part II train candidates quarantined (305 within 0.1° of a v11 val/test footprint; the 5 SIFT overlaps with test and 1 exact duplicate were all inside that set). `holdout.txt` / `holdout.yaml`: the frozen Part II holdout (below). Never trained on |

**The Part II holdout** (`eval/part2/holdout.json`, frozen 2026-09-24 before any
training on Part II): tiles grouped by single linkage where footprints come within
0.1°; a family is eligible only if no member is within 0.1° of any final-v11 train
footprint; half the eligible families held out by CRC32. **189 tiles in 105
families: 87 Lookalike, 102 No_oil.** None SIFT-matches a training tile. It is
geographically disjoint from training, not an independently labelled scene set.

On the 4060 Ti machine `oos/` and the repo's `.venv` are **hard links** into the
older training directory `C:\Users\adi\Downloads\oilSpil2l16\oilSpil2l` (zero
disk; C: had ~18 GB free). Replace a file there, never edit one in place.
`final-v11` was copied and repathed, and every image and label hash-checks
against its manifest (`scripts.train_final.verify_data`).

`final-v11`: **3,355 train / 482 val / 627 test** = 4,464 tiles, 20,261 polygon
instances. Of these, 4,021 tiles are positive and 443 are empty negatives.
`manifest.json` records `retained` 4,464, `excluded` 1,354, `original` 5,818.

Every dataset YAML declares `nc: 1`, `names: {0: slick}`. **Every polygon in
the repository is class index 0.** There is no two-class data anywhere.

The 3,455 positive train+val tiles that the annotation work targets break down
as: Part I `Oil` 782, Refined SOS train 2,144, Refined SOS val 422, Part III
`Oil` 107.

## 4. SAR scenes

| Path | Size | What |
|---|---|---|
| `data/raw/sar/*.tiff` | ~500 MB each | Raw VV measurement bands, COG, from the credential-free AWS STAC path |
| `data/raw/sar/safe/` | — | `.SAFE` products; SNAP needs the complete product because calibration reads the LUTs under `annotation/calibration/` |
| `data/processed/sar/*_s0db.tif` | **~3.58 GB each** | SNAP output, sigma-0 dB, EPSG:4326, GeoTIFF-BigTIFF, 32,585 x 21,409 px |

Three scenes, matching the three validation fixtures:
`20230409T000206`, `20230515T000208`, `20231205T000214`.

Note the third does **not** match the published Case 3 acquisition time
(`23:57:19 UTC`) — see `ISSUES.md` X7.

A processed scene is not web-servable. There is no COG pyramid and no tile
pipeline.

`data/processed/sar/windows/` holds the two upload windows
(`scripts/cut_geotiff_window.py`, gitignored), re-cut 2026-09-25:
`..._20230409..._win1536.tif` at the v11 largest detection (-89.65388, 29.59906),
byte-identical to the one the precomputed entry is keyed on (`3371b1dd…`), and
`..._20231205..._win2048.tif` at the December seed (-89.0082, 29.2661), the upload
that yields a full live run. The cutter's default centre reads
`eval/final/scenes`, which is v12's now: pass `--lon/--lat` to reproduce these.

## 5. Models — `weights/` and `runs/`

| Artifact | Note |
|---|---|
| `weights/L1-ciou-research.pt` | **The release: final-v12, promoted 2026-09-25** (`ml/export/export.py`) from `runs/final_v12_l1/L1-ciou/weights/best-fp32.pt`. 13 MB. SHA-256 `ccaad1…3399`. **Gitignored** |
| `weights/L1-ciou-research.json` | Its manifest — class scheme, frozen inference config (conf .15, v12's own validation point), raster convention, `version`, `supersedes`, and the hash of the record it was promoted from (`eval/part2/comparison.json`). **Tracked**, and the loader enforces it |
| `weights/L1-ciou-research-v11.{pt,json}` | The previous release (final-v11, `d4a749…fc6c`, conf .20) and its original manifest, kept beside it. `scripts/evaluate_v12.py` and `scripts/train_v12.py` compare against it |
| `weights/yolo26n.pt`, `yolo11n-seg.pt` | Pretrained bases. Tracked via a `!weights/` negation |
| `frontDemo/public/models/L1-ciou-research.onnx` | The release exported for the browser, fp32, 12.9 MB, SHA-256 `696c5c…95bf` (v12, 2026-09-25; box coordinates within 0.0013 px of PyTorch). **Gitignored** (`*.onnx`); regenerate with `.venv/Scripts/python.exe -m ml.export.onnx_export`, which checks it against PyTorch first and needs the `export` extra (`onnx`, `onnxruntime`) |
| `frontDemo/public/models/L1-ciou-research.json` | Its web manifest: the frozen inference config, the ONNX hash, and the PyTorch parity figures. **Tracked**; `tests/test_onnx_export.py` checks a present `.onnx` against it |
| `runs/final_l1_fp32_release/` | 274 MB. The 100/100-epoch FP32 reproduction |
| `runs/final/` | 604 MB. `none-ciou`, `L1-ciou` (best + epoch snapshots), `L4-ciou` (no weights — NaN failure) |
| `runs/ablation/` | 233 MB. The 12 screening cells. `none-ciou` has no checkpoint |

Frozen inference config, from the manifest: `imgsz 1024, batch 4, conf 0.15,
iou 0.70, max_det 1000, half false, rect true, retina_masks true`; raster
`band 2, sigma0_db, db_window [-35, 0]`; tiling `1024 / 0.1 overlap`.

**`runs/` is the one directory worth copying by hand** when moving machines.
Re-deriving it costs roughly 4.5 hours of GPU time.

**It did not survive** (2026-09-24: absent from every directory on the 4060 Ti
machine). What remains is `weights/L1-ciou-research.pt`, which carries the
release's own `train_args` and per-epoch `train_results`. `runs/final/initial_head.pt`
was regenerated by `train_final.prepare`'s deterministic recipe and proved
identical: a fresh epoch 1 on final-v11 reproduced the release's epoch-1 row to 5
decimals on all 12 losses and metrics (`runs/smoke_v11_l1/smoke.json`,
`scripts/train_v12.py --smoke`). The final-v12 retrain wrote `runs/final_v12_l1/`
(epoch snapshots every 10, `best-fp32.pt` the promoted release).

## 5a. Land mask — `frontDemo/public/landmask/`

The frontend's coastline: GSHHG full resolution, the polygons OpenDrift's
`reader_global_landmask` uses, rasterised at 1/240° by
`scripts/build_landmask.py` (~2.5 min, needs `roaring_landmask` from the
`drift` extra). **Tracked**, because the app fetches it at runtime.

| Artifact | Size | What |
|---|---|---|
| `frontDemo/public/landmask/band_00.bin` … `band_35.bin` | 3.01 MB, 33 files | Every coastal 5° tile, one file per latitude band, row 00 at the south pole. Bands with no coastal tile have no file |
| `frontDemo/src/sim/landmask.generated.ts` | 49 KB | Kind of every tile on Earth, plus the 11 coastal tiles authored scenes need, bundled |

**Authority: OpenDrift's GSHHG answer.** The raster is it sampled at cell
centres; `tests/test_landmask.py` checks ≥99.9% agreement. The basemap drawn
underneath is Esri's picture and can differ from both. GSHHG is LGPL
(Wessel & Smith).

## 5b. AIS — `data/raw/ais/`, `data/interim/ais/`, `frontDemo/public/ais/`

| Artifact | Size | What |
|---|---|---|
| `data/raw/ais/2023/AIS_2023_*.zip` | 3.6 GB, 12 days | marinecadastre national days: Apr 6-9, May 12-15, Dec 2-5 2023 — the 72 h before each of the three Gulf cases (Apr 6 and May 12 downloaded 2026-09-26 from `coast.noaa.gov/htdata/CMSP/AISDataHandler/2023/`, at the user's request). **Irreplaceable offline** (re-download from marinecadastre.gov) |
| `data/interim/ais/AIS_*_gulf.npz` | 12 files (15-27 MB each) | Each day a scene window needs, cut to the Gulf AOI and cached by `scripts/export_ais_traffic.py`. Regenerable, ~90 s a day |
| `frontDemo/public/ais/{gom-platform,gom-moving,gom-berthed}.json` | 1.2 MB | Per-scene tracks, simplified to 100 m (TD-TR), reception gaps as `breaks`, identities withheld (MID only), the published vessel flagged. **Tracked**; the app fetches them |
| `frontDemo/public/ais/real-{20230409,20230515,20231205}.json` | 3.2 MB | Traffic around each real OpenDrift run's seed, for the console's real-run views. Box = the run's 90% contour extent + 15 km; window = the AIS days on disk, 72 h for all three since 2026-09-26 (282 / 617 / 342 vessels; April and May had 48 h, 235 / 537). `python -m scripts.export_ais_traffic --real-runs`. Needs Dec 2-3 parsed into `data/interim/ais/` (done 2026-09-23) |
| `frontDemo/public/runs/<scene>/drift.json` | 7-10 MB | The real OpenDrift run: 10 members x 200 parcels, seeded uniformly over the seed detection's polygon (the same positions for every member), 72 h backward and 72 h forward on ERA5 wind and CMEMS currents (since 2026-09-25; each member's wind shifted in time by up to 3 h either way, the ensemble's timing uncertainty), one frame per hour from -72 to +72 (all 2,000 parcels, the 0.01° 50/90% cells, spread; forward frames add `strandedPct`, and a forward hour with nothing afloat is still a frame: no parcels, areas and spread 0, `strandedPct` 100 -- April's v12 seed is all ashore by +42 h), plus OpenDrift's own on-land share, the convergence series (backward only) and the age (`estimate_age`: a triple, or a refusal). `python -m scripts.export_drift_runs --all`, ~3 min a scene here. **Gitignored** |
| `frontDemo/public/runs/<scene>/scene.json` | 70-650 KB | Beside each `drift.json`: the model's full-scene detections, one ring per polygon part (simplified to 0.0002°), each with its `feature` index, its own confidence, `seed` and `boxCut` (a straight axis-aligned edge of 1.2 km or more, `ISSUES.md` Q5/F18), and the ERA5 wind at the seed from the drift's own two cached requests, -72 to +72 h. Also `cfar`: CA-CFAR targets (lon/lat, peak dB, area px) within 15 km of the seed on the processed scene (`cfar_near_seed`; `not_run` when the 3.6 GB scene is absent). Also, since the night of 2026-09-23, `characterisation`: the backend's PHASE-03 record of the seed detection (`characterise_seed`, `backend/characterize`) -- geometry from the unsimplified polygon in an equal-area projection, the damping ratio on the processed scene's band 2 against clean sea (GSHHG land, other detections and SNAP's zero fill kept out; `null` when the scene is absent), the ERA5 wind and wind gate at the pass, and the Fay morphology age prior (a ceiling, never an age). `python -m scripts.export_real_scenes` (offline; reads the ERA5 cache). The flagged seed is the detection `choose_seed` picked (largest at sea without a box-cut edge). **Gitignored** with the rest of `public/runs/`, like `drift.json`: regenerate on any other machine, after `export_drift_runs` |
| `data/cache/metocean/era5-wind_<hash>.nc` | 80-210 KB each | The ERA5 10 m wind the real runs are forced by, one file per request, keyed by the request's hash (`backend/ingest/metocean/cache.py`). Per scene: the 74 h before the pass and the 74 h after it; `wind_requests` in `export_drift_runs.py` defines both, over the extent of every detection in the scene. So a new model means new files: six were fetched 2026-09-25 (user-approved) for v12's detections, which reach the scene's west edge (-91.02); the v11 files stay for `scenes-v11`. **Gitignored**; re-fetched from CDS with `CDSAPI_KEY` if missing |
| `data/cache/metocean/cmems-currents_*.nc` | 4.4 MB each | CMEMS hourly mean surface currents (`uo`/`vo`, `cmems_mod_glo_phy_anfc_0.083deg_PT1H-m`, 1/12°) the three real runs are forced by since 2026-09-25. The `browser-<from>-<to>` files were downloaded through the Data Store in the logged-in browser (the toolbox cannot log in yet, ISSUES X2): box 26.9-30.9 N, 92.1-87.1 W, 00:00 on the first day to 23:00 on the last, Apr 5-12, May 11-18 and Dec 1-8 2023. `cache.covering_path` finds them for any request inside. A toolbox fetch (`cmems.fetch_cmems_currents`) names its file by the request's key instead. **Gitignored** |
| `frontDemo/public/precomputed/` | 4-31 KB each | "Use precomputed result" for uploads (`FUTURE_WORK.md` §1.5): the segmentation of a known file, keyed by the file's SHA-256 (`index.json`), stamped with the model's SHA-256, mask as run lengths. Made by `npm run precompute:uploads -- <repo-relative files>` (default: `data/processed/sar/windows/*.tif`); `check:precomputed` recomputes every entry whose source is on disk. Current entries: the Gulf window, `8346860__Oil__00001.png`, Part I `Oil/00586.tif`, all made by v12 (2026-09-25). v12 finds **nothing** in the April window (v11 filled 26.6% of it with one box, ISSUES Q5), 7 detections in the PNG and 18 in `00586`. **Tracked**. Stale the moment the model changes: re-run after retraining |

No real MMSI or vessel name is in the tracked files; `tests/test_export_ais_traffic.py`
asserts it.

### Characterisation fixtures — `tests/fixtures/characterise/`

Generated by `cd frontDemo && npm run export:characterise-fixtures`; **tracked**,
small (72 KB), never edited by hand. They hold the backend's PHASE-03 code to
the console's: `authored_slicks.json` (every authored slick outline as drawn,
its source tip and P004 length, for `tests/test_geometry.py`),
`verdict_cases.json` (verdict inputs and the TypeScript's outputs, asserted by
both `check:verdict` and `tests/test_verdict.py`), `wind_gate.json` (the
console's gate over 0-16 m/s, for `tests/test_windgate.py`). Regenerate after
changing `sim/slick.ts`, `sim/verdict.ts` or a scenario on purpose.

### Scoring fixtures — `tests/fixtures/scoring/`

`cd frontDemo && npm run export:scoring-fixtures`; **tracked**, 2.1 MB, gzipped
JSON, never edited by hand. Per authored scenario, the exact input the console's
`score()` gets and its output under both S_drift variants, for
`tests/test_attribution.py` to hold `backend/attribute` to. Trimmed to what the
scorer reads: the console's mass table per hour and only the grid cells it
samples, and only vessels within reach of the gate (the rest are counted, and
the export asserts dropping them changes nothing). `frame.json.gz` is one whole
frame for the grid ports. `-- --all-vessels <dir>` writes the untrimmed input
(~9 MB, not for the repository) for `scripts/attribution_ablation.py`.

## 5c. The demo snapshot — `demo/`

`python -m scripts.export_snapshot` writes `demo/data/snapshot.zip` (gitignored): every
file the offline demo reads that git does not carry. That is the weights, the ONNX model,
the real-run views, cached ERA5 and CMEMS forcing, the upload windows, the parsed AIS days
and the API's runs. It also writes `demo/snapshot.json` (tracked), which lists every file
the demo needs, git-carried or not, with its size and SHA-256. `--check` compares a
machine against it. Re-export last, after any pipeline re-run.

## 5d. Added 2026-09-25 (night)

| Artifact | What |
|---|---|
| `frontDemo/src/sim/regions.json` | The region registry (PHASE-10), read by the console and `backend/regions.py`. **Tracked** |
| `frontDemo/public/runs/<scene>/scene.json` `flow` | Wind (ERA5) and current (CMEMS) on a 10 × 10 grid per hour, for the map's arrows. **Now tracked** (Vercel) |
| `eval/cleanup/delete_list.json` | §2.6's verified delete list, paths of the machine it ran on |
| `eval/evaluation/authored.json` | PHASE-08's drift/attribution measurements on the authored scenarios |
| `eval/ennore/crosscheck.json` | The engine against the INCOIS Ennore 2017 assessment (X17) |
| `data/cache/metocean/cmems-currents_*.nc`, `era5-wind_*.nc` | Now also the Ennore 2017 window (fetched by the toolbox via the `CDSE_*` login) |

### Fetched live by the browser (nothing stored)

| Source | What | Used by |
|---|---|---|
| `archive-api.open-meteo.com/v1/archive?models=era5` | ERA5 hourly 10 m wind on a 5 × 5 grid, 220 km across, around an upload; about 5 days behind real time | `frontDemo/src/sim/metocean.ts`, the upload's drift, wind gate and arrows |
| `marine-api.open-meteo.com/v1/marine` | Copernicus Marine SMOC hourly surface currents, tides included (Météo-France, 0.08°), from January 2022 | the same |
| `frontDemo/public/ais/real-*.json` | The hosted real AIS; an upload inside one's box and window uses it | `realTrafficForUpload` in `sim/realAis.ts` |

Open-Meteo is free for non-commercial use with attribution, no key, open
CORS; the panels name it in every "sourced from" line.

## 6. Evaluation artifacts — `eval/`

240 MB on disk. Tracked selectively:

| Kept (tracked) | Dropped (gitignored, derived) |
|---|---|
| `*.json` summaries and manifests | `**/feature_cache/` (169 MB) |
| `*.md` reports | `*.npz` |
| `*.geojson` scene detections | `*.jsonl` per-image dumps |
| `*.png` review previews | `*.log` |

`eval/phase2-closure/annotation-pilot-cfar/` (5.2 MB, 2026-09-23) is the CFAR-backed review pack built from the 24-tile pilot by `scripts/cfar_review_pack.py`: `reviews/*.json` (proposals + measured evidence, all unconfirmed), `tiles/` previews, `summary.json`, and a self-contained `index.html` (serve it with the `review-pack` launch config). Decisions come back through `scripts/apply_review_decisions.py`. The original `annotation-pilot/` is untouched.

`eval/final/scenes/*.geojson` holds **three real full-scene detection outputs**
from the release, **v12 since 2026-09-25** — 53, 119 and 58 detections (86, 237, 88
polygons), EPSG:4326, map-ready as-is, each stamped with the weights' hash. The
v11 outputs (86, 240 and 40 detections) and their `benchmark.json` moved to
`eval/final/scenes-v11/`. `eval/part2/box_fill.json` compares the two
(`scripts/measure_box_fill.py`, ISSUES Q5). `eval/attribution/` is PHASE-06's
record: `REPORT.md`, and `ablation.json` from `scripts/attribution_ablation.py`.

## 7. What is irreplaceable versus regenerable

| Irreplaceable without re-download or re-training | Regenerable |
|---|---|
| `data/interim/datasets/zenodo/**` (70 GB of downloads) | `data/processed/dataset/**` — rebuild with `scripts/build_dataset.py` then `prepare_final_dataset.py` |
| `data/raw/sar/**` | `data/processed/sar/**` — rerun the SNAP graph, but budget 1h+ per scene |
| `runs/**` (~4.5 GPU-hours) | `eval/**/feature_cache`, `*.npz`, `*.jsonl` |
| `weights/L1-ciou-research.pt` | `eval/final/scenes/*.geojson` — rerun inference |
| | `frontDemo/public/landmask/**` — `scripts/build_landmask.py` |
| `data/raw/ais/**` (re-download) | `frontDemo/public/ais/**`, `data/interim/ais/**` — `scripts/export_ais_traffic.py` |

## 8. Credentials

`.env` is gitignored; `.env.example` lists the keys.

| Key | State |
|---|---|
| `CDSAPI_KEY` (ERA5 wind) | **set** |
| `COPERNICUSMARINE_SERVICE_USERNAME` / `_PASSWORD` | **absent.** The Marine account is signed into through CDSE and has no Marine password yet, so the toolbox cannot log in (ISSUES X2). `cmems.py` falls back to the `CDSE_*` pair, which will work once the account's Marine password is set to match |
| CDSE client id/secret | for the `.SAFE` download path |
| Supabase | hosted Postgres + PostGIS. Use the **session pooler on 5432**; the direct host is IPv6-only and the transaction pooler on 6543 lacks prepared statements |
