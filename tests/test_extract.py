"""Archive extraction for the Zenodo corpus.

What these tests defend is the same invariant as `test_zenodo.py` and
`test_preprocess.py`: **a run that did not finish must not leave something a
later run mistakes for finished output.** The corpus is 80 GB and extraction is
long enough to be interrupted, so a half-populated directory sitting under the
final name would silently become a short training set.
"""

from __future__ import annotations

import zipfile
from pathlib import Path

import pytest

from backend.ingest.datasets.extract import (
    ExtractionError,
    Extractor,
    ExtractorNotFoundError,
    extract_archive,
    find_extractor,
)


def _zip_with(path: Path, names: dict[str, bytes]) -> Path:
    with zipfile.ZipFile(path, "w") as bundle:
        for name, payload in names.items():
            bundle.writestr(name, payload)
    return path


# --- zip, via the standard library ---------------------------------------


def test_a_zip_is_extracted_and_counted(tmp_path: Path) -> None:
    archive = _zip_with(tmp_path / "masks.zip", {"a.tif": b"1", "sub/b.tif": b"2"})
    destination = tmp_path / "out"

    assert extract_archive(archive, destination) == 2
    assert (destination / "a.tif").read_bytes() == b"1"
    assert (destination / "sub" / "b.tif").read_bytes() == b"2"


def test_an_existing_destination_is_left_alone(tmp_path: Path) -> None:
    """Re-running must be cheap and must not re-extract 38 GB."""

    archive = _zip_with(tmp_path / "masks.zip", {"a.tif": b"1"})
    destination = tmp_path / "out"
    destination.mkdir()
    (destination / "already.tif").write_bytes(b"kept")

    assert extract_archive(archive, destination) == 1
    assert (destination / "already.tif").read_bytes() == b"kept"
    assert not (destination / "a.tif").exists()


# --- the partial-name discipline ------------------------------------------


def test_a_failed_extraction_leaves_no_destination(tmp_path: Path) -> None:
    """The whole point: a failure must be invisible to the next run.

    A corrupt archive must not leave a directory under the final name, or the
    next run skips it and the missing images surface much later as a short
    dataset.
    """

    archive = tmp_path / "broken.zip"
    archive.write_bytes(b"this is not a zip file")
    destination = tmp_path / "out"

    with pytest.raises(zipfile.BadZipFile):
        extract_archive(archive, destination)

    assert not destination.exists()
    assert not destination.with_name("out.partial").exists()


def test_an_extractor_that_writes_nothing_is_an_error(tmp_path: Path) -> None:
    """WinRAR exits 0 having written nothing if the destination is malformed.

    Renaming that empty directory into place would mark the archive done
    forever. It has to be an error.
    """

    archive = tmp_path / "images.7z"
    archive.write_bytes(b"stub")
    destination = tmp_path / "out"

    quiet = Extractor(flavour="7zip", path=Path("does-not-matter"))

    def _fake_run(*args: object, **kwargs: object):
        class _Result:
            returncode = 0
            stdout = ""
            stderr = ""

        return _Result()

    import backend.ingest.datasets.extract as module

    original = module.subprocess.run
    module.subprocess.run = _fake_run  # type: ignore[assignment]
    try:
        with pytest.raises(ExtractionError, match="empty directory"):
            extract_archive(archive, destination, extractor=quiet)
    finally:
        module.subprocess.run = original  # type: ignore[assignment]

    assert not destination.exists()


def test_a_nonzero_exit_is_reported_with_its_output(tmp_path: Path) -> None:
    archive = tmp_path / "images.7z"
    archive.write_bytes(b"stub")

    def _fake_run(*args: object, **kwargs: object):
        class _Result:
            returncode = 2
            stdout = ""
            stderr = "cannot open archive"

        return _Result()

    import backend.ingest.datasets.extract as module

    original = module.subprocess.run
    module.subprocess.run = _fake_run  # type: ignore[assignment]
    try:
        with pytest.raises(ExtractionError, match="cannot open archive"):
            extract_archive(archive, tmp_path / "out", extractor=Extractor("7zip", Path("x")))
    finally:
        module.subprocess.run = original  # type: ignore[assignment]


def test_an_unsupported_archive_type_is_refused(tmp_path: Path) -> None:
    archive = tmp_path / "images.rar"
    archive.write_bytes(b"stub")

    with pytest.raises(ExtractionError, match="unsupported archive type"):
        extract_archive(archive, tmp_path / "out")


# --- command construction --------------------------------------------------
#
# Both of these are quiet when wrong: WinRAR reads a destination with no
# trailing separator as a file-name filter and extracts nothing while exiting 0,
# and 7-Zip needs its destination glued to `-o` with no space.


def test_winrar_destination_carries_a_trailing_separator() -> None:
    command = Extractor("winrar", Path("WinRAR.exe")).command(
        Path("a.7z"), Path("/tmp/out")
    )
    assert command[-1].endswith(("\\", "/"))
    assert "-y" in command and "-o+" in command


def test_sevenzip_destination_is_glued_to_the_flag() -> None:
    command = Extractor("7zip", Path("7z.exe")).command(Path("a.7z"), Path("/tmp/out"))
    joined = [part for part in command if part.startswith("-o")]
    assert joined and joined[0] != "-o"


def test_an_unknown_flavour_is_refused() -> None:
    with pytest.raises(ExtractionError, match="unknown extractor flavour"):
        Extractor("bzip", Path("x")).command(Path("a.7z"), Path("out"))


# --- discovery -------------------------------------------------------------


def test_find_extractor_prefers_an_existing_candidate(tmp_path: Path) -> None:
    present = tmp_path / "7z.exe"
    present.write_bytes(b"")

    found = find_extractor((("7zip", str(tmp_path / "absent.exe")), ("7zip", str(present))))
    assert found.path == present


def test_find_extractor_names_what_to_install(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ZENODO_EXTRACTOR", raising=False)
    monkeypatch.setattr("shutil.which", lambda _: None)

    with pytest.raises(ExtractorNotFoundError, match="winget install"):
        find_extractor((("7zip", str(tmp_path / "absent.exe")),))


def test_the_env_override_wins(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    override = tmp_path / "WinRAR.exe"
    override.write_bytes(b"")
    monkeypatch.setenv("ZENODO_EXTRACTOR", str(override))

    found = find_extractor()
    assert found.path == override
    assert found.flavour == "winrar"


def test_a_missing_env_override_is_an_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ZENODO_EXTRACTOR", str(tmp_path / "nope.exe"))

    with pytest.raises(ExtractorNotFoundError, match="does not exist"):
        find_extractor()
