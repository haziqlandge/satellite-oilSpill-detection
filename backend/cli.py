"""Command-line entry point.

Pipeline stages are defined in PLAN/INTERFACES.md section 1. Commands are
stubbed here in PHASE-00 and filled in by their respective phases; each raises
NotImplementedError naming the phase that owns it, so an unimplemented path
fails loudly rather than silently doing nothing.
"""

from __future__ import annotations

import importlib.util
import sys
from typing import Annotated

import typer

from backend.config import get_settings

app = typer.Typer(
    add_completion=False,
    no_args_is_help=True,
    help="SAR + AIS oil spill detection, drift hindcasting and vessel attribution.",
)


def _todo(phase: str, what: str) -> None:
    raise NotImplementedError(f"{what} is implemented in {phase} -- see PLAN/phases/{phase}.md")


@app.command("run-scene")
def run_scene(
    scene: Annotated[str, typer.Option(help="Scene product id or local .SAFE path.")],
    backward_hours: Annotated[int, typer.Option(help="Backward drift horizon.")] = 48,
    forward_hours: Annotated[int, typer.Option(help="Forward forecast horizon.")] = 72,
) -> None:
    """Run the full pipeline for one scene: ingest, detect, characterise, drift, attribute.

    This is the end-to-end acceptance command (PLAN/EVALUATION.md section 6).
    """
    _todo("PHASE-01", "Scene ingest")


@app.command()
def train(
    ablation: Annotated[bool, typer.Option(help="Run the full LSK L1-L5 ablation.")] = False,
) -> None:
    """Train the detection model (PHASE-02)."""
    _todo("PHASE-02", "Model training")


@app.command()
def evaluate(
    suite: Annotated[str, typer.Option(help="detection | drift | attribution | all")] = "all",
) -> None:
    """Run the evaluation suites defined in PLAN/EVALUATION.md (PHASE-08)."""
    _todo("PHASE-08", "Evaluation")


@app.command("seed-demo")
def seed_demo() -> None:
    """Populate the database with pre-computed demo results (PHASE-09)."""
    _todo("PHASE-09", "Demo seeding")


@app.command()
def doctor() -> None:
    """Report environment readiness. Safe to run with nothing configured."""
    from backend.db.session import check_connection

    settings = get_settings()
    ok = True

    typer.echo(f"python            {sys.version.split()[0]}")
    if sys.version_info[:2] != (3, 12):
        typer.secho(
            "  ! expected 3.12 -- the geospatial/ML stack does not support 3.13+ yet",
            fg=typer.colors.YELLOW,
        )

    db_ok, db_detail = check_connection()
    summary = db_detail.splitlines()[0][:80]
    typer.echo(f"database          {'ok' if db_ok else 'unavailable'}  ({summary})")
    if not db_ok:
        typer.secho(
            "  ! see scripts/SETUP_DATABASE.md -- PostGIS is required from PHASE-01",
            fg=typer.colors.YELLOW,
        )
        ok = False

    for name, module in [
        ("rasterio", "rasterio"),
        ("shapely", "shapely"),
        ("geopandas", "geopandas"),
        ("torch", "torch"),
        ("ultralytics", "ultralytics"),
        ("opendrift", "opendrift"),
    ]:
        present = importlib.util.find_spec(module) is not None
        typer.echo(f"{name:<18}{'ok' if present else 'not installed'}")

    typer.echo(f"data dir          {settings.data_dir}")
    typer.echo(f"weights dir       {settings.weights_dir}")
    typer.echo(f"force_cpu         {settings.force_cpu}")

    _report_gpu()

    raise typer.Exit(0 if ok else 1)


def _report_gpu() -> None:
    """Report CUDA usability honestly.

    The local device found during PHASE-00 was a GeForce GT 710 (Kepler, compute
    capability 3.5, 2 GB). Prebuilt PyTorch 2.x wheels target sm_50 and above, so
    that device cannot run modern PyTorch, and 2 GB cannot train the PHASE-02
    model at 1024 px regardless. See PLAN/PREREQUISITES.md.
    """
    if importlib.util.find_spec("torch") is None:
        typer.echo("cuda              unknown (torch not installed)")
        return

    import torch

    if not torch.cuda.is_available():
        typer.echo("cuda              unavailable -- CPU only")
        return

    name = torch.cuda.get_device_name(0)
    major, minor = torch.cuda.get_device_capability(0)
    total_gb = torch.cuda.get_device_properties(0).total_memory / 1024**3
    typer.echo(f"cuda              {name} (sm_{major}{minor}, {total_gb:.1f} GB)")
    if (major, minor) < (5, 0):
        typer.secho(
            "  ! compute capability below sm_50 -- not supported by prebuilt PyTorch 2.x",
            fg=typer.colors.RED,
        )
    if total_gb < 8:
        typer.secho(
            "  ! under 8 GB -- insufficient to train the PHASE-02 model locally",
            fg=typer.colors.RED,
        )


if __name__ == "__main__":
    app()
