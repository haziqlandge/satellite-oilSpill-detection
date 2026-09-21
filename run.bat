@echo off
REM ===================================================================
REM  PHASE-02 interactive runner.
REM
REM  Double-click, or: run.bat
REM
REM  The thread caps are exported HERE, before python starts, and that
REM  ordering is load-bearing: the OMP runtime reads these once, when it
REM  loads on the first `import torch`. Setting them from inside a script
REM  that has already imported torch is too late to have any effect.
REM
REM  Affinity is NOT set here. It is applied in-process by
REM  ml/train/train.py:cap_cpu, before the dataloader workers spawn, so
REM  the workers inherit it. scripts/cap_cpu.ps1 could only ever reach
REM  processes already alive, which is every process except the ones
REM  doing the image work.
REM ===================================================================

setlocal
cd /d "%~dp0"

set OMP_NUM_THREADS=6
set MKL_NUM_THREADS=6
set OPENBLAS_NUM_THREADS=6
set NUMEXPR_NUM_THREADS=6

set PY=.venv\Scripts\python.exe
if not exist "%PY%" (
    echo.
    echo   No virtualenv at %PY%
    echo   See scripts\SETUP_NEW_MACHINE.md
    echo.
    pause
    exit /b 1
)

:menu
cls
echo ===================================================================
echo   PHASE-02  --  oil spill detection
echo ===================================================================
echo.
echo   Limits: CPU 80%%   RAM 24 GB   GPU unrestricted   stop above 93C
echo.
echo   [1]  Progress        watch a run already going
echo   [2]  Resume grid     screening cells, with live progress
echo   [3]  Benchmark       ~4 min, measures the pipeline
echo   [4]  Tests           full suite
echo   [5]  Doctor          environment and GPU check
echo   [6]  Grid status     one-shot list of cells done/pending
echo   [7]  Thermal guard   watch temperatures alongside a run
echo.
echo   [0]  Exit
echo.
set /p choice=" Choose: "

if "%choice%"=="1" goto progress
if "%choice%"=="2" goto grid
if "%choice%"=="3" goto bench
if "%choice%"=="4" goto tests
if "%choice%"=="5" goto doctor
if "%choice%"=="6" goto status
if "%choice%"=="7" goto thermal
if "%choice%"=="0" exit /b 0
goto menu

:progress
cls
"%PY%" scripts\progress.py --watch
pause
goto menu

:grid
cls
echo.
echo   Resuming the screening grid. Completed cells are skipped.
echo   Ctrl-C in the progress view stops WATCHING, not the run.
echo.
set /p wk=" Dataloader workers (blank = derive from free RAM): "
if "%wk%"=="" (
    "%PY%" scripts\progress.py --run grid
) else (
    "%PY%" scripts\progress.py --run grid --workers %wk%
)
pause
goto menu

:bench
cls
echo.
echo   Two real epochs per configuration. Writes to runs\bench,
echo   never to runs\ablation, so it cannot be mistaken for a cell.
echo.
echo     [1] single    current settings
echo     [2] workers   sweep 0 / 2 / 4
echo     [3] batch     sweep 8 / 16
echo.
set /p bchoice=" Choose: "
if "%bchoice%"=="2" (
    "%PY%" scripts\benchmark_pipeline.py --sweep workers
) else if "%bchoice%"=="3" (
    "%PY%" scripts\benchmark_pipeline.py --sweep batch
) else (
    "%PY%" scripts\benchmark_pipeline.py
)
pause
goto menu

:tests
cls
"%PY%" scripts\progress.py --run tests
pause
goto menu

:doctor
cls
"%PY%" -m backend.cli doctor
echo.
pause
goto menu

:status
cls
"%PY%" -m ml.ablation.run_ablation --list --screen
echo.
"%PY%" scripts\progress.py --once
echo.
pause
goto menu

:thermal
cls
echo.
echo   GPU temperature is readable unprivileged. CPU temperature needs
echo   an elevated shell -- cpu_available in the log says which you have.
echo.
"%PY%" scripts\thermal_guard.py --watch-only
pause
goto menu
