# CLAUDE.md — read this first

Operating rules for any agent session in this repository. Short on purpose.
Everything here is the kind of thing that has already cost someone real time.

## 1. This project spans two machines

| | Session machine | Training machine |
|---|---|---|
| GPU | GeForce GT 710 2 GB | RTX 4060 Ti 8 GB |
| RAM | — | 32 GB |
| Can train? | **No** | Yes |

PyTorch here reports the NVIDIA driver as too old (version 11040); CUDA never
initialises, so **this machine is CPU-only in practice**. Inference, the whole
drift/physics chain, dataset tooling and the frontend all run fine on CPU.

**If a task needs training, stop and tell the user.** They hand it to the other
machine. Do not start a training run here, and do not quietly substitute a
shorter one.

**On the 4060 Ti machine this is reversed** — check with
`.venv/Scripts/python.exe -c "import torch; print(torch.cuda.get_device_name(0))"`.
As of 2026-09-23 the work has moved there: training is allowed, and
`FUTURE_WORK.md` §0 says what comes next (Part II was trained and promoted on
2026-09-25). **The user decided on 2026-09-25 to keep working on the 4060 Ti**
rather than swap back. Files git does not carry are listed in
`pasteHere.txt` at the repository root.

**The 4060 Ti's checkout has no `.git`** (it began as a GitHub zip download).
Commits go through a separate clone pointed at this folder, never by copying a
`.git` in:

```bash
git clone --filter=blob:limit=2m https://github.com/haziqlandge/satellite-oilSpill-detection "$TMP/gh"
GIT_INDEX_FILE="$TMP/commit.index" git --git-dir="$TMP/gh/.git" --work-tree=. read-tree HEAD
```

Then `status`, `add -A` and `commit` with the same three prefixes, as Haziq
<haziqlandge@gmail.com>, and push from `$TMP/gh`. The last commit made that
way is `f215bec` (2026-09-25).

The frontend is authored separately and pushed straight to GitHub, so
`origin/main` can be ahead on `frontDemo/`. Fetch and compare `origin/main`
with the commit you are building on before assuming either side is current.

## 2. Paths from the other machine — fixed, but they come back

Artifacts produced on the training machine embed absolute paths rooted at
`C:\Users\adi\Downloads\oilSpil2l16\oilSpil2l\`, which does not exist here.
`scripts/repath_artifacts.py` made every existing one repo-relative (182,476
references: the annotation pilot, `inventory.json`, every `final-v*` split list,
`manifest.json`, `release.json`); its `--check` confirmed on 2026-09-23 that all
resolve. `.venv/pyvenv.cfg` was repointed on 2026-09-22.

**New artifacts copied from the training machine will embed its paths again.**
Run `.venv/Scripts/python.exe -m scripts.repath_artifacts` after copying, then
`--check`. Symptom if you forget: a missing-file error that reads like a corrupt
dataset rather than a path problem. See `DATA.md` §1.

**Two layouts, one repository.**

- **Session machine (GT 710):** everything lives inside the repository:
  - `data/interim/datasets/zenodo/{8346860,13761290,8253899}`;
  - `data/raw/…` and `data/processed/…`;
  - `runs/`.

  Use those in-repo files. Treat every `E:\…` or `oilSpil2l16` path in these
  docs as describing the 4060 Ti only: no junctions, and no `ZENODO_DIR`
  needed.
- **RTX 4060 Ti:** C: was too small, so the corpus is scattered:
  - `data/interim/datasets` is a directory junction into
    `C:\Users\adi\Downloads\oilSpil2l16\oilSpil2l`;
  - Parts I and III sit behind junctions onto `E:\oilSpil2l-data`;
  - Part II is in `E:\temp downloads`, so pass it to `scripts.part_two` as
    `--extracted "E:\temp downloads"`.

Code defaults are repo-relative only. `scripts/part_two.py` defaults to
`data/interim/datasets/zenodo/8253899`. The `scene` field in
`eval/final/scenes*/*.geojson` is the absolute path inference ran on,
provenance only; nothing reads it.

## 3. Where to look

**If you are a fresh session, read `FUTURE_WORK.md` §0 next.** It records where
the last session stopped, what is half-finished, what is blocked on the user,
and the traps already paid for.

| Question | Document |
|---|---|
| What is this, how do I run it | `README.md` |
| What is broken or unproven right now | `ISSUES.md` |
| What was done, and what must not be re-derived | `PREVIOUS_WORK.md` |
| What to do next | `FUTURE_WORK.md` |
| Where the data and artifacts live | `DATA.md` |
| What the system is supposed to be | `PLAN/` — `INDEX.md` first |
| Why a design decision was made | `RESEARCH/SYNTHESIS.md` |

`PLAN/` is what *should* exist; the repository is what *does*. When they
disagree, the repository wins and `ISSUES.md` records the gap.

## 4. Hard rules

`PLAN/CONSTRAINTS.md` defines twelve scientific-integrity constraints, C1–C12.
They are correctness requirements, not preferences, and several are enforced
structurally in `backend/db/models.py`. The ones most likely to be broken under
demo pressure:

- **C1** — age is never a bare scalar. Always `{low, best, high}` + method.
- **C3** — a diffuse origin field degrades to `insufficient_evidence`. Never
  force a suspect out of a field too wide to discriminate.
- **C4** — every suspect score decomposes into named terms with their geometry.
- **C5/C6** — backward drift is an ensemble, using OpenDrift's own mixing. Never
  hand-roll diffusion.
- **C8** — look-alike false positives are reported **separately** from mAP,
  never folded in.
- **C10** — synthetic AIS ground truth is authored, never detector-derived.

The system names vessels as suspected polluters. UI copy says "candidate",
"suspected", "score" — never "guilty", "responsible", "confirmed". Dark vessels
are ranked but never named.

**Anything simulated must say so.** The existing code does this well
(`provenance: "SIM · …"`); match it. A placeholder that presents its output as a
real result is the one failure that would discredit everything else.

## 5. Do not modify carelessly

| Path | Why |
|---|---|
| `oil.txt` | The user's own notes. Not an independent source; leave it alone. |
| `ml/ablation/results.md` | Auto-rewritten by `ml/ablation/run_ablation.py`. Hand edits vanish. |
| `PLAN/phases/*.md`, `RESEARCH/**` | Planned canon. Read, cite, don't rewrite. |
| `data/processed/dataset/final-v11/` | The frozen split the release was trained on. |
| `runs/` | ~1.8 GB, gitignored, expensive to regenerate (~4.5 h GPU). |

## 6. The held-out test split is consumed

It was evaluated exactly once (627 tiles, 2,859 instances). **Do not tune on
it, and do not evaluate on it again.** Any new generalisation claim needs a
freshly frozen, independently labelled holdout.

## 7. Before claiming anything is complete

```bash
.venv/Scripts/python.exe -m pytest
```

```bash
.venv/Scripts/python.exe -m ruff check . && .venv/Scripts/python.exe -m mypy ml backend scripts
```

Baseline is **677 passed, 8 skipped** as of the last full run (2026-09-25,
4060 Ti) — six database
tests skip because the Supabase project is paused (the pooler answers
tenant/user not found, ISSUES X1), and two need a hybrid CPU. A drop below 677
is a regression. ruff and mypy are both clean as of 2026-09-25 (mypy: 147
files); keep them that way. For the frontend,
`cd frontDemo && npx tsc -b && npm run check` (14 scripts; the corpus and
real-run checks skip on a machine without their data or the exported model).

**Use the trained model for every slick outline** (`frontDemo/src/sim/segmenter.ts`).
When its output looks wrong, the input is wrong — compare against
`backend/detect/yolo_lsk/infer.py` pixel for pixel before touching the model.

Run the command and read the output. "Should pass" is not evidence.

## 8. Traps that have already cost time twice

- **Vercel ships only what git carries.** The live demo
  (`satellite-oil-spill-detection.vercel.app`) is built from `main`.
  `frontDemo/public/runs/` and `frontDemo/public/models/*.onnx` are committed on
  purpose (`.gitignore` re-includes them). Without them every Real view is a
  404. Regenerate them with the export commands; never re-ignore them.
- **Import MapLibre from `frontDemo/src/map/maplibre.ts`**, never from
  `maplibre-gl`. v6 finds its worker beside its own module, and Vite moves the
  module; that file hands the worker over (`PREVIOUS_WORK.md` §2.25).

- **`weights/` is partially un-ignored.** `.gitignore` has `weights/` then
  `!weights/`, so files there are visible to git even though `*.pt` still hides
  checkpoints.
- **`eval/` is not gitignored** except for the derived `*.npz`, `*.jsonl` and
  `feature_cache/`. A careless `git add -A` used to sweep in 169 MB.
- **A `--` inside an XML comment is illegal** and makes SNAP's `gpt` die at graph
  init with an unrelated-looking XStream trace.
- **`times` descends on a backward drift run.** `times[0]` is the observation;
  `times[-1]` is the earliest reconstructed instant. Code assuming an ascending
  axis builds the origin field back to front.

More in `PREVIOUS_WORK.md` § "Findings that must not be re-derived".
