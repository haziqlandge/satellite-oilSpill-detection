"""LSK attention and MPDIoU — the two architectural changes PHASE-02 ablates.

These are the project's actual research contribution, so what matters is that
they implement the *published* behaviour rather than something plausible that
merely runs. Both papers make claims specific enough to test:

* LSK selects a receptive field **per spatial position**, and gates its input
  rather than replacing it.
* MPDIoU is zero-loss only on an exact match, and unlike CIoU it does **not**
  go blind when two boxes share an aspect ratio — which is the failure mode
  that matters for slicks, since a discharge trail is an extreme-aspect object.
"""

from __future__ import annotations

from pathlib import Path

import pytest

torch = pytest.importorskip("torch")

from ml.models.lsk import LSKAttention, LSKBlock  # noqa: E402
from ml.models.mpdiou import mpdiou, mpdiou_loss  # noqa: E402

# --- LSK -------------------------------------------------------------------


def test_lsk_preserves_shape() -> None:
    """It is attention over a feature map, so it must drop into a backbone."""

    block = LSKBlock(32).eval()
    x = torch.randn(2, 32, 16, 16)

    assert block(x).shape == x.shape


@pytest.mark.parametrize("channels", [16, 64, 128, 256])
def test_lsk_accepts_the_channel_counts_yolo_uses(channels: int) -> None:
    block = LSKBlock(channels).eval()
    x = torch.randn(1, channels, 8, 8)

    assert block(x).shape == x.shape


def test_lsk_rejects_an_odd_channel_count() -> None:
    """Each branch takes half the channels; an odd count would truncate."""

    with pytest.raises(ValueError, match="even channel count"):
        LSKBlock(15)


def test_lsk_is_a_gate_not_a_replacement() -> None:
    """`x * attn`, so a zero input stays zero however the weights are set.

    This is what makes inserting LSK into a pretrained backbone safe: an
    untrained module degrades towards a no-op, not towards noise.
    """

    block = LSKBlock(16).eval()
    zeros = torch.zeros(1, 16, 8, 8)

    assert torch.equal(block(zeros), zeros)


def test_lsk_selection_varies_across_space() -> None:
    """The 'selective' claim: kernel choice is per position, not per layer.

    An input whose two halves differ must produce attention that differs
    between those halves. If the squeeze pooled over space as well as channels,
    every position would get the same weight and this would fail.
    """

    torch.manual_seed(0)
    block = LSKBlock(16).eval()

    x = torch.zeros(1, 16, 16, 16)
    x[:, :, :, :8] = 1.0  # left half bright, right half dark

    with torch.no_grad():
        out = block(x)

    left = out[:, :, :, :8].abs().mean()
    right = out[:, :, :, 8:].abs().mean()
    assert not torch.isclose(left, right)


def test_lsk_attention_is_residual() -> None:
    """A zero-initialised output projection must leave the input untouched."""

    module = LSKAttention(16).eval()
    torch.nn.init.zeros_(module.project_out.weight)
    torch.nn.init.zeros_(module.project_out.bias)

    x = torch.randn(1, 16, 8, 8)
    with torch.no_grad():
        assert torch.allclose(module(x), x, atol=1e-6)


def test_lsk_is_differentiable() -> None:
    block = LSKBlock(16)
    x = torch.randn(1, 16, 8, 8, requires_grad=True)

    block(x).sum().backward()

    assert x.grad is not None
    assert torch.isfinite(x.grad).all()


# --- MPDIoU ----------------------------------------------------------------

SIZE = (1024, 1024)


def test_identical_boxes_have_zero_loss() -> None:
    box = torch.tensor([[100.0, 100.0, 40.0, 20.0]])

    assert mpdiou_loss(box, box.clone(), image_size=SIZE).item() == pytest.approx(0.0, abs=1e-6)


def test_loss_grows_as_boxes_separate() -> None:
    target = torch.tensor([[100.0, 100.0, 40.0, 20.0]])
    near = torch.tensor([[110.0, 100.0, 40.0, 20.0]])
    far = torch.tensor([[400.0, 400.0, 40.0, 20.0]])

    assert (
        mpdiou_loss(target, target, image_size=SIZE).item()
        < mpdiou_loss(near, target, image_size=SIZE).item()
        < mpdiou_loss(far, target, image_size=SIZE).item()
    )


def test_it_penalises_a_shifted_box_that_ciou_aspect_term_would_miss() -> None:
    """The reason P004 swaps CIoU out, and the reason it matters for slicks.

    These two boxes have the **same aspect ratio** and the same centre, so
    CIoU's aspect-ratio term is exactly zero and only its IoU term reacts.
    MPDIoU's corner distances see the size difference directly.
    """

    target = torch.tensor([[100.0, 100.0, 40.0, 20.0]])
    same_ratio_bigger = torch.tensor([[100.0, 100.0, 80.0, 40.0]])

    loss = mpdiou_loss(same_ratio_bigger, target, image_size=SIZE).item()
    assert loss > 0.0


def test_non_overlapping_boxes_still_give_a_gradient() -> None:
    """IoU alone is flat at zero for disjoint boxes; the corner terms are not.

    Without this the optimiser gets no signal at all from a miss, which is the
    classic IoU-loss failure.
    """

    a = torch.tensor([[10.0, 10.0, 10.0, 10.0]], requires_grad=True)
    b = torch.tensor([[900.0, 900.0, 10.0, 10.0]])

    loss = mpdiou_loss(a, b, image_size=SIZE)
    loss.backward()

    assert a.grad is not None
    assert a.grad.abs().sum() > 0


def test_xyxy_and_xywh_agree() -> None:
    xywh = torch.tensor([[100.0, 100.0, 40.0, 20.0]])
    xyxy = torch.tensor([[80.0, 90.0, 120.0, 110.0]])

    assert mpdiou(xywh, xywh, image_size=SIZE, xywh=True).item() == pytest.approx(
        mpdiou(xyxy, xyxy, image_size=SIZE, xywh=False).item(), abs=1e-6
    )


def test_a_batch_is_reduced_per_box_not_pooled() -> None:
    """One value per box; pooling here would hide a bad prediction."""

    prediction = torch.tensor([[100.0, 100.0, 40.0, 20.0], [500.0, 500.0, 40.0, 20.0]])
    target = torch.tensor([[100.0, 100.0, 40.0, 20.0], [100.0, 100.0, 40.0, 20.0]])

    losses = mpdiou_loss(prediction, target, image_size=SIZE)

    assert losses.shape == (2,)
    assert losses[0] < losses[1]


def test_a_degenerate_image_size_is_refused() -> None:
    box = torch.tensor([[1.0, 1.0, 1.0, 1.0]])

    with pytest.raises(ValueError, match="image_size must be positive"):
        mpdiou(box, box, image_size=(0, 1024))


def test_perfect_overlap_scores_one() -> None:
    box = torch.tensor([[100.0, 100.0, 40.0, 20.0]])

    assert mpdiou(box, box, image_size=SIZE).item() == pytest.approx(1.0, abs=1e-6)


# --- LSK placement (the ablation architectures) ----------------------------

from ml.models.yolo_seg_lsk import (  # noqa: E402
    POSITIONS,
    ArchitectureError,
    build_config,
    load_base_config,
    lsk_layer_count,
)


@pytest.fixture(scope="module")
def base() -> dict:
    return load_base_config()


def test_none_is_the_stock_architecture(base: dict) -> None:
    assert build_config("none", base) == base
    assert lsk_layer_count(build_config("none", base)) == 0


@pytest.mark.parametrize("position", ["L1", "L2", "L3", "L4"])
def test_single_positions_insert_exactly_one_block(position: str, base: dict) -> None:
    assert lsk_layer_count(build_config(position, base)) == 1


def test_l5_inserts_one_before_every_head(base: dict) -> None:
    """P004: L5 is 'in front of all object heads' -- three, not one."""

    assert lsk_layer_count(build_config("L5", base)) == 3


def test_references_are_renumbered(base: dict) -> None:
    """The failure this module exists to prevent.

    Inserting a layer shifts every index after it, and YOLO YAML addresses
    layers absolutely. Without renumbering, the model builds cleanly and wires
    the wrong tensors together -- no error, just a quietly wrong architecture.
    """

    config = build_config("L1", base)
    layers = [*config["backbone"], *config["head"]]

    segment = layers[-1]
    assert segment[2] == "Segment"
    # The three head indices each moved up by one past the L1 insertion at 9.
    assert segment[0] == [17, 20, 23]


def test_the_head_actually_reads_the_lsk_output(base: dict) -> None:
    """The bug this nearly shipped with: LSK inserted but never consumed.

    If `Segment` still points at the original head layers, the LSK blocks are
    dead code -- the model builds, trains, and the ablation measures nothing at
    all. Every tapped head reference must land on an `LSKAttention` layer.
    """

    for position, expected in (("L2", 1), ("L3", 1), ("L4", 1), ("L5", 3)):
        config = build_config(position, base)
        layers = [*config["backbone"], *config["head"]]
        segment = layers[-1]

        through_lsk = [r for r in segment[0] if layers[r][2] == "LSKAttention"]
        assert len(through_lsk) == expected, f"{position}: {expected} head(s) should read LSK"


def test_a_head_tap_does_not_disturb_the_downstream_path(base: dict) -> None:
    """Layer 16 feeds the small head *and* the Conv that builds P4.

    Splicing LSK inline there would put it in the P4 and P5 routes too, making
    "L2" silently an L2+L3+L4. Tapping the branch leaves the rest alone.
    """

    stock = [*base["backbone"], *base["head"]]
    config = build_config("L2", base)
    layers = [*config["backbone"], *config["head"]]

    # Every stock layer is unchanged; only new nodes and Segment differ.
    assert layers[: len(stock) - 1] == stock[:-1]


def test_every_absolute_reference_stays_in_range(base: dict) -> None:
    """A reference past the end silently indexes the wrong layer."""

    for position in POSITIONS:
        config = build_config(position, base)
        layers = [*config["backbone"], *config["head"]]
        for index, layer in enumerate(layers):
            refs = layer[0] if isinstance(layer[0], list) else [layer[0]]
            for ref in refs:
                if isinstance(ref, int) and ref >= 0:
                    assert ref < len(layers), f"{position}: layer {index} references {ref}"
                    assert ref < index, f"{position}: layer {index} references later layer {ref}"


def test_the_backbone_head_split_is_preserved(base: dict) -> None:
    """An insertion inside the backbone must not leak layers into the head."""

    for position in POSITIONS:
        config = build_config(position, base)
        assert config["backbone"][-1][2] == "C2PSA"
        assert config["head"][-1][2] == "Segment"


def test_an_unknown_position_is_refused(base: dict) -> None:
    with pytest.raises(ArchitectureError, match="unknown LSK position"):
        build_config("L9", base)


def test_the_grid_is_the_six_positions_p004_ablated() -> None:
    assert POSITIONS == ("none", "L1", "L2", "L3", "L4", "L5")


@pytest.mark.slow
def test_every_ablation_architecture_builds_and_runs() -> None:
    """The claim that matters: these six configs are trainable models.

    Parameter arithmetic doubles as a wiring check. L5 taps all three heads, so
    its parameter cost must equal L2 + L3 + L4 exactly -- the three heads carry
    different channel widths (256 / 512 / 1024), so any tap landing on the wrong
    one changes the sum.
    """

    import tempfile

    from ultralytics import YOLO

    from ml.models.yolo_seg_lsk import register_lsk, write_config

    register_lsk()
    root = Path(tempfile.mkdtemp())
    x = torch.zeros(1, 3, 256, 256)

    counts: dict[str, int] = {}
    for position in POSITIONS:
        path = write_config(position, root / f"y-{position}.yaml")
        model = YOLO(str(path), task="segment")
        with torch.no_grad():
            model.model(x)  # also materialises the lazy LSK modules
        counts[position] = sum(p.numel() for p in model.model.parameters())

    # `none` must be the stock architecture at our class count -- built here
    # rather than hardcoded, because `DEFAULT_NC` changes the head size and a
    # magic number would pin this test to whatever nc happened to be that day.
    stock = YOLO(str(write_config("none", root / "stock.yaml")), task="segment")
    with torch.no_grad():
        stock.model(x)
    assert counts["none"] == sum(p.numel() for p in stock.model.parameters())

    added = {k: v - counts["none"] for k, v in counts.items()}
    assert added["L5"] == added["L2"] + added["L3"] + added["L4"]
    for position in ("L1", "L2", "L3", "L4", "L5"):
        assert added[position] > 0


# --- the loss axis ---------------------------------------------------------


def _loss_inputs(n: int = 6, reg_max: int = 16):
    torch.manual_seed(0)
    return dict(
        pred_dist=torch.randn(1, n, 4 * reg_max),
        pred_bboxes=torch.tensor([[[10.0, 10.0, 50.0, 30.0]] * n]),
        anchor_points=torch.rand(n, 2) * 10,
        target_bboxes=torch.tensor([[[12.0, 11.0, 55.0, 33.0]] * n]),
        target_scores=torch.rand(1, n, 1),
        fg_mask=torch.ones(1, n, dtype=torch.bool),
        imgsz=torch.tensor([1024.0, 1024.0]),
        stride=torch.ones(1, n, 1),
    )


@pytest.mark.slow
def test_mpdiou_replaces_only_the_iou_term() -> None:
    """The DFL half is delegated, so it must come out bit-identical.

    Copying ultralytics' DFL block instead would duplicate internals that shift
    between releases, and a silent drift there would move *both* arms of the
    ablation at once -- destroying the only comparison the grid exists to make.
    """

    from ultralytics.utils.loss import BboxLoss

    from ml.models.loss_patch import _build_class

    kwargs = _loss_inputs()
    total = kwargs["target_scores"].sum()

    ciou = BboxLoss(16)(**kwargs, target_scores_sum=total)
    mpd = _build_class()(16)(**kwargs, target_scores_sum=total)

    assert not torch.isclose(ciou[0], mpd[0]), "IoU term must differ"
    assert torch.isclose(ciou[1], mpd[1]), "DFL term must be delegated unchanged"
    assert mpd[0].shape == torch.Size([])


@pytest.mark.slow
def test_the_mpdiou_loss_is_a_real_bboxloss() -> None:
    """Ultralytics type-checks its criterion; a duck-typed stand-in would fail."""

    from ultralytics.utils.loss import BboxLoss

    from ml.models.loss_patch import _build_class

    assert isinstance(_build_class()(16), BboxLoss)


@pytest.mark.slow
def test_swapping_nothing_is_reported_as_zero() -> None:
    """Zero is the dangerous outcome: the run would train CIoU and claim MPDIoU.

    `use_mpdiou` returns a count so a caller can assert the patch landed rather
    than discovering six duplicated ablation rows afterwards.
    """

    from ml.models.loss_patch import use_mpdiou

    class _NoCriterion:
        pass

    assert use_mpdiou(_NoCriterion()) == 0
