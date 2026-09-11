"""YOLO-seg with LSK attention at P004's five ablation positions.

PHASE-02's grid is `{none, L1..L5} x {CIoU, MPDIoU}` — twelve cells reproducing
Zhao et al. Table 1. This module builds the six architectures; the loss axis is
handled separately.

P004 §2.5 places LSK at:

| Position | Where |
|---|---|
| L1 | before the SPPF module |
| L2 | in front of the **small**-object head |
| L3 | in front of the **medium**-object head |
| L4 | in front of the **large**-object head |
| L5 | in front of **all** heads |

**Two ways to place a block, and they are not interchangeable.**

*L1 is inline.* "Before the SPPF" is a backbone position, so the node is spliced
in at index 9. That renumbers every layer after it, and YOLO YAML addresses
layers by absolute index — `yolo11-seg.yaml` ends with
`[[16, 19, 22], 1, Segment, ...]` and its `Concat` nodes reference absolute
indices too. Splicing without rewriting those produces a model that builds
cleanly and wires the wrong tensors together: no error, just a quietly wrong
architecture. `_insert` renumbers them; `test_references_are_renumbered` pins it.

*L2-L5 tap the head branch instead.* Layer 16 (P3) feeds both the small head and
the Conv that downsamples towards P4, so splicing inline there would put LSK in
the P4 and P5 routes as well and "L2" would silently be an L2+L3+L4. Each LSK
node therefore reads its head layer by absolute index and `Segment` is repointed
at it, leaving the downstream path untouched.

The second failure mode is worse than the first and nearly shipped: repointing
`Segment` is what makes the block *used at all*. Without it the LSK layers exist,
train, and are never read — the model runs fine and the ablation measures
nothing. `test_the_head_actually_reads_the_lsk_output` guards it.

The open question this exists to answer, from `RESEARCH/SYNTHESIS.md` §9 Q1:
**P004 ablated LSK on a detection head; we attach it to a segmentation head, and
whether L5 remains optimal is genuinely untested.** A negative result is a
legitimate finding and must be reported, not engineered around.
"""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any

import yaml

from ml.models.lsk import LSKAttention

# Ablation positions, in the order P004's Table 1 lists them.
POSITIONS: tuple[str, ...] = ("none", "L1", "L2", "L3", "L4", "L5")

# The YAML node inserted at each position. Empty args: `LSKAttention` infers its
# channel count from the first input, because ultralytics passes args verbatim
# for modules outside its `base_modules` set and a fixed count would be wrong at
# every scale but one.
_LSK_NODE: list[Any] = [-1, 1, "LSKAttention", []]

# Layer indices in the stock `yolo11-seg.yaml`. Named rather than inlined
# because they are the whole correctness surface of this module.
# This project's class count. The corpus is binary until the relabelling pass
# lands, at which point it becomes 2 (`oos`, `slick_unknown`).
DEFAULT_NC = 1

_SPPF_INDEX = 9
_HEAD_SMALL = 16
_HEAD_MEDIUM = 19
_HEAD_LARGE = 22


class ArchitectureError(RuntimeError):
    """The ablation architecture could not be constructed."""


def register_lsk() -> None:
    """Make `LSKAttention` resolvable from a YOLO YAML.

    Ultralytics resolves a module name with `globals()[m]` inside
    `ultralytics.nn.tasks`, so the class has to be present in *that* module's
    namespace. Importing it here is not enough.

    Idempotent, and safe to call before every build.
    """

    from ultralytics.nn import tasks

    tasks.LSKAttention = LSKAttention  # type: ignore[attr-defined]


def _shift(reference: Any, at: int) -> Any:
    """Renumber one `from` reference across an insertion at index `at`.

    Negative references are relative and unaffected. Absolute references at or
    beyond the insertion point move up by one.
    """

    if isinstance(reference, list):
        return [_shift(item, at) for item in reference]
    if isinstance(reference, int) and reference >= 0 and reference >= at:
        return reference + 1
    return reference


def _insert(layers: list[list[Any]], at: int, node: list[Any]) -> list[list[Any]]:
    """Insert `node` at index `at`, renumbering every affected reference.

    Without the renumbering the model still builds — it just connects the wrong
    layers, which is the failure this whole function exists to prevent.
    """

    if not 0 <= at <= len(layers):
        raise ArchitectureError(f"insertion index {at} outside 0..{len(layers)}")

    shifted = [[_shift(layer[0], at), *layer[1:]] for layer in layers]
    return [*shifted[:at], copy.deepcopy(node), *shifted[at:]]


def build_config(position: str, base: dict[str, Any]) -> dict[str, Any]:
    """Return a YOLO config with LSK inserted at `position`.

    **"In front of the head" means on the branch feeding that head, not inline
    in the backbone path.** The distinction is not cosmetic: layer 16 (P3) feeds
    both the small head *and* the Conv that downsamples towards P4. Splicing LSK
    inline there would put it in the P4 and P5 routes as well, so "L2" would
    silently be an L2+L3+L4. The head branch is therefore tapped: an LSK node
    reads the head layer by absolute index and `Segment` is repointed at it,
    leaving the downstream path untouched.

    L1 is genuinely inline, because "before the SPPF" *is* a backbone position.

    `base` is not mutated.
    """

    if position not in POSITIONS:
        raise ArchitectureError(f"unknown LSK position {position!r}; expected one of {POSITIONS}")

    config = copy.deepcopy(base)
    if position == "none":
        return config

    layers: list[list[Any]] = [*config["backbone"], *config["head"]]
    backbone_length = len(config["backbone"])

    if position == "L1":
        # Inline: the LSK takes -1 and SPPF, which also takes -1, now reads it.
        layers = _insert(layers, _SPPF_INDEX, _LSK_NODE)
        backbone_length += 1
        config["backbone"] = layers[:backbone_length]
        config["head"] = layers[backbone_length:]
        return config

    taps = {
        "L2": [_HEAD_SMALL],
        "L3": [_HEAD_MEDIUM],
        "L4": [_HEAD_LARGE],
        "L5": [_HEAD_SMALL, _HEAD_MEDIUM, _HEAD_LARGE],
    }[position]

    segment = layers[-1]
    if segment[2] != "Segment":
        raise ArchitectureError(f"expected the last layer to be Segment, got {segment[2]!r}")

    # Append one LSK per tapped head, immediately before Segment, each reading
    # its head layer absolutely. Appending cannot disturb any existing index.
    body = layers[:-1]
    remap: dict[int, int] = {}
    for tap in taps:
        node = [tap, 1, "LSKAttention", []]
        remap[tap] = len(body)
        body.append(node)

    rewired = [remap.get(ref, ref) for ref in segment[0]]
    config["backbone"] = body[:backbone_length]
    config["head"] = [*body[backbone_length:], [rewired, *segment[1:]]]
    return config


def load_base_config(scale: str = "n", *, nc: int | None = None) -> dict[str, Any]:
    """Parse the stock `yolo11-seg.yaml` shipped with ultralytics.

    `nc` overrides the stock 80. Set it to the dataset's class count so the head
    is built at its final size from the start — see `write_config` for why that
    matters to the ablation's validity.
    """

    import ultralytics

    root = Path(ultralytics.__file__).parent
    matches = sorted(root.rglob("yolo11-seg.yaml"))
    if not matches:
        raise ArchitectureError("yolo11-seg.yaml not found in the installed ultralytics")

    config: dict[str, Any] = yaml.safe_load(matches[0].read_text(encoding="utf-8"))
    config["scale"] = scale
    if nc is not None:
        config["nc"] = nc
    return config


def write_config(
    position: str, destination: Path, *, scale: str = "n", nc: int | None = DEFAULT_NC
) -> Path:
    """Write the ablation YAML for `position` and return its path.

    **`nc` defaults to this project's class count, not the stock 80, and that is
    load-bearing for the ablation.**

    Appending LSK before `Segment` shifts its layer index (23 -> 24/25/26), so a
    COCO checkpoint's head weights no longer match by key for L2-L5 while they
    still match for `none` and L1. Left alone, half the grid would train with a
    pretrained head and half with a random one — an asymmetry that has nothing
    to do with LSK and would corrupt exactly the comparison being made.

    Building the head at its final class count makes the 80-class COCO head fail
    to match **everywhere**, so every cell starts from a pretrained
    backbone/neck and an identically-initialised random head. Measured: the
    non-head transfer is then the same for `none` and `L5`.
    """

    config = build_config(position, load_base_config(scale=scale, nc=nc))
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")
    return destination


def stock_index_map(position: str) -> dict[int, int]:
    """Map a stock `yolo11-seg` layer index to its index in this architecture.

    Needed to transfer pretrained weights. **L1 is the case that requires it:**
    it splices a block in at index 9, so every backbone and neck layer after
    that point shifts by one and its checkpoint keys stop matching by name.
    Measured without this remap, L1 received 192 of 394 pretrained tensors where
    every other cell received 378 — a handicap on precisely the weights that
    matter most, and nothing to do with LSK.

    L2-L5 append their blocks *after* every stock layer, so their mapping is the
    identity for everything except the head, which is excluded from transfer
    anyway.
    """

    if position not in POSITIONS:
        raise ArchitectureError(f"unknown LSK position {position!r}")
    if position != "L1":
        return {}
    # One block inserted at _SPPF_INDEX: everything from there on moves up one.
    return {index: index + 1 for index in range(_SPPF_INDEX, 64)}


def lsk_layer_count(config: dict[str, Any]) -> int:
    """How many LSK nodes a config contains — 0, 1 or 3."""

    layers = [*config["backbone"], *config["head"]]
    return sum(1 for layer in layers if layer[2] == "LSKAttention")
