"""Resource sampling for a benchmark or a long training run.

Reports the four numbers the user's machine limits are written in -- CPU %,
machine-wide RAM, GPU utilisation and VRAM -- sampled on a background thread so
the measured job is not also the one doing the measuring.

**Machine-wide, not per-process.** The limits in `CONSTRAINTS.md` are ceilings on
what the laptop is doing, not on what this process is doing: a training run
holding 12 GB is fine on an idle machine and a breach on one already at 21 GB.
Per-process figures are reported too, but they are the secondary number.

**GPU utilisation is sampled, never taken once at the end.** It swings between 0
and 100 within a single batch -- fetch, forward, backward -- so a single reading
says nothing. The percentile summary is what shows whether the card is being fed.
"""

from __future__ import annotations

import statistics
import subprocess
import threading
import time
from dataclasses import dataclass

# nvidia-smi is the only unprivileged route to utilisation and temperature on
# this machine. torch reports allocator bytes, which is a different quantity and
# always lower than what the driver actually reserves.
NVIDIA_SMI_QUERY = "utilization.gpu,memory.used,memory.total,temperature.gpu"

# Long enough that a sample is not dominated by psutil's own work, short enough
# to resolve the batch-to-batch swing that makes a mean GPU figure misleading.
DEFAULT_INTERVAL_S = 1.0


@dataclass
class Sample:
    at: float
    cpu_percent: float
    ram_used_gb: float
    ram_percent: float
    gpu_percent: float | None
    vram_used_mb: float | None
    gpu_temp_c: float | None
    proc_rss_gb: float


@dataclass
class Summary:
    """What a benchmark prints. Percentiles, because means hide the swing."""

    samples: int = 0
    duration_s: float = 0.0
    cpu_mean: float = 0.0
    cpu_p95: float = 0.0
    cpu_max: float = 0.0
    ram_mean_gb: float = 0.0
    ram_max_gb: float = 0.0
    ram_max_percent: float = 0.0
    gpu_mean: float | None = None
    gpu_p50: float | None = None
    gpu_p95: float | None = None
    vram_max_mb: float | None = None
    gpu_temp_max: float | None = None
    proc_rss_max_gb: float = 0.0

    def as_dict(self) -> dict[str, float | int | None]:
        return {
            "samples": self.samples,
            "duration_s": round(self.duration_s, 1),
            "cpu_mean": round(self.cpu_mean, 1),
            "cpu_p95": round(self.cpu_p95, 1),
            "cpu_max": round(self.cpu_max, 1),
            "ram_mean_gb": round(self.ram_mean_gb, 2),
            "ram_max_gb": round(self.ram_max_gb, 2),
            "ram_max_percent": round(self.ram_max_percent, 1),
            "gpu_mean": None if self.gpu_mean is None else round(self.gpu_mean, 1),
            "gpu_p50": None if self.gpu_p50 is None else round(self.gpu_p50, 1),
            "gpu_p95": None if self.gpu_p95 is None else round(self.gpu_p95, 1),
            "vram_max_mb": None if self.vram_max_mb is None else round(self.vram_max_mb),
            "gpu_temp_max": None if self.gpu_temp_max is None else round(self.gpu_temp_max),
            "proc_rss_max_gb": round(self.proc_rss_max_gb, 2),
        }


def read_gpu() -> tuple[float, float, float, float] | None:
    """`(util%, used_mb, total_mb, temp_c)`, or None when nvidia-smi cannot answer.

    A missing reading is returned as None and never as zero. A benchmark that
    silently reported 0% utilisation because the driver failed to answer would
    look exactly like a starving dataloader -- the one condition this module
    exists to detect.
    """
    try:
        completed = subprocess.run(
            ["nvidia-smi", f"--query-gpu={NVIDIA_SMI_QUERY}", "--format=csv,noheader,nounits"],
            capture_output=True,
            text=True,
            timeout=5,
            check=True,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    lines = completed.stdout.strip().splitlines()
    if not lines:
        return None
    try:
        util, used, total, temp = (float(part.strip()) for part in lines[0].split(","))
    except ValueError:
        return None
    return util, used, total, temp


def _percentile(values: list[float], quantile: float) -> float:
    ordered = sorted(values)
    if len(ordered) == 1:
        return ordered[0]
    index = min(len(ordered) - 1, max(0, round(quantile * (len(ordered) - 1))))
    return ordered[index]


class ResourceMonitor:
    """Sample the machine on a background thread for the life of a `with` block."""

    def __init__(self, interval_s: float = DEFAULT_INTERVAL_S, *, pid: int | None = None) -> None:
        self.interval_s = interval_s
        self.samples: list[Sample] = []
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._pid = pid

    def __enter__(self) -> ResourceMonitor:
        self._thread = threading.Thread(target=self._loop, name="resource-monitor", daemon=True)
        self._thread.start()
        return self

    def __exit__(self, *_: object) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=self.interval_s * 3)

    @staticmethod
    def _tree_rss_gb(process: object) -> float:
        """RSS of the trainer **and its dataloader workers**.

        The children are the point: workers are where the per-worker cost that
        the RAM budget is built from actually lands, so a parent-only figure
        would report a run at 3 workers as costing the same as one at 0.
        """
        import psutil

        total = 0
        try:
            assert isinstance(process, psutil.Process)
            total = process.memory_info().rss
            for child in process.children(recursive=True):
                try:
                    total += child.memory_info().rss
                except (psutil.NoSuchProcess, psutil.AccessDenied):
                    continue
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            pass
        return total / 1024**3

    def _loop(self) -> None:
        import psutil

        process = psutil.Process(self._pid) if self._pid else psutil.Process()
        psutil.cpu_percent(interval=None)  # prime the delta-based reading
        while not self._stop.wait(self.interval_s):
            memory = psutil.virtual_memory()
            gpu = read_gpu()
            self.samples.append(
                Sample(
                    at=time.monotonic(),
                    cpu_percent=psutil.cpu_percent(interval=None),
                    ram_used_gb=(memory.total - memory.available) / 1024**3,
                    ram_percent=memory.percent,
                    gpu_percent=None if gpu is None else gpu[0],
                    vram_used_mb=None if gpu is None else gpu[1],
                    gpu_temp_c=None if gpu is None else gpu[3],
                    proc_rss_gb=self._tree_rss_gb(process),
                )
            )

    def summary(self) -> Summary:
        if not self.samples:
            return Summary()

        cpu = [s.cpu_percent for s in self.samples]
        ram = [s.ram_used_gb for s in self.samples]
        gpu = [s.gpu_percent for s in self.samples if s.gpu_percent is not None]
        vram = [s.vram_used_mb for s in self.samples if s.vram_used_mb is not None]
        temps = [s.gpu_temp_c for s in self.samples if s.gpu_temp_c is not None]
        rss = [s.proc_rss_gb for s in self.samples]

        return Summary(
            samples=len(self.samples),
            duration_s=self.samples[-1].at - self.samples[0].at,
            cpu_mean=statistics.fmean(cpu),
            cpu_p95=_percentile(cpu, 0.95),
            cpu_max=max(cpu),
            ram_mean_gb=statistics.fmean(ram),
            ram_max_gb=max(ram),
            ram_max_percent=max(s.ram_percent for s in self.samples),
            gpu_mean=statistics.fmean(gpu) if gpu else None,
            gpu_p50=_percentile(gpu, 0.50) if gpu else None,
            gpu_p95=_percentile(gpu, 0.95) if gpu else None,
            vram_max_mb=max(vram) if vram else None,
            gpu_temp_max=max(temps) if temps else None,
            proc_rss_max_gb=max(rss),
        )
