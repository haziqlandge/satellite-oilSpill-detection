"""Binary -> {`oos`, `slick_unknown`} relabelling assistance.

The Zenodo corpus ships **binary** masks (oil / not-oil). The detector's class
scheme has **two foreground classes**, so every training mask needs a class
assigned per instance. PHASE-01 is explicit that this is "annotation work, not
code" and "the largest hidden cost in the plan".

This module therefore **proposes and defers**. It never writes a training label.
It measures the morphology of each mask instance, proposes a class with the
named terms that produced the proposal, and exports a review file in which
every record is unconfirmed. `load_confirmed` returns only what a human
subsequently signed off, and refuses a label that carries no reviewer.

The rule PHASE-01 states is "linear + vessel-adjacent -> `oos`; irregular ->
`slick_unknown`". The important qualifier comes from
`RESEARCH/topics/lookalike-discrimination.md`: a **ship wake is linear and dark
and shaped exactly like an OOS**, and is called out there as the most dangerous
look-alike. Linearity on its own is therefore not evidence for `oos` -- it is
equally evidence for a wake -- so a linear instance with no bright target near
it is deferred rather than proposed confidently.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Literal

import numpy as np

ClassName = Literal["oos", "slick_unknown"]

# The scheme the weights manifest declares (`INTERFACES.md` section 6). A third
# class arriving from a hand-edited review file must be rejected, not trained on.
CLASS_SCHEME: tuple[str, ...] = ("oos", "slick_unknown")

# Below this an instance is speckle or a mask-edge artefact rather than a slick.
# Deliberately small: a genuinely small slick should still reach a human.
MIN_INSTANCE_PX = 64

# An axis this small or smaller is a channel axis, not a spatial one. Used to
# tell (bands, H, W) from (H, W, channels) -- see `_drop_channel_axis`. 4
# covers RGBA; a real mask dimension is orders of magnitude larger.
MAX_CHANNELS = 4


# Major/minor axis ratio above which an instance reads as linear. Ship wakes and
# OOS both sit above it; that ambiguity is resolved by the bright-target term,
# not by this threshold.
LINEAR_ELONGATION = 6.0

# Below this an instance reads as a compact, irregular patch -- the natural-slick
# and biogenic-film morphology rather than a discharge trail.
IRREGULAR_ELONGATION = 3.0

# A bright target this close (in pixels) counts as "vessel-adjacent". At the
# 10 m pixel spacing the SNAP chain writes, 300 px is ~3 km.
VESSEL_ADJACENT_PX = 300.0

# Half-width of the band around a decision boundary in which the tool refuses to
# commit. Anything inside it is exported flagged for review.
AMBIGUOUS_MARGIN = 0.15


@dataclass(frozen=True, slots=True)
class Morphology:
    """Shape measurements for one connected component of a binary mask."""

    label: int
    area_px: int
    perimeter_px: float
    elongation: float
    compactness: float
    solidity: float
    orientation_deg: float
    centroid_rc: tuple[float, float]


@dataclass(frozen=True, slots=True)
class Proposal:
    """A suggested class, the evidence for it, and whether it is safe to trust.

    `proposed_class` is never a label. It becomes one only when a human copies
    it into `confirmed_class` and signs the record.
    """

    label: int
    proposed_class: ClassName | None
    confidence: float
    needs_review: bool
    terms: dict[str, float] = field(default_factory=dict)
    reasons: list[str] = field(default_factory=list)
    morphology: Morphology | None = None


def _drop_channel_axis(array: np.ndarray) -> np.ndarray:
    """Reduce a 3-D mask to its 2-D plane, whichever axis holds the channels.

    Two layouts are in circulation and they are transposes of one another:

    * `rasterio.open(...).read()` returns **(bands, H, W)** -- channel *first*.
      This is how the Zenodo Part I masks arrive (record 8346860: single-band
      2048x2048 GeoTIFF, `{0, 1}`-encoded).
    * PIL and imageio return **(H, W, channels)** -- channel *last*. This is how
      the Refined SOS masks arrive (record 15298010: 256x256x3 PNG, `{0, 255}`).

    Taking the last axis unconditionally, as this did until 2026-08-31, turned a
    (1, 2048, 2048) mask into a (1, 2048) strip with **no foreground left** and
    raised nothing -- so a dataset built from Part I would have trained on empty
    labels. A channel axis is small and a spatial axis is not, which is what
    separates them here.
    """

    first_is_channel = array.shape[0] <= MAX_CHANNELS
    last_is_channel = array.shape[-1] <= MAX_CHANNELS

    if first_is_channel and last_is_channel:
        raise ValueError(
            f"ambiguous channel axis for a mask of shape {array.shape}: the first and "
            "last axis are both small enough to be channels. Pass a 2-D array."
        )
    if first_is_channel:
        return array[0, ...]
    if last_is_channel:
        return array[..., 0]
    raise ValueError(
        f"no channel axis in a mask of shape {array.shape}: neither the first nor the "
        f"last axis is {MAX_CHANNELS} or smaller. Pass a 2-D array."
    )


def binarise(mask: np.ndarray, *, threshold: float | None = None) -> np.ndarray:
    """Reduce a stored mask to a clean 2-D boolean array.

    Both of the cases handled here were found by running this module against the
    real Refined SOS masks (Zenodo 15298010) rather than by reading the format:

    * **The masks are RGB**, three identical channels. Left 3-D, `label(...,
      connectivity=2)` treats the array as a *volume* and every measurement is
      meaningless, without raising anything.
    * **11 of 40 sampled masks carry a lossy-compression halo** -- intermediate
      values between 0 and 255 ringing around each edge. Thresholding at `> 0`
      takes that halo as foreground, and because it lies *between* nearby slicks
      it **bridges them into one instance**: on the real data it merged 47 true
      instances down to 43. Silently merging two slicks is a corrupted
      instance-segmentation label, which is worse than the 4% area inflation
      that comes with it.

    The default threshold is half the **observed** maximum, not a fixed 128, so
    that `{0, 1}` and `{0, 255}` encodings both work -- a fixed 128 would empty
    a `{0, 1}` mask entirely.
    """

    array = np.asarray(mask)

    if array.ndim == 3:
        array = _drop_channel_axis(array)
    if array.ndim != 2:
        raise ValueError(f"expected a 2-D or 3-D mask, got shape {np.asarray(mask).shape}")

    if array.dtype == bool:
        return array

    if threshold is None:
        peak = float(array.max())
        if peak <= 0:
            return np.zeros(array.shape, dtype=bool)
        threshold = peak / 2.0

    return array >= threshold


def analyse_mask(
    mask: np.ndarray,
    *,
    min_area_px: int = MIN_INSTANCE_PX,
    threshold: float | None = None,
) -> list[Morphology]:
    """Measure every connected component of a binary mask.

    Components smaller than `min_area_px` are dropped as speckle. Returned in
    label order so a review file is stable across runs. See `binarise` for how
    the stored mask is reduced to booleans -- that step is not a formality.
    """

    from skimage.measure import label as label_components
    from skimage.measure import regionprops

    binary = binarise(mask, threshold=threshold)
    if not binary.any():
        return []

    labelled = label_components(binary, connectivity=2)
    instances: list[Morphology] = []

    for region in regionprops(labelled):
        if region.area < min_area_px:
            continue

        major = float(region.axis_major_length)
        minor = float(region.axis_minor_length)
        # A one-pixel-wide streak has minor axis 0; treat it as maximally
        # elongated rather than dividing by zero.
        elongation = major / minor if minor > 1e-6 else float(major)

        perimeter = float(region.perimeter) or 1.0
        # 4*pi*A / P^2 -- 1.0 for a circle, falling towards 0 as an outline
        # becomes long and thin or convoluted.
        compactness = 4.0 * np.pi * float(region.area) / (perimeter**2)

        instances.append(
            Morphology(
                label=int(region.label),
                area_px=int(region.area),
                perimeter_px=perimeter,
                elongation=elongation,
                compactness=min(compactness, 1.0),
                solidity=float(region.solidity),
                orientation_deg=float(np.degrees(region.orientation)),
                centroid_rc=(float(region.centroid[0]), float(region.centroid[1])),
            )
        )

    return instances


def _nearest_bright_target(
    centroid_rc: tuple[float, float],
    bright_targets: list[tuple[float, float]],
) -> float:
    """Distance in pixels to the closest bright target, or infinity if none."""

    if not bright_targets:
        return float("inf")
    row, col = centroid_rc
    return min(float(np.hypot(row - r, col - c)) for r, c in bright_targets)


def propose(
    instance: Morphology,
    *,
    bright_targets: list[tuple[float, float]] | None = None,
    target_distance_px: float | None = None,
) -> Proposal:
    """Propose a class for one instance, with the terms that produced it.

    Two independent pieces of evidence are combined:

    * **linearity** -- how far the elongation sits above `LINEAR_ELONGATION`
      (discharge trails are long and thin) or below `IRREGULAR_ELONGATION`
      (natural films and biogenic slicks are compact and ragged);
    * **vessel adjacency** -- distance to the nearest bright target, which is
      what separates an `oos` trail from a look-alike with the same shape.

    Neither is decisive alone. A linear instance with no bright target near it
    is exactly the ship-wake case, so it is deferred rather than called `oos`.

    `target_distance_px` is the distance from the nearest target to the
    instance ITSELF, which `propose_all` measures from the mask. Without it the
    distance falls back to the centroid, which misjudges exactly the case the
    rule exists for: a long trail with the vessel at its end has its centroid
    half a trail away. On the real pilot that deferred three linear instances
    whose CFAR targets sat 15-22 px from the trail, as "no bright target
    within 300 px".
    """

    targets = bright_targets or []
    distance = (
        float(target_distance_px)
        if target_distance_px is not None and targets
        else _nearest_bright_target(instance.centroid_rc, targets)
    )
    vessel_adjacent = distance <= VESSEL_ADJACENT_PX

    terms: dict[str, float] = {
        "elongation": round(instance.elongation, 3),
        "compactness": round(instance.compactness, 4),
        "solidity": round(instance.solidity, 3),
        "area_px": float(instance.area_px),
        "bright_target_distance_px": (round(distance, 1) if np.isfinite(distance) else -1.0),
    }
    reasons: list[str] = []

    is_linear = instance.elongation >= LINEAR_ELONGATION
    is_irregular = instance.elongation <= IRREGULAR_ELONGATION

    if is_linear and vessel_adjacent:
        proposed: ClassName | None = "oos"
        # Confidence grows with how far past the linearity threshold it sits and
        # how close the target is; capped well below 1 because this is a
        # proposal for a human, not a classifier output.
        linear_margin = min((instance.elongation - LINEAR_ELONGATION) / LINEAR_ELONGATION, 1.0)
        proximity = 1.0 - min(distance / VESSEL_ADJACENT_PX, 1.0)
        confidence = 0.5 + 0.25 * linear_margin + 0.2 * proximity
        reasons.append(
            f"elongation {instance.elongation:.1f} >= {LINEAR_ELONGATION} (linear) and a "
            f"bright target {distance:.0f} px away (<= {VESSEL_ADJACENT_PX:.0f})"
        )
    elif is_linear and not vessel_adjacent:
        # The ship-wake trap. Shape alone cannot separate these.
        proposed = None
        confidence = 0.0
        reasons.append(
            f"elongation {instance.elongation:.1f} is linear but no bright target within "
            f"{VESSEL_ADJACENT_PX:.0f} px; a ship wake has this exact morphology, so shape "
            "alone is not evidence of an oil spill"
        )
    elif is_irregular:
        proposed = "slick_unknown"
        irregular_margin = min(
            (IRREGULAR_ELONGATION - instance.elongation) / IRREGULAR_ELONGATION, 1.0
        )
        confidence = 0.5 + 0.3 * max(irregular_margin, 0.0)
        reasons.append(
            f"elongation {instance.elongation:.1f} <= {IRREGULAR_ELONGATION}: compact and "
            "irregular rather than a discharge trail"
        )
        if vessel_adjacent:
            reasons.append(
                f"a bright target is {distance:.0f} px away, which argues for oos; "
                "the shape does not"
            )
    else:
        # Between the two thresholds: neither morphology asserts itself.
        proposed = None
        confidence = 0.0
        reasons.append(
            f"elongation {instance.elongation:.1f} falls between {IRREGULAR_ELONGATION} and "
            f"{LINEAR_ELONGATION}; morphology does not distinguish the classes here"
        )

    needs_review = proposed is None or confidence < (0.5 + AMBIGUOUS_MARGIN)
    if vessel_adjacent and proposed == "slick_unknown":
        # Conflicting evidence always goes to a human.
        needs_review = True

    return Proposal(
        label=instance.label,
        proposed_class=proposed,
        confidence=round(min(max(confidence, 0.0), 1.0), 3),
        needs_review=needs_review,
        terms=terms,
        reasons=reasons,
        morphology=instance,
    )


def propose_all(
    mask: np.ndarray,
    *,
    bright_targets: list[tuple[float, float]] | None = None,
    min_area_px: int = MIN_INSTANCE_PX,
    threshold: float | None = None,
) -> list[Proposal]:
    """Propose a class for every instance in a binary mask.

    Vessel adjacency is measured from each bright target to the nearest pixel
    of the instance (one distance transform per mask), not to its centroid --
    see `propose`.
    """

    instances = analyse_mask(mask, min_area_px=min_area_px, threshold=threshold)
    if not bright_targets or not instances:
        return [propose(instance, bright_targets=bright_targets) for instance in instances]

    from scipy import ndimage
    from skimage.measure import label as label_components

    labelled = label_components(binarise(mask, threshold=threshold), connectivity=2)
    seeds = np.ones(labelled.shape, dtype=bool)
    for row, col in bright_targets:
        r, c = round(row), round(col)
        if 0 <= r < seeds.shape[0] and 0 <= c < seeds.shape[1]:
            seeds[r, c] = False
    if seeds.all():
        # Every target fell outside the raster; the centroid rule still applies.
        return [propose(instance, bright_targets=bright_targets) for instance in instances]
    to_target = ndimage.distance_transform_edt(seeds)
    nearest = ndimage.minimum(to_target, labels=labelled, index=[i.label for i in instances])
    return [
        propose(instance, bright_targets=bright_targets, target_distance_px=float(distance))
        for instance, distance in zip(instances, np.atleast_1d(nearest), strict=True)
    ]


def export_review(proposals: list[Proposal], destination: Path, *, source: str) -> Path:
    """Write a review file. Every record leaves here unconfirmed.

    `confirmed_class` and `confirmed_by` are the two fields a human fills in.
    Nothing downstream reads `proposed_class`.
    """

    destination.parent.mkdir(parents=True, exist_ok=True)
    document = {
        "source": source,
        "class_scheme": list(CLASS_SCHEME),
        "note": (
            "proposed_class is a suggestion, not a label. Set confirmed_class and "
            "confirmed_by to accept or override it. Records left unconfirmed are ignored."
        ),
        "instances": [
            {
                "label": proposal.label,
                "proposed_class": proposal.proposed_class,
                "confidence": proposal.confidence,
                "needs_review": proposal.needs_review,
                "terms": proposal.terms,
                "reasons": proposal.reasons,
                "morphology": (asdict(proposal.morphology) if proposal.morphology else None),
                "confirmed_class": None,
                "confirmed_by": None,
            }
            for proposal in proposals
        ],
    }
    destination.write_text(json.dumps(document, indent=2), encoding="utf-8")
    return destination


def load_confirmed(path: Path) -> dict[int, str]:
    """Return `{label: class}` for records a human actually signed off.

    Unconfirmed records are skipped silently -- a partly reviewed file is the
    normal state of a long annotation pass. A confirmed record that names a
    class outside the scheme, or that carries no reviewer, raises: both are
    ways an unreviewed label could otherwise reach training.
    """

    document = json.loads(Path(path).read_text(encoding="utf-8"))
    if document.get("class_scheme") != list(CLASS_SCHEME):
        raise ValueError(f"{path}: review class_scheme does not match {CLASS_SCHEME}")
    confirmed: dict[int, str] = {}
    seen: set[int] = set()

    for record in document.get("instances", []):
        label = record["label"]
        if type(label) is not int or label <= 0 or label in seen:
            raise ValueError(f"{path}: invalid or duplicate component label {label!r}")
        seen.add(label)
        class_name = record.get("confirmed_class")
        if class_name is None:
            continue
        if class_name not in CLASS_SCHEME:
            raise ValueError(
                f"{path}: label {record.get('label')} is confirmed as {class_name!r}, "
                f"which is not in the class scheme {CLASS_SCHEME}"
            )
        reviewer = record.get("confirmed_by")
        if not isinstance(reviewer, str) or not reviewer.strip():
            raise ValueError(
                f"{path}: label {record.get('label')} has a confirmed_class but no "
                "confirmed_by. An unattributed label is indistinguishable from an "
                "auto-label, which this module exists to prevent."
            )
        confirmed[label] = class_name

    return confirmed
