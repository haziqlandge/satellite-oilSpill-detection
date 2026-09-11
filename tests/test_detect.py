"""CFAR bright-target detection (PHASE-02).

The single most important thing here is `test_running_on_db_as_if_linear_is_
catastrophic`. CA-CFAR's threshold is derived from an exponential clutter model
that holds for sigma0 in **linear power** and not for its logarithm — and our
products are dB, because the SNAP chain ends in `LinearToFromdB`. Feeding dB
straight in does not degrade gracefully: it flags the entire image. That failure
is loud in a test and would be quiet in a pipeline, where it would surface as
"the relabeller thinks every instance is vessel-adjacent".

The rest pin the calibration, because a CFAR whose false-alarm rate does not
match the rate it was asked for is a threshold chosen by accident:

    pfa = 1e-4 over 360,000 pure-sea cells -> 32 observed, ~36 expected
    pfa = 1e-6 over 360,000 pure-sea cells ->  0 observed, ~0.36 expected
"""

from __future__ import annotations

import numpy as np
import pytest

from backend.detect.cfar.detector import (
    DEFAULT_PFA,
    BrightTarget,
    CfarError,
    ca_cfar_mask,
    cfar_alpha,
    db_to_linear,
    detect_bright_targets,
)

SEA_SCALE = 10 ** (-2.5)  # ~-25 dB mean, a plausible ocean sigma0


def _sea(shape=(400, 400), seed: int = 0) -> np.ndarray:
    """Exponential power (Rayleigh amplitude) sea clutter, expressed in dB."""

    rng = np.random.default_rng(seed)
    return 10 * np.log10(rng.exponential(scale=SEA_SCALE, size=shape))


def _with_targets(boosts_db, *, patch: int = 5, seed: int = 0):
    scene = _sea(seed=seed)
    spots = []
    for index, boost in enumerate(boosts_db):
        row, col = 80 + index * 70, 90 + index * 60
        scene[row : row + patch, col : col + patch] += boost
        spots.append((row + patch // 2, col + patch // 2))
    return scene, spots


def _found_near(targets, row, col, tolerance: int = 3) -> bool:
    return any(abs(t.row - row) <= tolerance and abs(t.col - col) <= tolerance for t in targets)


# --- the dB trap -----------------------------------------------------------


def test_running_on_db_as_if_linear_is_catastrophic() -> None:
    """The reason `input_db` defaults to True.

    dB values over the ocean are large and negative. The exponential clutter
    model breaks completely, and the detector flags essentially every cell
    rather than failing in a way anyone would notice.
    """

    scene = _sea()

    correct = ca_cfar_mask(scene, pfa=DEFAULT_PFA, input_db=True).sum()
    wrong = ca_cfar_mask(scene, pfa=DEFAULT_PFA, input_db=False).sum()

    assert correct < 100
    assert wrong > 0.9 * scene.size, "treating dB as power should flag nearly everything"


def test_db_to_linear_inverts_the_decibel_definition() -> None:
    assert db_to_linear(np.array([0.0])) == pytest.approx(1.0)
    assert db_to_linear(np.array([-10.0])) == pytest.approx(0.1)
    assert db_to_linear(np.array([-20.0])) == pytest.approx(0.01)


# --- the threshold is derived, not tuned -----------------------------------


def test_alpha_follows_the_false_alarm_rate() -> None:
    """`alpha = n * (pfa ** (-1/n) - 1)`, so a stricter rate raises the bar."""

    assert cfar_alpha(200, 1e-4) < cfar_alpha(200, 1e-6) < cfar_alpha(200, 1e-8)


def test_alpha_is_about_twelve_decibels_for_the_default_geometry() -> None:
    """Sanity: the default asks a target to stand ~11.6 dB above its background."""

    assert 10 * np.log10(cfar_alpha(200, DEFAULT_PFA)) == pytest.approx(11.6, abs=1.0)


def test_an_impossible_false_alarm_rate_is_refused() -> None:
    with pytest.raises(CfarError, match="pfa must be"):
        cfar_alpha(100, 1.5)
    with pytest.raises(CfarError, match="pfa must be"):
        cfar_alpha(100, 0.0)


def test_zero_training_cells_is_refused() -> None:
    with pytest.raises(CfarError, match="at least one training cell"):
        cfar_alpha(0)


# --- calibration ------------------------------------------------------------


def test_the_false_alarm_rate_matches_what_was_asked_for() -> None:
    """A CFAR whose rate does not match its `pfa` has a threshold set by accident.

    Order-of-magnitude, not exact: the model is asymptotic and the training
    count varies at the border.
    """

    pure = _sea((600, 600), seed=1)
    expected = pure.size * 1e-4

    observed = ca_cfar_mask(pure, pfa=1e-4).sum()

    assert 0.2 * expected < observed < 5 * expected, f"{observed} vs ~{expected:.0f}"


def test_a_stricter_rate_flags_strictly_fewer_cells() -> None:
    pure = _sea((300, 300), seed=2)

    assert ca_cfar_mask(pure, pfa=1e-8).sum() <= ca_cfar_mask(pure, pfa=1e-4).sum()


# --- detection --------------------------------------------------------------


def test_targets_above_the_threshold_are_found_and_below_are_not() -> None:
    """Detection tracks the derived threshold rather than being tuned to a case."""

    scene, spots = _with_targets([25.0, 20.0, 15.0, 10.0, 5.0])
    targets = detect_bright_targets(scene, pfa=DEFAULT_PFA)

    for (row, col), boost in zip(spots, [25.0, 20.0, 15.0], strict=False):
        assert _found_near(targets, row, col), f"+{boost:.0f} dB target should be found"
    for (row, col), boost in zip(spots[3:], [10.0, 5.0], strict=False):
        assert not _found_near(targets, row, col), f"+{boost:.0f} dB is below threshold"


def test_an_empty_sea_yields_no_targets() -> None:
    assert detect_bright_targets(_sea((200, 200), seed=3), pfa=1e-10) == []


def test_targets_are_returned_brightest_first() -> None:
    """PHASE-06 wants the strongest candidates first."""

    scene, _ = _with_targets([25.0, 18.0, 15.0])
    peaks = [t.peak_linear for t in detect_bright_targets(scene)]

    assert peaks == sorted(peaks, reverse=True)


def test_speckle_below_the_area_floor_is_dropped() -> None:
    """A single bright pixel is speckle, not a vessel."""

    scene = _sea(seed=4)
    scene[200, 200] += 40.0  # one very bright pixel

    assert not _found_near(detect_bright_targets(scene, min_area_px=4), 200, 200)
    assert _found_near(detect_bright_targets(scene, min_area_px=1), 200, 200)


# --- land, and the self-masking trap ---------------------------------------


def test_land_zeros_are_excluded_from_the_background() -> None:
    """SNAP writes exact zeros over land; zero is 'not sea', not 'very dark sea'.

    Including land in the training ring would inflate the local background and
    blind the detector to vessels near shore -- which is where they are.
    """

    scene = _sea(seed=5)
    scene[:, :200] = 0.0  # left half is land
    scene[100:105, 300:305] += 20.0  # a ship well out at sea

    targets = detect_bright_targets(scene)

    assert _found_near(targets, 102, 302)
    assert all(t.col >= 200 for t in targets), "nothing should be detected on land"


def test_a_large_target_self_masks_unless_the_guard_ring_is_widened() -> None:
    """The classic CFAR failure, and a real limit of the default geometry.

    A target wider than its guard ring reaches into its own training annulus,
    raises its own background estimate and drops below the threshold -- so the
    *largest* targets are the ones that vanish. Measured here: a 20x20 px target
    is masked at guard 4 and 8, and found at 15.

    This is not academic. **P004 Case 1's target is a platform group**, and
    infrastructure is exactly the large, bright, extended thing this fails on.
    Hunting infrastructure means widening the guard.
    """

    scene = _sea(seed=6)
    scene[190:210, 190:210] += 20.0  # a 20x20 px platform-scale target

    assert not _found_near(detect_bright_targets(scene, guard_px=4), 199, 199, tolerance=8)
    assert _found_near(detect_bright_targets(scene, guard_px=15), 199, 199, tolerance=8)


def test_a_vessel_scale_target_is_found_with_the_default_guard() -> None:
    """The default geometry must still work for what it is sized for."""

    scene = _sea(seed=7)
    scene[200:210, 200:210] += 20.0  # 10x10 px, ~100 m at 10 m pixels

    assert _found_near(detect_bright_targets(scene), 204, 204, tolerance=6)


# --- the contract the relabeller depends on --------------------------------


def test_centroid_rc_is_what_relabel_expects() -> None:
    """`relabel.propose` takes `bright_targets` as `(row, col)` pairs.

    Handing it `(col, row)` would produce plausible distances that are wrong,
    and the proposals would be confidently mislabelled.
    """

    target = BrightTarget(row=12.5, col=340.0, area_px=9, peak_linear=1.0, mean_linear=0.5)

    assert target.centroid_rc == (12.5, 340.0)


def test_cfar_output_feeds_the_relabeller() -> None:
    """The integration that unblocks PHASE-01's relabelling pass.

    Without bright targets `relabel` cannot propose `oos` at all -- a ship wake
    and an operational discharge are both linear and dark, so shape alone
    cannot separate them.
    """

    from backend.ingest.datasets.relabel import analyse_mask, propose

    scene, spots = _with_targets([25.0])
    targets = detect_bright_targets(scene)
    assert targets

    mask = np.zeros((400, 400), dtype=np.uint8)
    row, col = spots[0]
    mask[row - 1 : row + 2, col - 40 : col + 40] = 1  # a linear slick beside it

    (instance,) = analyse_mask(mask)
    proposal = propose(instance, bright_targets=[t.centroid_rc for t in targets])

    assert proposal.terms["bright_target_distance_px"] >= 0


def test_a_non_two_dimensional_image_is_refused() -> None:
    with pytest.raises(CfarError, match="2-D image"):
        ca_cfar_mask(np.zeros((4, 4, 3)))


def test_the_scene_band_matches_what_the_dataset_trains_on() -> None:
    """Detector and dataset must look at the same polarisation.

    Measured twice on independent data: band 1 (VH) gives 0.51-0.60 dB of slick
    contrast against band 2's (VV) 6.21-7.01, and on the real Case 1 scene band
    2 found 8 targets at 34.4 dB against band 1's 6 at 14.8. Disagreeing here
    would mean CFAR hunting vessels in one polarisation while the segmentation
    model was trained in another.
    """

    from backend.detect.cfar.detector import SCENE_BAND
    from ml.datasets.oos_dataset import SAR_BAND

    assert SCENE_BAND == SAR_BAND == 2
