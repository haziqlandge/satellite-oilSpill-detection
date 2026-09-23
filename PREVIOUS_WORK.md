# PREVIOUS WORK

What has been done and proved. Open items are in `ISSUES.md`; next steps are in
`FUTURE_WORK.md`.

Part 2 is the important half. Part 1 is the story; Part 2 is the set of things
that were expensive to learn and would be expensive to learn twice.

---

# Part 1 — Timeline

## Backend and ML

**PHASE-00 — scaffold and research corpus.** Four papers read in full, six
topic syntheses, a citation graph, and the eleven-phase plan under `PLAN/`.
The anchor paper is Zhao et al. 2025, *Marine Pollution Bulletin*,
DOI 10.1016/j.marpolbul.2025.118608.

**2026-08-28 — database moved to Supabase.** Hosted Postgres + PostGIS replaced
the local container. This removed Docker from the critical path (Docker Desktop
would not start on the training machine) but made the pipeline require network,
which amended constraint C12 from "runs fully offline" to "degrades gracefully
without network".

**2026-08-29 — SNAP driven natively.** The original constraint said SNAP must
run in a Linux container, justified by `esa_snappy` being a Windows install
hazard. That hazard is specific to the *Python bindings*; the preprocessing
graph is run by `gpt`, a plain Java CLI. `backend/ingest/sar/preprocess.py`
invokes it by subprocess. Intent preserved, blocker removed.

**2026-08-30 — sigma-0 ordering settled, AIS ingest built.** See §2.1 and §2.6.
The storage measurement that forced the `ais_tracks`-only decision also landed
here: AOI + 48 h clipping reduces 25,273,138 national rows to 2,955,407 — a 9x
reduction, not the ~1000x the plan had implicitly assumed.

**2026-08-31 — the corpus arrives, and three silent faults with it.** Parts I
and III and Refined SOS downloaded and MD5-verified. Part II deliberately
skipped (§2.3). The `relabel.binarise` band-order bug, the band-1 discovery and
the pretrained-initialisation confound were all found in this window — any one
of them would have invalidated PHASE-02. PHASE-04's drift engine and PHASE-05's
AIS pipeline both completed.

**2026-09-01 — the overfitting question answered.** 60 epochs *under*-trains:
the reference run peaks at epoch 59 of 60 with every validation loss still
falling, gaining +0.0098 over epochs 50 to 60. Screening depth is therefore not
reducible. The same session corrected its own prior CPU diagnosis (§2.8) and
re-optimised the input pipeline — `cache="disk"` cut cell time 57%.

**2026-09-02 to 09-14 — thermal stall, then the move.** The grid stopped at
3/12 on a laptop that hit 92 C. Work resumed on the RTX 4060 Ti 8 GB with full
resource use authorised; the earlier CPU/RAM/temperature caps became historical.

**2026-09-15 — screening complete.** All 12 cells at 60 epochs. Finalists
selected: `none-ciou` (control), `L1-ciou` (primary), `L4-ciou` (complementary).
The review protocol was frozen *before* the evaluation, which is why its
findings are usable.

**2026-09-16 — final training.** Three fresh 100-epoch runs. `L4-ciou` hit NaN
and needed an isolated FP32 recovery from epoch 11.

**2026-09-17 — release, then independent audit.** The FP32-safe `L1-ciou`
reproduction completed 100/100 epochs in 13,882 s (3.86 h). An independent audit
then corrected three claims the selection narrative had made (§2.9), froze the
operating point, and consumed the held-out test exactly once. Full-scene SAHI
inference ran on all three fixtures. Phase 02 closure fixed four annotation
pipeline defects and produced the 24-tile review pilot.

**2026-09-22 — the two trees reconciled.** Backend/ML work from the training
machine and the frontend from GitHub merged into one history. 15 conflicts: 10
where local was a verified superset, 2 where origin held the older state, 2
that were character-encoding damage. Tests: 464 passed, 9 skipped.

**2026-09-22, later — a real, global land mask.** The frontend mask became
GSHHG, the coastline OpenDrift itself uses, for the whole globe; upload AIS
lanes were planned around it and every vessel track checked against it. See
§2.13. Tests: 487 passed, 9 skipped.

**2026-09-23 — real AIS.** The three Gulf scenes now run on real marinecadastre
traffic, with the published vessels' own tracks as ground truth; the rest got
routed, varied simulated voyages. Real AIS exposed a reversed course in Case 2
and a one-degree coordinate error in Case 3. See §2.14. Tests: 506 passed,
9 skipped.

### Results

Screening, 12 cells at 60 epochs, mask metrics, single `slick` class:

| LSK | Loss | mAP50-95 | mAP50 |
|---|---|---:|---:|
| **L1** | **CIoU** | **0.199** | **0.431** |
| none | CIoU | 0.198 | 0.429 |
| L5 | CIoU | 0.193 | 0.421 |
| L4 | MPDIoU | 0.192 | 0.415 |

Final, frozen operating point, one-shot test:

| Measure | L1 val (.20) | Control val (.15) | **L1 test (.20)** |
|---|---:|---:|---:|
| Mask AP50-95 | .154474 | .147085 | **.149918** |
| Mask AP50 | .355973 | .341304 | **.363622** |
| Instance P / R / F1 | .5354 / .3373 / .4138 | .4303 / .3680 / .3967 | .5050 / .3557 / .4174 |
| Union Dice / IoU | .7610 / .6558 | .7821 / .6773 | .7437 / .6343 |
| Look-alike alarm tiles | 13/23 | 10/23 | **8/11** |
| Small-instance recall | .1181 | .1562 | .1096 |

Total compute: **1,080 epochs** (60 reference + 720 screening + 300 final), plus
the 100-epoch reproduction.

Full-scene inference, 864 native-resolution tiles each:

| Acquisition | Seconds | Raw predictions | Merged polygons |
|---|---:|---:|---:|
| 2023-04-09 00:02:06 | 48.009 | 112 | 86 |
| 2023-05-15 00:02:08 | 53.547 | 313 | 240 |
| 2023-12-05 00:02:14 | 46.835 | 57 | 40 |

Maximum geographic-to-pixel roundtrip error: **1.17e-10 pixels**. That checks
coordinate arithmetic, not geolocation accuracy or detection truth.

**The main technical risk was answered, negatively.** `RESEARCH/SYNTHESIS.md` §9
Q1 asked whether LSK-at-L5 transfers from a detection head to a segmentation
head. It does not: L5 ranks below both `none` and L1. That is a legitimate
finding and is reported as one.

## Frontend

Began as a five-layout landing-page study (Signal, Terminal, Orbit, Dossier,
Deepwater) exploring visual direction with anime.js. A separate animation
design from 2026-08-31 survives under `frontDemo/.backup/`.

Those were recombined into **SlickTrace**: one product, two surfaces — a home
page and an operations console with a dockable window manager. Stack is
React 19, Vite 6, Tailwind v4, MapLibre GL and anime.js v4.

Five review sessions followed, each closing items and finding new ones. Their
durable output is in §2.10–2.12 and in `ISSUES.md` §6. The largest single find
was the corridor/coastline work; the most-repeated was that scenario prose
disagrees with what the simulator actually computes — three separate sessions
each found a fresh instance.

On 2026-09-10 the sample-image reconstruction landed: outlines traced from the
supplied clean images, scaled into three open-water theatres, carried through
the existing ensemble and scoring pipeline. It is disclosed in the console as
simulated, and it should stay disclosed.

---

# Part 2 — Findings that must not be re-derived

## 2.1 Sigma-0 goes to dB last, and the paper's order was never running

The chain is `Read -> Apply-Orbit-File -> Calibration (linear) -> Speckle-Filter
(Refined Lee) -> Land-Sea-Mask -> Terrain-Correction -> LinearToFromdB -> Write`.

**`outputImageScaleInDb` is silently ignored by SNAP.** Measured on the Case 1
fixture, a subset calibrated with the flag true and one with it false are
byte-identical. So the anchor paper's "calibrate to dB, then Refined Lee" order
was never actually executing — the filter has always received linear input, and
what was missing was any dB conversion at all.

Two physical reasons the conversion belongs at the end: speckle is
multiplicative in the linear domain, which is what Refined Lee's
coefficient-of-variation model assumes; and Terrain-Correction resamples, where
averaging power linearly is the correct arithmetic mean and averaging in dB is a
geometric mean that biases interpolated pixels low.

Verified end to end: EPSG:4326, 73.9% non-zero, 100% negative values, mean
**-27.09 dB**, against `10*log10(0.00209) = -26.79` from the linear probe.

Two SNAP traps found alongside: `mapProjection` must be `WGS84(DD)`, not
`"EPSG:4326"` (the EPSG string builds a degenerate CRS and fails with a
divide-by-zero at graph init), and `nodataValueAtSea` **must be false** — it
defaults true, SRTM has no data over water, and on a marine scene the output is
correctly sized, correctly georeferenced and entirely zero.

## 2.2 Band 1 has no signal in it

**The single most expensive trap found.** Part I and Part III images are 2-band
float32 GeoTIFF holding sigma-0 in dB. Measured over 30 Part III `Oil` images,
comparing inside the ground-truth mask against outside:

| Band | Inside | Outside | Contrast |
|---|---|---|---|
| band 1 (VH) | -29.54 dB | -29.03 dB | **0.51 dB — noise** |
| band 2 (VV) | -27.41 dB | -20.41 dB | **7.01 dB** |

Reading "the first band" is the obvious implementation and hands the model an
image with no signal in it. It would have presented as an architecture failure —
or as the LSK-at-L5 question answering itself negatively — rather than as a
loader bug. `SAR_BAND = 2`.

Separately, **no image loader can open these files**: Ultralytics loads through
PIL, which answers `cannot identify image file` for every one. The first smoke
run called all 182 images corrupt. They must be *converted*, not linked.

**The dB window must be fixed, never per-image.** The absolute level *is* the
class signal — per-image band-2 means are Oil -21.5, Lookalike -20.2, No oil
-12.7 dB. A per-image min/max stretch, which is the usual reflex, maps all three
to the same output range and destroys the separation.
`DB_WINDOW = (-35.0, 0.0)` clips 0.000% low and 0.004% high.

## 2.3 The mask encodings genuinely differ, and one destroyed every label

`binarise` reduced a 3-D mask with `array[..., 0]` — correct for PIL's
`(H, W, C)`, wrong for `rasterio.read()`'s `(bands, H, W)`. On a real Part I
mask:

```
binarise(src.read())   -> (1, 2048)      0 true pixels     # every label destroyed
binarise(src.read(1))  -> (2048, 2048)   14,539 true pixels
```

**No exception was raised.** PHASE-02 assembling Part I the obvious way would
have trained on entirely empty labels and looked like a modelling failure.
`_drop_channel_axis` now picks the channel axis by size and **raises on a
genuinely ambiguous shape rather than guessing**, because guessing silently
transposes a label.

| | Part I | Refined SOS |
|---|---|---|
| Shape | 1 band, 2048² | 3-band RGB, 256² |
| Values | `{0, 1}` | `{0, 255}` + lossy halo |
| Clean binary | 200/200 sampled | 28/40 |
| Georeferenced | **no** | n/a |

Both encodings are really in circulation, which is why the rule is **threshold
at half the observed maximum**, not a fixed 128 — a fixed 128 would empty every
Part I mask.

## 2.4 Every record disagrees with the others, silently

Four traps, all now handled and tested:

1. **Part III masks carry a `_segmentation` suffix.** Matching on the bare stem
   finds **zero** pairs across all 450 images. It does not half-work.
2. **Part III restarts numbering inside every category.** `00000.tif` exists in
   `Oil`, `Lookalike` *and* `No oil`. Flattening on the bare stem silently
   overwrites two thirds of the corpus. Identities are qualified:
   `13761290__Oil__00000`.
3. **Refined SOS ships macOS AppleDouble debris** — 16,148 `._name` stubs. A
   plain glob pairs a 4 KB resource fork with a real mask. Naive count 16,145;
   real count 8,070.
4. **Refined SOS is mixed-sensor** and nothing in `PLAN/` or `RESEARCH/`
   anticipated it. 48% is ALOS PALSAR — L-band, where this pipeline is
   Sentinel-1 C-band. Oil damps capillary waves differently between the two, so
   they are not interchangeable training data.

## 2.5 Why Part II was skipped, and why that has now expired

Decided with the user 2026-08-31. The reason was not disk or bandwidth: PHASE-01
wants a look-alike negative pool at ~10% per split, Part III ships 150
`Lookalike` + 150 `No oil` with genuinely empty masks, and the assembled dataset
reached **10.2% / 11.7% / 11.8%**. Fetching 42.77 GB to refill a pool already at
target was poor value.

The decision came with an explicit trigger: **"fetch it only if the baseline
over-triggers on look-alikes"**. It does — 8 of 11 named look-alike test tiles
raise an alarm. The condition has been met. See `FUTURE_WORK.md`.

## 2.6 Two AIS ingest traps

**One malformed row killed an 8.2-million-row ingest.** `AIS_2023_04_09`
contains exactly one row whose MMSI is `G338926440` — a Coast Guard cutter off
Guam, far outside the AOI. `int()` raised and aborted the whole national day.
Bad rows are now skipped *and counted*, because a silent drop would present a
provider format change as "slightly less traffic", and traffic volume feeds the
scoring.

**A 48 h window spans three daily files, not one.** Anchored at 00:02, the
window touches Apr 7, 8 and 9. Loading only the acquisition day gives about two
minutes of overlap — **2,330 rows instead of 2,955,407** — and looks like light
traffic rather than an error.

## 2.7 The confound that would have invalidated the whole ablation

**Handing a YAML to `YOLO()` builds from random initialisation.** The baseline
used `yolo11n-seg.pt`, which is COCO-pretrained. Left alone, the twelve cells
would have compared a pretrained baseline against from-scratch LSK variants, and
the grid would have reported a confident, wrong **negative** on exactly the
question PHASE-02 exists to answer.

Three asymmetries had to be closed:

1. **The head's index moves.** Appending LSK before `Segment` shifts it from 23
   to 24/25/26, so checkpoint keys stop matching for L2–L5 while still matching
   for `none` and L1. The head is now excluded from transfer everywhere.
2. **L1 shifts the backbone too.** Its inline insertion at index 9 moves every
   later layer, so it received **192 of 394** tensors where others got 378 — a
   handicap on exactly the weights that matter most.
3. **The head filter must test the *remapped* key**, or L1's head slips through
   and gets 510 — the opposite asymmetry.

All six now transfer **exactly 378**, pinned by a test that asserts the counts
are *equal* rather than asserting any particular number.

Consequence: **`baseline-screen` is not the `none-ciou` cell.** It loaded a full
pretrained checkpoint including the head. Excluding the pretrained head costs
about one point of mAP50-95 (0.208 to 0.198) — the price of a valid comparison,
not a regression.

## 2.8 Resource limits: two wrong diagnoses before the right one

**RAM.** At `workers=8` (the paper's value) a run reached **30.8 GB of 31.4 GB —
98%** and left the machine unusable. `DEFAULT_WORKERS` is now derived from
*free* RAM, not total, because SNAP holds 7+ GB while it runs. This is a
recorded deviation from the paper and must be reported with any result — it is
safe in a way that changing batch, lr or epochs would not be, because `workers`
governs host-side prefetching only. `RunConfig` records both `workers` and
`workers_paper` so a reader comparing wall-clock sees the difference.

**CPU.** Two diagnoses were wrong before the third was right. `cap_cpu.ps1`
never could have worked; affinity alone does not cap utilisation; and a
percentage is not enough because the core *type* drives temperature. The
laptop-era section is marked superseded in place — the current machine has full
resource authorisation.

**Batch.** The paper trained at `imgsz=1024, batch=32` on a 24 GB RTX 4090.
Neither of this project's machines has that, so batch is derived from detected
VRAM and effective batch is held at 32 via `nbs=32` gradient accumulation.
**Record the physical batch used.** Note a physical batch change mid-run
(8 to 4 at epoch 44 in one case) does not make a run numerically identical to
one that did not change.

## 2.9 Three claims the independent audit corrected

Worth keeping because each is the kind of error that reads as fine:

1. **The oversized tensor is `model.10.cv1.bn.running_var`** — a BatchNorm
   buffer with maximum 18,835,282, not a learned LSK weight. FP16 cannot
   represent it. The earlier description of overflowing learned weights was
   inaccurate.
2. **The 0.15622 figure was the maximum mask AP over the whole curve**, not the
   saved checkpoint's metric — checkpoint fitness combines box and mask scores.
   The checkpoint's own value is 0.15550.
3. **The `.004` epoch-jitter heuristic is not a statistical parity tolerance.**
   It was being used as one.

## 2.10 `relabel.py` is built so it cannot become an auto-labeller

`export_review` writes every record with `confirmed_class: null`, and
`load_confirmed` returns only records a human signed — raising on a class
outside the scheme, or a label with no `confirmed_by`. An unattributed label is
indistinguishable from an auto-label, which is what the module exists to
prevent.

The morphology rule carries one deliberate qualifier: **a ship wake is linear
and dark and shaped exactly like an operational spill**. So linearity *without*
a nearby bright target is deliberately not proposed as `oos` — it is deferred,
because shape alone cannot separate those two. Run against 40 real masks it
proposes `slick_unknown` 102 times and defers 91%, which is the correct answer
while `bright_targets` is empty.

## 2.11 The area floor is not a tuning knob

Measured over 120 real Part I masks:

| Floor | Instances | Per mask | Foreground area kept |
|---|---:|---:|---:|
| none | 6,989 | 58.2 | 100% |
| **64 px** | **1,855** | **15.5** | **99.8%** |
| 2000 px | 399 | 3.3 | 97.9% |

Median component area is **9 px** and p25 is **1 px** — the masks are heavily
speckled. The 64 px floor discards 73% of components for 0.2% of the oil area.
It is what makes the labels usable at all.

## 2.12 Frontend lessons worth keeping

- **`createScope` from anime.js v4 confines selectors and reverts on cleanup.**
  Without it, five mount/unmount cycles leak timers into each other.
- **The scroll-reveal option is `repeat: false`, not `once: true`.** `once` is
  silently ignored in v4.
- **Drive the layout switcher's tuck with a CSS transition, not a JS tween.** A
  JS tween left animations stranded part-way whenever state flipped mid-flight.
- **A coarse land grid will lie to you**, and nearly did. Build the mask once,
  then search.
- **Two numbers on one page disagreeing is the cheapest bug detector here** —
  it is how three separate copy/data contradictions were found.
- **Prove the instrument before trusting a null result.** A check that reports
  "no problem" is worthless until it has been shown to fire on a known problem.

## 2.13 One coastline for the whole system

**The frontend mask is OpenDrift's coastline, not a copy of it.**
`roaring_landmask.Shapes.wkb(LandmaskProvider.Gshhg)` returns the exact GSHHG
full-resolution polygons OpenDrift's `reader_global_landmask` tests against —
180,496 polygons, 9.46 M vertices, all valid, none past ±180°.
`scripts/build_landmask.py` rasterises them at 1/240°, which is also the grid
of roaring's own raster. Natural Earth was planned and rejected: it would have
been a third coastline, and the disagreement would have been documented rather
than removed.

**Rasterise by latitude band, not by tile.** The first attempt clipped every
polygon per 5° tile and ran a Python varint loop; `contains`/`clip_by_rect` on
Eurasia (over a million vertices) for every tile it touches made it crawl with
no output. One GDAL `rasterize` per band plus a vectorised encoder does the
globe in ~2.5 minutes.

**A raster of the same coastline still "disagrees" at the shore, and that is
rounding.** Against OpenDrift's backward parcels the raster says 19.0%, 40.0%
and 25.6% ashore; OpenDrift says 0.10%, 0.26% and 0.14%; 98–99.99% of the gap
is within one cell of water, because `coastline_action="previous"` parks
parcels hard against the shore. Do not "fix" that by nudging real parcels —
test for *deep* ashore (no water in the eight neighbouring cells) instead.

**The basemap-colour mask was wrong in ways its own test enshrined.** It
called Venice, Louisiana water, and `check-landmask` asserted it. Over the Gulf
box it disagreed with OpenDrift at 6.02% of random points; the GSHHG raster
disagrees at 0.62%.

**A land-aware retry must not touch the shared RNG.** `buildTraffic` hands
vessels round-robin off one stream, so a retry drawn from it re-rolls the whole
scene. Re-placement draws from a per-vessel stream and a dropped vessel still
consumes its main-stream draws; every authored ranking came out bit-identical.

## 2.14 Real AIS, and what it said about the published cases

**The named vessels are in the data, and they corrected the scenes.** Both
ships Zhao et al. 2025 name are in the marinecadastre days on disk, under MMSIs
the scripted stand-ins did not use. Case 2's tanker was *southbound* at 7.8 kn
and at the slick tip at the pass (0.065-0.10 km from the published point),
still discharging; the authored scene had it northbound, finished four hours
earlier. Case 3's supply vessel was moored 0.046-0.07 km from 88°58′07″W — the
transcribed 89°58′07″W (`RESEARCH/papers/P004.md:181`) is one degree out, and
the scene had sat 97 km west of the real berth. Both are now read off the AIS.
Real AIS is the cheapest check on a transcribed coordinate this project has.

**Simplify in time, not just space.** Path-only Douglas-Peucker drops a stop on
a straight line, because the path does not change; the gate asks where a vessel
was at an hour, so the export uses synchronised-distance DP (TD-TR), which
bounds the position error at every instant. `tests/test_export_ais_traffic.py`
pins the stop case.

**A simplified track cannot tell you where the gaps are.** After TD-TR a
straight leg reported every minute keeps two points an hour apart, which looks
exactly like an hour of silence. Reception gaps have to be recorded before
simplifying (`breaks`), or the frontend invents them.

**`behaviour()` reads the first step as the cadence.** Resampling "each report
plus every 300 s" made a track whose first two reports were 60 s apart read
every later step as missed reports. Resample onto one global grid.

**`positionAt` clamps to a track's ends,** so a ship that left the scene was
drawn parked at its exit and every lane end collected phantom vessels; and CFAR
targets were generated for ships that were not there at the pass. Both now
require a report near the instant.

**Where a simulated ship stops decides a ranking.** The first voyage generator
stopped tankers and tugs anywhere mid-lane; with lanes authored through the
scene, a tug held station in kutch-dark's origin field and outranked the dark
contact. The scorer was right; the generator was not — ships wait at
anchorages at the end of a passage. Moving stops there restored the ranking.
Recorded because the order of events (failure seen, then realism fix) is
exactly what tuning-after-the-fact looks like, and it was not.

---

## 2.15 The upload path: wrong band, then a screen that outlined the sea

Two defects stacked, and each hid the other. Measured 2026-09-23 against the
Part I ground-truth masks.

**Wider spread is not more signal.** The GeoTIFF decoder chose the band with the
larger standard deviation. On Part I that is band 1, VH near the noise floor,
where the spread IS the speckle: oil sat a median 0.5 dB from the water there
against 5.5 dB in band 2, and 3 grey levels on screen. The co-polarised band is
the brighter one over the sea (by 4.0 dB at least, 12.4 typically, 60/60 scenes),
so that is now the rule, and it agrees with `SAR_BAND = 2` in training.

**A threshold cannot find a slick that covers 1% of a frame.** With the right
band, the Otsu screen still outlined the sea: over 24 validation scenes its
median precision was **.045** (IoU .045) while the release model through
`infer_scene` scored **.915** (IoU .769). Otsu splits the population it can
see, and in a scene that is 99% water that population is the water — the
recursive split does not save it. The model now runs in the browser instead;
the port matches Python pixel for pixel (mask IoU 1.000 on four scenes, .997 on
a fifth), and `check:segmenter` holds a floor on it.

Neither of these is a claim about generalisation: the model numbers are
validation-split, the same split checkpoint selection used.

**Then two input bugs, both the model's input rather than the model.** Where
the browser still went wrong it was always a preparation mistake, never the
network: (1) geotiff.js's LZW dictionary is three entries short of 12-bit, so a
sizeable share of Part I would not decode at all (`ISSUES.md` F16); (2) the
zero-fill outside a swath was counted as data, so on half-empty scenes both
band medians were 0 dB and the model was handed band 1 (`DATA.md` §2.1). With
the input prepared exactly as `infer_scene` prepares it, the browser matched
Python pixel for pixel on every scene compared, including the zero-filled one.

## Where the detailed evidence lives

| Artifact | Contents |
|---|---|
| `eval/final/operational/*/summary.json` | Per-run metrics at the frozen operating point |
| `eval/final/scenes/benchmark.json` | Full-scene inference timings and output hashes |
| `eval/screening/dataset_audit.json` | Per-source tile census, duplicate groups |
| `eval/final_preflight/label_audit.json` | Per-split label validation — zero format errors |
| `eval/phase2-closure/annotation-pilot/` | The 24-tile review pack and its inventory |
| `ml/ablation/results.md` | The 12-cell screening table (machine-generated) |
| `runs/final_l1_fp32_release/L1-ciou/release.json` | Release provenance and hashes |
