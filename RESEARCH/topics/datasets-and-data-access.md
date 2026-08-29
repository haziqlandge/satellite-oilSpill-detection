# Topic — Datasets and data access

Everything here was verified by web research in the session of 2026-08-28, or is stated in
[[P004]]. Access conditions change; re-verify before relying on any single row.

## 1. SAR imagery — Sentinel-1

### Access (important: the old route is dead)
**The Copernicus Open Access Hub (SciHub) ceased operations 2 Nov 2023.** Anything
referencing `scihub.copernicus.eu` or `sentinelsat` against it is stale.

| Route | Notes | Recommended for |
|---|---|---|
| **Copernicus Data Space Ecosystem (CDSE)** | Free tier. STAC, OData and S3 APIs. Native-format zipped products available for ~1 month after publication; older data via the catalogue | Targeted scene fetch by AOI + date |
| **AWS Open Data Registry** | What Cerulean uses for S1 GRD; lower friction, no auth ceremony | Bulk / repeated access |
| openEO (CDSE) | Free tier with a monthly resource quota | Server-side processing |

Note the CDSE **STAC endpoint consolidation of 17 Nov 2025** — both endpoints now serve the
same catalogue content.

### Product spec we need
Sentinel-1 **IW GRD, VV polarisation, 10 m** ([[P004]] Sec. 2.2). See
[[sar-oil-spill-detection]] for the pre-processing chain.

## 2. Labelled oil spill datasets

| Dataset | Content | Access | Verdict |
|---|---|---|---|
| **Zenodo "Sentinel-1 SAR Oil spill image dataset" Part I** — `zenodo.org/records/8346860` | 1200 S1 Sigma0 (dB) images + 1200 masks; **2048x2048x2** GeoTIFF, masks 2048x2048, foreground=1 | **Open** | **Primary training source** |
| **Part II** — `zenodo.org/records/8253899` | Train/val images for **No Oil and Look-alike** scenarios | **Open** | **The look-alike negative pool** — exactly what [[lookalike-discrimination]] Layer 1 needs |
| **Part III** — `zenodo.org/records/13761290` | Test images | **Open** | Held-out test |
| **Refined Deep-SAR Oil Spill (SOS)** — `zenodo.org/records/15298010` | ~38% of train masks and ~50% of val masks **manually corrected** for annotation consistency | **Open** | **Prefer these masks** where they overlap |
| **Krestenitis / MKLab (CERTH)** | 1112 images @ 1250x650, 10 m; **5 classes**: sea surface, oil spill, look-alike, ship, land. 1002 train / 110 test. 280+ citations, the reference benchmark | **On request** from the authors | Request early; treat as a bonus, not a dependency |
| Eastern Mediterranean oil slicks / look-alikes (ESSD 2025) | Slicks, look-alikes and remarkable SAR signatures from S1 | Open (ESSD) | Secondary; useful for cross-region generalisation testing |

[[P004]] used **MKLab (615 screened images) + 155 Bohai sub-images = 770**. Since MKLab is
request-gated, our substitute is **Zenodo Parts I/III + Refined SOS for positives, Part II
for look-alike negatives**, targeting roughly the same ~10% negative fraction per split.

**Note the label-schema mismatch:** Zenodo masks are **binary** (oil / not-oil); [[P004]]'s
scheme needs **two foreground classes** (`oos`, `slick_unknown`). Bridging this requires a
relabelling pass — assign class by slick morphology (linear + vessel-associated vs
irregular), which is a real annotation cost to budget in Phase 1/2. Krestenitis's 5-class
labels do not solve it either, since its `oil spill` class is also undifferentiated.

> **This is the largest hidden cost in the whole plan.** Flag it explicitly in PHASE-02.

## 3. AIS

### Real — United States only, free
**`marinecadastre.gov`** (redirects to `hub.marinecadastre.gov/pages/vesseltraffic`). The
source [[P004]] used. Since 2015: **Zstd-compressed daily CSV**, filtered to 1-minute
intervals, all US coastal waters.

Schema:
```
MMSI, BaseDateTime, LAT, LON, SOG, COG, Heading,
VesselName, IMO, CallSign, VesselType, Status,
Length, Width, Draft, Cargo, TransceiverClass
```

Also mirrored to GCP/BigQuery and AWS by third parties (USCG NAIS 1-minute).

### Which days to actually download

Do not pull the year (about 3 GB compressed, 80 GB expanded). The fixtures need ten daily
files, sized to the **72 h** backward horizon:

| Case | Acquisition (UTC) | Days |
|---|---|---|
| 1 | 2023-04-09 00:02 | `2023-04-07`, `04-08`, `04-09` |
| 2 | 2023-05-15 00:02 | `2023-05-13`, `05-14`, `05-15` |
| 3 | 2023-12-05 23:57 | `2023-12-02`, `12-03`, `12-04`, `12-05` |

Case 3 needs the extra day because its source vessel sailed at 18:06:50 and moored at
18:59:12 on **3 December** - roughly 53 hours before acquisition, outside a 48 h window.
That is the reason the horizon is 72 h and not 48 h.

**Do not use a different year.** All three fixtures are 2023; AIS from any other year has no
ground truth to validate against.

**This is why the Gulf of Mexico is our validation region** — it is the only place where
free real AIS coincides with a published, peer-reviewed attribution ground truth
([[P004]]'s three TPSL cases).

### Synthetic — Indian waters
No comparable free real AIS exists for Indian waters, and [[P002]] notes AIS data sharing
between states can be politically constrained. The problem statement anticipates this:
*"Real AIS if available may be used else synthetic data can be prepared for the region of
oil spill."*

**Design rule: the synthetic generator emits the marinecadastre schema exactly**, so one
ingest and feature path serves both regions and the synthetic path is validated by the real
one. Generation recipe adapted from [[P003]] (noise injection into normal trajectories,
abrupt speed change, irregular routing, Gaussian and time-series perturbation), with one
correction: **ground truth is the scripted discharge event we author, never the output of an
anomaly detector** — [[P003]]'s circularity is the mistake to avoid.

Candidate demo regions: **Gulf of Kutch**, **Mumbai High** (offshore platforms + dense
traffic), **Ennore/Chennai** (a real 2017 spill site with published INCOIS trajectory studies).

### Reference for dark-vessel / gap methodology
Global Fishing Watch, Welch et al. 2022 — repo `GlobalFishingWatch/AIS-disabling-high-seas`.
Method and scripts for identifying **intentional** AIS disabling as distinct from coverage
artefacts. See [[ais-attribution-and-scoring]].

## 4. Met-ocean forcing

| Field | Product | Access |
|---|---|---|
| Ocean currents (forecast/analysis) | CMEMS `GLOBAL_ANALYSISFORECAST_PHY_001_024` | Free account at marine.copernicus.eu; OpenDrift ships a CMEMS reader |
| Ocean currents (reanalysis) | CMEMS `GLOBAL_MULTIYEAR_PHY_001_030` | Needed for our **historical 2023 GoM fixtures** |
| Total surface currents | CMEMS `MULTIOBS_GLO_PHY_MYNRT_015_003` | Geostrophic + Ekman, 0 m and 15 m, hourly, 1/4 deg |
| Wind | ERA5 (reanalysis) / GFS (forecast) | CMEMS currents are ERA5-forced, so ERA5 is the consistent pairing |
| India (reference) | INCOIS OOSA — NOAA **GNOME** in diagnostic mode over the Indian Ocean, forced by ROMS / HYCOM / GODAS + ECMWF / NCMRWF / WRF; 96 h trajectories via WebGIS | Reference and cross-check only |

**Cache all forcing to local NetCDF during Phase 4.** The demo must run offline; CMEMS auth
and quota are the most likely live-demo failure point.

## 5. Infrastructure

Cerulean uses the **SAR Fixed Infrastructure Dataset** for offshore platform locations.
Needed for the infrastructure branch of the collation score, and to resolve [[P004]]'s
Case 1 (platform leak, no vessel within 5 km).

## 6. Reference system

**SkyTruth Cerulean** — `skytruth.org/cerulean`, methods at `/cerulean/methods`, code at
`github.com/SkyTruth/cerulean-cloud`, plus an OGC-compliant REST API and a public database
of **human-reviewed** slicks. Free. Now integrated into Skylight.

Two distinct uses for us: (1) the algorithm reference for [[ais-attribution-and-scoring]];
(2) **its expert-reviewed slick database is an independent label source** we could use for
validation. Worth investigating in Phase 8.

## Data acquisition checklist (Phase 1)

- [ ] CDSE account; verify STAC/OData query for an AOI + date range
- [ ] Fetch the three [[P004]] TPSL fixture scenes: 2023-04-09, **2023-05-15**, 2023-12-05
- [ ] Download Zenodo Parts I, II, III + Refined SOS
- [ ] Email CERTH/MKLab requesting the Krestenitis dataset (long lead time — do this first)
- [ ] Download marinecadastre AIS for the three fixture dates
- [ ] CMEMS account; cache reanalysis currents + ERA5 wind for the fixture windows
- [ ] Obtain SAR Fixed Infrastructure Dataset for the GoM AOI
- [ ] **Scope the `oos` vs `slick_unknown` relabelling effort on Zenodo positives**
