"""GPU detection and machine-adaptive training defaults.

This project moves between machines with materially different GPUs (an RTX
4060 Ti 16 GB desktop and an RTX 5070 Ti 12 GB laptop, historically a GT 710
that could not run PyTorch at all). Nothing here should be hard-coded per
machine: the device and the batch size are derived from what is actually
present, and whatever was chosen is recorded alongside the results.
"""

from __future__ import annotations

import importlib.util
from dataclasses import dataclass

from backend.config import get_settings

# Prebuilt PyTorch 2.x wheels target sm_50 and above. Kepler-era cards
# (sm_35, e.g. the GT 710) are below the floor and cannot run them at all.
MIN_COMPUTE_CAPABILITY = (5, 0)

# Below this there is not enough VRAM to train the PHASE-02 model at any
# useful batch size, whatever the compute capability says.
MIN_TRAIN_VRAM_GB = 8.0

# Effective batch, held constant across machines via gradient accumulation so
# the PHASE-02 ablation stays comparable to Zhao et al. Table 1.
NOMINAL_BATCH = 32


@dataclass(frozen=True)
class DeviceInfo:
    device: str
    name: str | None = None
    capability: tuple[int, int] | None = None
    vram_gb: float | None = None
    reason: str = ""

    @property
    def is_cuda(self) -> bool:
        return self.device == "cuda"

    @property
    def can_train(self) -> bool:
        return self.is_cuda and (self.vram_gb or 0) >= MIN_TRAIN_VRAM_GB


def resolve_device() -> DeviceInfo:
    """Pick the device by inspection rather than configuration.

    FORCE_CPU exists only as an override for debugging or for reproducing a
    CPU-path bug. It is not how an unusable GPU gets avoided -- that is
    detected here, so moving the repository to another machine needs no edit.
    """
    settings = get_settings()

    if settings.force_cpu:
        return DeviceInfo(device="cpu", reason="FORCE_CPU is set")

    if importlib.util.find_spec("torch") is None:
        return DeviceInfo(device="cpu", reason="torch is not installed")

    import torch

    if not torch.cuda.is_available():
        return DeviceInfo(device="cpu", reason="no CUDA device visible to torch")

    name = torch.cuda.get_device_name(0)
    capability = torch.cuda.get_device_capability(0)
    vram_gb = torch.cuda.get_device_properties(0).total_memory / 1024**3

    if capability < MIN_COMPUTE_CAPABILITY:
        return DeviceInfo(
            device="cpu",
            name=name,
            capability=capability,
            vram_gb=vram_gb,
            reason=(
                f"{name} is sm_{capability[0]}{capability[1]}, below the sm_"
                f"{MIN_COMPUTE_CAPABILITY[0]}{MIN_COMPUTE_CAPABILITY[1]} floor "
                "of prebuilt PyTorch 2.x wheels"
            ),
        )

    return DeviceInfo(
        device="cuda",
        name=name,
        capability=capability,
        vram_gb=vram_gb,
        reason="usable CUDA device",
    )


def suggest_batch_size(vram_gb: float | None) -> int:
    """Starting physical batch for PHASE-02 at 1024 px, by available VRAM.

    These are **starting points to be confirmed empirically on the first run**,
    not measured figures. Zhao et al. used batch 32 at 1024 px on a 24 GB
    RTX 4090; everything below is scaled down from that and assumes AMP is on.
    Instance-segmentation heads cost more than the detection heads they used,
    so err low and raise once memory headroom is observed.

    Pair whatever is chosen with nbs=NOMINAL_BATCH so the *effective* batch
    stays 32 regardless of machine.
    """
    if vram_gb is None:
        return 4
    if vram_gb >= 22:
        return 32  # 24 GB class, the paper's own setting
    if vram_gb >= 15:
        return 12  # 16 GB class, e.g. RTX 4060 Ti
    if vram_gb >= 11:
        return 8  # 12 GB class, e.g. RTX 5070 Ti laptop
    if vram_gb >= MIN_TRAIN_VRAM_GB:
        return 4
    return 2


def training_defaults() -> dict[str, object]:
    """Resolved training knobs, for logging into `ml/ablation/results.md`.

    The physical batch must be recorded with the results: an unreported batch
    change silently invalidates the comparison against the paper.
    """
    info = resolve_device()
    batch = suggest_batch_size(info.vram_gb)
    return {
        "device": info.device,
        "gpu": info.name,
        "vram_gb": round(info.vram_gb, 1) if info.vram_gb else None,
        "batch": batch,
        "nbs": NOMINAL_BATCH,
        "imgsz": 1024,
        "amp": info.is_cuda,
        "accumulate": max(1, NOMINAL_BATCH // batch),
    }
