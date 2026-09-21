# Screening review protocol — 2026-09-15

## Purpose and project context

Select the plain YOLO control and two challengers for three fresh 100-epoch runs. Masks drive area, medial axis, head/tail and drift seeding; false detections can contaminate AIS attribution. Consequently mask AP alone cannot select an operational model. C8 requires look-alike false positives separately. The original L5+MPDIoU design is a hypothesis, not a required winner.

## Budget and scope

All twelve 60-epoch screens are complete (720 epochs), plus the separate 60-epoch reference: 780/1080 done. The remaining 300 are three independent fresh runs, not 40-epoch extensions. This review does not start them. Current machine is RTX 4060 Ti 8 GB, 32 GB RAM; full resource use is authorized. Historical laptop caps and timings are not current instructions.

## Protocol frozen before additional model evaluation

1. Inventory every run, checkpoint, exact summary and learning curve. Verify initialization, batches, augmentation, seed, loss and data split; preserve originals. Missing artifacts remain missing evidence.
2. Audit training/validation source and negative counts and exact duplicate hashes. Do not use test predictions or test labels to choose models. Tile split is not proof of scene independence.
3. Evaluate every available grid best checkpoint on the same 585 validation tiles: imgsz=1024, batch=4, FP32, device=0, workers=2, NMS IoU=.7, conf=.001, max_det=300. Report standard mask and box AP, AP75, precision/recall. Reference baseline with different initialization is not the missing grid control.
4. Save per-image evidence. At fixed confidence .10/.25/.50 report confidence-ordered one-to-one instance matching at mask IoU .5, recall/precision, negative-image false alarm rate and FP instances. Separate named Lookalike and No oil sources. Sweep thresholds for equal-recall comparisons; never lower recall silently to claim fewer false alarms.
5. At .25 report union foreground IoU/Dice, pixel precision/recall, area bias, boundary F1 (2 pixels at the evaluator mask resolution); report positive-tile macro metrics separately from background tiles. Union metrics complement instance matching and cannot detect merged instances alone.
6. Stratify instance recall by mask area fraction (<.1%, .1–1%, >=1%), box elongation (aspect >=5) and border contact; stratify image metrics by source. Report sample counts and sparse strata explicitly. Size here is image fraction, not square metres.
7. Inspect final-ten-epoch level, trend, jitter and best-vs-last differences. Epoch jitter is not a confidence interval or multi-seed significance test. Paired bootstrap validation tiles for differences in .25 Dice/recall/false alarms; these intervals do not cover seed variance or unknown scene dependence.
8. Record parameter count, weight size and validation inference time, clearly separating model speed from audit overhead and full-scene SAHI. Inspect common validation cases visually, including hard negatives and low overlap positives; report labeling ambiguity without editing labels.
9. Choose a mandatory plain-YOLO/CIoU control, strongest defensible challenger, and a complementary challenger addressing the L5 transfer question if competitive. Prefer credible multiattribute tradeoffs over an arbitrary weighted score. Disqualify intended-loss claims for an implementation mismatch; archived weights can still be measured empirically. If finalists remain close, state uncertainty rather than manufacture a winner.

## Known issues at protocol creation

Grid none-ciou has run.json but no best.pt/last.pt/results.csv in expected artifacts. The separate baseline-screen uses COCO head initialization whereas the grid loads backbone/non-head weights only. Hardware/batch changes confound causal attribution. Data is single slick class, not oos/slick_unknown. Installed loss passes grid-unit boxes while the MPDIoU patch normalizes with pixel image dimensions; validate and record this before recommending that loss. Existing mirroring-only and optimizer prose may disagree with actual checkpoint arguments.

## Final training and test gates

Use new runs/final directories and a results destination that cannot overwrite the screening table; freeze initialization, physical batch=4, seed, optimizer and augmentation identically across finalists. Do not resume completed screening last.pt. Preserve current loss artifacts; any corrected MPDIoU experiment is a new treatment requiring validation and a revised budget, not a renamed old run. Select checkpoints and thresholds on validation, then evaluate frozen models once on an audited, scene-independent holdout and separate look-alikes. Existing mixed-source tile holdout is only an internal test, not an external geography guarantee. Human two-class relabeling, geocoded geometry checks, SAHI seams, real-scene null cases and downstream attribution remain acceptance gates. No screening model is certified highly reliable solely by this review.

## Deliverables

Reusable evaluation script and metric tests; per-model JSON/JSONL; dataset/provenance audit; curve summary; paired uncertainty and qualitative panels; detailed report with three-model selection and limitations; updated README, phase/evaluation index and HANDOFF with exact continuation steps.

## Execution and result


Completed the audit and selected **none-ciou, L1-ciou, L4-ciou**; reserve L5-ciou. See [the detailed report](../eval/screening/REVIEW.md) and selection.json. All eleven available best checkpoints were evaluated; the three close CIoU variants received exact matched-recall comparisons, common qualitative panels and cap1000 sensitivity. A targeted check found no GT instances rasterized to empty masks. Main findings: missing baseline artifacts, two train/val duplicate pairs, actual augmentation/optimizer discrepancies and MPDIoU coordinate-scale mismatch. Final training remains unstarted, with the report's concrete preflight sequence.

Protocol additions were diagnostic and recorded: exact matched-recall analysis for L1/L4/L5 after the coarse threshold sweep, prototype-mask disappearance check, and higher prediction-cap sensitivity after saturation was observed. No test-set predictions, model retraining or old-artifact changes were used.
