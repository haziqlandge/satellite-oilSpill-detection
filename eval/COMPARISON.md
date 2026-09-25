# Comparison (PHASE-08), 2026-09-25

This system against P004 (Zhao et al. 2025, *Marine Pollution Bulletin*, the
anchor paper) and SkyTruth's Cerulean, on the axes of `RESEARCH/SYNTHESIS.md`
§4. Results are in `RESULTS.md`.

## Capabilities

| | P004 YOLOv8-LSK | Cerulean | **This project, as built** |
|---|---|---|---|
| Detect | 2-class (oos / slick) | binary | **1 class** (`slick`); the two-class labels do not exist (B1). `oos` is a downstream verdict from wind, radar, shape and drift evidence |
| Contour | boxes | yes | **instance masks**, measured into length, width profile, area and damping |
| Backward drift | no (named as future work, §3.8) | no; slick geometry as the proxy | **yes**: OpenDrift OpenOil ensemble, 10 members, on ERA5 wind and CMEMS currents, giving a time-indexed origin field and an age triple (C1) |
| AIS attribution | manual, by an analyst | automatic, geometry-based | **automatic, conditioned on the drift field** (S_drift and the spatiotemporal gate), six named terms per candidate |
| Explainable | no | partial | **evidence cards**: every term, its weight and its geometry; the ablation is live in the UI; refusals are results (C3) |

## Numbers, and why they are not head-to-head

| Measure | P004 | This project | Comparable? |
|---|---|---|---|
| Detection AP50 | .942, **bounding-box** AP on P004's own dataset | .364 **mask** AP50 on this corpus's held-out test (v11); .345 on validation (v12) | **No.** Different task (box vs mask), different data, different class scheme. Reported side by side only because both papers print an AP50 |
| Look-alike false alarms | 14 → 5 with negative curation (P004's result) | 55 → 4 of 87 frozen-holdout look-alikes with Part II negatives | **In kind only.** The same intervention was tried on different data |
| Attribution on the three cases | the named vessels, found by hand | the named vessels rank first on the **authored** cases (P004's slicks as published, the real AIS of those days); not tested on real slicks | **Partly.** Same vessels and same AIS; slicks as published, not re-detected |

## What the comparison supports

- The pipeline closes the loop P004 left open: backward drift conditioning the
  AIS attribution automatically, with the reasoning exposed.
- Negative curation reduces look-alike alarms here as it did in P004.

## What it does not support

- Any claim that detection is better or worse than P004's; the AP figures do
  not measure the same thing.
- Any comparison with P003's numbers (C11).
- Any claim of real-world attribution accuracy. The three cases are authored,
  and no real slick in this repository has a ranked vessel (`RESULTS.md` §3).
