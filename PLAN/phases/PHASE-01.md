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
- [ ] All three fixture scenes fetched and pre-processed end-to-end
- [ ] Geocoding round-trip < 1 px, asserted in CI
- [ ] Coastline overlay aligns visually on all three scenes
- [ ] Zenodo Parts I/II/III + Refined SOS downloaded and verified
- [ ] marinecadastre AIS downloaded for the three fixture dates
- [ ] Look-alike negative pool assembled at ~10% per split
- [ ] Relabelling pass complete on the training positives
- [ ] SAR Fixed Infrastructure Dataset obtained for the GoM AOI

## Known failure conditions
- `esa_snappy` JVM memory errors on large IW scenes → raise `-Xmx` in `gpt.vmoptions`.
- CDSE OAuth token expiry mid-download → refresh and resume.
- Terrain correction silently reprojecting to a UTM zone → assert EPSG:4326 explicitly.
- Refined Lee over-smoothing thin slicks → keep the filter window at the SNAP default; do
  not increase it.
