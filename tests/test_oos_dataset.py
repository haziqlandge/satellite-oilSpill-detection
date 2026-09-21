"""YOLO-seg dataset assembly from the Zenodo corpus.

The two things most worth defending here are silent rather than loud:

* **Axis order.** `skimage` yields `(row, col)`; ultralytics wants `(x, y)`.
  Swapping them produces a perfectly well-formed label file describing a
  transposed slick, and training simply gets worse for no visible reason.
* **Split stability.** A split derived from `hash()` reshuffles every
  interpreter run, leaking validation images into training across resumed runs.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest

from ml.datasets.oos_dataset import (
    DB_WINDOW,
    DEFAULT_SPLIT,
    SAR_BAND,
    SINGLE_CLASS_NAME,
    DatasetError,
    Instance,
    SourceImage,
    assign_split,
    build_dataset,
    db_to_uint8,
    discover_paired,
    discover_part_one,
    discover_part_three,
    discover_refined_sos,
    instances_for,
    is_corpus_file,
    link_or_copy,
    mask_path_for,
    mask_to_polygons,
    materialise_image,
    negative_budget,
    sensor_of,
    write_data_yaml,
    write_label_file,
)


def _rectangle(height: int = 200, width: int = 200) -> np.ndarray:
    """A single axis-aligned block, wider than it is tall."""

    mask = np.zeros((height, width), dtype=np.uint8)
    mask[50:100, 20:160] = 1  # rows 50-99, cols 20-159
    return mask


# --- polygon extraction ----------------------------------------------------


def test_a_single_slick_becomes_one_polygon() -> None:
    polygons = mask_to_polygons(_rectangle())

    assert len(polygons) == 1
    assert len(polygons[0]) >= 3


def test_review_ids_survive_filtering_earlier_specks() -> None:
    from backend.ingest.datasets.relabel import analyse_mask

    mask = _rectangle()
    mask[0, 0] = 1
    reviewed_id = analyse_mask(mask)[0].label
    assert reviewed_id == 2
    result = instances_for(
        mask, confirmed={reviewed_id: "slick_unknown"}, class_names=("oos", "slick_unknown")
    )
    assert len(result) == 1 and result[0].class_index == 1


def test_two_class_missing_review_never_defaults_to_oos() -> None:
    with pytest.raises(DatasetError, match="confirmed"):
        instances_for(_rectangle(), class_names=("oos", "slick_unknown"))


def test_partial_review_omits_unreviewed_source(tmp_path: Path) -> None:
    image = _png(tmp_path / "source.png", _rectangle() * 255)
    report = build_dataset(
        [SourceImage(identity="unreviewed", image=image, mask=image)],
        tmp_path / "dataset",
        class_names=("oos", "slick_unknown"),
        confirmed={"another-source": {1: "oos"}},
    )
    assert report.total == 0 and len(report.skipped) == 1
    assert not list((tmp_path / "dataset" / "labels").rglob("*.txt"))


def test_two_class_rebuild_cannot_keep_stale_unreviewed_labels(tmp_path: Path) -> None:
    image = _png(tmp_path / "source.png", _rectangle() * 255)
    root = tmp_path / "existing-dataset"
    stale = root / "labels" / "train" / "unreviewed.txt"
    stale.parent.mkdir(parents=True)
    stale.write_text("previous label")
    with pytest.raises(DatasetError, match="new output directory"):
        build_dataset(
            [SourceImage(identity="unreviewed", image=image, mask=image)],
            root,
            class_names=("oos", "slick_unknown"),
            confirmed={},
        )
    assert stale.read_text() == "previous label"


def test_coordinates_are_normalised_x_y_not_row_col() -> None:
    """The axis swap, pinned.

    The block spans columns 20-159 of 200 and rows 50-99 of 200, so x must
    cover roughly 0.10-0.80 and y roughly 0.25-0.50. If row and column were
    swapped the two ranges would trade places and nothing else would complain.
    """

    (polygon,) = mask_to_polygons(_rectangle())
    xs = [x for x, _ in polygon]
    ys = [y for _, y in polygon]

    assert min(xs) == pytest.approx(0.10, abs=0.02)
    assert max(xs) == pytest.approx(0.80, abs=0.02)
    assert min(ys) == pytest.approx(0.25, abs=0.02)
    assert max(ys) == pytest.approx(0.50, abs=0.02)

    # And the ranges are genuinely different, so the assertion above cannot
    # pass by coincidence on a square slick.
    assert max(xs) - min(xs) > max(ys) - min(ys)


def test_every_coordinate_is_inside_the_unit_square() -> None:
    polygons = mask_to_polygons(_rectangle())

    for polygon in polygons:
        for x, y in polygon:
            assert 0.0 <= x <= 1.0
            assert 0.0 <= y <= 1.0


def test_a_slick_touching_the_border_is_still_closed() -> None:
    """Tiling puts slicks against the tile edge; that is the normal case.

    `find_contours` will not close a contour running off the array edge, which
    is why the mask is padded first.
    """

    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[0:40, 0:40] = 1  # flush against two borders

    polygons = mask_to_polygons(mask)

    assert len(polygons) == 1
    assert len(polygons[0]) >= 3


def test_two_separate_slicks_stay_two_instances() -> None:
    mask = np.zeros((200, 200), dtype=np.uint8)
    mask[20:60, 20:60] = 1
    mask[120:170, 120:170] = 1

    assert len(mask_to_polygons(mask)) == 2


def test_specks_below_the_area_floor_are_dropped() -> None:
    mask = np.zeros((100, 100), dtype=np.uint8)
    mask[10:40, 10:40] = 1  # 900 px, kept
    mask[80, 80] = 1  # 1 px of speckle, dropped

    assert len(mask_to_polygons(mask)) == 1


def test_an_empty_mask_yields_nothing() -> None:
    assert mask_to_polygons(np.zeros((50, 50), dtype=np.uint8)) == []


def test_a_band_first_mask_is_handled() -> None:
    """The real Part I layout: rasterio gives (bands, H, W).

    Guards the same channel-order trap `binarise` was fixed for on 2026-08-31.
    """

    plane = _rectangle()
    assert mask_to_polygons(plane[np.newaxis, ...]) == mask_to_polygons(plane)


def test_a_zero_to_255_mask_matches_a_zero_to_one_mask() -> None:
    """Both encodings are in circulation across the four Zenodo records."""

    plane = _rectangle()
    assert mask_to_polygons(plane * 255) == mask_to_polygons(plane)


# --- splitting -------------------------------------------------------------


def test_the_split_is_stable_across_calls() -> None:
    identities = [f"{n:05d}.tif" for n in range(50)]
    first = [assign_split(i) for i in identities]
    second = [assign_split(i) for i in identities]

    assert first == second


def test_the_split_lands_near_eight_one_one() -> None:
    identities = [f"{n:05d}.tif" for n in range(20_000)]
    counts = {"train": 0, "val": 0, "test": 0}
    for identity in identities:
        counts[assign_split(identity)] += 1

    total = sum(counts.values())
    assert counts["train"] / total == pytest.approx(0.8, abs=0.02)
    assert counts["val"] / total == pytest.approx(0.1, abs=0.02)
    assert counts["test"] / total == pytest.approx(0.1, abs=0.02)


def test_an_image_never_lands_in_two_splits() -> None:
    assert assign_split("00042.tif") in {"train", "val", "test"}


def test_a_salt_changes_the_split() -> None:
    identities = [f"{n:05d}.tif" for n in range(200)]
    plain = [assign_split(i) for i in identities]
    salted = [assign_split(i, salt="fold2") for i in identities]

    assert plain != salted


def test_wrong_ratio_count_is_refused() -> None:
    with pytest.raises(DatasetError, match="split ratios"):
        assign_split("a.tif", ratios=(0.9, 0.1))


# --- class assignment ------------------------------------------------------


def test_single_class_mode_labels_every_instance_zero() -> None:
    instances = instances_for(_rectangle())

    assert [i.class_index for i in instances] == [0]


def test_an_unconfirmed_instance_raises_rather_than_defaulting() -> None:
    """The point of the whole relabelling design: never guess a class.

    Defaulting an unreviewed instance to a class is exactly how an unchecked
    guess reaches the training set.
    """

    with pytest.raises(DatasetError, match="no confirmed class"):
        instances_for(_rectangle(), confirmed={}, class_names=("oos", "slick_unknown"))


def test_a_confirmed_class_outside_the_scheme_raises() -> None:
    with pytest.raises(DatasetError, match="not in the scheme"):
        instances_for(
            _rectangle(),
            confirmed={1: "definitely_oil"},
            class_names=("oos", "slick_unknown"),
        )


def test_a_confirmed_class_becomes_its_scheme_index() -> None:
    instances = instances_for(
        _rectangle(),
        confirmed={1: "slick_unknown"},
        class_names=("oos", "slick_unknown"),
    )

    assert [i.class_index for i in instances] == [1]


# --- label files -----------------------------------------------------------


def test_a_label_line_is_class_then_normalised_pairs() -> None:
    instance = Instance(class_index=1, polygon=((0.25, 0.5), (0.75, 0.5), (0.5, 0.9)))

    parts = instance.to_label_line().split()
    assert parts[0] == "1"
    assert len(parts) == 1 + 3 * 2
    assert all(0.0 <= float(p) <= 1.0 for p in parts[1:])


def test_a_negative_gets_an_empty_label_file_not_a_missing_one(tmp_path: Path) -> None:
    """A missing label means "skip this image" to ultralytics.

    An empty one means "genuinely nothing here", which is the entire purpose of
    the look-alike negative pool.
    """

    path = tmp_path / "labels" / "train" / "00001.txt"
    assert write_label_file(path, []) == 0

    assert path.exists()
    assert path.read_text() == ""


def test_a_written_label_file_round_trips(tmp_path: Path) -> None:
    path = tmp_path / "00001.txt"
    instances = instances_for(_rectangle())

    assert write_label_file(path, instances) == 1
    line = path.read_text().strip()
    assert line.startswith("0 ")
    assert len(line.split()) % 2 == 1  # class + an even number of coordinates


# --- data.yaml and the negative budget -------------------------------------


def test_data_yaml_declares_the_classes_in_index_order(tmp_path: Path) -> None:
    path = write_data_yaml(
        tmp_path / "data.yaml", root=tmp_path, class_names=("oos", "slick_unknown")
    )
    text = path.read_text()

    assert "nc: 2" in text
    assert "  0: oos" in text
    assert "  1: slick_unknown" in text
    assert "train: images/train" in text


def test_single_class_yaml_does_not_claim_the_two_class_scheme(tmp_path: Path) -> None:
    """A binary baseline must be impossible to mistake for the real model."""

    path = write_data_yaml(tmp_path / "data.yaml", root=tmp_path, class_names=(SINGLE_CLASS_NAME,))
    declarations = [line for line in path.read_text().splitlines() if line.startswith("  ")]

    assert "nc: 1" in path.read_text()
    assert declarations == [f"  0: {SINGLE_CLASS_NAME}"]
    assert not any(name in line for line in declarations for name in ("oos", "slick_unknown"))


def test_the_negative_budget_is_a_share_of_the_final_split() -> None:
    """P004 section 2.4 is 200 *of* 2048, not 200 added to 2048."""

    assert negative_budget(2048, 0.0) == 0
    assert negative_budget(900, 0.10) == 100  # 100 of 1000 final
    assert negative_budget(2048, 0.10) == 228


def test_an_impossible_negative_fraction_is_refused() -> None:
    with pytest.raises(DatasetError, match="negative fraction"):
        negative_budget(100, 1.0)


def test_default_split_is_eight_one_one() -> None:
    assert DEFAULT_SPLIT == (0.8, 0.1, 0.1)


# --- reading the real corpus ----------------------------------------------
#
# Every convention asserted below was measured against the extracted archives
# on 2026-08-31, and every one of them fails silently when got wrong.


def _touch(path: Path) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"")
    return path


def test_macos_packaging_debris_is_not_corpus_data() -> None:
    """Record 15298010 ships an AppleDouble shadow for every real file.

    16,148 of them. Pairing a 4 KB resource fork with a real mask either throws
    in the loader or reads metadata bytes as an image.
    """

    assert is_corpus_file(Path("images/train/sentinel_0.png"))
    assert not is_corpus_file(Path("images/train/._sentinel_0.png"))
    assert not is_corpus_file(Path("__MACOSX/images/train/sentinel_0.png"))
    assert not is_corpus_file(Path("images/.DS_Store"))


def test_the_mask_suffix_is_resolved(tmp_path: Path) -> None:
    """Record 13761290 stores `00000.tif` as `00000_segmentation.tif`.

    Matching on the bare stem finds zero pairs across all 450 images.
    """

    images, masks = tmp_path / "Images", tmp_path / "Mask"
    _touch(images / "00000.tif")
    _touch(masks / "00000_segmentation.tif")

    assert mask_path_for(images / "00000.tif", masks, suffix="_segmentation") is not None
    assert mask_path_for(images / "00000.tif", masks) is None


def test_an_image_with_no_mask_is_an_error_not_a_silent_drop(tmp_path: Path) -> None:
    """An unpaired image becomes an unlabelled example teaching "no slick here"."""

    images, masks = tmp_path / "Images", tmp_path / "Mask"
    _touch(images / "00000.tif")
    masks.mkdir(parents=True)

    with pytest.raises(DatasetError, match="have no mask"):
        discover_paired(images, masks, record_id="13761290")


def test_identities_are_unique_across_categories(tmp_path: Path) -> None:
    """Record 13761290 restarts numbering per category: `00000` names three files.

    Flattened on the bare stem, two thirds of the corpus overwrites itself in
    the output directory.
    """

    for category in ("Oil", "Lookalike", "No oil"):
        _touch(tmp_path / "Images" / category / "00000.tif")
        _touch(tmp_path / "Mask" / category / "00000_segmentation.tif")

    sources = discover_part_three(tmp_path)

    assert len(sources) == 3
    assert len({s.identity for s in sources}) == 3


def test_lookalike_and_no_oil_are_marked_negative(tmp_path: Path) -> None:
    for category in ("Oil", "Lookalike", "No oil"):
        _touch(tmp_path / "Images" / category / "00000.tif")
        _touch(tmp_path / "Mask" / category / "00000_segmentation.tif")

    negatives = {s.identity.split("__")[1] for s in discover_part_three(tmp_path) if s.is_negative}

    assert negatives == {"Lookalike", "No_oil"}


def test_palsar_is_excluded_by_default(tmp_path: Path) -> None:
    """Record 15298010 is 48% ALOS PALSAR L-band; this pipeline is S1 C-band.

    Oil damps capillary waves differently between the two bands, so taking the
    lot has to be a deliberate, recorded act rather than the default.
    """

    images, masks = tmp_path / "images", tmp_path / "masks"
    for name in ("sentinel_0.png", "palsar_0.png"):
        _touch(images / "train" / name)
        _touch(masks / "train" / name)

    default = discover_refined_sos(images, masks)
    everything = discover_refined_sos(images, masks, sensors=None)

    assert [s.image.name for s in default] == ["sentinel_0.png"]
    assert len(everything) == 2


def test_sensor_is_read_from_the_file_stem() -> None:
    assert sensor_of(Path("sentinel_1234.png")) == "sentinel"
    assert sensor_of(Path("palsar_7.png")) == "palsar"


def test_junk_is_skipped_during_discovery(tmp_path: Path) -> None:
    images, masks = tmp_path / "images", tmp_path / "masks"
    _touch(images / "train" / "sentinel_0.png")
    _touch(masks / "train" / "sentinel_0.png")
    _touch(images / "train" / "._sentinel_0.png")
    _touch(images / "train" / ".DS_Store")

    assert len(discover_refined_sos(images, masks)) == 1


# --- building the tree -----------------------------------------------------


def _png(path: Path, array: np.ndarray) -> Path:
    import imageio.v3 as iio

    path.parent.mkdir(parents=True, exist_ok=True)
    iio.imwrite(path, array.astype(np.uint8))
    return path


def _corpus(tmp_path: Path, positives: int = 6, negatives: int = 2) -> list[SourceImage]:
    sources: list[SourceImage] = []
    for n in range(positives):
        image = _png(tmp_path / "src" / f"pos_{n}.png", np.zeros((80, 80), np.uint8))
        mask = _png(tmp_path / "src" / f"pos_{n}_m.png", _rectangle(80, 80) * 255)
        sources.append(SourceImage(identity=f"r__pos_{n}", image=image, mask=mask))
    for n in range(negatives):
        image = _png(tmp_path / "src" / f"neg_{n}.png", np.zeros((80, 80), np.uint8))
        sources.append(
            SourceImage(identity=f"r__neg_{n}", image=image, mask=None, is_negative=True)
        )
    return sources


def test_build_writes_images_labels_and_data_yaml(tmp_path: Path) -> None:
    report = build_dataset(_corpus(tmp_path), tmp_path / "ds")

    assert (tmp_path / "ds" / "data.yaml").exists()
    assert report.total == 8
    assert report.instances > 0

    for split in ("train", "val", "test"):
        for name in (tmp_path / "ds" / "images" / split).glob("*.png"):
            assert (tmp_path / "ds" / "labels" / split / f"{name.stem}.txt").exists()


def test_every_image_gets_a_label_file_including_negatives(tmp_path: Path) -> None:
    """A missing label is "skip me"; the negative pool must say "nothing here"."""

    build_dataset(_corpus(tmp_path), tmp_path / "ds")

    images = list((tmp_path / "ds" / "images").rglob("*.png"))
    labels = list((tmp_path / "ds" / "labels").rglob("*.txt"))

    assert len(images) == len(labels) == 8
    assert any(path.read_text() == "" for path in labels)  # the negatives


def test_an_unconfirmed_image_is_skipped_and_reported_not_silently_emptied(
    tmp_path: Path,
) -> None:
    """The dangerous alternative is writing an empty label for a real slick.

    That would teach the model the tile is background, which is worse than
    leaving it out -- so it must be excluded *and* named in the report.
    """

    sources = _corpus(tmp_path, positives=2, negatives=0)
    report = build_dataset(
        sources,
        tmp_path / "ds",
        class_names=("oos", "slick_unknown"),
        confirmed={s.identity: {} for s in sources},
    )

    assert report.total == 0
    assert len(report.skipped) == 2
    assert "no confirmed class" in report.skipped[0]


def test_building_the_same_corpus_twice_is_stable(tmp_path: Path) -> None:
    sources = _corpus(tmp_path)
    first = build_dataset(sources, tmp_path / "a")
    second = build_dataset(sources, tmp_path / "b")

    assert first.per_split == second.per_split


def test_an_empty_corpus_is_refused(tmp_path: Path) -> None:
    with pytest.raises(DatasetError, match="no source images"):
        build_dataset([], tmp_path / "ds")


def test_link_or_copy_does_not_duplicate_bytes(tmp_path: Path) -> None:
    source = tmp_path / "a.bin"
    source.write_bytes(b"payload")
    target = tmp_path / "out" / "a.bin"

    link_or_copy(source, target)

    assert target.read_bytes() == b"payload"
    link_or_copy(source, target)  # idempotent
    assert target.read_bytes() == b"payload"


def test_a_slick_below_the_area_floor_is_excluded_not_called_empty(tmp_path: Path) -> None:
    """An empty label for a real slick teaches "this is background".

    Measured on the real corpus: 25 of 4,193 Refined SOS images carry a mask
    whose every component sits below the floor (largest 17-57 px). Emitting an
    empty label for those is a worse lesson than leaving them out, so they are
    excluded and counted separately from genuine negatives.
    """

    speck = np.zeros((80, 80), np.uint8)
    speck[40, 40] = 255  # 1 px: real foreground, far below the floor

    image = _png(tmp_path / "src" / "tiny.png", np.zeros((80, 80), np.uint8))
    mask = _png(tmp_path / "src" / "tiny_m.png", speck)
    blank = _png(tmp_path / "src" / "blank.png", np.zeros((80, 80), np.uint8))
    blank_mask = _png(tmp_path / "src" / "blank_m.png", np.zeros((80, 80), np.uint8))

    report = build_dataset(
        [
            SourceImage(identity="r__tiny", image=image, mask=mask),
            SourceImage(identity="r__blank", image=blank, mask=blank_mask),
        ],
        tmp_path / "ds",
    )

    # The genuinely blank mask is kept as a negative; the speck is not.
    assert report.undersized == ("r__tiny",)
    assert report.total == 1
    assert list((tmp_path / "ds" / "labels").rglob("r__tiny.txt")) == []
    assert list((tmp_path / "ds" / "images").rglob("r__tiny*")) == []
    assert len(list((tmp_path / "ds" / "images").rglob("r__blank*"))) == 1


# --- SAR float32 dB conversion ---------------------------------------------


def test_the_db_window_is_fixed_not_per_image() -> None:
    """The whole point: the absolute dB level carries the class signal.

    Measured per-image band-2 means are Oil -21.5, Lookalike -20.2, No oil
    -12.7 dB. A per-image stretch maps every one of those to the same output
    range and destroys the separation. Two arrays that differ only in level
    must therefore convert to *different* pixel values.
    """

    dark = np.full((8, 8), -30.0, dtype=np.float32)
    bright = np.full((8, 8), -12.0, dtype=np.float32)

    assert db_to_uint8(dark).mean() < db_to_uint8(bright).mean()


def test_the_window_clips_rather_than_wrapping() -> None:
    extreme = np.array([[-100.0, 100.0]], dtype=np.float32)

    out = db_to_uint8(extreme)
    assert out[0, 0] == 0
    assert out[0, 1] == 255


def test_the_window_endpoints_map_to_the_full_range() -> None:
    low, high = DB_WINDOW
    out = db_to_uint8(np.array([[low, high]], dtype=np.float32))

    assert (out[0, 0], out[0, 1]) == (0, 255)


def test_an_inverted_window_is_refused() -> None:
    with pytest.raises(DatasetError, match="not increasing"):
        db_to_uint8(np.zeros((2, 2), np.float32), window=(0.0, -35.0))


def test_the_default_band_is_the_signal_bearing_one() -> None:
    """Band 1 (VH) shows 0.51 dB slick contrast; band 2 (VV) shows 7.01 dB.

    Defaulting to band 1 -- the obvious "read the first band" -- would hand the
    model an image with no slick signal in it.
    """

    assert SAR_BAND == 2


def test_a_float_geotiff_is_converted_to_png_not_linked(tmp_path: Path) -> None:
    """PIL cannot open a 2-band float32 GeoTIFF at all."""

    import rasterio

    source = tmp_path / "scene.tif"
    data = np.stack(
        [
            np.full((16, 16), -29.0, dtype=np.float32),  # band 1, flat
            np.full((16, 16), -20.0, dtype=np.float32),  # band 2, the signal
        ]
    )
    with rasterio.open(
        source, "w", driver="GTiff", height=16, width=16, count=2, dtype="float32"
    ) as dst:
        dst.write(data)

    target = materialise_image(source, tmp_path / "out" / "scene.tif")

    assert target.suffix == ".png"
    assert target.exists()

    from PIL import Image

    with Image.open(target) as opened:  # the check that actually matters
        opened.load()

    # Band 2 was used: -20 dB in a [-35, 0] window is ~109, not band 1's ~44.
    assert abs(int(np.asarray(iio_read(target)).mean()) - 109) <= 2


def iio_read(path: Path) -> np.ndarray:
    import imageio.v3 as iio

    return np.asarray(iio.imread(path))


def test_an_eight_bit_png_is_linked_unchanged(tmp_path: Path) -> None:
    source = _png(tmp_path / "a.png", np.full((8, 8), 120, np.uint8))
    target = materialise_image(source, tmp_path / "out" / "a.png")

    assert target.suffix == ".png"
    assert iio_read(target).mean() == pytest.approx(120, abs=1)


def test_part_one_pairs_across_two_archive_roots(tmp_path: Path) -> None:
    """Record 8346860 ships images and masks in separately named archives.

    `01_Train_Val_Oil_Spill_images/Oil/` against
    `01_Train_Val_Oil_Spill_mask/Mask_oil/` -- different roots, matching stems,
    no `_segmentation` suffix. Reusing Part III's pairing rule here finds
    nothing; reusing Part I's rule on Part III finds nothing either.
    """

    images = tmp_path / "01_Train_Val_Oil_Spill_images"
    masks = tmp_path / "01_Train_Val_Oil_Spill_mask"
    for n in range(3):
        _touch(images / "Oil" / f"{n:05d}.tif")
        _touch(masks / "Mask_oil" / f"{n:05d}.tif")

    sources = discover_part_one(images, masks)

    assert len(sources) == 3
    assert all(not s.is_negative for s in sources)  # Part I is all positives
    assert sources[0].identity == "8346860__Oil__00000"
    assert sources[0].mask is not None and sources[0].mask.name == "00000.tif"


def test_part_one_identities_do_not_collide_with_part_three(tmp_path: Path) -> None:
    """Both records number from 00000 and both have an `Oil` category."""

    images = tmp_path / "01_Train_Val_Oil_Spill_images"
    masks = tmp_path / "01_Train_Val_Oil_Spill_mask"
    _touch(images / "Oil" / "00000.tif")
    _touch(masks / "Mask_oil" / "00000.tif")

    three = tmp_path / "p3"
    for category in ("Oil", "Lookalike", "No oil"):
        _touch(three / "Images" / category / "00000.tif")
        _touch(three / "Mask" / category / "00000_segmentation.tif")

    one = discover_part_one(images, masks)
    other = discover_part_three(three)

    assert one[0].identity != other[0].identity
