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
| `8253899` | Part II | **not extracted** | Only two mask archives (426 KB + 417 KB). The two ~21 GB image archives were never downloaded. See `ISSUES.md` B3 |

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
| **`final-v11/`** | **Authoritative.** The frozen split the release was trained on |

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

## 5. Models — `weights/` and `runs/`

| Artifact | Note |
|---|---|
| `weights/L1-ciou-research.pt` | The release checkpoint, exported. 13 MB. SHA-256 `d4a749…fc6c`. **Gitignored** |
| `weights/L1-ciou-research.json` | Its manifest — class scheme, frozen inference config, raster convention. **Tracked**, and the loader enforces it |
| `weights/yolo26n.pt`, `yolo11n-seg.pt` | Pretrained bases. Tracked via a `!weights/` negation |
| `frontDemo/public/models/L1-ciou-research.onnx` | The release exported for the browser, fp32, 12.9 MB. **Gitignored** (`*.onnx`); regenerate with `.venv/Scripts/python.exe -m ml.export.onnx_export`, which checks it against PyTorch first |
| `frontDemo/public/models/L1-ciou-research.json` | Its web manifest: the frozen inference config, the ONNX hash, and the PyTorch parity figures. **Tracked**; `tests/test_onnx_export.py` checks a present `.onnx` against it |
| `runs/final_l1_fp32_release/` | 274 MB. The 100/100-epoch FP32 reproduction |
| `runs/final/` | 604 MB. `none-ciou`, `L1-ciou` (best + epoch snapshots), `L4-ciou` (no weights — NaN failure) |
| `runs/ablation/` | 233 MB. The 12 screening cells. `none-ciou` has no checkpoint |

Frozen inference config, from the manifest: `imgsz 1024, batch 4, conf 0.20,
iou 0.70, max_det 1000, half false, rect true, retina_masks true`; raster
`band 2, sigma0_db, db_window [-35, 0]`; tiling `1024 / 0.1 overlap`.

**`runs/` is the one directory worth copying by hand** when moving machines.
Re-deriving it costs roughly 4.5 hours of GPU time.

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
| `data/raw/ais/2023/AIS_2023_*.zip` | 2.9 GB, 10 days | marinecadastre national days: Apr 7-9, May 13-15, Dec 2-5 2023 — the 48 h before each of the three Gulf cases. **Irreplaceable offline** (re-download from marinecadastre.gov) |
| `data/interim/ais/AIS_*_gulf.npz` | 178 MB, 8 files (15-27 MB each) | Each day a scene window needs, cut to the Gulf AOI and cached by `scripts/export_ais_traffic.py`. Regenerable, ~90 s a day |
| `frontDemo/public/ais/{gom-platform,gom-moving,gom-berthed}.json` | 1.2 MB | Per-scene tracks, simplified to 100 m (TD-TR), reception gaps as `breaks`, identities withheld (MID only), the published vessel flagged. **Tracked**; the app fetches them |
| `frontDemo/public/ais/real-{20230409,20230515,20231205}.json` | 3.2 MB | Traffic around each real OpenDrift run's seed, for the console's real-run views. Box = the run's 90% contour extent + 15 km; window = the AIS days on disk (48 h Apr/May, 72 h Dec). `python -m scripts.export_ais_traffic --real-runs`. Needs Dec 2-3 parsed into `data/interim/ais/` (done 2026-09-23) |
| `frontDemo/public/runs/<scene>/drift.json` | 7-10 MB | The real OpenDrift run: 10 members x 200 parcels, seeded uniformly over the seed detection's polygon (the same positions for every member), 72 h backward on the ERA5 wind before the pass and 72 h forward on the wind after it, one frame per hour from -72 to +72 (all 2,000 parcels, the 0.01° 50/90% cells, spread; forward frames add `strandedPct`), plus OpenDrift's own on-land share, the convergence series (backward only) and the age (`estimate_age`: a triple, or a refusal). `python -m scripts.export_drift_runs --all`, ~3 min a scene here. **Gitignored** |
| `frontDemo/public/runs/<scene>/scene.json` | 70-650 KB | Beside each `drift.json`: the model's full-scene detections, one ring per polygon part (simplified to 0.0002°), each with its `feature` index, its own confidence, `seed` and `boxCut` (a straight axis-aligned edge of 1.2 km or more, `ISSUES.md` Q5/F18), and the ERA5 wind at the seed from the drift's own two cached requests, -72 to +72 h. Also `cfar`: CA-CFAR targets (lon/lat, peak dB, area px) within 15 km of the seed on the processed scene (`cfar_near_seed`; `not_run` when the 3.6 GB scene is absent). Also, since the night of 2026-09-23, `characterisation`: the backend's PHASE-03 record of the seed detection (`characterise_seed`, `backend/characterize`) -- geometry from the unsimplified polygon in an equal-area projection, the damping ratio on the processed scene's band 2 against clean sea (GSHHG land, other detections and SNAP's zero fill kept out; `null` when the scene is absent), the ERA5 wind and wind gate at the pass, and the Fay morphology age prior (a ceiling, never an age). `python -m scripts.export_real_scenes` (offline; reads the ERA5 cache). The flagged seed is the detection `choose_seed` picked (largest at sea without a box-cut edge). **Gitignored** with the rest of `public/runs/`, like `drift.json`: regenerate on any other machine, after `export_drift_runs` |
| `data/cache/metocean/era5-wind_<hash>.nc` | 80-210 KB each | The ERA5 10 m wind the real runs are forced by, one file per request, keyed by the request's hash (`backend/ingest/metocean/cache.py`). Per scene: the 74 h before the pass (the original three) and the 74 h after it (fetched 2026-09-23 for the forecast); `wind_requests` in `export_drift_runs.py` defines both. **Gitignored**; re-fetched from CDS with `CDSAPI_KEY` if missing |
| `frontDemo/public/precomputed/` | 4-31 KB each | "Use precomputed result" for uploads (`FUTURE_WORK.md` §1.5): the segmentation of a known file, keyed by the file's SHA-256 (`index.json`), stamped with the model's SHA-256, mask as run lengths. Made by `npm run precompute:uploads -- <repo-relative files>` (default: `data/processed/sar/windows/*.tif`); `check:precomputed` recomputes every entry whose source is on disk. Current entries: the Gulf window, `8346860__Oil__00001.png`, Part I `Oil/00586.tif`. **Tracked**. Stale the moment the model changes: re-run after retraining |

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
— 86, 240 and 40 merged polygons, EPSG:4326, map-ready as-is.

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
| `COPERNICUSMARINE_SERVICE_USERNAME` / `_PASSWORD` | **absent** — blocks real current forcing |
| CDSE client id/secret | for the `.SAFE` download path |
| Supabase | hosted Postgres + PostGIS. Use the **session pooler on 5432**; the direct host is IPv6-only and the transaction pooler on 6543 lacks prepared statements |
