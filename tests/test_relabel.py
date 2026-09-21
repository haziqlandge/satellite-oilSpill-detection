"""Binary -> 2-class relabelling assistance.

The thing these tests mostly defend is that the module **proposes** and never
decides. PHASE-01 calls relabelling "the largest hidden cost in the plan" and
"annotation work, not code"; a tool that silently auto-labelled would convert
that cost into a quiet, unreviewed error in the training set.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pytest

from backend.ingest.datasets.relabel import (
    AMBIGUOUS_MARGIN,
    MIN_INSTANCE_PX,
    Proposal,
    analyse_mask,
    binarise,
    export_review,
    load_confirmed,
    propose,
    propose_all,
)


def _linear_streak() -> np.ndarray:
    """A long thin slick -- the OOS morphology."""

    mask = np.zeros((200, 200), dtype=np.uint8)
    mask[98:103, 20:180] = 1
    return mask


def _blob() -> np.ndarray:
    """A round, compact patch -- irregular/unknown morphology."""

    mask = np.zeros((200, 200), dtype=np.uint8)
    rows, cols = np.ogrid[:200, :200]
    mask[((rows - 100) ** 2 + (cols - 100) ** 2) <= 35**2] = 1
    return mask


# --- morphology -------------------------------------------------------------


def test_analyse_finds_one_instance_per_connected_component() -> None:
    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[10:20, 10:40] = 1
    mask[60:70, 60:90] = 1

    assert len(analyse_mask(mask)) == 2


def test_analyse_discards_specks_below_the_floor() -> None:
    """A handful of pixels is speckle, not a slick, and must not be annotated."""

    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[10:20, 10:40] = 1
    mask[80, 80] = 1  # 1 px

    instances = analyse_mask(mask)

    assert len(instances) == 1
    assert instances[0].area_px >= MIN_INSTANCE_PX


def test_a_linear_streak_is_far_more_elongated_than_a_blob() -> None:
    streak = analyse_mask(_linear_streak())[0]
    blob = analyse_mask(_blob())[0]

    assert streak.elongation > 10
    assert blob.elongation == pytest.approx(1.0, abs=0.2)
    assert blob.compactness > streak.compactness


def test_analyse_is_empty_on_an_empty_mask() -> None:
    assert analyse_mask(np.zeros((50, 50), dtype=np.uint8)) == []


# --- proposals --------------------------------------------------------------


def test_linear_and_vessel_adjacent_proposes_oos() -> None:
    """PHASE-01's rule: linear + vessel-adjacent -> oos."""

    streak = analyse_mask(_linear_streak())[0]

    result = propose(streak, bright_targets=[(100.0, 18.0)])

    assert result.proposed_class == "oos"
    assert "elongation" in result.terms
    assert "bright_target_distance_px" in result.terms


def test_an_irregular_blob_proposes_slick_unknown() -> None:
    blob = analyse_mask(_blob())[0]

    result = propose(blob, bright_targets=[])

    assert result.proposed_class == "slick_unknown"


def test_a_linear_streak_with_no_vessel_nearby_is_not_confidently_oos() -> None:
    """Linearity alone is a ship wake as readily as a slick.

    `lookalike-discrimination` calls wakes the most dangerous look-alike
    precisely because they are linear and dark. Without a bright target the
    evidence does not support `oos`, so this must not be asserted confidently.
    """

    streak = analyse_mask(_linear_streak())[0]

    result = propose(streak, bright_targets=[])

    assert result.proposed_class != "oos" or result.needs_review


def test_every_proposal_carries_the_terms_that_produced_it() -> None:
    """C4's principle: never a bare score. The reviewer must see the evidence."""

    for instance in analyse_mask(_linear_streak()):
        result = propose(instance, bright_targets=[(100.0, 18.0)])
        assert result.terms, "proposal has no named terms"
        assert result.reasons, "proposal has no human-readable reasoning"
        assert 0.0 <= result.confidence <= 1.0


def test_a_borderline_instance_is_flagged_for_review() -> None:
    """Near the decision boundary the tool must defer, not guess."""

    mask = np.zeros((200, 200), dtype=np.uint8)
    mask[95:105, 60:140] = 1  # elongation ~8, between the two rules
    instance = analyse_mask(mask)[0]

    result = propose(instance, bright_targets=[])

    assert result.needs_review


def test_propose_all_returns_one_proposal_per_instance() -> None:
    mask = _linear_streak() | _blob()

    results = propose_all(mask, bright_targets=[])

    assert len(results) == len(analyse_mask(mask))
    assert all(isinstance(r, Proposal) for r in results)


def test_ambiguous_margin_is_a_real_band() -> None:
    assert AMBIGUOUS_MARGIN > 0


# --- the human-in-the-loop boundary ----------------------------------------


def test_export_writes_unconfirmed_records(tmp_path: Path) -> None:
    """Everything leaves the tool marked unconfirmed. Nothing self-approves."""

    out = tmp_path / "review.json"
    export_review(propose_all(_linear_streak(), bright_targets=[]), out, source="m.png")

    records = json.loads(out.read_text(encoding="utf-8"))["instances"]

    assert records
    assert all(r["confirmed_class"] is None for r in records)
    assert all(r["confirmed_by"] is None for r in records)


def test_load_confirmed_ignores_unreviewed_rows(tmp_path: Path) -> None:
    """A file nobody reviewed must yield no labels, not the proposals."""

    out = tmp_path / "review.json"
    export_review(propose_all(_linear_streak(), bright_targets=[]), out, source="m.png")

    assert load_confirmed(out) == {}


@pytest.mark.parametrize("problem", ["blank_reviewer", "duplicate_id", "wrong_scheme"])
def test_invalid_review_metadata_is_rejected(tmp_path: Path, problem: str) -> None:
    out = tmp_path / "review.json"
    export_review(propose_all(_linear_streak()), out, source="source")
    document = json.loads(out.read_text())
    document["instances"][0].update(confirmed_class="oos", confirmed_by="analyst")
    if problem == "blank_reviewer":
        document["instances"][0]["confirmed_by"] = "  "
    elif problem == "duplicate_id":
        document["instances"].append(dict(document["instances"][0]))
    else:
        document["class_scheme"].reverse()
    out.write_text(json.dumps(document))
    with pytest.raises(ValueError):
        load_confirmed(out)


def test_dataset_import_requires_attributed_unchanged_sources(tmp_path: Path) -> None:
    import hashlib

    from ml.datasets.oos_dataset import DatasetError, SourceImage
    from scripts.build_dataset import load_reviews

    image = tmp_path / "image.bin"
    mask = tmp_path / "mask.bin"
    image.write_bytes(b"original image")
    mask.write_bytes(b"original mask")
    reviews = tmp_path / "reviews"
    out = reviews / "source.json"
    export_review(propose_all(_linear_streak()), out, source="source")
    document = json.loads(out.read_text())
    document.update(
        image_sha256=hashlib.sha256(image.read_bytes()).hexdigest(),
        mask_sha256=hashlib.sha256(mask.read_bytes()).hexdigest(),
    )
    out.write_text(json.dumps(document))
    sources = [SourceImage(identity="source", image=image, mask=mask)]
    with pytest.raises(DatasetError, match="No human-confirmed"):
        load_reviews(reviews, sources)
    document["instances"][0].update(confirmed_class="slick_unknown", confirmed_by="analyst")
    out.write_text(json.dumps(document))
    assert load_reviews(reviews, sources) == {"source": {1: "slick_unknown"}}
    mask.write_bytes(b"edited mask")
    with pytest.raises(DatasetError, match="mask hash mismatch"):
        load_reviews(reviews, sources)


def test_load_confirmed_returns_only_human_confirmed_labels(tmp_path: Path) -> None:
    out = tmp_path / "review.json"
    export_review(propose_all(_linear_streak(), bright_targets=[]), out, source="m.png")

    document = json.loads(out.read_text(encoding="utf-8"))
    document["instances"][0]["confirmed_class"] = "oos"
    document["instances"][0]["confirmed_by"] = "analyst"
    out.write_text(json.dumps(document), encoding="utf-8")

    assert load_confirmed(out) == {document["instances"][0]["label"]: "oos"}


def test_load_confirmed_rejects_a_class_outside_the_scheme(tmp_path: Path) -> None:
    """The weights manifest declares two classes; a third would corrupt training."""

    out = tmp_path / "review.json"
    export_review(propose_all(_linear_streak(), bright_targets=[]), out, source="m.png")

    document = json.loads(out.read_text(encoding="utf-8"))
    document["instances"][0]["confirmed_class"] = "oil_probably"
    document["instances"][0]["confirmed_by"] = "analyst"
    out.write_text(json.dumps(document), encoding="utf-8")

    with pytest.raises(ValueError, match="oil_probably"):
        load_confirmed(out)


def test_confirmation_requires_an_attributed_reviewer(tmp_path: Path) -> None:
    """A label with no reviewer is indistinguishable from an auto-label."""

    out = tmp_path / "review.json"
    export_review(propose_all(_linear_streak(), bright_targets=[]), out, source="m.png")

    document = json.loads(out.read_text(encoding="utf-8"))
    document["instances"][0]["confirmed_class"] = "oos"  # no confirmed_by
    out.write_text(json.dumps(document), encoding="utf-8")

    with pytest.raises(ValueError, match="confirmed_by"):
        load_confirmed(out)


# --- real-world mask encoding ------------------------------------------------
# Both of these were found by running the module against the actual Refined SOS
# masks (Zenodo 15298010) on 2026-08-30, not by reasoning about the format.


def test_lossy_compression_halo_does_not_merge_distinct_instances() -> None:
    """11 of 40 real masks carry a compression halo of intermediate values.

    Thresholding at `> 0` swallows that halo, and because it sits *between*
    nearby slicks it bridges them into a single instance -- on the real data
    that merged 47 true instances down to 43. For an instance-segmentation
    ground truth, silently merging two slicks is a corrupted label.
    """

    mask = np.zeros((60, 200), dtype=np.uint8)
    mask[25:35, 20:80] = 255
    mask[25:35, 120:180] = 255
    mask[28:32, 80:120] = 7  # halo bridging the two, as JPEG ringing does

    assert len(analyse_mask(mask)) == 2


def test_a_zero_one_mask_is_not_thresholded_away() -> None:
    """Masks encoded {0,1} are as common as {0,255}; a fixed 128 would empty them."""

    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[10:40, 10:60] = 1

    instances = analyse_mask(mask)

    assert len(instances) == 1
    assert instances[0].area_px == 30 * 50


def test_an_rgb_mask_is_read_as_one_plane() -> None:
    """The Refined SOS masks are RGB with three identical channels.

    Passed through as 3-D, `label(..., connectivity=2)` treats the array as a
    volume and the measurements are meaningless.
    """

    plane = np.zeros((80, 80), dtype=np.uint8)
    plane[20:50, 20:60] = 255
    rgb = np.stack([plane] * 3, axis=-1)

    assert analyse_mask(rgb) == analyse_mask(plane)


def test_an_explicit_threshold_is_honoured() -> None:
    mask = np.zeros((60, 60), dtype=np.uint8)
    mask[10:30, 10:40] = 200

    assert analyse_mask(mask, threshold=250) == []
    assert len(analyse_mask(mask, threshold=150)) == 1


def test_a_boolean_mask_is_used_as_given() -> None:
    mask = np.zeros((60, 60), dtype=bool)
    mask[10:30, 10:40] = True

    assert len(analyse_mask(mask)) == 1


# --- channel order -------------------------------------------------------
#
# Found on 2026-08-31 against the real Zenodo Part I masks (record 8346860),
# which are single-band 2048x2048 GeoTIFF and `{0, 1}`-encoded -- a different
# encoding from the Refined SOS PNGs (256x256x3, `{0, 255}`) the module was
# first written against. `rasterio.open(...).read()` returns **(bands, H, W)**,
# channel FIRST, where PIL and imageio return **(H, W, channels)**, channel
# LAST. Taking `array[..., 0]` unconditionally reduced a (1, 2048, 2048) mask
# to (1, 2048) and lost every foreground pixel, with no exception raised.


def test_binarise_accepts_a_band_first_mask() -> None:
    """`rasterio.read()` gives (bands, H, W); the slick must survive it.

    This is the exact call PHASE-02 dataset assembly makes when it loads a
    Part I mask. Before the channel-order fix this returned a (1, 2048)
    array containing no foreground at all.
    """

    plane = np.zeros((80, 80), dtype=np.uint8)
    plane[20:50, 20:60] = 1

    band_first = plane[np.newaxis, ...]  # (1, 80, 80), as rasterio returns

    result = binarise(band_first)
    assert result.shape == plane.shape
    assert int(result.sum()) == int((plane > 0).sum()) > 0


def test_binarise_accepts_a_channel_last_rgb_mask() -> None:
    """The Refined SOS layout (H, W, 3) must keep working."""

    plane = np.zeros((80, 80), dtype=np.uint8)
    plane[20:50, 20:60] = 255

    channel_last = np.stack([plane] * 3, axis=-1)  # (80, 80, 3)

    result = binarise(channel_last)
    assert result.shape == plane.shape
    assert int(result.sum()) == int((plane > 0).sum()) > 0


def test_binarise_rejects_an_ambiguous_three_dimensional_mask() -> None:
    """Both axes look like channels: refuse rather than guess.

    Guessing here would silently transpose a label. The caller knows the
    layout and can pass a 2-D array.
    """

    with pytest.raises(ValueError, match="ambiguous"):
        binarise(np.ones((3, 3, 3), dtype=np.uint8))


def test_analyse_mask_agrees_across_channel_orders() -> None:
    """The same slick measured three ways must give the same instances."""

    plane = np.zeros((80, 80), dtype=np.uint8)
    plane[20:50, 20:60] = 1

    assert analyse_mask(plane[np.newaxis, ...]) == analyse_mask(plane)
    assert analyse_mask(np.stack([plane] * 3, axis=-1)) == analyse_mask(plane)
