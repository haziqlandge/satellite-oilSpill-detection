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
| **ESA SNAP** | 14 | SAR preprocessing. `winget install EuropeanSpaceAgency.SNAP`. Installs `gpt.exe` to `C:\Program Files\esa-snap\bin\`, which `preprocess.py` finds automatically; override with `SNAP_GPT` |
| **Docker** | — | **No longer required.** Supabase replaced the PostGIS container, and SNAP is now driven natively via `gpt` (see `CONSTRAINTS.md`, amended 2026-08-29) |

> **Disk:** budget ~15 GB. Torch alone unpacks to ~2.6 GB and the three fixture
> `.SAFE` products are ~0.9 GB each. A torch install that dies mid-extract with
> `os error 112` is a full disk, not a broken wheel.

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
2. Put the connection URI in `.env` as `DATABASE_URL`, scheme
   `postgresql+psycopg://`, with `sslmode=require`

> **The direct host is IPv6-only.** `db.<ref>.supabase.co` resolves to an AAAA
> record and nothing else. On a machine or network without working IPv6 — check
> with `Test-NetConnection ipv6.google.com -Port 443` — psycopg fails with
> `failed to resolve host ... getaddrinfo failed`, which reads like a wrong
> hostname but is not.
>
> Use the **session pooler** instead. It is IPv4, still on port 5432, and still
> supports prepared statements, so alembic and psycopg3 both work (the *transaction*
> pooler on 6543 does not, and remains off-limits). The username becomes
> `postgres.<project_ref>`:
>
> ```
> DATABASE_URL=postgresql+psycopg://postgres.hbctpozvofhxlioywcjw:<password>@aws-0-ap-south-1.pooler.supabase.com:5432/postgres?sslmode=require
> ```
>
> Confirm the exact host in the dashboard rather than assuming the `aws-0` prefix —
> `aws-1-ap-south-1` also resolves but rejects this tenant.

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

### If rasterio raises `CRSError ... DATABASE.LAYOUT.VERSION.MINOR = 2`

A PostgreSQL/PostGIS install sets **machine-level `PROJ_LIB` and `GDAL_DATA`**
pointing at its own bundled PROJ database, which shadows the one rasterio and
pyproj ship. It breaks every Python geospatial stack on the machine, not just
this project. Clear both (elevated), then open a new shell:

```powershell
[Environment]::SetEnvironmentVariable('PROJ_LIB', $null, 'Machine')
[Environment]::SetEnvironmentVariable('GDAL_DATA', $null, 'Machine')
```

Already-running shells keep the stale values in their own process environment,
so verify in a **freshly launched** one.

## 6. Start work

Read [`../HANDOFF.md`](../HANDOFF.md), then `PLAN/INDEX.md`, then
`PLAN/phases/PHASE-01.md`.

Do not touch `frontDemo/` - it belongs to the session on the other machine.

---

## Producing the zip (from the source machine)

Exclude the three rebuilt directories:

```bash
tar --exclude='.venv' --exclude='node_modules' --exclude='dist' -czf oilSpill.tar.gz oilSpill/
```

PowerShell equivalent, if a `.zip` is required:

```powershell
Get-ChildItem -Path . -Recurse -Force | Where-Object { $_.FullName -notmatch '\\(\.venv|node_modules|dist)\\' } | Compress-Archive -DestinationPath ..\oilSpill.zip
```

**Do not include `.env`.** It holds the Supabase password. `.env.example` is the file that
travels; secrets are re-entered on the new machine.
