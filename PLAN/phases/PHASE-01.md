# PHASE-01 — Data acquisition and SAR pre-processing

## Objective
Fetch all required data, and turn a raw Sentinel-1 GRD product into geocoded, speckle-
filtered, land-masked σ0 dB tiles with an exact pixel↔geo mapping.

## Why it exists
Every downstream stage depends on geocoding fidelity. P004 §2.3 states that geometric
correction is precisely what "ensure[s] the alignment of images and geographic coordinate
systems **to match the SAR images with the AIS data**". A metre of geocoding error is a
metre of error in proximity scoring, propagated silently into an accusation.

## Dependencies
PHASE-00.

## Files to create
```
backend/ingest/sar/fetch.py          CDSE STAC/OData + AWS Open Data
backend/ingest/sar/preprocess.py     SNAP graph invocation
backend/ingest/sar/tiling.py         1024x1024 overlapping tiles + geotransform
backend/ingest/sar/geo.py            pixel<->geo helpers
backend/ingest/datasets/zenodo.py    Parts I/II/III + Refined SOS download & verify
backend/ingest/datasets/relabel.py   binary -> {oos, slick_unknown} assistance tooling
graphs/s1_grd_preprocess.xml         SNAP GPT graph
tests/test_geocoding.py
tests/test_tiling.py
```

## Implementation details

### Fetch
CDSE STAC/OData by AOI + date; AWS Open Data Registry as the lower-friction fallback
(what Cerulean uses). **SciHub is dead — never target `scihub.copernicus.eu`.**

Fixture scenes to fetch first (Port of South Louisiana, Sentinel-1 IW GRD VV):
- **2023-04-09 00:02 UTC** (P004 Case 1)
- **2023-05-15 00:02 UTC** (P004 Case 2 — the headline fixture)
- **2023-12-05 23:57:19 UTC** (P004 Case 3)

### SNAP chain (fixed order, P004 §2.3)
1. Apply orbit file
2. **Calibrate** to σ0, convert to dB
3. **Refined Lee** speckle filter
4. **Land mask** (SRTM/GSHHG)
5. **Terrain correction** → EPSG:4326

Run as a SNAP GPT graph inside the `ingest` container. **Do not attempt native Windows
install** (`CONSTRAINTS.md`).

### Tiling
1024×1024 with ~10% overlap (matching P004's sub-image size). Write GeoTIFF with a full
geotransform + CRS — not a world file — so `rasterio` alone can round-trip coordinates.

### The relabelling problem — budget real time for this
Zenodo masks are **binary** (oil / not-oil). Our scheme needs **two foreground classes**.
`relabel.py` is an assistance tool, not an automation: it proposes a class from morphology
(elongation, compactness, proximity to a CFAR bright target — linear + vessel-adjacent →
`oos`; irregular → `slick_unknown`) and exports for human confirmation.

> **This is the largest hidden cost in the plan** (`CONSTRAINTS.md`). It is annotation
> work, not code. Start it as soon as Part I is downloaded, in parallel with other phases.

### Negative pool
Zenodo **Part II** is explicitly no-oil / look-alike. Target ~**10% of every split**,
matching P004 §2.4 (200/2048 train, 25/231 val, 25/231 test).

## Inputs / outputs
- In: AOI + date range; Zenodo archives; AIS fixture dates
- Out: geocoded σ0 dB GeoTIFFs + tiles in `data/processed/`; rows in `scenes`;
  a class-labelled training set

## Relevant interfaces
`INTERFACES.md` §1 (`ingest_scene`), §4 (CDSE/AWS contracts).

## Relevant research
`RESEARCH/topics/sar-oil-spill-detection.md` (chain, sensor config);
`RESEARCH/topics/datasets-and-data-access.md` (all URLs, the Phase-1 checklist);
`RESEARCH/papers/P004.md` §2.2–2.4.

## Tests
- **`test_geocoding.py` — pixel→geo→pixel round-trip error < 1 px.** This is the invariant
  the whole system rests on; it runs in CI.
- Tile mosaic reassembles to the source extent with no gaps.
- A known coastline vector overlays the land mask correctly.
- Zenodo archives verified by checksum and mask/image count.

## Acceptance criteria
- [x] All three fixture scenes **fetched** (classic `.SAFE`, `data/raw/sar/safe/`)
- [ ] All three fixture scenes pre-processed end-to-end — **none complete.** Case 1 ran
      correctly but exceeded the then-1-hour timeout and was killed; its partial output was
      deleted. Timeout is now 4 h. Budget hours per scene
- [ ] Geocoding round-trip < 1 px, asserted in CI
- [ ] Coastline overlay aligns visually on all three scenes
- [ ] Zenodo Parts I/II/III + Refined SOS downloaded and verified — **blocked on disk:
      91 GB of archives against 59.9 GB free (2026-08-29)**. Downloader and checksum
      verification are written and tested (`backend/ingest/datasets/zenodo.py`); only the
      space is missing. Sizes and a suggested order are in `HANDOFF.md`
- [x] marinecadastre AIS downloaded for the three fixture dates (10 days, `data/raw/ais/`)
- [ ] Look-alike negative pool assembled at ~10% per split
- [ ] Relabelling pass complete on the training positives
- [ ] SAR Fixed Infrastructure Dataset obtained for the GoM AOI

## Known failure conditions
- JVM memory errors on large IW scenes → raise the heap. `preprocess.py` passes
  `-J-Xmx` explicitly (`max_heap_gb`); the SNAP default does not survive Refined Lee over a
  full 25k×17k IW scene.
- CDSE OAuth token expiry mid-download → refresh and resume. Handled in `cdse.py`.
- Terrain correction silently reprojecting to a UTM zone → assert EPSG:4326 explicitly.
  `preprocess.run_graph` reads the written product back and raises on any other CRS.
- Refined Lee over-smoothing thin slicks → keep the filter window at the SNAP default; do
  not increase it.

### Confirmed on this hardware, 2026-08-29

- **`mapProjection` must be `WGS84(DD)`, never `EPSG:4326`.** This one cost hours.
  SNAP wants its own CRS name in that parameter. Given an `EPSG:nnnn` string it builds a
  degenerate CRS, computes a **zero-size target**, and dies *at graph init* as:
  - `Terrain-Correction` → `java.lang.ArithmeticException: / by zero` at
    `OperatorImageTileStack.createLocks`
  - `Ellipsoid-Correction-GG` → `Width (0) and height (0) must be > 0` — the same root
    cause, stated plainly.

  It presents as a data or install fault and is neither. Ruled out along the way, all
  irrelevant: SNAP version (**12 and 14 fail identically; 12 is not needed**), COG vs
  classic packaging, input format (`.SAFE` and BEAM-DIMAP alike), scene size (a 512×512
  subset fails the same in 5 s), a fresh `snap.userdir`, DEM availability,
  `pixelSpacingInMeter`/`InDegree`, and `snap.jai.defaultTileSize`.
  The product was verified healthy throughout: 210 geolocation grid points, 17 orbit state
  vectors, IPF 003.61, and populated `latitude`/`longitude` tie-point grids
  (28.59–28.96 N, −90.17 to −89.84 E).

  Guarded by `tests/test_preprocess.py`. The written GeoTIFF does read back as EPSG:4326.
- **`nodataValueAtSea` must be `false` in Terrain-Correction.** It defaults to **true**,
  and SRTM has no data over water, so on a marine scene it nulls almost every pixel. The
  result is the nastiest kind of failure: SNAP exits 0 and writes a correctly sized,
  correctly georeferenced, **entirely zero** raster. Geometry checks pass it. For an
  oil-spill pipeline the sea is the signal, not the background.

  Measured stage by stage on the Case 1 fixture — `Read` 97.2% non-zero (DN 3–1243),
  `+Calibration` 97.2%, `+Land-Sea-Mask` 84.5% (correctly masking ~13% as land) — and then
  0% after Terrain-Correction with the default.

  **A caution about method:** this parameter was tested early and appeared not to help, so
  it was wrongly set aside. That test was invalidated by the `mapProjection` bug, which
  made the run fail before the parameter could have any effect. When several faults stack,
  a negative result only means something once the *other* faults are cleared.

  `run_graph` now calls `check_has_data` as well as the CRS check, so an empty output can
  no longer be reported as success.
- **Budget hours per scene, not minutes.** A full IW GRDH scene (25896 × 16734) through
  Refined Lee and Terrain-Correction at 10 m pixel spacing had written 2.5 GB and was
  **still running at 60 minutes** on an RTX 4060 Ti desktop (the chain is CPU-bound; the
  GPU is irrelevant here). The original 1-hour timeout killed a perfectly healthy run.
  `DEFAULT_TIMEOUT_S` is now 4 h, and a failed or timed-out run deletes its partial output
  so a truncated raster is never skipped as "already done" on the next pass.
- **Check `PROJ_LIB` before believing a CRS reads as `None`.** A PostgreSQL/PostGIS install
  sets machine-level `PROJ_LIB`/`GDAL_DATA` that shadow rasterio's PROJ database, and
  `crs.to_epsg()` then returns `None` for a perfectly good EPSG:4326 product. See
  `scripts/SETUP_NEW_MACHINE.md`. A shell started before the fix keeps the stale value.
- **Prefer the classic products over `_COG` anyway.** SNAP warns *"The calibration LUT for
  this product could be incorrect and therefore the calibration result may not be
  reliable"* on the COG packaging but not the classic one. Classic is ~1.62 GB against
  ~0.87 GB; ids are pinned in `scripts/download_cdse_fixture_safe.py`. (Note: the COG
  packaging is **not** the cause of the geocoding failure above — that was an early
  hypothesis and it was wrong.)
- **`measurement/`-only downloads cannot be calibrated.** The sigma0 LUTs live in
  `annotation/calibration/`. Fetch the whole `.SAFE`.
- **`Land-Sea-Mask` must not carry a `geometry` parameter when `useSRTM=true`.** SNAP
  parses the value as a band-arithmetic expression; a placeholder such as `0,0` fails the
  graph with `Undefined symbol '0,0'` in `CreateLandMaskOp`. Guarded by
  `tests/test_preprocess.py`.
