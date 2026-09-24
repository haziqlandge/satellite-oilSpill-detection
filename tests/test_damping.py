"""The damping ratio (PHASE-03, C2): relative contrast only, from clean sea."""

from __future__ import annotations

import dataclasses

import numpy as np
import pytest

from backend.characterize.damping import Damping, damping_ratio

PIXEL_M = 10.0


def scene(sea_db: float = -8.0, slick_db: float = -14.0, size: int = 400):
    """A calm sea with one rectangular slick in the middle."""
    image = np.full((size, size), sea_db)
    slick = np.zeros((size, size), dtype=bool)
    slick[180:220, 100:300] = True
    image[slick] = slick_db
    return image, slick


def test_contrast_is_slick_minus_sea_in_db():
    image, slick = scene()
    d = damping_ratio(image, slick, pixel_m=PIXEL_M)
    assert d.ratio_db == pytest.approx(-6.0, abs=1e-9)
    assert d.inside_db == pytest.approx(-14.0) and d.annulus_db == pytest.approx(-8.0)
    assert d.confidence == "low"


def test_averages_in_power_not_in_db():
    image, slick = scene()
    image[slick] = np.where(np.arange(slick.sum()) % 2 == 0, -10.0, -20.0)
    d = damping_ratio(image, slick, pixel_m=PIXEL_M)
    assert d.inside_db == pytest.approx(10 * np.log10((0.1 + 0.01) / 2))  # -12.6 dB, not -15


def test_speckle_does_not_bias_the_ratio():
    rng = np.random.default_rng(7)
    image, slick = scene()
    # Single-look speckle is exponential in power.
    power = np.power(10.0, image / 10.0) * rng.exponential(1.0, image.shape)
    d = damping_ratio(10 * np.log10(power), slick, pixel_m=PIXEL_M)
    assert d.ratio_db == pytest.approx(-6.0, abs=0.2)


def test_standoff_skips_the_boundary_gradient():
    image, slick = scene()
    from scipy.ndimage import binary_dilation

    edge = binary_dilation(slick, iterations=8) & ~slick  # 80 m of blur at -11 dB
    image[edge] = -11.0
    assert damping_ratio(image, slick, pixel_m=PIXEL_M, standoff_m=100).ratio_db == pytest.approx(-6.0)
    assert damping_ratio(image, slick, pixel_m=PIXEL_M, standoff_m=0).ratio_db > -6.0


def test_land_and_other_slicks_are_kept_out_of_the_annulus():
    image, slick = scene()
    land = np.zeros_like(slick)
    land[:, :60] = True
    image[land] = 5.0  # bright land
    other = np.zeros_like(slick)
    other[240:260, 120:280] = True
    image[other] = -15.0
    excluded = damping_ratio(image, slick, pixel_m=PIXEL_M, exclude=land | other)
    assert excluded.ratio_db == pytest.approx(-6.0)
    assert "land, another slick or excluded" in excluded.note
    polluted = damping_ratio(image, slick, pixel_m=PIXEL_M)
    assert polluted.ratio_db != pytest.approx(-6.0)


def test_no_data_is_ignored():
    image, slick = scene()
    image[:, 250:] = np.nan
    d = damping_ratio(image, slick, pixel_m=PIXEL_M)
    assert d.ratio_db == pytest.approx(-6.0)


def test_too_little_to_measure_is_said_not_guessed():
    image, slick = scene()
    tiny = np.zeros_like(slick)
    tiny[200, 200] = True
    d = damping_ratio(image, tiny, pixel_m=PIXEL_M)
    assert d.ratio_db is None and "inside the slick" in d.note
    boxed_in = damping_ratio(image, slick, pixel_m=PIXEL_M, exclude=~slick)
    assert boxed_in.ratio_db is None and "annulus" in boxed_in.note
    assert boxed_in.confidence == "low"


def test_pixels_in_degrees_take_row_and_column_sizes():
    image, slick = scene()
    # At 28N a 1/11132 degree pixel is ~10 m north-south and ~8.8 m east-west.
    d = damping_ratio(image, slick, pixel_m=(10.0, 8.8))
    assert d.ratio_db == pytest.approx(-6.0)
    with pytest.raises(ValueError):
        damping_ratio(image, slick, pixel_m=(10.0, 0.0))
    with pytest.raises(ValueError):
        damping_ratio(image, slick[:10], pixel_m=10.0)


def test_there_is_nowhere_to_put_a_thickness():
    # C2 is structural: a relative index, never microns.
    names = {f.name for f in dataclasses.fields(Damping)}
    assert not any("thick" in n or "micron" in n or "volume" in n for n in names)
