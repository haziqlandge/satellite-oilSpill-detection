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
| `data/cache/metocean/*.nc` (7 files, 1.2 MB) | The ERA5 wind the real runs used: the 74 h before each pass and, since the evening of 2026-09-23, the 74 h after it (the forecast) | `export_drift_runs` re-fetches from CDS (needs `.env`), minutes |
| `frontDemo/public/runs/<scene>/{drift,scene}.json` (25 MB) | The real-run views, -72 h to +72 h | Regenerate: `export_drift_runs --all`, then `export_real_scenes`, then `export_ais_traffic --real-runs` (commands below) |
| `frontDemo/public/models/L1-ciou-research.onnx` (13 MB) | The browser segmenter | `.venv/Scripts/python.exe -m ml.export.onnx_export` from `weights/L1-ciou-research.pt` |
| `weights/L1-ciou-research.pt` (13 MB) | The release checkpoint | It came from this machine's `runs/final_l1_fp32_release/`; check before asking |
| `data/interim/ais/*.npz` (218 MB), `data/raw/ais/2023/*.zip` (2.9 GB) | Only to RE-export AIS | The tracked `frontDemo/public/ais/*.json` already serve the app |
| `data/processed/sar/*_s0db.tif` (3 × 3.6 GB) + `windows/` | Only to re-run full-scene inference or cut upload windows | Needed for job 2 below; skip otherwise |
| `data/runs/<id>/` | Every run `POST /api/v1/runs` made (inputs, events, drift/scene/ais JSON) | Nothing breaks; the console lists none. Re-run through the API |
| `data/processed/sar/windows/*_win2048.tif` (10.9 MB) | The December window that yields a full live run | `scripts.cut_geotiff_window --scene 20231205 --size 2048 --lon -89.0082 --lat 29.2661` |
| `frontDemo/node_modules`, `.venv` | Environments | `cd frontDemo && npm install`; `scripts/SETUP_NEW_MACHINE.md` |

After copying anything from another machine, run
`.venv/Scripts/python.exe -m scripts.repath_artifacts --check` (`CLAUDE.md` §2).

### NEXT SESSION: START HERE (written 2026-09-24, end of the console-fix session)

Everything below is in the working tree, **UNCOMMITTED** (commit only when the
user asks, via `commitskill`, no AI attribution). The §3 session's loose ends
are closed and verified (next subsection). In order:

1. **The plan: §5 phase 06**, the backend attribution engine. It is also the
   missing half of §3.5 (AIS gate -> scores -> evidence; `backend/pipeline/run.py`'s
   `attribute` stage refuses until it exists). It carries the open `S_drift`
   question -- max over track points or the integral of the track through the
   field -- with a failing fixture already waiting (ISSUES F12, kutch-dark
   under `max`). Implement both and let the fixtures decide; never tune weights
   to force one (§5). Honest limit: every real run is wind-only (X2), so the
   engine can be built and tested on the authored scenarios, but the real runs
   will keep refusing (E-X2) until currents exist.
2. Then **phase 09** (demo packaging, C12 offline snapshot, tested with the
   network actually off).
3. Open bugs: X9 (wind-phase shift), F20 (width profile counts gaps as zero;
   fix on purpose, rerun `check:verdict` and `check:scenarios`), F10 (maplibre
   XSS, a breaking major, needs `npm install`: ask first).
4. Waiting on a person: the CFAR review pack (B1) and the QGIS hand-measure (Q6).

#### What the console-fix session did (2026-09-24, session machine; do not redo)

- **F21:** the add-image panel shows only the uploaded image and the mask; the
  mask is drawn over the uploaded image, not the despeckled copy. Asked, the
  user kept the despeckled copy in the detect pane and the full-size viewer,
  so the "Despeckle (display only)" stage stays.
- **F22:** every upload fronts the Model Timing pane (`front()` in
  `ConsoleShell.tsx`, shared with the number keys), once, as it starts.
- **F23:** the GeoTIFF decode runs in a module worker
  (`sim/geotiff.worker.ts`, `sim/decodeOffThread.ts`; `worker.format: "es"` in
  `vite.config.ts`) and the preview is encoded with `toBlob`, so "Decode raster"
  ticks live. Idle, the decode takes ~0.45 s either way; on the main thread
  the page got 0 timer ticks in it, in the worker 4 in 0.48 s.
- **F24:** the upload -> live pipeline -> auto-open flow seen end to end in
  the browser with the pane visible: the December 2048 window streamed its 14
  stages into Model Timing and, when the run completed (223 s of stage time on the CPU, 197 s of it OpenDrift), the
  console opened it as "API · 2023-12-05 00:02Z" with E-C1. A dataset PNG
  (`8346860__Oil__00002.png`) ran too (browser only; not georeferenced, so not
  POSTed). Findings in `PREVIOUS_WORK.md` §2.21.

#### What the §3 session did (2026-09-24, session machine; do not redo)

- **§3.1 the API** (`backend/app/`): `main.py` (app factory, lifespan, RFC 7807
  handlers in `problems.py`), `store.py` (reads the pipeline's FILES, not
  PostGIS -- the pooler is unreachable, X1; stable UUID5 ids for scenes and
  detections), `views.py`, `schemas.py`, `deps.py`, `routers/` for scenes,
  detections, drift, suspects, vessels, health, runs. Every `INTERFACES.md` §3
  endpoint answers: drift as a time-indexed FeatureCollection (cells dissolved
  into polygons), age as a C1 triple or refusal, suspects as an
  `insufficient-evidence` problem at **HTTP 200** (C3), vessel tracks by MMSI
  from `data/interim/ais` (local only), `/health` with DB, weights, browser
  model, forcing cache. Start it: launch config `api`, or
  `.venv/Scripts/python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000`.
  Vite proxies `/api` to it (`frontDemo/vite.config.ts`, `API_ORIGIN` overrides).
- **§3.2 `POST /api/v1/runs` + SSE** (`routers/runs.py`, `jobs.py`): raw-body
  GeoTIFF upload (`?name=`) or JSON `{"source": "<repo path>"}`; refuses at the
  door (415 not a GeoTIFF, 422 unreadable / not EPSG:4326 / outside the repo,
  409 no precomputed result); queues ONE pipeline process at a time
  (`python -m backend.pipeline.run`), answers 202; `GET /runs/{id}/events`
  replays the run's `events.jsonl` then tails it (`Last-Event-ID` resumes); a
  process that dies, or a run orphaned by an API restart, gets a final event
  written by the API (`"by": "api"`). The dated amendment to the read-only rule
  is in `PLAN/CONSTRAINTS.md` (Technical constraints, "API is read-only").
- **§3.3 two-pass detection** (`backend/pipeline/screen.py`, `infer_scene(select=, band=)`):
  overview at >= 1/8 averaged in linear power; a region >= 2 dB below the 10 km
  mean, >= 4 overview px; tiles its box (+2 px) touches go to the model.
  Measured on the three Gulf scenes (`scripts/measure_two_pass.py`,
  `eval/two-pass/two_pass.json`), CPU: 204 / 372 / 150 of 864 tiles, model
  38 / 55 / 21 s (+~28 s screen), **97.5 / 99.3 / 99.1% of the full sweep's
  detected area recovered, 0% extra, seed IoU 0.9995 / 0.9995 / 0.9999**.
- **§3.4 ERA5**: the fetcher existed since 2026-09-22 (`era5.py`, uncounted
  until now). Added `cache.covering_path` (a cached file of the same product
  whose box and window contain a smaller request answers it; one 0.25° grid
  step of tolerance because CDS snaps areas inward) -- that is what lets a
  window or a two-pass run go offline on the scene's own cached wind.
- **§3.5 the chain** (`backend/pipeline/run.py`, 14 stages: input, screen,
  detect, seed, wind, characterise, cfar, drift_backward, drift_forward,
  origin_field, ais, verdict, attribute, write). Writes the SAME
  `drift.json`/`scene.json` as the exports (+`ais.json`, `detections.geojson`,
  `run.json`, `events.jsonl`) under `data/runs/<id>/` (gitignored).
  **Attribution refuses** (PHASE-06 not built; wind-only field) -- so §3.5 is
  counted HALF done: AIS gate -> scores -> evidence wait for phase 06.
- **§3.6 streamed stages in the console**: `src/lib/api.ts` (client, shared run
  watcher, one EventSource per run), `src/console/ServerRun.tsx`
  (`ServerRunTimings`: live spinner/elapsed, member/tile progress, refusals in
  the warning tone), `realRun.ts` now a registry (`registerApiRun`, ids
  `real-api-<run>`), `realAis.ts` traffic sources per API run (none -> "AIS:
  none on this machine"), SpillKey group "live pipeline · this machine", Model
  Timing pane shows the pipeline's stages for an API run; every georeferenced
  upload is also POSTed (after the browser's segmentation, with the same
  precomputed choice) and its stages stream under the browser's; when it
  completes the console opens it (`ConsoleShell`, `onRunFinished`).
  `npm run check:apiruns` (new, 14th script) builds every complete API run on
  disk through the real-run view.
- **Refactor, byte-identical output:** the seed rule, frame builder, CFAR /
  damping / wind helpers moved from `scripts/export_*` into
  `backend/drift/seedrule.py`, `backend/drift/frames.py`,
  `backend/characterize/onraster.py`; the scripts re-export every name.
  Re-running `export_real_scenes`' functions reproduced all three committed
  `scene.json` files **byte for byte**.
- **Bugs found and fixed on the way:** the seed rule had no size floor (on the
  April window it picked a **1-pixel** part) -- now `MIN_SEED_KM2 = 0.05`; the
  three exported seeds are unchanged (5.50 / 6.71 / 3.19 km2), but their
  `drift.json` still carries the rule text from before the floor (re-export
  with the next job-2 regeneration; OpenDrift is not seeded, so a re-export
  moves the documented ages slightly). Events carrying a NaN age triple crashed
  the writer (now `json_safe`). `covering_path` too strict (grid snapping).
- **End-to-end, measured:** December full scene through the API -- 4.8 min
  CPU (screen 26 s, detect 23 s on 150 tiles, drift 108 + 94 s), 88 SSE events
  then `end`; seed 3.19 km2 (= export), damping -4.59 dB (export -4.6), 85
  CFAR targets (= export), monotonic age, 310 vessels, verdict unknown 0.45
  (= export, F19), attribute refused. The April window
  (`..._win1536.tif`) refuses at seed: its one detection is a filled box at
  the coast (1 box-cut, 1 ashore, 14 under 0.05 km2) -- correct, not a bug.
  A new window around the December seed,
  `data/processed/sar/windows/..._20231205..._win2048.tif` (10.9 MB), is the
  upload that yields a full run (seed 2.99 km2, 7.5 km, 58 CFAR targets); its
  browser upload was verified streaming live into the Model Timing pane up to
  the forward forecast, then a Vite full reload (from editing `realAis.ts`)
  dropped the page session, so the auto-open on completion is NOT yet seen.
  Run `20260923T193745Z-ecb8b3` in `data/runs/` is that upload.
- **Tests:** `tests/test_api.py` (11), `tests/test_api_runs.py` (6),
  `tests/test_pipeline.py` (12), plus one each in `test_scene_inference.py`
  and `test_drift.py`. ruff clean, mypy clean on **130** files.

#### Verification, run 2026-09-24 after the console fixes

pytest **630 passed, 9 skipped** (the §3 session's 31 new tests on top of
599); ruff clean; mypy clean on 130 files; `npx tsc -b` clean; all 14
`npm run check` scripts pass (`check:ingest` skips without its fixture
tiles); `npm run build` succeeds and emits the decode worker.

### Progress against this plan (counted 2026-09-24)

**17 of the 27 work items in this file are done — about 63%** (was 12, 44%;
re-counted after the console-fix session, which closed bugs, not plan items).
§1: 6 of 6; §2: 4 of 6 (§2.5 is the 4060 Ti's, §2.6 needs the user's OK);
§3: 5 of 6 (§3.1, 3.2, 3.3, 3.4, 3.6; §3.5 half -- attribution waits for phase
06); §4: 1 of 3; §5: 1 of 6 (phase 03). Bug fixes are not plan items.

### THE JOBS, in order

**Job 0 — set up and prove the tree.** Pull `main`; place the files above; run
the verification block at the end of this section. Expected: pytest **630
passed, 9 skipped** here (6 database skips need the Supabase pooler, X1; a
machine with CUDA may skip fewer), ruff and mypy clean (130 files), all 14
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
reports how many it passed over, and the Real views' switch counts them.
**Also re-run `cd frontDemo && npm run precompute:uploads -- <the entries in
public/precomputed/index.json>`** (§1.5): every stored upload result names the
model it was made by, and `check:precomputed` fails until they are redone.

**Job 3 — DONE on the session machine, evening of 2026-09-23.** The raster
viewer was driven with real input on a dataset PNG and a Part I GeoTIFF (wheel
and double-click zoom hold the point under the cursor to 1e-3 px, drag pans by
the mouse delta, `0`/`1`/`M`/`+`/`-`/Esc all behave, focus returns, the mask is
native-resolution blue/yellow), and the real views PLAY −72 h → 0 on all three
with no console errors. Two bugs found on the way are fixed (below).

**Job 4 — the rest of the plan. SUPERSEDED by "NEXT SESSION: START HERE"
above (§3 was done 2026-09-24).** Done on the
session machine: §2.1-§2.4 (late evening 2026-09-23) and **§5 phase 03**, the
backend characterisation (night of 2026-09-23/24, below). Next, in order, all
CPU-only: **§3 the API** (`POST /runs` + SSE; honour the §1.5 precomputed
contract; `backend/characterize/characterise.characterise_outline` is the
`characterize` stage's core and its `as_row()` fills the table); **§5 phase
06** (the `S_drift` max-vs-integral question, ISSUES F12); **§5 phase 09**
(offline snapshot, C12, tested with the network actually off). Open bugs: X9
(wind-phase shift through the ERA5 reader's time reference), F20 (the
console's width profile counts gaps as zero; it changes every authored run's
printed geometry, so fix it on purpose) and F10 (maplibre XSS, a major upgrade;
needs `npm install`, ask first). **A person should use the new review pack**
(`eval/phase2-closure/annotation-pilot-cfar/index.html`, served by the
`review-pack` launch config) -- that is what B1 now waits on -- and
**hand-measure three slicks in QGIS** for phase 03's last acceptance line
(ISSUES Q6).

### What the night session did (2026-09-23/24, session machine, do not redo)

Uncommitted like the evening's work; commit only if the user asks.

- **The previous session's wrap-up:** ruff's last error (UP017 in
  `opendrift_runner.py`), the baseline figures, and the frontend half of the
  verification it never ran (all green).
- **§5 phase 03, `backend/characterize/`:** `geometry.py` (equal-area
  projection; medial axis thinned, pruned and end-trimmed; ends aimed at the
  middle of the end cap; perpendicular width chords; parts chained with their
  gaps counted), `damping.py` (power-mean contrast against an annulus 150-1150
  m out, land, other slicks and no-data excluded; relative only, C2),
  `windgate.py` (the console's exact ramp; ERA5 nearest cell and hour, offset
  recorded, refused past 1 h), `age.py` (Fay's surface-tension prior: a
  ceiling, never an age), `verdict.py` (the §2.4 twin), `characterise.py`
  (`Characterisation`, `as_row()` for the database, `as_console()` for the
  views). 65 new tests. Acceptance: P004 Case 2 19.14 km (~19), Case 1 5.69
  (~5.5), Case 3 5.21 (~5); ends 3-15 m from the source tips; the wind gate is
  0 on mumbai-null and 0.33 on the real May seed; damping confidence and the
  age triple are structural. Not met: the QGIS hand-check (ISSUES Q6).
- **The real runs carry it:** `export_real_scenes.characterise_seed` writes the
  seed's record into `scene.json` (damping on the processed scene's band 2:
  April -2.7, May -1.9, December -4.6 dB), the view uses it, and the detect
  pane shows where each number came from and the Fay prior. Re-exported; only
  the new field changed. **December's verdict moved from oos 0.51 to unknown
  0.45** on the better end placement (ISSUES F19).
- **TS/Python parity fixtures** in `tests/fixtures/characterise/`
  (`npm run export:characterise-fixtures`), asserted from both sides.
- **The Real views' detection switch is gone** (the user: use seed only): the
  map draws the seed detection alone, and `check:realruns` asserts it.
- Fixed on the way: a real run would have shown a *synthesised* radar tile
  once its damping was measured (now gated off real runs); a duplicate React
  key (`row--36`) on the home page's origin-field plate.
- Baseline **599 passed, 9 skipped**; mypy 107 files; 13 `npm run check`
  scripts. Findings not to re-derive: `PREVIOUS_WORK.md` §2.19.

### What the late-evening session did (2026-09-23, session machine, do not redo)

Uncommitted like the evening's work; commit only if the user asks.

- **§2.1 CFAR + a new review pack** (`scripts/cfar_review_pack.py`): CA-CFAR on
  the 16 calibrated pilot tiles (33 targets; Refined SOS skipped, D6), measured
  evidence per instance (distance to the target in px/m, target at an end,
  contrast dB, the tile's background), written to
  `eval/phase2-closure/annotation-pilot-cfar/` (the old pilot is untouched).
  Found and fixed a proposer defect on the way: adjacency was measured to the
  centroid (`ISSUES.md` B2). Now 3 `oos` proposals, 279 `slick_unknown`, 73
  deferred.
- **§2.2 + §2.3 the page and the rubric**: one self-contained `index.html`
  (template `scripts/review_pack.html`) -- images with mask/target overlays,
  every measure, the rubric, per-instance decisions (oos / slick_unknown /
  reject wake / reject look-alike / reject mask / defer) with confidence and
  notes, kept in the browser and downloaded as a bundle.
  `scripts/apply_review_decisions.py` applies a bundle all-or-nothing through
  `load_confirmed`'s own gate. Verified in the browser: page -> bundle -> apply ->
  `load_confirmed` returns the confirmed label and nothing else.
- **§2.4 the verdict** (`frontDemo/src/sim/verdict.ts`, `check:verdict`): the
  detect pane shows "detector: slick · one class" and the verdict with six
  terms (linear, bright target at an end, opens in a V, wind gate, contrast,
  vessel in the origin field). Real runs now carry CA-CFAR targets within 15 km
  of the seed (`export_real_scenes.cfar_near_seed`, 1 / 17 / 85, 1 / 5 / 14
  AIS-matched). The simulated radar no longer drops the scene's own vessel.
  Thresholds are uncalibrated (`ISSUES.md` F19).
- **Bugs:** X10 (naive UTC at the drift engine's entry), F15 (the T0 button went
  to the span's start); F6 and F7 were already fixed in frontend commits and
  their rows are gone.

### What the evening session did on the session machine (2026-09-23, do not redo)

Nothing here needed training. Committed only if the user asks (check
`git log`); everything below is in the working tree of the session machine.

- **§1.5 "Use precomputed result"** (see §1.5): SHA-256-keyed, model-stamped
  stored segmentations in `frontDemo/public/precomputed/`, the button always
  shown, `check:precomputed`. Browser WebGPU and stored WASM agree on every
  pixel of a 2048² tile.
- **Uploads no longer stall in a background tab**: `nextFrame()` waited on
  `requestAnimationFrame`, which a hidden tab never fires.
- **The Real views** (`ISSUES.md` F18, raised by the user as "all over the
  place and blocky"): a four-way detection switch on the map (focus / seed only
  / no boxes / all; box-filled masks hold 80-93% of detected area; removed on
  2026-09-24 at the user's request, the map now draws the seed alone), the drift
  field smoothed from OpenDrift's parcels like the authored scenes (masked on
  deep land only -- the raster coast deleted a quarter of December's mass),
  "86 detections (366 polygons)" instead of calling rings detections.
- **Seeded over the slick, with a forecast.** Every member now starts from the
  same 200 parcels spread over the seed polygon (`backend/drift/seeding.py`),
  not a 500 m disc at its centre, so T0 is the slick's shape (98-99% of parcels
  inside it, spanning 97-99% of its length). A forward 72 h ensemble runs from
  the same parcels on ERA5 wind for the hours after the pass (three new CDS
  files, user-approved), with `stranding`: April 0%, May 0%, December **60%**
  of the oil reaches the coast by +72 h. `FORWARD_HOURS`, `wind_requests`,
  `history_frames` in `scripts/export_drift_runs.py`.
- **A consequence to know:** with a real-shaped seed, April and May now have a
  convergence minimum -- ages 0.0 / 0.5 / 4.2 h and 0.0 / 1.7 / 7.3 h (fresh
  oil, `ongoing` by the authored engine's rule). The view shows that age and a
  new refusal, **E-X2** ("wind-only field, no currents: nothing ranked");
  December still never converges and keeps E-C1. Nobody is ranked in any.
- Baseline now **522 passed, 9 skipped**; 12 `npm run check` scripts.

### What the 2026-09-23 day sessions did (do not redo)

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

- **Hand-measure three slicks** (area and length) in QGIS for phase 03's last
  acceptance line (`ISSUES.md` Q6); the three real seeds are the useful ones.

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
traffic is simulated; F19 the verdict's thresholds are uncalibrated (December
flipped on 0.2 km of end placement); F20 the console's width profile counts
gaps as zero; Q6 phase 03's geometry awaits a person's measurement; X7 Case 3
acquisition mismatch.

### A correction to carry forward

Look-alike data exists: Part III ships 150 Lookalike and 150 No oil, and the
built corpus holds 289 Lookalike and 271 No_oil tiles. What is missing is Part
II's ~42 GB (B3) and a test stratum wider than 11 named look-alike tiles (Q2).
Say it that way.

### Traps already paid for

- **The browser pane can be hidden while you drive it.** Then screenshots are
  stale or black, `requestAnimationFrame` never fires (PLAY stops, MapLibre
  never finishes loading a style after a reload) and only the DOM is
  trustworthy. `tabs_context` says which; ask the user to show the pane
  (Ctrl+Shift+B) before taking proof screenshots. More harness traps in
  `PREVIOUS_WORK.md` §2.17.

- **`times` descends on a backward run.** `times[0]` is the observation.
- **The drift engine compares naive UTC datetimes** (X10). `naive_utc` converts
  at its entry and in `windgate.sample_wind`; use it wherever a datetime meets
  xarray.
- **`medial_axis` is random unless seeded** (`rng=`), and a longest skeleton
  path can end in a corner or run up a side branch. Read `PREVIOUS_WORK.md`
  §2.19 before touching `backend/characterize/geometry.py`.
- **Heredocs break on backticks and on `'\\'`.** Write multi-line scripts with
  the Write tool and run the file.
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

Baseline **630 passed, 9 skipped**. Then ruff and `mypy ml backend scripts`
(130 files), both clean since 2026-09-23 (ISSUES X11), then the frontend:

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

### 1.3 Replace simulated data with real artifacts — DONE 2026-09-23

Done as `sim/realRun.ts` (§0); `lib/reconstruction.ts` is deleted. The real
runs now also carry a 72 h forward forecast and start from the slick's own
shape (§0, "this session"). The original brief follows.

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

### 1.5 A skip button, always visible — DONE 2026-09-23

"Use precomputed result" on every path, including the live one. Instant, and
labelled as precomputed.

**Built as:** the one live path today is an upload's segmenter run, so the
button lives in the add-image panel and the Model Timing panel, always shown
while an upload is on screen. A precomputed result can only exist for a known
input, so results are keyed by the **SHA-256 of the file's bytes** (a renamed
copy still finds it) and stamped with the **model's SHA-256** (a retrained
release never sees a previous model's answer). They are made offline by the
browser's own `segment` on onnxruntime WASM (`npm run precompute:uploads --
<repo-relative files>`; default: every window in `data/processed/sar/windows/`)
into `frontDemo/public/precomputed/`, tracked, 4-31 KB each (RLE masks).
Only the segmentation is swapped; decode, trace, despeckle, coastline and drift
still run on the file in hand. The button is disabled with the reason when no
entry exists, cuts in during model load or between tiles when pressed (the
live run is aborted via `SegmentOptions.signal`), and the inference row,
the panel and the run's provenance all say PRECOMPUTED and when it was made.
`check:precomputed` recomputes every entry whose source is on disk and demands
the identical mask. Measured in the browser: a live WebGPU run on a canvas
decode and the stored WASM entry agree on **all 4,194,304 pixels** of a
2048² tile, scores to four decimals.

**For §3:** the live pipeline (`POST /runs`) must honour the same contract —
the precomputed answer for this exact input and model, and a label. **After
retraining (job 1/2), re-run `npm run precompute:uploads`**: every entry names
the old model, the browser refuses it, and the check fails until it is redone.

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

### 2.1 Run CFAR, then rebuild the review pack — DONE 2026-09-23 (§0, late evening)

The proposer currently **cannot** propose `oos` — `bright_target_distance_px`
is `-1.0` for all 355 instances, so the `is_linear AND vessel_adjacent` branch
is unreachable (`ISSUES.md` B2). Run `backend/detect/cfar/detector.py` over the
24 pilot tiles first, then regenerate. Note
`scripts/prepare_annotation_review.py` raises `FileExistsError` if `--out`
already exists, so write to a new directory.

This is what makes a non-specialist review defensible: confirming or rejecting
real `oos` proposals backed by vessel evidence, rather than guessing from shape.

### 2.2 A review pack that can actually be used — DONE 2026-09-23 (§0)

The current `index.html` is static and script-free and expects 24 JSON files to
be hand-edited in a text editor. Replace it with one self-contained page showing
per tile: image and mask overlay, the shape statistics already computed
(elongation, compactness, solidity, area), CFAR vessel distance, ERA5 wind at
acquisition, and the rubric — capturing decisions and downloading the JSONs.

### 2.3 The rubric — DONE 2026-09-23 (in the review page)

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

### 2.4 Move the verdict downstream — DONE 2026-09-23 in the console; the backend twin landed with phase 03

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

## 3. The live local pipeline — 5 of 6 DONE 2026-09-24 (§0, "What the §3 session did")

Status: 1 DONE (file-backed, X1), 2 DONE (amendment in `PLAN/CONSTRAINTS.md`),
3 DONE (measured, `eval/two-pass/two_pass.json`), 4 DONE (plus the covering
cache lookup), 5 HALF (the chain runs to the verdict; AIS gate -> scores ->
evidence are phase 06, and attribution refuses meanwhile), 6 DONE (console
streams the stages; three UI fixes the user asked for are in §0). The original
brief follows.

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
| 03 — characterisation and wind gate | **DONE 2026-09-23/24** (`backend/characterize/`, §0). Acceptance: P004 lengths and source-tip ends met on the authored slicks, the wind gate suppresses mumbai-null (0) and scales the real May seed (0.33), C1/C2 structural; the QGIS hand-check on three slicks is open (ISSUES Q6) |
| 06 — attribution engine | Not started. Includes the open `S_drift` question: max over track points, or integral of the track through the field? The integral should favour a vessel that lingered, and therefore the Case 3 fixture. Implement both and let the fixture decide |
| 07 — API and visual interface | Partly covered by §3 and §1 |
| 08 — evaluation and validation | Blocked on a fresh holdout |
| 09 — demo packaging | Includes the C12 offline snapshot, which must be tested with the network actually off, not mocked |
| 10 — documentation and handover | — |

Do not tune weights to force a fixture to pass. If `S_drift` cannot carry
Case 3, revisit the formulation and say so.
