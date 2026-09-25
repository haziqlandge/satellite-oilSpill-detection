# Walkthrough — three minutes, five acts

The narrative is the argument (PHASE-09): each act earns the next. Times are
targets; the console is at `http://127.0.0.1:5180/#/console`, desktop layout
(1280 px or wider), map at about z9.

**Say "candidate", "suspected", "score".** Never "guilty", "responsible",
"confirmed". Dark vessels are ranked, never named.

## Before the audience arrives

1. `.venv/Scripts/python.exe -m scripts.export_snapshot --check`: every file
   the demo reads is present and unchanged. If files are missing, unzip
   `demo/data/snapshot.zip` at the repository root.
2. Start both servers: the `api` and `frontDemo` launch configurations, or
   ```bash
   .venv/Scripts/python.exe -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
   ```
   ```bash
   npm run dev --prefix frontDemo
   ```
3. Last check, with the network **off**:
   ```bash
   .venv/Scripts/python.exe -m scripts.verify_offline
   ```
   It must print `PASS` and `network was OFF`. The map then draws land
   from the local GSHHG mask and says the tiles are unreachable. Every
   result layer is still there (ISSUES F11).

## Act 1: a real scene, and a system that says what it cannot do (0:00–0:40)

Spill selector → **Real · 2023-12-05**. This is a real Sentinel-1 pass over
the Mississippi delta, segmented by the release model (v12). Only the seed
detection is drawn. Pane 01 shows it measured: length, width, damping ratio
(relative, C2) and ERA5 wind with the wind gate.

*Top right of the map:* the wind (ERA5), the surface current (CMEMS) and the
drift at the spill, live with the timeline. The few large arrows on the map
are each an area's average flow. Anything simulated carries a **SIM** tag
there, and the panels say where each real value was sourced from.

*Open pane 04* (the red `halt` flag in the header). It names nobody, and it
says why: the field never converges, so there is no age (C1). **This is
`insufficient_evidence`, shown first on purpose: a system that always names
someone is useless.**

## Act 2: the hindcast (0:40–1:10)

Press **Play**, or drag the timeline back towards −72 h. These are OpenDrift's
own 2,000 parcels (10 members × 200), run backward on the real wind. The
dashed outline is the 50 % / 90 % region. Forward of T0 it is the 72 h
forecast, and parcels that reach the delta strand.

*No system in the reviewed literature conditions attribution on a backward
drift field. P004 names OpenDrift reverse-trajectory simulation as future
work.*

## Act 3: attribution, published Case 2 (1:10–1:50)

Spill selector → **Moving discharge** (`gom-moving`). The slick is P004's
Case 2 as published (~19 km), laid over the **real** marinecadastre AIS of
2023-05-15. Identities are masked. The spatiotemporal gate cuts the traffic
to 24 candidates. The published tanker ranks **1st, margin +0.396**. Pane 05
has its evidence card: six named terms, their weights, the geometry behind
each, and the caveats (C4).

*Same vessel as the paper, reached automatically. It is one authored case,
not an accuracy figure. Present it per case, never as a percentage from n = 3.*

## Act 4: where the drift field decides (1:50–2:25)

Spill selector → **Dark vessel** (`kutch-dark`; simulated AIS, labelled SIM).
Among 38 candidates, a radar contact with its transponder off ranks **1st**
and is **not named**. Pane 04, *Ablation* →
**recompute without s_drift**: the contact drops to **3rd**. Without the
drift field, passing traffic outranks it. That is the contribution: the field
is decisive where geometry is silent.

*Say the limit too.* On the authored Case 3 (`gom-berthed`, the berthed
vessel) removing S_drift does **not** change the top rank. The vessel sits
at the slick's head, so proximity carries it (ISSUES Q7,
`eval/attribution/REPORT.md`). Removing the whole field costs the platform
case (Case 1) its first place.

## Act 5: the null case (2:25–3:00)

Spill selector → **Look-alike, no spill** (`mumbai-null`). Wind 1.9 m/s is
below the Bragg gate, so the sea is dark everywhere and the gate is 0. **It
names nobody.** Close on this: it answers the sceptic's question, *does it
ever say "I don't know"?*

The Indian-waters scenarios use **simulated AIS**, which the problem
statement permits, and they are labelled SIM. They test the logic, not
cross-region detector transfer. If there is time, show **Anchored after a
collision** (Ennore) and **Mooring leak** (Paradip), the Bay of Bengal zones.

**Say it plainly:** the pipeline operates over these zones. It is not claimed
that detection accuracy generalises to Indian waters.

## If asked

- **Detection quality:** one class, `slick`; mask mAP50 .36 on the held-out
  test (consumed once). Look-alike alarms fell from 55/87 to 4/87 on a frozen
  Part II holdout after retraining with its negatives (`eval/part2/REPORT.md`).
- **Real vessels ranked on real slicks?** Not yet. The real runs now drift on
  ERA5 wind and CMEMS currents, but two of the three never converge (no age)
  and the third's wind is below the Bragg gate, and ranking a live field waits
  on smoothing it (ISSUES X16). The real views refuse, and pane 04 says why.
- **Offline?** Everything above runs from local files: the API reads the
  pipeline's artifacts, and forcing comes from the NetCDF cache
  (`DEMO_OFFLINE=1`). Without tiles, the land is the drift's own GSHHG mask.
