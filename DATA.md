# DATA

Where everything lives, which copy is authoritative, and what is cheap to
regenerate versus irreplaceable. `data/`, `runs/` and model checkpoints are
gitignored — a clean clone has the code and none of this.

Current footprint: **`data/` 158 GB, `runs/` 1.8 GB, `eval/` ~70 GB tracked
portion excluded** (see §6). Free space on this machine at last check: 225 GB.

---

## 1. The stale-path problem — read before running anything

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
| `8346860` | Part I | **53 GB** | 1,200 oil-positive images + masks. 1-band 2048², values `{0,1}`, **not georeferenced** |
| `13761290` | Part III | **16 GB** | 150 each of `Oil`, `Lookalike`, `No oil`, plus `Mask/` |
| `15298010` | Refined Deep-SAR SOS | **1.4 GB** | 6,455 train + 1,615 val pairs, 3-band RGB 256², values `{0,255}` |
| `8253899` | Part II | **not extracted** | Only two mask archives (426 KB + 417 KB). The two ~21 GB image archives were never downloaded. See `ISSUES.md` B3 |

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
| `runs/final_l1_fp32_release/` | 274 MB. The 100/100-epoch FP32 reproduction |
| `runs/final/` | 604 MB. `none-ciou`, `L1-ciou` (best + epoch snapshots), `L4-ciou` (no weights — NaN failure) |
| `runs/ablation/` | 233 MB. The 12 screening cells. `none-ciou` has no checkpoint |

Frozen inference config, from the manifest: `imgsz 1024, batch 4, conf 0.20,
iou 0.70, max_det 1000, half false, rect true, retina_masks true`; raster
`band 2, sigma0_db, db_window [-35, 0]`; tiling `1024 / 0.1 overlap`.

**`runs/` is the one directory worth copying by hand** when moving machines.
Re-deriving it costs roughly 4.5 hours of GPU time.

## 6. Evaluation artifacts — `eval/`

240 MB on disk. Tracked selectively:

| Kept (tracked) | Dropped (gitignored, derived) |
|---|---|
| `*.json` summaries and manifests | `**/feature_cache/` (169 MB) |
| `*.md` reports | `*.npz` |
| `*.geojson` scene detections | `*.jsonl` per-image dumps |
| `*.png` review previews | `*.log` |

`eval/final/scenes/*.geojson` holds **three real full-scene detection outputs**
— 86, 240 and 40 merged polygons, EPSG:4326, map-ready as-is.

## 7. What is irreplaceable versus regenerable

| Irreplaceable without re-download or re-training | Regenerable |
|---|---|
| `data/interim/datasets/zenodo/**` (70 GB of downloads) | `data/processed/dataset/**` — rebuild with `scripts/build_dataset.py` then `prepare_final_dataset.py` |
| `data/raw/sar/**` | `data/processed/sar/**` — rerun the SNAP graph, but budget 1h+ per scene |
| `runs/**` (~4.5 GPU-hours) | `eval/**/feature_cache`, `*.npz`, `*.jsonl` |
| `weights/L1-ciou-research.pt` | `eval/final/scenes/*.geojson` — rerun inference |

## 8. Credentials

`.env` is gitignored; `.env.example` lists the keys.

| Key | State |
|---|---|
| `CDSAPI_KEY` (ERA5 wind) | **set** |
| `COPERNICUSMARINE_SERVICE_USERNAME` / `_PASSWORD` | **absent** — blocks real current forcing |
| CDSE client id/secret | for the `.SAFE` download path |
| Supabase | hosted Postgres + PostGIS. Use the **session pooler on 5432**; the direct host is IPv6-only and the transaction pooler on 6543 lacks prepared statements |
