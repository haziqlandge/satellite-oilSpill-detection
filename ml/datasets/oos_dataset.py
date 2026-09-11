"""Assemble a YOLO-seg training set from the extracted Zenodo corpus.

Turns the corpus `scripts/extract_zenodo.py` unpacks -- images plus binary masks
-- into the directory layout and label files `ultralytics` trains from, with the
8:1:1 split, mirroring and ~10% negative pool that PHASE-01 and PHASE-02
specify.

Three things here are deliberate and worth reading before changing them.

**Class assignment is never inferred.** The Zenodo masks are binary (oil /
not-oil) and the project's scheme has two foreground classes, `oos` and
`slick_unknown`. Deriving those from mask shape is exactly what
`datasets/relabel.py` refuses to do, because a ship wake and an operational
discharge are both linear and dark. So this module either

* takes a **human-confirmed** mapping from `relabel.load_confirmed`, or
* runs in `single_class` mode, which emits **one** class named `slick` and is
  honestly a *binary* baseline, not the two-class model.

There is no third option that guesses. A `single_class` dataset must not be
exported under the two-class manifest in `INTERFACES.md` section 6.

**Splits are content-addressed, not shuffled.** The split an image lands in is
derived from a CRC32 of its identity, so it is stable across runs, across
machines, and across additions to the corpus. `hash()` is randomised per
interpreter run and would silently reshuffle the split -- and therefore leak
validation images into training -- on every invocation. `synthetic.py` learned
this the same way.

**Mirroring only, never rotation.** `CONSTRAINTS.md`: rotation invalidates the
pixel-to-geo mapping on geocoded imagery. Mirroring is what P004 used.
"""

from __future__ import annotations

import zlib
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from backend.ingest.datasets.relabel import MIN_INSTANCE_PX, binarise

# The scheme `INTERFACES.md` section 6 declares. Order is the class index order
# written into every label file, so it must not be reordered casually.
CLASS_SCHEME: tuple[str, ...] = ("oos", "slick_unknown")

# The name used when no confirmed labels exist. Deliberately *not* one of the
# two real class names, so a binary baseline can never be mistaken for the
# two-class model in a manifest or a results table.
SINGLE_CLASS_NAME = "slick"

# 8:1:1, as PHASE-02 specifies.
DEFAULT_SPLIT = (0.8, 0.1, 0.1)
SPLIT_NAMES = ("train", "val", "test")

# Contour simplification tolerance in pixels. Ultralytics stores a polygon per
# instance; an unsimplified 2048x2048 contour runs to thousands of vertices,
# which bloats the label files without adding boundary accuracy the model can
# use at imgsz=1024.
POLYGON_TOLERANCE_PX = 1.5

# A polygon needs three distinct points to enclose area. Fewer is a degenerate
# instance -- a line or a point -- and ultralytics silently drops it, so filter
# here where it can be counted instead.
MIN_POLYGON_POINTS = 3


class DatasetError(RuntimeError):
    """The dataset could not be assembled as specified."""


@dataclass(frozen=True, slots=True)
class Instance:
    """One slick, as a class index plus a normalised polygon."""

    class_index: int
    polygon: tuple[tuple[float, float], ...]

    def to_label_line(self) -> str:
        """The ultralytics segmentation label format: `cls x1 y1 x2 y2 ...`."""

        coordinates = " ".join(f"{x:.6f} {y:.6f}" for x, y in self.polygon)
        return f"{self.class_index} {coordinates}"


@dataclass(frozen=True, slots=True)
class SourceImage:
    """One corpus image and the mask that goes with it, if any.

    `mask` is `None` for a negative -- a look-alike or clean-sea image, which
    contributes an **empty** label file rather than no label file at all.
    Ultralytics treats a missing label as an unlabelled image to be skipped; an
    empty one is a true negative, which is the whole point of the pool.
    """

    identity: str
    image: Path
    mask: Path | None = None
    is_negative: bool = False


def assign_split(
    identity: str,
    *,
    ratios: Sequence[float] = DEFAULT_SPLIT,
    salt: str = "",
) -> str:
    """Map an image identity to `train` / `val` / `test`, deterministically.

    CRC32 rather than `hash()`: `hash()` is salted per interpreter run, so the
    split would differ between two runs on the same machine and quietly move a
    validation image into training.
    """

    if len(ratios) != len(SPLIT_NAMES):
        raise DatasetError(f"expected {len(SPLIT_NAMES)} split ratios, got {len(ratios)}")
    total = sum(ratios)
    if total <= 0:
        raise DatasetError("split ratios must sum to more than zero")

    # 10_000 buckets: fine enough that an 80/10/10 split is exact to 0.01%.
    bucket = zlib.crc32(f"{salt}{identity}".encode()) % 10_000
    threshold = 0.0
    for name, ratio in zip(SPLIT_NAMES, ratios, strict=True):
        threshold += ratio / total * 10_000
        if bucket < threshold:
            return name
    return SPLIT_NAMES[-1]


def mask_to_polygons(
    mask: np.ndarray,
    *,
    min_area_px: int = MIN_INSTANCE_PX,
    tolerance_px: float = POLYGON_TOLERANCE_PX,
) -> list[tuple[tuple[float, float], ...]]:
    """Trace each connected slick in a binary mask to a normalised polygon.

    Returns `(x, y)` pairs in `[0, 1]`, which is the order and range ultralytics
    expects -- note `skimage` yields `(row, col)`, so the axes are swapped here
    exactly once.

    The mask is padded by one pixel before contouring. `find_contours` does not
    close a contour that runs off the array edge, and a slick touching the tile
    border is the normal case when a scene is tiled, not an edge case.
    """

    from skimage.measure import approximate_polygon, find_contours
    from skimage.measure import label as label_components

    binary = binarise(mask)
    if not binary.any():
        return []

    height, width = binary.shape
    labelled = label_components(binary, connectivity=2)

    polygons: list[tuple[tuple[float, float], ...]] = []
    for index in range(1, int(labelled.max()) + 1):
        component = labelled == index
        if int(component.sum()) < min_area_px:
            continue

        padded = np.pad(component.astype(np.uint8), 1, mode="constant")
        contours = find_contours(padded, 0.5)
        if not contours:
            continue

        # One component can yield an outer contour plus holes; the outer
        # boundary is the longest. YOLO-seg carries no hole representation.
        outer = max(contours, key=len)
        simplified = approximate_polygon(outer, tolerance=tolerance_px)

        # Undo the pad, swap (row, col) -> (x, y), and normalise. Clipping
        # guards the half-pixel that contouring can place outside the frame.
        points: list[tuple[float, float]] = []
        for row, column in simplified:
            x = float(np.clip((column - 1) / max(width - 1, 1), 0.0, 1.0))
            y = float(np.clip((row - 1) / max(height - 1, 1), 0.0, 1.0))
            points.append((x, y))

        # approximate_polygon returns a closed ring; the repeated last point is
        # redundant in the label format.
        if len(points) > 1 and points[0] == points[-1]:
            points.pop()

        if len(points) >= MIN_POLYGON_POINTS:
            polygons.append(tuple(points))

    return polygons


def instances_for(
    mask: np.ndarray,
    *,
    class_index: int = 0,
    confirmed: dict[int, str] | None = None,
    class_names: Sequence[str] = (SINGLE_CLASS_NAME,),
    min_area_px: int = MIN_INSTANCE_PX,
) -> list[Instance]:
    """Build labelled instances for one mask.

    With `confirmed` supplied, the class of the *n*-th instance is looked up by
    its label id and must be present -- an unconfirmed instance raises rather
    than defaulting, because defaulting is how an unreviewed guess reaches the
    training set. Without it every instance takes `class_index`, which is the
    single-class baseline path.
    """

    polygons = mask_to_polygons(mask, min_area_px=min_area_px)
    instances: list[Instance] = []

    for order, polygon in enumerate(polygons, start=1):
        if confirmed is None:
            resolved = class_index
        else:
            name = confirmed.get(order)
            if name is None:
                raise DatasetError(
                    f"instance {order} has no confirmed class. Run the relabelling "
                    "review to completion, or assemble in single-class mode."
                )
            if name not in class_names:
                raise DatasetError(f"confirmed class {name!r} is not in the scheme {tuple(class_names)}")
            resolved = list(class_names).index(name)
        instances.append(Instance(class_index=resolved, polygon=polygon))

    return instances


def write_label_file(path: Path, instances: Iterable[Instance]) -> int:
    """Write one ultralytics label file, returning the instance count.

    An empty file is written for a negative rather than no file at all: a
    missing label means "unlabelled, skip me" to ultralytics, where an empty one
    means "genuinely nothing here", which is what the negative pool is for.
    """

    lines = [instance.to_label_line() for instance in instances]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + ("\n" if lines else ""), encoding="utf-8")
    return len(lines)


def write_data_yaml(
    path: Path,
    *,
    root: Path,
    class_names: Sequence[str],
) -> Path:
    """Write the `data.yaml` ultralytics reads the split layout from."""

    names = "\n".join(f"  {index}: {name}" for index, name in enumerate(class_names))
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "# Generated by ml/datasets/oos_dataset.py -- do not hand-edit.\n"
        f"path: {root.as_posix()}\n"
        "train: images/train\n"
        "val: images/val\n"
        "test: images/test\n"
        f"nc: {len(class_names)}\n"
        "names:\n"
        f"{names}\n",
        encoding="utf-8",
    )
    return path


def negative_budget(positive_count: int, fraction: float) -> int:
    """How many negatives a split of this size should carry.

    `fraction` is the share of the *final* split, matching P004 section 2.4's
    200/2048 rather than 200 added to 2048, so it is not simply
    `positive_count * fraction`.
    """

    if not 0.0 <= fraction < 1.0:
        raise DatasetError(f"negative fraction must be in [0, 1), got {fraction}")
    return round(positive_count * fraction / (1.0 - fraction))


# --- reading the real corpus ----------------------------------------------
#
# Everything below was derived by inspecting the extracted archives on
# 2026-08-31, not from the record descriptions. The three records disagree with
# each other on every convention that matters, and each disagreement is silent.

# `images.zip` and `masks.zip` in record 15298010 were built on macOS and carry
# an AppleDouble shadow for every real file: a `__MACOSX/` tree of `._name`
# stubs. They are 16,148 of the 16,145-per-archive entries. A plain glob pairs a
# 4 KB resource fork with a real mask and the loader either throws or, worse,
# reads a few bytes of metadata as an image.
JUNK_NAME_PREFIXES = ("._",)
JUNK_NAMES = frozenset({".DS_Store", "Thumbs.db"})
JUNK_DIRECTORIES = frozenset({"__MACOSX"})

# Record 13761290 names a mask for `00000.tif` as `00000_segmentation.tif`.
# Matching on the bare stem finds **zero** pairs across all 450 images.
PART_III_MASK_SUFFIX = "_segmentation"

# Record 13761290 restarts numbering inside every category, so `00000.tif`
# exists three times over. Flattening on the bare stem silently overwrites two
# thirds of the corpus in the output directory.
PART_III_CATEGORIES = ("Oil", "Lookalike", "No oil")
PART_III_NEGATIVE_CATEGORIES = frozenset({"Lookalike", "No oil"})

# Record 15298010 is **mixed-sensor**: 4,193 `sentinel_*` and 3,877 `palsar_*`
# of 8,070. ALOS PALSAR is L-band where this whole pipeline is Sentinel-1
# C-band, and oil damps capillary waves differently between the two. Default to
# the Sentinel subset; taking the lot is a deliberate act that has to be
# recorded in the weights manifest.
DEFAULT_SENSORS = ("sentinel",)

# --- SAR imagery is float32 dB, which no image loader will open --------------
#
# Part I and Part III images are **2-band float32 GeoTIFF holding sigma0 in dB**
# (measured range -35.9 to +12.8). Ultralytics loads images through PIL, and PIL
# reports `cannot identify image file` for every one of them -- so they have to
# be converted, not linked.
#
# **Band 2 is the signal-bearing one.** Measured over 30 Part III `Oil` images
# by comparing pixels inside the ground-truth mask against pixels outside it:
#
#     band 1:  inside -29.54 dB   outside -29.03 dB   contrast 0.51 dB
#     band 2:  inside -27.41 dB   outside -20.41 dB   contrast 7.01 dB
#
# Band 1 is VH and shows essentially no slick contrast; band 2 is VV, the
# polarisation oil damping is strongest in and the one `PLAN/` specifies.
# Reading "the first band" is the obvious implementation and it would hand the
# model an image with no signal in it -- which would present as an architecture
# failure rather than a loader bug.
SAR_BAND = 2

# A **fixed** dB window, shared by every image. This is the important part: the
# absolute dB level is itself discriminative -- measured per-image band-2 means
# are Oil -21.5, Lookalike -20.2, No oil -12.7 dB. Normalising per image would
# stretch each one to full range and **destroy** the "oil is darker" cue that
# separates the classes. -35 dB is below the observed floor and 0 dB is above
# the ocean return, so the window clips almost nothing.
DB_WINDOW = (-35.0, 0.0)


def db_to_uint8(
    array: np.ndarray, *, window: tuple[float, float] = DB_WINDOW
) -> np.ndarray:
    """Scale a dB array to 8-bit through a fixed window.

    Fixed, not per-image: see `DB_WINDOW`. A per-image stretch is the usual
    reflex and it silently removes the class signal.
    """

    low, high = window
    if high <= low:
        raise DatasetError(f"dB window {window} is not increasing")
    scaled = (np.clip(np.asarray(array, dtype=np.float32), low, high) - low) / (high - low)
    return (scaled * 255.0).round().astype(np.uint8)


def read_sar_uint8(
    path: Path,
    *,
    band: int = SAR_BAND,
    window: tuple[float, float] = DB_WINDOW,
) -> np.ndarray:
    """Read one float32 dB GeoTIFF as an 8-bit greyscale array."""

    import rasterio

    with rasterio.open(path) as src:
        chosen = band if src.count >= band else 1
        return db_to_uint8(src.read(chosen), window=window)


def materialise_image(source: Path, target: Path, *, band: int = SAR_BAND) -> Path:
    """Put a trainable copy of `source` at `target`.

    An 8-bit image is hard-linked unchanged. A float32 dB GeoTIFF is converted
    to 8-bit PNG, because that is the only form ultralytics can read -- so the
    target's suffix is not always the source's.
    """

    if source.suffix.lower() in {".tif", ".tiff"}:
        target = target.with_suffix(".png")
        if target.exists():
            return target
        import imageio.v3 as iio

        target.parent.mkdir(parents=True, exist_ok=True)
        iio.imwrite(target, read_sar_uint8(source, band=band))
        return target

    link_or_copy(source, target)
    return target



def is_corpus_file(path: Path) -> bool:
    """True for a real corpus file, false for packaging debris."""

    if any(part in JUNK_DIRECTORIES for part in path.parts):
        return False
    if path.name in JUNK_NAMES:
        return False
    return not path.name.startswith(JUNK_NAME_PREFIXES)


def sensor_of(path: Path) -> str:
    """The sensor a Refined SOS file came from, e.g. `sentinel_12.png` -> `sentinel`."""

    return path.stem.rsplit("_", 1)[0] if "_" in path.stem else path.stem


def mask_path_for(image: Path, masks_dir: Path, *, suffix: str = "") -> Path | None:
    """The mask that goes with `image`, or `None` if there is not one.

    `suffix` covers record 13761290's `_segmentation`. The mask extension is not
    assumed to match the image extension -- it does today, but the records
    already disagree on `.tif` versus `.png`.
    """

    candidates = [masks_dir / f"{image.stem}{suffix}{image.suffix}"]
    if suffix:
        candidates.append(masks_dir / f"{image.stem}{suffix}.tif")
        candidates.append(masks_dir / f"{image.stem}{suffix}.png")
    else:
        candidates.append(masks_dir / f"{image.stem}.tif")
        candidates.append(masks_dir / f"{image.stem}.png")

    for candidate in candidates:
        if candidate.exists():
            return candidate
    return None


def qualified_identity(record_id: str, category: str, stem: str) -> str:
    """A corpus-unique name for one image.

    Must include the category: record 13761290 restarts numbering per category,
    so `00000` alone names three different images.
    """

    parts = [record_id, category.replace(" ", "_"), stem] if category else [record_id, stem]
    return "__".join(parts)


def discover_paired(
    images_dir: Path,
    masks_dir: Path | None,
    *,
    record_id: str,
    category: str = "",
    mask_suffix: str = "",
    is_negative: bool = False,
    sensors: Sequence[str] | None = None,
    require_mask: bool = True,
) -> list[SourceImage]:
    """List the usable images in one directory, paired with their masks.

    Raises when `require_mask` and an image has no mask: a silently unpaired
    image becomes an unlabelled training example, which is a quiet way to teach
    the model that slicks are background.
    """

    if not images_dir.is_dir():
        raise DatasetError(f"no image directory at {images_dir}")

    found: list[SourceImage] = []
    missing: list[str] = []

    for image in sorted(images_dir.iterdir()):
        if not image.is_file() or not is_corpus_file(image):
            continue
        if sensors is not None and sensor_of(image) not in sensors:
            continue

        mask = None
        if masks_dir is not None:
            mask = mask_path_for(image, masks_dir, suffix=mask_suffix)
            if mask is None and require_mask:
                missing.append(image.name)
                continue

        found.append(
            SourceImage(
                identity=qualified_identity(record_id, category, image.stem),
                image=image,
                mask=mask,
                is_negative=is_negative,
            )
        )

    if missing:
        raise DatasetError(
            f"{len(missing)} image(s) in {images_dir} have no mask "
            f"(first: {missing[0]}). Check the mask suffix -- record 13761290 uses "
            f"{PART_III_MASK_SUFFIX!r}."
        )

    return found


def discover_part_three(root: Path, *, record_id: str = "13761290") -> list[SourceImage]:
    """Record 13761290: `Images/<category>` and `Mask/<category>`, three categories.

    `Lookalike` and `No oil` are the negative pool -- their masks are genuinely
    empty, measured across 80 sampled files, so they contribute empty labels.
    """

    sources: list[SourceImage] = []
    for category in PART_III_CATEGORIES:
        sources.extend(
            discover_paired(
                root / "Images" / category,
                root / "Mask" / category,
                record_id=record_id,
                category=category,
                mask_suffix=PART_III_MASK_SUFFIX,
                is_negative=category in PART_III_NEGATIVE_CATEGORIES,
            )
        )
    return sources


# Record 8346860 keeps images and masks in **separately named archives**, so
# their roots differ: `01_Train_Val_Oil_Spill_images/Oil/NNNNN.tif` against
# `01_Train_Val_Oil_Spill_mask/Mask_oil/NNNNN.tif`. Stems match exactly -- no
# `_segmentation` suffix, unlike Part III -- and there is one category, so
# nothing collides.
PART_I_IMAGE_DIR = "Oil"
PART_I_MASK_DIR = "Mask_oil"


def discover_part_one(
    images_root: Path,
    masks_root: Path,
    *,
    record_id: str = "8346860",
) -> list[SourceImage]:
    """Record 8346860 -- the primary training positives, 1,200 images.

    Every image is a positive; the record carries no negatives of its own, which
    is what Part II (or Part III's `Lookalike` / `No oil`) is for.
    """

    return discover_paired(
        images_root / PART_I_IMAGE_DIR,
        masks_root / PART_I_MASK_DIR,
        record_id=record_id,
        category=PART_I_IMAGE_DIR,
    )


def discover_refined_sos(
    images_root: Path,
    masks_root: Path,
    *,
    record_id: str = "15298010",
    sensors: Sequence[str] | None = DEFAULT_SENSORS,
) -> list[SourceImage]:
    """Record 15298010: `train/` and `val/` under each root, mixed-sensor.

    The record's own train/val split is kept as the `category`, so it stays
    visible in the identity, but the assembled split is still decided by
    `assign_split` -- one split rule for the whole corpus rather than two.
    """

    sources: list[SourceImage] = []
    for subset in ("train", "val"):
        images_dir = images_root / subset
        if not images_dir.is_dir():
            continue
        sources.extend(
            discover_paired(
                images_dir,
                masks_root / subset,
                record_id=record_id,
                category=subset,
                sensors=sensors,
            )
        )
    return sources


# --- building the training tree -------------------------------------------


@dataclass(frozen=True, slots=True)
class BuildReport:
    """What one assembly run produced, for the manifest and the log."""

    root: Path
    class_names: tuple[str, ...]
    per_split: dict[str, int]
    negatives_per_split: dict[str, int]
    instances: int
    skipped: tuple[str, ...] = ()
    undersized: tuple[str, ...] = ()

    @property
    def total(self) -> int:
        return sum(self.per_split.values())

    def negative_fraction(self, split: str) -> float:
        count = self.per_split.get(split, 0)
        return self.negatives_per_split.get(split, 0) / count if count else 0.0


def link_or_copy(source: Path, target: Path) -> None:
    """Place `source` at `target` without spending the bytes twice.

    A hard link costs nothing on the same NTFS volume and the corpus is tens of
    gigabytes. Windows reserves symlink creation for elevated or developer-mode
    sessions, so a symlink is not a safe default here; a copy is the fallback
    when the link cannot be made (different volume, or a filesystem without
    them).
    """

    import os
    import shutil as _shutil

    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        return
    try:
        os.link(source, target)
    except (OSError, AttributeError, NotImplementedError):
        _shutil.copy2(source, target)


def _read_mask(path: Path) -> np.ndarray:
    """Load a mask as a 2-D array, whatever the record stored it as.

    `.tif` goes through rasterio, which returns **(bands, H, W)**; PNG goes
    through imageio, which returns **(H, W, channels)**. `binarise` resolves
    both, but only because it was fixed to -- see `_drop_channel_axis`.
    """

    if path.suffix.lower() in {".tif", ".tiff"}:
        import rasterio

        with rasterio.open(path) as src:
            return np.asarray(src.read(1))

    import imageio.v3 as iio

    return np.asarray(iio.imread(path))


def build_dataset(
    sources: Sequence[SourceImage],
    root: Path,
    *,
    class_names: Sequence[str] = (SINGLE_CLASS_NAME,),
    confirmed: dict[str, dict[int, str]] | None = None,
    ratios: Sequence[float] = DEFAULT_SPLIT,
    salt: str = "",
    min_area_px: int = MIN_INSTANCE_PX,
    band: int = SAR_BAND,
) -> BuildReport:
    """Write the ultralytics directory tree for `sources` under `root`.

    Produces `images/<split>/` and `labels/<split>/` plus `data.yaml`. Every
    image gets a label file, empty for a negative, because a *missing* label
    means "skip this image" to ultralytics where an empty one means "nothing
    here" -- and the negative pool exists precisely to say the latter.
    """

    if not sources:
        raise DatasetError("no source images to assemble")

    per_split: dict[str, int] = dict.fromkeys(SPLIT_NAMES, 0)
    negatives: dict[str, int] = dict.fromkeys(SPLIT_NAMES, 0)
    skipped: list[str] = []
    undersized: list[str] = []
    instances = 0

    for source in sources:
        split = assign_split(source.identity, ratios=ratios, salt=salt)
        image_target = root / "images" / split / f"{source.identity}{source.image.suffix}"
        label_target = root / "labels" / split / f"{source.identity}.txt"

        found: list[Instance] = []
        if source.mask is not None and not source.is_negative:
            array = _read_mask(source.mask)
            try:
                found = instances_for(
                    array,
                    confirmed=(confirmed or {}).get(source.identity) if confirmed else None,
                    class_names=class_names,
                    min_area_px=min_area_px,
                )
            except DatasetError as error:
                # An unconfirmed instance is a review gap, not a corrupt file.
                # Record it and leave the image out rather than guessing a class
                # or writing a label that claims the tile is empty.
                skipped.append(f"{source.identity}: {error}")
                continue

            if not found and binarise(array).any():
                # The mask marks a slick but every component fell below the area
                # floor. An empty label here does not mean "negative", it means
                # "this slick is background" -- which is a worse lesson than
                # leaving the image out. Measured 2026-08-31: 25 of 4,193
                # Refined SOS images, largest component 17-57 px.
                undersized.append(source.identity)
                continue

        materialise_image(source.image, image_target, band=band)
        instances += write_label_file(label_target, found)
        per_split[split] += 1
        if not found:
            negatives[split] += 1

    write_data_yaml(root / "data.yaml", root=root, class_names=class_names)

    return BuildReport(
        root=root,
        class_names=tuple(class_names),
        per_split=per_split,
        negatives_per_split=negatives,
        instances=instances,
        skipped=tuple(skipped),
        undersized=tuple(undersized),
    )
