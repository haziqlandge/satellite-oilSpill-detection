# Phase 02 closure work — 2026-09-17

Phase 02 is still **9/13 acceptance items (69%)**. This continuation fixes real annotation-pipeline defects, but does not invent missing class labels or convert failed model-quality gates into passes. No additional training or consumed-test inference was run.

## Dataset categories independently checked

The user correctly recalled category-labelled folders. Local extracted directories and the original publisher descriptions agree:

| Source | Supplied information | Missing information |
|---|---|---|
| [Zenodo Part I](https://zenodo.org/records/8346860) | 1,200 oil-positive images; foreground 1/background 0 masks | Operational versus unknown-origin class per slick |
| [Zenodo Part II](https://zenodo.org/records/8253899) | 685 No Oil and 685 Lookalike images; masks all background | The two oil-origin classes; this part is not extracted locally |
| [Zenodo Part III](https://zenodo.org/records/13761290) | 150 each Oil, Lookalike, No oil | Operational versus unknown-origin class per slick |

`Lookalike` is a negative, not `slick_unknown`. Renaming these folders to the operational classes would change label meaning. `PLAN/phases/PHASE-01.md` already identifies this gap. P004 uses a separately assembled two-class dataset; its local source, `paperSource/paper4/operational_oil_spill_detection_with_figures.md`, ends with data available on request. No such annotated two-class dataset was found locally. No author was contacted.

The prior pipeline redistributed Zenodo Part III into its internal tile splits; historical results therefore are not an untouched official Part III benchmark. This continuation preserves final-v11 split membership. Future model selection requires a newly frozen, independently labelled holdout for a fresh final generalisation claim.

## Bugs fixed and why

1. **Missing review silently became class 0:** multi-class instances now require explicit confirmed labels. A partially reviewed dataset omits unreviewed positives instead of silently labelling them `oos`.
2. **Component IDs shifted after speck filtering:** polygon extraction now carries original connected-component IDs through filtering. Human labels attach to the same regions the reviewer saw.
3. **CLI bypassed reviewer attribution:** `--confirmed` now accepts a directory of review documents, validates class scheme/reviewer/unique component IDs, and checks original image and mask SHA-256. Bare anonymous class mappings are rejected.
4. **Stale labels could survive exclusions:** multi-class builds require a fresh output directory. Existing data is preserved rather than partially overwritten.

The first three regression cases failed before the fix and passed after it. The MPDIoU per-anchor stride correction was already implemented and its regression tests pass; old runs remain historical evidence of the old loss, not corrected-loss experiments.

## Concrete review pack

Open `annotation-pilot/index.html` for 24 train/validation tiles, side-by-side source images and numbered mask overlays. The JSON files in `annotation-pilot/reviews/` carry hashes, proposals, original component IDs and empty confirmation fields. This is a review pilot, not a training-ready dataset.

The complete eligible inventory contains **3,837 train/validation tiles**, **3,455 positive tiles**, and **17,402 existing polygon annotations**. Counts estimate work; retained raw component IDs are authoritative for class assignment. The old final test was excluded. Verification regenerated all 24 pilot single-class label files byte-for-byte; every proposal remains unconfirmed and the importer rejects the unreviewed pack (`pilot-verification.json`).

Generate a larger pack into a new directory, without modifying the pilot:

```powershell
.\.venv\Scripts\python.exe -m scripts.prepare_annotation_review --limit 3455 --out eval/phase2-closure/annotation-full
```

A qualified reviewer must assign `confirmed_class` and `confirmed_by` only when supported by image/context evidence. Leave ambiguous components unconfirmed. Incorrect masks require a corrected dataset version, not forced class assignments. Use the pilot to measure annotation time and identify missing contextual evidence before scaling the work.

## Remaining acceptance and ETA

- Two-class per-class metrics and comparison against a similarly trained baseline require valid labels, dataset assembly with overlap quarantine, matched model training, and a fresh evaluation protocol.
- AP50 >= .90 is not demonstrated. The current mask AP50 is .363622. P004's reported .942 is bounding-box AP on a different dataset, so it cannot guarantee this segmentation target. The requirement has not been silently lowered.
- Strictly fewer look-alike false positives remains unproven under the audited comparison. Any next experiment must predefine recall/false-alarm criteria on development data and preserve the final holdout.

**Pipeline fixes and pilot: complete.** A training-time planning reference is the measured 13,882-second (3.86-hour) 100-epoch FP32 L1 reproduction. Two comparable runs would be approximately 8 GPU-hours only if data size, settings and throughput stayed comparable; annotation, data QA, evaluation and repeat experiments are additional. Human review time is not yet measured, so there is no defensible full-phase finish date. No compute run is pending or running.

Full suite before the final output-directory guard: **464 passed, 8 skipped**, 136.60 seconds (`tests.log`). Focused suites after that final guard: **86 passed**, 5.61 seconds (`focused-tests.log`). Skips remain six unavailable database integrations and two hybrid-CPU checks. Source-transfer restrictions still prevent the external Aikido scan; no external security verification is claimed.
