"""The damping ratio: how much darker the slick is than the sea around it (PHASE-03).

Mean sigma-0 inside the mask against mean sigma-0 in an annulus of clean sea
around it, with a stand-off so the annulus starts clear of the boundary
gradient (the mask edge is a few pixels uncertain, and speckle smears it).

**C2: a relative contrast index, never a thickness.** `confidence` is always
"low" and there is no field a thickness could go in. Its uses are the ones
`RESEARCH/topics/slick-age-estimation.md` allows: a within-scene relative
descriptor, an optional drift-seeding weight, and a weak look-alike tiebreak
(very weak contrast argues a biogenic film; the console's verdict uses it that
way, `sim/verdict.ts`).

**Averaged in linear power, reported in dB.** sigma-0 in dB is a logarithm;
the mean of logarithms is the logarithm of the geometric mean, which speckle
drags low. So both regions are averaged as power and the ratio is taken last:
`10 log10(mean_inside / mean_annulus)`, negative when the slick is darker.

**What the annulus must not contain** (PHASE-03 failure conditions): land,
other slicks, and no-data. The caller passes them as `exclude`; no-data is
anything non-finite. A region with fewer than `MIN_PIXELS` usable pixels is not
measured, and the result says so rather than returning a number from a handful
of pixels.

The stand-off and annulus widths are this project's choice, not a calibration:
150 m clears a 10 m product's mask-edge uncertainty several times over, and
1 km of sea is enough pixels to average speckle without reaching the next
weather cell.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import numpy as np

DEFAULT_STANDOFF_M = 150.0
DEFAULT_ANNULUS_M = 1000.0
MIN_PIXELS = 30


@dataclass(frozen=True, slots=True)
class Damping:
    """Slick-to-sea contrast. `ratio_db` is None when it could not be measured."""

    ratio_db: float | None
    inside_db: float | None
    annulus_db: float | None
    inside_px: int
    annulus_px: int
    standoff_m: float
    annulus_m: float
    note: str
    #: C2: always "low", and there is deliberately no thickness.
    confidence: Literal["low"] = "low"


def _power_mean_db(values_db: np.ndarray) -> float:
    return float(10.0 * np.log10(np.mean(np.power(10.0, values_db / 10.0))))


def damping_ratio(
    sigma0_db: np.ndarray,
    slick: np.ndarray,
    *,
    pixel_m: float | tuple[float, float],
    exclude: np.ndarray | None = None,
    standoff_m: float = DEFAULT_STANDOFF_M,
    annulus_m: float = DEFAULT_ANNULUS_M,
    min_pixels: int = MIN_PIXELS,
) -> Damping:
    """Contrast of `slick` (a boolean mask on `sigma0_db`'s grid) against clean sea around it.

    `pixel_m` is the pixel size in metres, or (row, column) sizes for a grid in
    degrees, whose pixels are narrower east-west than north-south away from the
    equator. Non-finite pixels are no-data; a SNAP product's exact-zero land
    fill should be passed as NaN or in `exclude`.
    """

    from scipy.ndimage import distance_transform_edt

    image = np.asarray(sigma0_db, dtype=float)
    mask = np.asarray(slick, dtype=bool)
    if image.shape != mask.shape:
        raise ValueError(f"image {image.shape} and mask {mask.shape} differ")
    if exclude is not None and np.shape(exclude) != image.shape:
        raise ValueError(f"exclude {np.shape(exclude)} and image {image.shape} differ")
    sampling = (float(pixel_m), float(pixel_m)) if isinstance(pixel_m, (int, float)) else tuple(map(float, pixel_m))
    if len(sampling) != 2 or not min(sampling) > 0:
        raise ValueError(f"pixel_m must be positive, got {pixel_m}")
    valid = np.isfinite(image)
    blocked = np.zeros_like(mask) if exclude is None else np.asarray(exclude, dtype=bool)

    # Distance from the slick in metres, for every pixel outside it.
    away_m = distance_transform_edt(~mask, sampling=sampling)
    annulus = (away_m > standoff_m) & (away_m <= standoff_m + annulus_m) & ~mask & ~blocked & valid
    inside = mask & valid
    n_in, n_out = int(inside.sum()), int(annulus.sum())

    def refuse(why: str) -> Damping:
        return Damping(None, None, None, n_in, n_out, standoff_m, annulus_m, why)

    if n_in < min_pixels:
        return refuse(f"only {n_in} usable pixels inside the slick (need {min_pixels})")
    if n_out < min_pixels:
        return refuse(f"only {n_out} usable pixels of clean sea in the annulus (need {min_pixels}); "
                      "land, other slicks or the image edge take the rest")
    inside_db = _power_mean_db(image[inside])
    annulus_db = _power_mean_db(image[annulus])
    touching = float(blocked[(away_m > standoff_m) & (away_m <= standoff_m + annulus_m)].mean())
    return Damping(
        ratio_db=inside_db - annulus_db,
        inside_db=inside_db,
        annulus_db=annulus_db,
        inside_px=n_in,
        annulus_px=n_out,
        standoff_m=standoff_m,
        annulus_m=annulus_m,
        note=(f"power means over {n_in} px inside and {n_out} px of sea {standoff_m:.0f}-"
              f"{standoff_m + annulus_m:.0f} m out; {100 * touching:.0f}% of that ring was land, "
              "another slick or excluded; relative contrast only (C2)"),
    )
