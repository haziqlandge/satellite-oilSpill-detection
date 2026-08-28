# Setting up on a training machine

For the session picking this project up on either training box after the zip transfer:
the **RTX 4060 Ti (16 GB)** desktop or the **RTX 5070 Ti (12 GB)** laptop. Both are
supported and nothing needs editing to move between them. Work through it in order; it ends
with a green test suite and a usable GPU.

The zip carries source only. It does **not** carry a working environment: a Windows
virtualenv bakes absolute paths and will not run elsewhere, and `node_modules` is large and
trivially rebuilt.

**Expected to be absent and rebuilt here:** `.venv/`, `frontDemo/node_modules/`,
`frontDemo/dist/`.
**Expected to be present:** `.claude/` (launch config), `data/` (empty scaffold), and
`.git/` if it was included.

---

## 1. Prerequisites

| Need | Version | Note |
|---|---|---|
| Python | **3.12** | Not 3.13+. The geospatial and ML stack does not support it yet |
| Node.js | 20 or 22 LTS | Only if you touch `frontDemo/`, which is **not your track** |
| NVIDIA driver | recent | Must expose CUDA 12.x for current PyTorch wheels |
| Git | any | Optional if `.git/` was excluded |

Check Python is present:

```bash
py --list
```

## 2. Python environment

```bash
py -3.12 -m venv .venv
```

```bash
.venv/Scripts/python.exe -m pip install --upgrade pip
```

Install **PyTorch first**, from the CUDA index. Installing it after `ultralytics` tends to
pull a CPU-only build over the top:

```bash
.venv/Scripts/python.exe -m pip install torch torchvision --index-url https://download.pytorch.org/whl/cu128
```

**Pick the index to match the card.** The 4060 Ti (Ada, sm_89) works on cu124 or cu128. The
5070 Ti (Blackwell, **sm_120**) needs **cu128 or newer** - older wheels may not ship kernels
for it and fail at runtime with "no kernel image is available for execution on the device".
cu128 covers both, which is why it is the default above.

Confirm the GPU is visible **and can actually allocate** before going further - capability
alone does not prove the wheel has kernels for it:

```bash
.venv/Scripts/python.exe -c "import torch; print(torch.cuda.get_device_name(0), torch.cuda.get_device_capability(0)); print(torch.zeros(1).cuda())"
```

Expect the card name, `(8, 9)` for the 4060 Ti or `(12, 0)` for the 5070 Ti, and a tensor
printing without error. If the allocation raises, the wheel is wrong for the card.

Then the project and its groups:

```bash
.venv/Scripts/python.exe -m pip install -e ".[dev,api,drift,detect]"
```

`opendrift` and `rasterio` are the two most likely to fail on Windows. If they do, install
them individually and report the error rather than working around it silently.

## 3. Configuration

```bash
cp .env.example .env
```

Then edit `.env`:
- `DATABASE_URL` - from Supabase, see step 4
- `FORCE_CPU=0` - leave it. An unusable GPU is detected in `backend/device.py`, so this
  is a debug override and not a per-machine setting
- Copernicus credentials as you obtain them

## 4. Database (Supabase)

Follow [`SETUP_DATABASE.md`](SETUP_DATABASE.md) in full. Summary:

The project **`oilSpill-Detect`** already exists (ref `hbctpozvofhxlioywcjw`, `ap-south-1`,
PG 17.6, PostGIS 3.3), the schema is applied, and RLS is enabled on every table. **Do not
create a second project.** You only need to:

1. Get the database password from whoever set it, or reset it at
   Dashboard > Project Settings > Database
2. Put the **direct** connection URI (port 5432, not the 6543 pooler) in `.env` as
   `DATABASE_URL`, scheme `postgresql+psycopg://`, with `sslmode=require`

Confirm you are at the current revision rather than re-running blindly:

```bash
.venv/Scripts/python.exe -m alembic current
```

Expect `0002`. If the database is empty (a fresh project), bring it up instead:

```bash
.venv/Scripts/python.exe -m alembic upgrade head
```

## 5. Verify

```bash
.venv/Scripts/python.exe -m backend.cli doctor
```

Expect: python 3.12, database ok with a PostGIS version, torch and ultralytics installed,
a `gpu` line naming the card, `device cuda`, and a `train defaults` line showing the batch
it would pick for this machine.

```bash
.venv/Scripts/python.exe -m pytest -q
```

Expect **12 passed** (the integration test now runs, since a database is reachable). If it
reports 11 passed / 1 skipped, the database is not connected - revisit step 4.

```bash
.venv/Scripts/python.exe -m ruff check . && .venv/Scripts/python.exe -m mypy backend
```

## 6. Start work

Read [`../HANDOFF.md`](../HANDOFF.md), then `PLAN/INDEX.md`, then
`PLAN/phases/PHASE-01.md`.

Do not touch `frontDemo/` - it belongs to the session on the other machine.

---

## Producing the zip (from the source machine)

Windows ships bsdtar at `C:\Windows\System32	ar.exe`, which writes zip directly:

```powershell
& "$env:SystemRoot\System32	ar.exe" -a -c -f ..\oilSpill-transfer.zip --exclude=".venv" --exclude="node_modules" --exclude="dist" --exclude=".env" --exclude="*.zip" --exclude=".mypy_cache" --exclude=".ruff_cache" --exclude=".pytest_cache" --exclude="__pycache__" --exclude="*.egg-info" .
```

A correct archive is **under 1 MB** and about 350 entries. If it comes out at tens or
hundreds of MB, something on the exclude list slipped through - list it and find the
offender before sending:

```powershell
& "$env:SystemRoot\System32	ar.exe" -t -v -f ..\oilSpill-transfer.zip | Sort-Object { [int]($_ -split '\s+')[4] } -Descending | Select-Object -First 10
```

Why each exclusion:

| Excluded | Reason |
|---|---|
| `.venv` | ~315 MB, and a Windows virtualenv bakes absolute paths - it cannot work elsewhere |
| `node_modules`, `dist` | Large, and rebuilt by `npm install` / `npm run build` |
| `*.zip` | **A previous archive left in the project folder gets swept into the next one.** This happened once and produced a 139 MB zip |
| `.mypy_cache`, `.ruff_cache`, `.pytest_cache`, `__pycache__`, `*.egg-info` | Tool caches, regenerated on first run |
| `.env` | **Holds the live Supabase password.** See below |

`.git/` is deliberately kept: it is small (~0.5 MB) and preserves the history even though
the transfer is not happening over git.

### The `.env` problem

`.env` is excluded because it contains a real database password, and a zip is easy to
forward by accident. The new machine needs it, so carry it separately:

1. Copy `.env.example` to `.env` on the new machine
2. Paste the `DATABASE_URL` password from your password manager, or reset it at
   Dashboard > Project Settings > Database
3. Fill the Copernicus credentials as you obtain them

`.claude/` **is** included - the next session needs `launch.json`.
