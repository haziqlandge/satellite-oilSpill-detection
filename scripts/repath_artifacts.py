"""Make the training machine's artifacts resolve from any checkout.

Artifacts produced on the training machine embed absolute paths rooted at that
machine's home directory. Every byte they point at is present here and
hash-verified; only the prefix is wrong. That is the worst possible shape for a
bug, because nothing reports a path problem -- `data.yaml` reports a missing
dataset, the review pack reports a missing tile, and both read as corruption.

This script rewrites those references to a form the repository can resolve on
its own, and refuses to finish unless every rewritten reference names a file
that actually exists. It is idempotent: a second run finds nothing to do.

What each rewrite targets, and why that form:

``final-v*/{train,val,test}.txt``
    Ultralytics reads a split list and, for any line beginning with ``./``,
    replaces exactly that prefix with the list file's own directory
    (``BaseDataset.get_img_files``, ``x.replace("./", parent, 1)``). So a line
    written as ``./../oos/images/train/X.png`` resolves against the list, not
    against the working directory. The leading ``./`` is load-bearing: without
    it the line is passed through untouched.

``final-v*/data.yaml``
    The ``path:`` key is dropped rather than made relative. A relative ``path``
    is resolved against the *working directory* first and Ultralytics' global
    datasets directory second, so it would trade one machine dependency for
    another. With the key absent the dataset root falls back to the yaml file's
    own parent, which is what we mean (``check_det_dataset``, ``path =
    Path(extract_dir or data.get("path") or Path(data["yaml_file"]).parent)``).

``annotation-pilot/inventory.json``, ``annotation-pilot/reviews/*.json``,
``runs/**/release.json``
    Plain records, read by people and by ad-hoc tooling. Repo-relative POSIX
    strings, which are also what the generators now write.

The split lists under ``final-v11/`` are the frozen split the release was
trained on, so this rewrite is constrained to be provably content-preserving:
the ordered list of tile identities in each split is captured before the
rewrite and compared after. If a single identity moves, appears or disappears
the run aborts before writing. Only the prefix is allowed to change.
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

import yaml

from backend.config import REPO_ROOT

# Both machines check the project out into a directory ending in this, so the
# tail after it is the repo-relative path regardless of whose home it sat in.
ANCHOR = "oilspil2l16/oilspil2l/"


class Abort(RuntimeError):
    """A rewrite could not be made safely. Nothing further is written."""


def repo_relative(value: str) -> str | None:
    """The repo-relative tail of an absolute path, or None if it is not one.

    Accepts either separator, because the artifacts disagree -- the split lists
    use forward slashes and `inventory.json` uses escaped backslashes.
    """
    normalised = value.replace("\\", "/")
    index = normalised.lower().find(ANCHOR)
    if index < 0:
        return None
    return normalised[index + len(ANCHOR) :]


_RESOLVED: set[str] = set()


def _must_exist(relative: str, source: Path) -> None:
    """Every rewrite is checked. Memoised -- the manifests repeat themselves."""
    if relative in _RESOLVED:
        return
    if not (REPO_ROOT / relative).exists():
        raise Abort(f"{source}: rewritten reference does not resolve: {relative}")
    _RESOLVED.add(relative)


def _identities(lines: list[str]) -> list[str]:
    """Tile stems, in order. The invariant a split rewrite must preserve."""
    return [Path(line.replace("\\", "/")).stem for line in lines if line.strip()]


def _write(path: Path, text: str, *, apply: bool) -> None:
    if not apply:
        return
    backup = path.with_suffix(path.suffix + ".orig")
    if not backup.exists():
        shutil.copy2(path, backup)
    path.write_text(text, encoding="utf-8")


def fix_split_list(path: Path, *, apply: bool) -> int:
    lines = path.read_text(encoding="utf-8").splitlines()
    before = _identities(lines)
    changed = 0
    out: list[str] = []
    for line in lines:
        if not line.strip():
            continue
        relative = repo_relative(line)
        if relative is None:
            out.append(line)
            continue
        _must_exist(relative, path)
        target = (REPO_ROOT / relative).resolve()
        rewritten = "./" + target.relative_to(path.parent.resolve(), walk_up=True).as_posix()
        out.append(rewritten)
        changed += 1
    if changed and _identities(out) != before:
        raise Abort(f"{path}: rewrite changed the split contents; refusing")
    if changed:
        _write(path, "\n".join(out) + "\n", apply=apply)
    return changed


def fix_data_yaml(path: Path, *, apply: bool) -> int:
    document = yaml.safe_load(path.read_text(encoding="utf-8"))
    if "path" not in document:
        return 0
    document.pop("path")
    header = (
        "# No `path:` key on purpose. Ultralytics falls back to this file's own\n"
        "# directory, which is the only root that is correct on every machine; a\n"
        "# relative `path` would resolve against the working directory instead.\n"
        "# See scripts/repath_artifacts.py.\n"
    )
    _write(path, header + yaml.safe_dump(document, sort_keys=True), apply=apply)
    return 1


def _fix_json_fields(path: Path, fields: tuple[str, ...], *, apply: bool) -> int:
    document = json.loads(path.read_text(encoding="utf-8"))
    changed = 0

    def visit(node: object) -> None:
        nonlocal changed
        if isinstance(node, dict):
            for key, value in node.items():
                if key in fields and isinstance(value, str):
                    relative = repo_relative(value)
                    if relative is not None:
                        _must_exist(relative, path)
                        node[key] = relative
                        changed += 1
                else:
                    visit(value)
        elif isinstance(node, list):
            for item in node:
                visit(item)

    visit(document)
    if changed:
        _write(path, json.dumps(document, indent=2) + "\n", apply=apply)
    return changed


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--check",
        action="store_true",
        help="report what would change and exit non-zero if anything would; write nothing",
    )
    args = parser.parse_args(argv)
    apply = not args.check

    total = 0
    report: list[str] = []

    for version in sorted((REPO_ROOT / "data" / "processed" / "dataset").glob("final-v*")):
        for split in ("train", "val", "test"):
            listing = version / f"{split}.txt"
            if listing.exists():
                count = fix_split_list(listing, apply=apply)
                if count:
                    report.append(f"{listing.relative_to(REPO_ROOT)}: {count} lines")
                    total += count
        yaml_file = version / "data.yaml"
        if yaml_file.exists():
            count = fix_data_yaml(yaml_file, apply=apply)
            if count:
                report.append(f"{yaml_file.relative_to(REPO_ROOT)}: dropped absolute `path:`")
                total += count
        # Not in DATA.md's list, but affected in exactly the same way, and
        # `train_final.verify_data` cross-checks the manifest against the split
        # list -- so leaving it absolute while the lists went relative would
        # have failed the frozen-input preflight on both machines.
        manifest = version / "manifest.json"
        if manifest.exists():
            count = _fix_json_fields(manifest, ("path",), apply=apply)
            if count:
                report.append(f"{manifest.relative_to(REPO_ROOT)}: {count} references")
                total += count

    pilot = REPO_ROOT / "eval" / "phase2-closure" / "annotation-pilot"
    inventory = pilot / "inventory.json"
    if inventory.exists():
        count = _fix_json_fields(inventory, ("image",), apply=apply)
        if count:
            report.append(f"{inventory.relative_to(REPO_ROOT)}: {count} references")
            total += count
    for review in sorted((pilot / "reviews").glob("*.json")):
        count = _fix_json_fields(review, ("original_image", "original_mask"), apply=apply)
        if count:
            report.append(f"{review.relative_to(REPO_ROOT)}: {count} references")
            total += count

    for release in sorted((REPO_ROOT / "runs").glob("**/release.json")):
        count = _fix_json_fields(release, ("selection_report",), apply=apply)
        if count:
            report.append(f"{release.relative_to(REPO_ROOT)}: {count} references")
            total += count

    for line in report:
        print(("would fix " if args.check else "fixed ") + line)
    if not total:
        print("nothing to do; every artifact already resolves from the repository")
        return 0
    print(f"\n{'would rewrite' if args.check else 'rewrote'} {total} reference(s)")
    return 1 if args.check else 0


if __name__ == "__main__":
    raise SystemExit(main())
