"""Cell-averaging CFAR for bright targets on a dark sea (PHASE-02).

Ships and platforms return far more energy than the surrounding water, so they
need no labels to find — which is why this exists alongside the learned
detector rather than inside it. Three things depend on it:

* **The relabelling pass (PHASE-01).** `relabel.propose` will not call an
  instance `oos` on shape alone, because a ship wake is linear and dark and
  looks exactly like an operational discharge. It needs a nearby bright target
  to break the tie, and without CFAR that evidence simply does not exist —
  which is why the module currently defers 91% of instances.
* **Dark-vessel candidates (PHASE-06).** A CFAR target with no AIS match is the
  definition of a dark vessel.
* **P004 Case 1.** The paper's own reasoning is that "the white spot corresponds
  to the platform group"; reproducing that automatically is what lets
  infrastructure outrank vessels in the fixture where no vessel is within 5 km.

**The detector runs on LINEAR power, never on dB — this is the correctness
point of the whole module.** CA-CFAR's threshold multiplier is derived from an
exponential clutter model, which holds for sigma0 in linear power and **not** for
its logarithm: dB compresses the bright tail that the detector exists to find,
so a threshold calibrated for a 1e-6 false-alarm rate silently becomes something
else entirely. Our SAR products are dB (`ml/datasets/oos_dataset.DB_WINDOW`,
and the SNAP chain ends in `LinearToFromdB`), so `input_db=True` is the default
and conversion happens before any statistic is computed.

**The threshold is derived, not tuned.** For `n` training cells and a target
false-alarm rate `pfa`, the multiplier is

    alpha = n * (pfa ** (-1 / n) - 1)

so asking for a different false-alarm rate changes the threshold in a principled
way rather than by taste. Guard cells sit between the cell under test and the
training ring so that a large target does not contaminate its own background
estimate — the classic CFAR self-masking failure, where a big ship raises the
local mean enough to hide itself.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

# The guard ring must be wide enough that a target does not reach into its own
# training annulus. **Measured on this implementation**, 20 dB targets on
# exponential sea:
#
#     target   guard 4   guard 8   guard 15
#      5x5      found     found     found
#     10x10     found     found     found
#     20x20    MASKED    MASKED     found
#
# So the guard needs to be roughly three quarters of the target's width. At
# 10 m pixels the default handles anything up to about 100 m -- most vessels --
# but **a large platform complex can self-mask**, which matters directly for
# P004 Case 1 where the target is a platform *group*. Raise `guard_px` when
# hunting infrastructure; `detect_bright_targets` takes it per call for exactly
# that reason.
DEFAULT_GUARD_PX = 4
DEFAULT_TRAIN_PX = 8

# One false alarm per million cells. On a 32585 x 21409 scene that is still
# ~700 expected false detections, which is why `min_area_px` and the AIS gate
# downstream both matter -- CFAR is a candidate generator, not a decision.
DEFAULT_PFA = 1e-6

# Below this a detection is speckle rather than a vessel. A 20 m ship at 10 m
# pixels is ~2x6 px, so 4 px is deliberately permissive.
DEFAULT_MIN_AREA_PX = 4

# Land returns are bright and would swamp the statistics. SNAP's Land-Sea-Mask
# writes exact zeros over land, so zero means "not sea" rather than "very dark
# sea" and must be excluded from both test and training cells.
LAND_VALUE = 0.0


class CfarError(RuntimeError):
    """CFAR could not be run as specified."""


@dataclass(frozen=True, slots=True)
class BrightTarget:
    """One detected bright target, in pixel coordinates."""

    row: float
    col: float
    area_px: int
    peak_linear: float
    mean_linear: float

    @property
    def centroid_rc(self) -> tuple[float, float]:
        """`(row, col)` — the form `relabel.propose` expects for `bright_targets`."""

        return (self.row, self.col)


def db_to_linear(image: np.ndarray) -> np.ndarray:
    """sigma0 in dB to linear power. See the module docstring for why this matters."""

    return np.power(10.0, np.asarray(image, dtype=np.float64) / 10.0)


def cfar_alpha(training_cells: int, pfa: float = DEFAULT_PFA) -> float:
    """CA-CFAR threshold multiplier for an exponential clutter model.

    `alpha = n * (pfa ** (-1/n) - 1)`. Derived from the false-alarm rate rather
    than chosen, so changing `pfa` moves the threshold coherently.
    """

    if training_cells < 1:
        raise CfarError(f"need at least one training cell, got {training_cells}")
    if not 0.0 < pfa < 1.0:
        raise CfarError(f"pfa must be in (0, 1), got {pfa}")
    return float(training_cells * (pfa ** (-1.0 / training_cells) - 1.0))


def _box_sum(image: np.ndarray, size: int) -> np.ndarray:
    """Sum over a `size x size` window, via a summed-area table.

    An explicit sliding window over a 32k x 21k scene is minutes; this is
    milliseconds and exact for float64.
    """

    padded = np.pad(image, size // 2 + 1, mode="reflect")
    integral = padded.cumsum(axis=0).cumsum(axis=1)
    integral = np.pad(integral, ((1, 0), (1, 0)), mode="constant")

    height, width = image.shape
    offset = size // 2 + 1
    top = offset - size // 2
    left = offset - size // 2
    window: np.ndarray = (
        integral[top + size : top + size + height, left + size : left + size + width]
        - integral[top : top + height, left + size : left + size + width]
        - integral[top + size : top + size + height, left : left + width]
        + integral[top : top + height, left : left + width]
    )
    return window


def ca_cfar_mask(
    image: np.ndarray,
    *,
    guard_px: int = DEFAULT_GUARD_PX,
    train_px: int = DEFAULT_TRAIN_PX,
    pfa: float = DEFAULT_PFA,
    input_db: bool = True,
) -> np.ndarray:
    """Boolean mask of cells exceeding the local CA-CFAR threshold.

    The background for each cell is the mean of a square annulus: everything in
    the `train` box that is not in the `guard` box. Land (exact zeros) is
    excluded from both, so a coastline does not inflate the neighbouring
    background and blind the detector next to shore.
    """

    array = np.asarray(image, dtype=np.float64)
    if array.ndim != 2:
        raise CfarError(f"expected a 2-D image, got shape {array.shape}")
    if guard_px < 1 or train_px < 1:
        raise CfarError("guard and training widths must be positive")

    linear = db_to_linear(array) if input_db else array

    # Zeros are SNAP's land fill, not dark water.
    sea = array != LAND_VALUE
    linear = np.where(sea, linear, 0.0)

    inner = 2 * guard_px + 1
    outer = 2 * (guard_px + train_px) + 1

    outer_sum = _box_sum(linear, outer)
    inner_sum = _box_sum(linear, inner)
    outer_count = _box_sum(sea.astype(np.float64), outer)
    inner_count = _box_sum(sea.astype(np.float64), inner)

    training_sum = outer_sum - inner_sum
    training_count = outer_count - inner_count

    usable = training_count > 0
    background = np.zeros_like(linear)
    np.divide(training_sum, training_count, out=background, where=usable)

    # alpha depends on how many cells actually contributed, which varies near
    # land and at the image border -- so it is computed per pixel rather than
    # once for the nominal geometry.
    counts = np.maximum(training_count, 1.0)
    alpha = counts * (np.power(pfa, -1.0 / counts) - 1.0)

    return bool_and(linear > alpha * background, usable & sea)


def bool_and(*masks: np.ndarray) -> np.ndarray:
    result = masks[0]
    for mask in masks[1:]:
        result = np.logical_and(result, mask)
    return np.asarray(result, dtype=bool)


def detect_bright_targets(
    image: np.ndarray,
    *,
    guard_px: int = DEFAULT_GUARD_PX,
    train_px: int = DEFAULT_TRAIN_PX,
    pfa: float = DEFAULT_PFA,
    min_area_px: int = DEFAULT_MIN_AREA_PX,
    input_db: bool = True,
) -> list[BrightTarget]:
    """Detect and cluster bright targets, brightest first.

    Returns `BrightTarget`s whose `centroid_rc` is directly what
    `relabel.propose` takes as `bright_targets`.
    """

    from scipy import ndimage

    mask = ca_cfar_mask(
        image, guard_px=guard_px, train_px=train_px, pfa=pfa, input_db=input_db
    )
    if not mask.any():
        return []

    linear = db_to_linear(image) if input_db else np.asarray(image, dtype=np.float64)
    labelled, count = ndimage.label(mask)
    if count == 0:
        return []

    targets: list[BrightTarget] = []
    objects = ndimage.find_objects(labelled)
    for index, window in enumerate(objects, start=1):
        if window is None:
            continue
        patch = labelled[window] == index
        area = int(patch.sum())
        if area < min_area_px:
            continue
        values = linear[window][patch]
        rows, cols = np.nonzero(patch)
        targets.append(
            BrightTarget(
                row=float(rows.mean() + window[0].start),
                col=float(cols.mean() + window[1].start),
                area_px=area,
                peak_linear=float(values.max()),
                mean_linear=float(values.mean()),
            )
        )

    targets.sort(key=lambda t: t.peak_linear, reverse=True)
    return targets


# The polarisation band CFAR reads from a multi-band product. **Band 2, not
# band 1**, and measured twice on independent data:
#
#   Zenodo Part I/III tiles, slick contrast inside vs outside the mask:
#       band 1 (VH)  0.51-0.60 dB      band 2 (VV)  6.21-7.01 dB
#
#   SNAP-processed Case 1 scene, a 2000x2000 window, CFAR at guard 15:
#       band 1  sea -28.3 dB, 6 targets, brightest 14.8 dB
#       band 2  sea -21.4 dB, 8 targets, brightest 34.4 dB
#
# Band 2 finds more targets at greater contrast, and it is the same band
# `ml/datasets/oos_dataset.SAR_BAND` trains on -- so detector and dataset agree
# about which polarisation the pipeline is looking at.
SCENE_BAND = 2


def detect_in_scene(
    path: str | Path,
    *,
    window: Any | None = None,
    band: int = SCENE_BAND,
    **kwargs: Any,
) -> list[BrightTarget]:
    """Run CFAR over a geocoded SAR product, reading the right band.

    Row/column in the returned targets are **relative to `window`** when one is
    given, not to the full scene; add the window offset before converting to
    geographic coordinates. Keeping them window-relative is what lets a large
    scene be processed in tiles without every caller re-deriving the offset.
    """

    import rasterio

    with rasterio.open(path) as source:
        chosen = band if source.count >= band else 1
        image = source.read(chosen, window=window)

    return detect_bright_targets(image, **kwargs)
