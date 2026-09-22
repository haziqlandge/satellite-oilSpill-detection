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

The frontend is authored separately and pushed straight to GitHub, so
`origin/main` can be ahead on `frontDemo/` while local is ahead on backend/ML.
Check `git rev-list --left-right --count main...origin/main` before assuming
either side is current.

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

Baseline is **506 passed, 9 skipped** — six database tests skip because the
Supabase session pooler returns tenant/user not found, and the rest need
hardware this machine lacks. A drop below 506 is a regression.

Run the command and read the output. "Should pass" is not evidence.

## 8. Traps that have already cost time twice

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
