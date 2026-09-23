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
| D2 | **Two exact cross-split duplicates** survived into training: train `8346860__Oil__00357` and val `Oil__00356`, plus train `Oil__01339` and val `Oil__00007`. CRC32 tile splitting does not guarantee scene independence. | `eval/screening/dataset_audit.json` |
| D3 | **Part III was redistributed into internal train/val splits**, so historical results are *not* an untouched official Part III benchmark. | `eval/phase2-closure/STATUS.md` |
| D4 | **The held-out test split is consumed.** Evaluated exactly once. Any new generalisation claim needs a freshly frozen, independently labelled holdout. | `eval/final/INDEPENDENT_AUDIT.md` |
| D5 | **SAR GeoTIFF bands are unnamed.** The band-2 VV/dB assumption is recorded, not verified from metadata. Band 1 is VH and carries 0.51 dB of contrast — effectively no signal. Re-measured 2026-09-23 against the masks over 60 scenes (40 Part I, 20 Part III): band 2 carries more oil contrast in **60 of 60** (median 5.5 / 6.3 dB, against 0.5 / 0.1 dB in band 1), and is the brighter band by median in every one. Still not from metadata, but no longer an open empirical question. | `PREVIOUS_WORK.md`, `frontDemo/scripts/check-geotiff.ts` |
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
| X7 | **Case 3 fixture mismatch.** The available December GeoTIFF is `20231205T000214`; the published case requires `2023-12-05 23:57:19 UTC`. Reconcile acquisition and footprint before any Case 3 claim. Separately, and now fixed in the frontend: the published Case 3 coordinate as transcribed (89°58′07″W) is one degree of longitude out — the named vessel's own AIS puts its berth 0.07 km from 88°58′07″W and 97 km from the transcribed point. `RESEARCH/papers/P004.md:181` carries the transcribed value and was left unedited (canon, `CLAUDE.md` §5); whether the slip is in the paper or in the transcription is unverified — check the PDF before citing either. |
| X9 | **`run_ensemble` returns a time axis offset by one member's wind-phase shift, and stacks members that are not time-aligned.** `backend/drift/ensemble.py:171` applies the shift by moving the run's clock (`shifted_start = start + timedelta(...)`), then `:192` keeps `times` from whichever member ran first. Measured with `seed=0`: member 0's shift is **+2.757 h**, and `times[0]` comes back as `start + 2.757 h` to the microsecond. Members span **5.32 h** of clock disagreement (-2.567 to +2.757) yet their histories are stacked at the same row index and binned into one probability slice, so a single "timestep" mixes positions from instants up to 5.3 h apart. Consequences: the origin field's time axis, `estimate_age` and any AIS spatiotemporal gate are all shifted, and part of the reported ensemble spread is clock error rather than physical uncertainty. For a system whose thesis is matching a slick origin to vessel positions at a given time, 2.8 h is a vessel at 10 kn moving ~51 km. **No test catches this** because every test uses constant `Forcing`, where moving the clock is physically a no-op; it only bites with real time-varying ERA5/CMEMS readers. The intent — "the wind arrived early or late" — is right; the mechanism should offset the *forcing's* time reference while every member stays anchored to the acquisition time. |
| X10 | **The drift engine silently requires naive UTC datetimes.** Passing a tz-aware `datetime` fails deep inside xarray/pandas with `TypeError: Cannot compare tz-naive and tz-aware datetime-like objects`. Nothing in `backend/drift/` normalises `tzinfo`, and every test uses naive values, so the constraint is undocumented and unguarded. Any real ingest path hits this — an ISO-8601 acquisition time parsed from GeoTIFF metadata is naturally tz-aware. |
| X11 | **RESOLVED 2026-09-23 — `ruff check .` and `mypy ml backend scripts` are both clean (97 files).** The five ruff errors were all in `frontDemo/scripts/extract-sample-geometry.py`, which traced the authored samples from the cleaned JPEGs; it is gone, replaced by `extract-sample-geometry.ts`, which segments the normal sample JPEGs with the trained model (the cleaned JPEGs are deleted too). `scripts/__init__.py` ends the module-path collision; the 21 type errors that collision had been hiding (13 in `ml/train/checkpoint.py`, 8 across four scripts) are fixed with annotations and casts only, no runtime change. Original entry: **`ruff check .` is not clean and `mypy` cannot complete.** All five ruff errors are in `frontDemo/scripts/extract-sample-geometry.py`, which arrived with the frontend merge and was never linted by the backend track; three are `B023` late-binding-closure warnings, which is a real bug class in a script that generates `sampleGeometry.json`. Separately mypy aborts with *Source file found twice under different module names* for `scripts/prepare_final_dataset.py` — a module-path collision that stops it checking anything else. Both predate the 2026-09-22 reconciliation. |
| X8 | **External Aikido scan not performed** — source transfer was never authorised. No external security result is claimed. |

## 6. Frontend

| # | Issue |
|---|---|
| F3 | **Nothing is wired to a backend.** All content comes from `src/sim/` and static files under `public/` (real AIS for the Gulf scenes, the land mask, the OpenDrift exports). The shapes already mirror `PLAN/INTERFACES.md`, so this is a transport change, not a rewrite. |
| F14 | **Non-US traffic is still simulated.** Kutch, Mumbai, the three samples and every upload use `voyage()` in `sim/ais.ts` — routed, varied and labelled SIM, but invented. There is no free AIS for them on this machine; marinecadastre is US-only. Scenario notes that quote counts against the old straight-lane generator are marked historical where found (kutch-dark's local lane); others may remain (F8). |
| F12 | **`kutch-dark` fails under the `max` drift variant**, and did so before 2026-09-22 rather than because of that day's changes. It now ranks the ground truth **3rd** with a margin of −0.012; with the displacement reverted it instead **refuses** with insufficient evidence although the scenario has a truth to name. Both are wrong and neither causes the other. `integral` — the variant the console uses — ranks it 1st at 0.6419 with a 0.0677 margin. This is the open `S_drift` question in `FUTURE_WORK.md` §5 (max over track points versus the integral of the track through the field) showing up as a concrete failing fixture, which is exactly what that item asked for. `frontDemo/scripts/check-scenarios.ts` lists it rather than silencing it. |
| F17 | **`frontDemo/src/site/sections/SampleAnimationLab.tsx` is dead code.** Nothing imports it since the showcase was overhauled. Its references to the deleted cleaned sample JPEGs were removed on 2026-09-23 and it still type-checks, but it renders nowhere. Delete it (and whatever in `site/demoData.ts` only it uses) or remount it; decide which before editing it further. |
| F16 | **RESOLVED 2026-09-23.** Root cause: geotiff.js sizes its LZW dictionary at 4,093 entries where 12-bit codes reach 4,095; past 4,092 its writes vanish and a lookup loops on `undefined` until the array overflows. `frontDemo/src/sim/lzw.ts` is the same decoder sized to 4,096, registered through geotiff's own `addDecoder`; every pixel of scenes 00284, 00059, 00000 and 00570 then matches libtiff exactly, and `check:geotiff` always decodes the four train scenes that used to fail. Original entry: **geotiff.js 3.0.5 cannot decompress some LZW corpus scenes**, and the upload panel refuses them with "The raster bands could not be read." Seen on 4 of 24 Part I val scenes (`00059`, `00309`, `00452`, `00807`) and 3 of 8 train scenes sampled (`00504`, `00818`, `01168`; also `00284`): `RangeError: Invalid array length` in its LZW decoder. libtiff (rasterio) reads every one of them, so the files are sound. Separately, geotiff.js reads the SCIFIO-written **masks'** StripOffsets with the wrong byte order (16780 as 0x8C410000); only the checks read masks, and `frontDemo/scripts/corpusDisk.ts` parses them itself. |
| F11b | **RESOLVED 2026-09-23 — the upload path no longer uses the screen.** Uploads run the trained segmenter in the browser (`sim/segmenter.ts`); over 24 Part I validation scenes it scored precision .915 / IoU .769 against the screen's .045 / .045, which outlined the sea. The authored samples now use the model too, for their evidence figure and their geometry; the screen survives only behind `check:ingest`. Original entry: **The upload screen returns a wrong region on low-contrast tiles instead of refusing.** Measured over 24 labelled train tiles: 21 overlap a labelled slick, 1 misses (`13761290__Oil__00021`), and 2 Refined SOS tiles (`sentinel_18`, `sentinel_20`) return a region covering under 1% of the frame with recall **0.02**. Those two used to be refused as uniformly dark; recursive Otsu — which is what makes real georeferenced scenes work at all, since a Sentinel-1 window is ~90% water and the first cut finds the sea — now finds a sub-population in them instead. Contrast separation does **not** separate the good cases from the bad (those two score 0.146 and 0.154, higher than several correct tiles), so there is no honest threshold available and none has been invented. The split count is shown in the panel so an operator can see the first cut found the sea. The real fix is §4.1: run the trained model in the browser instead of a threshold. |
| F13 | **Contours can overlap the drawn coast by up to ~1 km at z≥12.** The land mask is GSHHG rasterised at 1/240° (~460 m) and the field is zeroed on land nodes after blurring, so an iso-line interpolates up to one density-grid step past the last water node, on a coast quantised to one land cell. Measured on the Malacca Strait GeoTIFF (`8346860/.../Oil/00586.tif`): 21 of 183 hindcast contour vertices fall in land cells, **every one** within one cell of GSHHG water, while Esri's drawn coast and GSHHG agree there within 0–0.28 km. Invisible at the z≈9 working view (~3 px); visible as a stair-step at z12+. A finer raster or dilating land for contour clipping would fix it; neither was done. |
| F15 | **The timeline's T0 button sometimes does not move the playhead.** Observed twice on 2026-09-23 in the browser pane (after a scenario switch, and after scrolling): clicking "Jump to the satellite pass" left the readout at T−36h, while clicking the timeline strip itself scrubbed correctly. Not investigated — it may be a click-target or focus issue in the pane rather than the app. Reproduce in a normal browser before fixing. |
| F5 | **Age interval is degenerate** — `[0, 0, 0]` for four of five scenarios. Presented honestly, but the `source_coincidence` estimator needs revisiting. |
| F6 | **`--panel-scale` is inert.** Every leaf text node computes to the same font size at 300, 430 and 760 px, while the dock body's own font-size does move. Two docblocks assert the opposite. A sweeping px-to-em refactor was already rejected, so the fix is probably to delete the mechanism or correct the claims. |
| F7 | **Smooth scrolling ignores reduced-motion.** `site/Nav.tsx` calls `window.scrollTo({ behavior: "smooth" })` in two places with no guard; CSS cannot reach an explicit `behavior`. |
| F8 | **Scenario copy is unverified against the data.** Three separate sessions each found a place where the console states something its own numbers contradict. Treat every `summary`, `short`, `provenance` and `tests` string in `scenarios.ts` as an unchecked assertion. |
| F9 | **No test harness exists in `frontDemo/`.** |
| F10 | **`maplibre-gl` has a critical XSS advisory.** Versions <= 6.4.0 are affected by a sanitizer bypass in `DOM.sanitize()` via live NamedNodeMap removal (GHSA-jrc7-96c5-q579). The project is on ^5.24.0; the fix is 6.10.0, a breaking major. Low practical risk while content is ours and local; it matters the moment the site is public. |
| F11 | **Basemap requires network.** Everything else renders locally; the map reports a tile failure and the other layers still draw (C12). |

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
- Only 11 named look-alike test tiles exist. That is a sparse EVALUATION
  sample, and it is not the same thing as having no look-alike data — a
  conflation that has been repeated more than once. Part III ships 150
  Lookalike and 150 No oil, and the built corpus holds **289 Lookalike and
  271 No_oil tiles**, 560 negatives against 2,577 Oil. What is missing is
  Part II’s additional ~42 GB (B3) and a test stratum wider than 11 tiles.
