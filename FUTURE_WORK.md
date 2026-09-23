# FUTURE WORK

Ordered by what unblocks what. Open problems are in `ISSUES.md`; finished work
is in `PREVIOUS_WORK.md`.

Two jobs are marked **[4060 Ti]** — they need training and cannot run on the
session machine. See `CLAUDE.md` §1.

---

## 0. Start here — handover to the RTX 4060 Ti machine (2026-09-23)

Read `CLAUDE.md` first, then this section. **Replace this section when its
contents are done** — do not append a second one.

### The situation

A **local** demo plus a research model. The frontend must be top-tier; the
backend can stay file-driven. The user is Haziq; commit as them via
`commitskill` and **never add AI attribution** — authorship matters for this
submission. Commit only when the user asks. The user verifies in the browser
pane and wants the same from you: reload (and confirm the reload happened),
view the map at about **z9**, screenshot as proof, and exercise uploads with
both a dataset PNG and a GeoTIFF — the browser pane's file picker is under
**Add image** in the console's right dock.

**This work is moving to the 4060 Ti machine**, which can train (`CLAUDE.md`
§1). It already holds the Zenodo corpus and is downloading Part II. Everything
in git is on GitHub at `haziqlandge/satellite-oilSpill-detection`, `main`. What
git does NOT carry is listed next; the user sends it separately.

### Files that are not in git (sent separately by the user)

| Path | Why it matters | If missing |
|---|---|---|
| `.env` | CDS (ERA5), CDSE, Supabase credentials | ERA5 re-fetch and database tests fail. Never commit it |
| `data/cache/metocean/*.nc` (612 KB) | The ERA5 wind the three real drift runs used | `export_drift_runs` re-fetches from CDS (needs `.env`), minutes |
| `frontDemo/public/runs/<scene>/{drift,scene}.json` (13 MB) | The real-run views | Regenerate: `export_drift_runs --all`, then `export_real_scenes` (commands below) |
| `frontDemo/public/models/L1-ciou-research.onnx` (13 MB) | The browser segmenter | `.venv/Scripts/python.exe -m ml.export.onnx_export` from `weights/L1-ciou-research.pt` |
| `weights/L1-ciou-research.pt` (13 MB) | The release checkpoint | It came from this machine's `runs/final_l1_fp32_release/`; check before asking |
| `data/interim/ais/*.npz` (218 MB), `data/raw/ais/2023/*.zip` (2.9 GB) | Only to RE-export AIS | The tracked `frontDemo/public/ais/*.json` already serve the app |
| `data/processed/sar/*_s0db.tif` (3 × 3.6 GB) + `windows/` | Only to re-run full-scene inference or cut upload windows | Needed for job 2 below; skip otherwise |
| `frontDemo/node_modules`, `.venv` | Environments | `cd frontDemo && npm install`; `scripts/SETUP_NEW_MACHINE.md` |

After copying anything from another machine, run
`.venv/Scripts/python.exe -m scripts.repath_artifacts --check` (`CLAUDE.md` §2).

### Progress against this plan (counted 2026-09-23)

**6 of the 27 work items in this file are done — about 22%.** §1: 5 of 6
(§1.1, §1.2, §1.3, §1.4, §1.6); §2: 0 of 6; §3: 0 of 6; §4: 1 of 3 (§4.1); §5:
0 of 6. Bug fixes are not plan items and are not counted.

### THE JOBS, in order

**Job 0 — set up and prove the tree.** Pull `main`; place the files above; run
the verification block at the end of this section. Expected: pytest **515
passed, 9 skipped** here (6 database skips need the Supabase pooler, X1; a
machine with CUDA may skip fewer), ruff and mypy clean, all 11
`npm run check` scripts pass, `npm run build` succeeds.

**Job 1 — Part II and the look-alike false-alarm rate (§2.5, the reason for
the move).** Do this before anything else. Protocol, in order:

1. Confirm Part II is complete: `scripts/download_zenodo.py --records negatives`
   finishes, then `scripts/extract_zenodo.py`, then counts and hashes against
   the record. Only the mask archives were ever here (B3).
2. **Freeze a Part II look-alike holdout before training on any of it**,
   split by scene, never tuned on. The consumed test split cannot measure the
   change (D4) — its 8/11 look-alike figure is the old baseline and must not be
   re-evaluated. Report the frozen holdout's size and how it was cut.
3. Rebuild the dataset with the enlarged negative pool as a NEW version
   (`final-v12`), preserving overlap quarantine; `final-v11` stays frozen
   (`CLAUDE.md` §5). Add Part II to train (and the holdout) only and leave
   validation as it is, so the 13/23 figure below stays comparable.
4. Retrain the release configuration (`L1-ciou`, FP32-safe, as
   `runs/final_l1_fp32_release/` was trained); record physical batch and seed.
5. Report **look-alike false alarms separately from mAP** (C8): on validation
   against the current **13/23**, and on the new Part II holdout. Report mAP
   too; a model that alarms less but finds less is a tradeoff, not a win.
6. **Ask the user before promoting new weights** to `weights/` or the browser.
   The release manifest, `onnx_export` and every downstream artifact key off it.

**Job 2 — only if the user promotes new weights.** Re-export ONNX
(`ml.export.onnx_export`, which checks parity with PyTorch), re-run full-scene
inference on the three Gulf scenes (`backend/detect/yolo_lsk/infer.py`; writes
`eval/final/scenes/*.geojson`), then the real-run chain:
`export_drift_runs --all`, `export_real_scenes`, `export_ais_traffic --real-runs`.
Then check whether whole-tile blocks (`ISSUES.md` Q5) are fewer — the seed rule
reports how many it passed over.

**Job 3 — verify what the last session built but could not check in the
browser** (it ran out of time):

- The **full-resolution raster viewer** (`console/RasterViewer.tsx`): upload a
  dataset PNG and a Part I GeoTIFF through Add image, click any of the three
  evidence images in the detect pane — the viewer should open full screen, wheel
  and double-click zoom about the cursor, drag pans, `0` fits, `1` is 1:1 (pixels
  drawn as blocks above 1:1), `M` toggles the model's mask (blue = every pixel
  marked, yellow = the outline drifted), Esc closes and returns focus.
  `tsc -b` is clean; nothing else about it has been run.
- **The three real-run views after the re-seed** (below): PLAY −72 → 0 h on each,
  no console errors, the provenance names the seed rule.

**Job 4 — the rest of the plan**, in this file's order: §1.5 skip button; §2.1
CFAR over the pilot tiles, §2.2 a usable review pack, §2.3 the rubric, §2.4 the
downstream `oos`/`slick_unknown` verdict; §3 the API (`POST /runs` + SSE, the
live pipeline); §5 phases 03 and 06 (the `S_drift` max-vs-integral question,
ISSUES F12), 09 (offline snapshot). Open bugs worth taking on the way: X9 (apply
the wind-phase shift through the ERA5 reader's time reference), X10 (naive UTC
guard), F10 (maplibre XSS — a major-version upgrade), F15, F6, F7.

### What the 2026-09-23 sessions did (do not redo)

- **Browser segmenter** (§4.1): the release model runs in the browser via ONNX,
  pixel-for-pixel with `infer_scene`; uploads, the authored samples' evidence
  and their geometry all use it. Otsu survives only behind `check:ingest`.
  Input traps fixed: band choice (brighter band by median), zero-fill as
  no-data, geotiff.js's short LZW dictionary (`sim/lzw.ts`), a WebGPU deadlock
  on overlapping runs (`segment()` queues; never call `session.run` elsewhere).
- **Real AIS** for the three Gulf scenes with the published vessels as truth
  (§1.6); two authored cases corrected from it (Case 2 heading, Case 3's
  one-degree longitude slip, X7).
- **Real runs in the console** (§1.3): `sim/realRun.ts` — three "Real · <date>"
  views, listed under "real runs · nothing simulated": the model's full-scene
  detections, OpenDrift's 73 backward frames (−72..0 h), real AIS, ERA5 wind.
  **Nobody is ranked**: the fields never converge (`monotonic`, no age, C1)
  and carry no currents (X2); the view says so as E-C1. Not in `SCENARIOS`
  (the synthetic checks iterate it); `buildRun` dispatches on `isRealRun`.
  Commit `0a5a2b4`.
- **Contours drawn as outlines of the exported cells** (`dissolveCells`,
  `polygonsOf` in `sim/geo.ts`; holes kept), lobes counted as regions, one
  provenance badge rule (`provenanceFlag`).
- **The real runs are re-seeded** (uncommitted at the time of writing; see the
  commit that follows `0a5a2b4`). `choose_seed` in `scripts/export_drift_runs.py`
  replaces "the ring with the biggest bounding box", which picked a box the
  model had filled in every scene and, in December, an inland water body
  (`ISSUES.md` Q5). Rule: the largest detection at sea on GSHHG (centre
  offshore, ≤10% on land) whose outline never runs straight along the pixel
  grid for 1.2 km or more — a straight edge that long is the model's box, not a
  slick's edge (90% of detections have no run over ~0.6 km; the boxes run
  3–9 km). Seeds now: April 5.5 km² conf .47 (9 box-cut passed over), May
  6.7 km² conf .31 (55), December 3.2 km² conf .81 (5) — December's is a
  textbook discharge streak; April's is part of a filament network that may be
  a natural film; May's sits in a 2.5 m/s-wind sea. `drift.json` records
  `seedDetection` and the view states the rule. `tests/test_export_drift_runs.py`.
- **`check:realdrift` now asserts OpenDrift's own on-land share** (`onLandPct`,
  measured on GSHHG polygons at export) instead of the raster's "deep ashore"
  count, which the re-seeded December run broke: its parcels entered delta
  passes narrower than one 1/240° cell — 98.8% of the raster's "deep" parcels
  are GSHHG water, all within a quarter cell of it.
- **Stale ISSUES rows corrected**: X3 (an ERA5 fetcher exists), X5 (drift is
  serialised as JSON for the frontend), X9 (the clock half is fixed; the phase
  shift is not applied).

### Regenerating the real runs

```bash
.venv/Scripts/python.exe -m scripts.export_drift_runs --list
```

```bash
.venv/Scripts/python.exe -m scripts.export_drift_runs --all
```

```bash
.venv/Scripts/python.exe -m scripts.export_real_scenes
```

```bash
.venv/Scripts/python.exe -m scripts.export_ais_traffic --real-runs
```

Set `DEMO_OFFLINE=1` to forbid network fetches (cache only). About 90 s per
scene on the session machine's CPU. `check:realruns` and `check:realdrift` skip
until the files exist.

### Waiting on the user

- **Delete or remount `site/sections/SampleAnimationLab.tsx`** (`ISSUES.md`
  F17). Nothing imports it since the showcase was overhauled; its
  cleaned-image references are already gone.

- **Review `console/PositionPicker.tsx`** (map pin, footprint box, live
  water/land) before building on it.
- Whether rejected traffic should be drawn brighter. It is dim by design (the
  selected track must stand out) and the Colour Attributes panel can change it;
  do not change the palette unasked.
- Real AIS for non-US scenes and uploads needs a paid provider (Spire,
  MarineTraffic, Global Fishing Watch); ask before pursuing.

### Open limitations worth knowing (in `ISSUES.md`)

F12 kutch-dark under `max` ranks the truth 3rd-4th (the open `S_drift` question,
§5); F13 contours can overlap the drawn coast by ~1 km at z≥12; F14 non-US
traffic is simulated; F15 the T0 button sometimes does not move the playhead
(unverified); X7 Case 3 acquisition mismatch.

### A correction to carry forward

Look-alike data exists: Part III ships 150 Lookalike and 150 No oil, and the
built corpus holds 289 Lookalike and 271 No_oil tiles. What is missing is Part
II's ~42 GB (B3) and a test stratum wider than 11 named look-alike tiles (Q2).
Say it that way.

### Traps already paid for

- **`times` descends on a backward run.** `times[0]` is the observation.
- **The drift engine needs naive UTC datetimes** (X10).
- **`json.dumps` writes a bare `NaN`** that `JSON.parse` refuses;
  `check-real-drift.ts` parses every artifact for that reason.
- **Otsu finds the sea, not the oil,** on a real scene; re-applied inside the
  dark class and disclosed as "split Nx".
- **Corpus GeoTIFFs sit outside `DB_WINDOW`** (−35..0 dB); the decoder falls back
  to the raster's own range and says so. **Band order is not consistent** (D5).
- **npm 10+ ignores `--prefix` for `install`.** Use `cd frontDemo`.
- **`buildRun` refuses a Gulf scene until its real AIS is loaded.** The browser
  path awaits `ensureRealTraffic` in `lib/spill.ts`; Node checks call
  `useDiskTraffic()` (`scripts/realAisDisk.ts`) and, for coastal tiles outside
  the bundle, `useDiskLandmask()` then `await ensureLandmask(...)`.
- **The AIS export is slow once, fast after:** ~12 min to parse the 8 national
  days into `data/interim/ais/*.npz`, then 8 s. A simplified track cannot tell
  you where reception gaps are — the export records them as `breaks`.
- **Browser-pane verification traps:** a Shift+F5 once did not reload (check
  `performance.timeOrigin` is seconds old, or use `location.reload()`);
  `await import('/src/...')` gets a separate module instance after HMR —
  inspect the live map via `window.__map` (`querySourceFeatures`); screen pixels
  are not coordinates (the canvas runs under the right dock).
- **`check:scenarios` prints the truth as "runnerUp" when the truth is not
  first,** so a failing row shows margin 0. Print the suspects.
- **`landmask.generated.ts` is written last** by `build_landmask.py`; the console
  fails to load while a rebuild runs.
- **Never stash or delete `frontDemo/public/` while the dev server runs.** Vite
  keeps a list of public files; when `public/ais/` was stashed and restored, it
  kept answering `ais/*.json` with `index.html` (200, `text/html`) and the
  console hung on "awaiting run". Restart the dev server (`preview_stop` then
  `preview_start`). The console now says "run failed" with this cause.
- **`git add -A` used to sweep in 169 MB.** Check `git status` first.

### Verification

```bash
.venv/Scripts/python.exe -m pytest
```

Baseline **515 passed, 9 skipped**. Then ruff and `mypy ml backend scripts`,
both clean since 2026-09-23 (ISSUES X11), then the frontend:

```bash
cd frontDemo && npm run check && npm run build
```

`npm run check:ingest` needs fixtures first:
`.venv/Scripts/python.exe -m scripts.export_ingest_fixtures --out <dir>`, then
`TILE_DIR=<dir> npm run check:ingest`.

## 1. Immediate — the local demo

### 1.1 Make the paths repo-relative — DONE 2026-09-22

`scripts/repath_artifacts.py` rewrote every reference (commit `467c456`);
`python -m scripts.repath_artifacts --check` reported on 2026-09-23 that every
artifact resolves from the repository. Re-run it after copying anything new from
the training machine, which will embed that machine's paths again.

### 1.2 Real upload, real metadata — DONE 2026-09-22

The fingerprint gate is gone. Any decodable raster is accepted, screened for
a dark region by `frontDemo/src/sim/ingest.ts`, and its outline, bearing,
length, widths and damping ratio are MEASURED off those pixels and become a
scene the whole console runs. Verified on the corpus itself: a real 2048²
tile screens in **66 ms** in the browser and ends with C3 correctly
withholding attribution, which was not scripted.

Measured over 24 real labelled train tiles, stratified across all three
source corpora (`scripts/export_ingest_fixtures.py`, then
`npm run check:ingest`): **21 of 24 overlap a labelled slick**, 2 are
refused as uniformly dark, 1 misses. Recall of the labelled region is
typically 0.75–1.0 while IoU is often low — the screen finds the oil and
over-covers, which is what a threshold does. The panel reports coverage so
that is visible rather than hidden.

**It is a threshold screen and the UI says so in those words.** It is not
the trained segmenter, so an uploaded region is classed `slick_unknown`,
never `oos`, and the `conf` readout carries the screen's contrast separation
rather than an invented model score. The dB damping figure is real, derived
through the corpus window, and the provenance states the window was assumed
— which matters for Refined SOS tiles (DATA.md D6).

Three things are asserted by the operator and stamped on the run: position,
ground scale and acquisition time. The corpus tiles carry no georeferencing
and no time in their names, so they cannot be derived; the time IS parsed
when the file is named like a Sentinel-1 product.

**Still open, and deliberately not claimed:**

- **GeoTIFF is not decoded.** The panel says so and asks for a PNG. Wiring
  `geotiff.js` would give a real geotransform and CRS, which is the only
  route to a position that is measured rather than asserted.
- **The float32 sigma-0 path is not built.** `DB_WINDOW` is recorded in
  `ingest.ts` as the constant that path would apply; PNG and JPEG input has
  already been through it.
- **Nothing is uploaded anywhere.** The raster never leaves the browser,
  which is the right default and also why the WebP-sidecar split in the
  original plan is not needed yet. It becomes necessary when §3's API exists.

### 1.3 Replace simulated data with real artifacts

`eval/final/scenes/*.geojson` already holds three real full-scene detection
outputs (86, 240 and 40 polygons, EPSG:4326) and is map-ready today.

Run the real OpenDrift ensemble offline, once per scene, and export particles,
50%/90% contours per timestep, the convergence series and the age triple to
`frontDemo/public/runs/<scene>/`. Static files — which is also exactly what a
static host wants later.

Then **delete `frontDemo/src/lib/reconstruction.ts`.** Once real backward frames
exist, a hand-tuned cosmetic transform presented as a hindcast is not redundant,
it is a false claim. `frontDemo/scripts/check-reconstruction.ts` needs rewriting
to validate the exported artifacts instead.

Watch the sign convention: `times` **descends** on a backward run.

### 1.4 Make the animation fluid — DONE 2026-09-22

All of it, in `frontDemo/src/map/ParticleOverlay.ts`: pre-rendered radial
stamp via `drawImage`, Catmull-Rom across four frames, a fading trail buffer
instead of `clearRect`, per-parcel size and brightness, and a continuous rAF
already driven by the fractional playhead. The existing weighting logic is
kept — release bright, backward ensemble a faint haze before the pass, full
weight after — with the forecast thinned further, because the 50/90 contours
are drawn over it and are what it is read from.

Two things deliberately NOT done, and why:

- **Position is never jittered.** Size and brightness vary per parcel; where
  a parcel *is* does not. The whole claim of this view is that these are the
  ensemble's own positions.
- **The 10-minute native step belongs to §1.3**, not here. Interpolating
  between stored timesteps is interpolation whatever the step, and the
  interface says so; exporting finer frames is a change to what is stored.

**If you change the weights, measure the saturated fraction.** Additive
blending clips, and a clipped cloud looks confident while carrying no
density information: the first draft of the stamp held full opacity to 45%
of its radius and put **51.4%** of lit pixels at full white. Fading from the
centre took it to **0%**. Count pixels with alpha >= 250 on the overlay
canvas; judging this by eye is how it got shipped wrong the first time.

### 1.5 A skip button, always visible

"Use precomputed result" on every path, including the live one. Instant, and
labelled as precomputed.

### 1.6 Real AIS on the map — DONE 2026-09-23

> "would like to see actual ais ship data overlay and not random fake ships
> with straight lines because that never happens in real life"

Decided with the user: the published vessels' real tracks are the Gulf scenes'
ground truth, and scenes with no real AIS get realistic simulated voyages,
labelled SIM.

**The three Gulf scenes run on real marinecadastre AIS.**
`scripts/export_ais_traffic.py` parses the national days once into
`data/interim/ais/*.npz` (Gulf AOI, ~15 min first run, 8 s after), cuts each
scene's box and window, cleans with `clean_records`, simplifies with
synchronised-distance Douglas-Peucker (every instant within 100 m — a path-only
simplifier would drop a stop on a straight line), records reception gaps
(>15 min) as explicit `breaks`, withholds identities (sequential ids keeping
only the MID; no MMSI or name reaches the file), and flags the published
vessel. 316 / 232 / 315 vessels, 1.2 MB, in `frontDemo/public/ais/`.
`sim/realAis.ts` loads them (`useSpill` awaits it; `buildRun` refuses a real
scene without it), resamples each continuous segment onto a global 5-minute grid
so `behaviour()`'s cadence logic holds, and never fills a gap. The map breaks
tracks at gaps instead of bridging them, and a vessel's position dot is drawn
only when it reported near the playhead.

**Measured, no weights touched:** every truth still ranks first — Case 2 (the
real tanker) 0.757, margin 0.396; Case 3 (the real supply vessel) 0.744, margin
0.186; Case 1 (the platform) 0.679, margin 0.232. Case 2's margin is partly by
construction: the slick is laid along the named vessel's real track, as the
publication describes. What is genuinely tested is that no other real vessel —
232 of them — outscores it. `check:realais` asserts each named vessel's AIS
reaches its published point (0.065 km at the pass; 0.046 km at the berth).

**Everywhere else, voyages instead of rulers.** `voyage()` in `sim/ais.ts`:
each vessel takes its own smoothed route through 2-4 waypoints, arrives from and
leaves toward its own point beyond the lane (lanes funnel, then fan out), speed
wanders, fishing boats trawl a ground at 2.5-4 kn, and tankers, bulkers, tugs
and supply boats sometimes stop — at the approach end of the voyage. The first
version stopped them mid-lane, which put a simulated tug holding station inside
kutch-dark's origin field and it outranked the dark contact; ships wait at
anchorages, not mid-transit, and moving stops there restored the ranking
(margin 0.0579). That is recorded so it is not mistaken for tuning after the
fact. The scripted truth tracks for the samples also bend now, except while
discharging, when they hold course as the real Case 2 tanker did.

**What the user saw and questioned.** The Case 2 truth draws a rectangle. It is
the tanker's real AIS: out of the Mississippi, a box south of the delta at 8 kn,
south along the slick to the tip at the pass, then a second box. Tankers box
offshore waiting for orders — and clean tanks while they do. The Evidence pane
now says "recorded AIS track" for every real vessel so a viewer is not left to
assume the generator drew it.

**Still open.** Uploads and the Indian-waters scenes remain simulated; there is
no free AIS for them on this machine. A real-AIS feed for uploads would need a
provider (Spire, MarineTraffic, Global Fishing Watch) and an account. The real
OpenDrift runs (§0, "wire the real runs") would pair naturally with this real
traffic — same three days — once they are wired into the console.

## 2. The labelling blocker

### 2.1 Run CFAR, then rebuild the review pack

The proposer currently **cannot** propose `oos` — `bright_target_distance_px`
is `-1.0` for all 355 instances, so the `is_linear AND vessel_adjacent` branch
is unreachable (`ISSUES.md` B2). Run `backend/detect/cfar/detector.py` over the
24 pilot tiles first, then regenerate. Note
`scripts/prepare_annotation_review.py` raises `FileExistsError` if `--out`
already exists, so write to a new directory.

This is what makes a non-specialist review defensible: confirming or rejecting
real `oos` proposals backed by vessel evidence, rather than guessing from shape.

### 2.2 A review pack that can actually be used

The current `index.html` is static and script-free and expects 24 JSON files to
be hand-edited in a text editor. Replace it with one self-contained page showing
per tile: image and mask overlay, the shape statistics already computed
(elongation, compactness, solidity, area), CFAR vessel distance, ERA5 wind at
acquisition, and the rubric — capturing decisions and downloading the JSONs.

### 2.3 The rubric

- **Wind gate first.** Below ~3 m/s there is no Bragg roughness for oil to
  suppress, so the sea is already dark and contrast is meaningless. Above
  ~10–12 m/s wind mixes oil down and re-roughens the surface. Outside the band,
  **defer**. (Espedal 1999.)
- **Linear, trailing a vessel, not widening** → `oos` candidate.
- **Linear, diverging in a V from a bright target** → ship wake. Reject. This is
  the most dangerous confusion: a wake is linear, dark, adjacent to a vessel,
  and would be attributed to the ship that made it.
- **Irregular or compact, no vessel** → `slick_unknown`.
- **Sharp boundary and strong contrast** → oil-like. Weak contrast argues
  biogenic film → defer.
- **Never** promote a `Lookalike` or `No oil` tile. Those 249 tiles have
  genuinely empty masks and are the only look-alike evaluation stratum that
  exists.
- Record `confirmed_by: "<name> (non-specialist, rubric-assisted)"` plus a
  confidence field.

Background: Brekke & Solberg 2005, *Remote Sensing of Environment* 95(1):1–13;
Topouzelis 2013 for the concrete feature families; EMSA CleanSeaNet operational
guidance for how analysts weigh them.

### 2.4 Move the verdict downstream

The detector keeps **one honest class**, `slick`. `oos` versus `slick_unknown`
becomes an evidence-backed verdict computed *after* detection from the wind gate
multiplier, CFAR vessel adjacency, V-divergence, backward-drift plausibility and
shape statistics — rendered with its terms, the way suspect scores already are.

Zero new annotation, zero retraining. It is also what the project's own research
already concluded: `RESEARCH/topics/lookalike-discrimination.md` states that
distinguishing oil from natural films using SAR imagery alone is unreliable, and
lists the four evidence layers that can do it. `weights/L1-ciou-research.json`
already declares one class and says never to relabel predictions as `oos`; this
makes the rest of the system agree with the weights.

### 2.5 [4060 Ti] Zenodo Part II and the look-alike false-alarm rate

**Context for whoever picks this up on the training machine.** Part II's
*images* were never downloaded — only the two mask archives are on disk
(426 KB + 417 KB), and there is no extracted directory. Extracting what is
present yields nothing trainable. The two image archives are about 21 GB each,
42.77 GB total; this machine had 225 GB free at last check.

Skipping Part II was a deliberate 2026-08-31 decision, because Part III already
brought the negative pool to 10.2% / 11.7% / 11.8% per split against a ~10%
target. **But that decision carried an explicit trigger — fetch it if the
baseline over-triggers on look-alikes — and the trigger has fired:** 8 of 11
named look-alike test tiles raise an alarm.

The job:

1. Check whether Part II was ever incorporated on that machine. If it was, say
   so and stop; this item is stale.
2. If not: `scripts/download_zenodo.py --records negatives`, then
   `scripts/extract_zenodo.py`, then verify counts and hashes.
3. Rebuild the dataset with the enlarged negative pool, preserving overlap
   quarantine.
4. Retrain and report the **look-alike false-positive count separately from
   mAP** (constraint C8), against the current 8/11 baseline.

Negative curation is, per the project's own research, the single
highest-leverage intervention available — it is what cut the anchor paper's
false positives from 14 to 5. It costs data, not architecture.

**Do not evaluate on the held-out test split.** It is consumed. A new
generalisation claim needs a freshly frozen, independently labelled holdout.

### 2.6 Archive cleanup — verify before deleting

`data/` is 158 GB. Nothing gets deleted before its extraction is verified:

1. Inventory every archive under `data/raw/**` and `data/interim/**`.
2. Confirm the extracted tree exists with the expected file count; spot-check
   SHA-256 against the manifests.
3. Print the delete list with per-item and total reclaimed space.
4. Delete only after the user confirms that list. Archives whose extraction
   cannot be verified stay.

Part II's two mask archives are excluded until §2.5 completes.

---

## 3. The live local pipeline

`backend/app/__init__.py` is 0 bytes — there is no API. `PLAN/INTERFACES.md` §3
specifies it completely, so this is implementation, not design.

1. `backend/app/main.py` plus routers for scenes, detections, drift, suspects,
   vessels and health.
2. **One write endpoint**, `POST /api/v1/runs`, returning a job id with SSE
   progress. All GETs stay read-only. This is a deliberate amendment to the
   recorded rule that the API never triggers the pipeline — record it in
   `PLAN/CONSTRAINTS.md` as a dated deviation with its reasoning, the way the
   SNAP and sigma-0 decisions were recorded.
3. **Two-pass detection.** You cannot know which parts of a scene hold oil until
   something looks, but you do not need full-resolution inference to look: a
   decimated-overview dark-region screen, then full-res SAHI only on candidate
   windows. That turns an 864-tile sweep into a handful.
4. **Write the ERA5 fetcher.** `backend/ingest/metocean/cache.py` is a complete
   caching layer whose `fetcher` callable has no implementation anywhere.
   `CDSAPI_KEY` is set; CMEMS credentials are not.
5. Wire detect → wind gate → drift ensemble → origin field → convergence → AIS
   gate → scores → evidence.
6. Stream each stage as it completes, replacing the four hardcoded 5-second
   timers with progress that is real.

**No GPU is needed for the physics.** Only detection is GPU-hungry; the drift,
origin-field, convergence and scoring chain is NumPy on CPU and already written.

---

## 4. Deployment

### 4.1 Detection on the visitor's GPU — DONE 2026-09-23

Built as described below, with two differences: the export is **fp32** (the
release manifest says `half: false`, and WASM is fp32-native), 12.9 MB; and the
upload panel now runs it in place of the Otsu screen. See §0.

Export the release checkpoint to ONNX with the existing `ml/export/export.py`
and run it through `onnxruntime-web` on the WebGPU backend. The model is about
2.9 M parameters, so fp16 ONNX is roughly 6 MB — servable as an ordinary static
asset. Detection then runs on the visitor's hardware: no server GPU, no egress,
no per-inference cost.

Gate the UI on `navigator.gpu`. **Word it carefully:** WebGPU is a capability,
not a permission — there is no "Allow GPU?" dialog like camera or microphone.
The panel must tell the visitor what to *do* (update the browser, enable the
flag, switch browsers), not ask them to grant something they cannot. Fall back
to `onnxruntime-web` on WASM with SIMD and threads — tens of seconds rather than
under one, but it completes.

### 4.2 Static hosting

The frontend is a static Vite build and the run artifacts from §1.3 are static
files, so a static host plus object storage covers the public site with no
database in the request path.

Two findings to design around:

- **Cloudflare has no GPU available for a custom model.** Containers are
  CPU-only (max 4 vCPU / 12 GiB / 20 GB disk) and Workers AI runs a fixed
  catalogue — custom weights cannot be uploaded. Hence §4.1.
- **D1 is SQLite; there is no PostGIS.** The current design leans on it hard:
  `LINESTRING M` geometry with epoch seconds in the M ordinate, GiST indexes,
  and the spatiotemporal gate as a single PostGIS operation. Migrating means a
  bbox prefilter in SQL plus the exact gate in Shapely. That is the one genuine
  migration cost and should be costed deliberately. The cheap alternative is to
  keep Supabase for AIS and PostGIS only, and put the heavy imagery on object
  storage — which is where the egress problem actually lives.

Relevant limits, from the current documentation: static hosting allows 20,000
files at 25 MiB each on the free plan; R2 charges **no egress on any storage
class**, with 10 GB-month plus 1 M class-A and 10 M class-B operations free;
Workers cap request bodies at 100 MB on free and pro, so large uploads must go
to object storage directly rather than through a worker; Worker CPU is 30 s by
default on paid, raisable to 5 minutes.

Sequence it: static site and artifacts first (near-free, and it solves public
access on its own), object storage when real imagery goes up, and a server-side
API only if live inference online is actually wanted.

### 4.3 An external GPU host, later

If server-side inference is ever needed, put it behind the same
`POST /runs` plus SSE contract as §3 so the frontend does not change when it is
wired up.

---

## 5. Remaining phases

| Phase | State |
|---|---|
| 03 — characterisation and wind gate | Not started. Named as the next implementation milestone by the independent audit |
| 06 — attribution engine | Not started. Includes the open `S_drift` question: max over track points, or integral of the track through the field? The integral should favour a vessel that lingered, and therefore the Case 3 fixture. Implement both and let the fixture decide |
| 07 — API and visual interface | Partly covered by §3 and §1 |
| 08 — evaluation and validation | Blocked on a fresh holdout |
| 09 — demo packaging | Includes the C12 offline snapshot, which must be tested with the network actually off, not mocked |
| 10 — documentation and handover | — |

Do not tune weights to force a fixture to pass. If `S_drift` cannot carry
Case 3, revisit the formulation and say so.
