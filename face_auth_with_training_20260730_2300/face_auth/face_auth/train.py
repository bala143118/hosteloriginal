"""
train.py
--------
CLI helper for enrolling faces into the existing face_auth engine.

This file intentionally does not implement any new face-recognition logic.
It simply orchestrates the already-existing `FaceAuthSystem.register_face()`
flow so training/enrollment can be run from a separate command.

Examples
--------
Train one person from a folder of photos:
    python -m face_auth.train --person alice --images photos/alice

Train many people from a dataset root where each subfolder is one identity:
    python -m face_auth.train --dataset photos
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

from . import config
from .face_auth import FaceAuthSystem


logger = logging.getLogger(__name__)


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Train/enroll face embeddings using the existing FaceAuthSystem "
            "registration pipeline."
        )
    )
    parser.add_argument(
        "--person",
        help="Person name for single-person training mode.",
    )
    parser.add_argument(
        "--images",
        type=Path,
        help="Folder containing images for one person.",
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        help=(
            "Dataset root for batch training. Each immediate subfolder name is "
            "used as the person name."
        ),
    )
    parser.add_argument(
        "--embeddings-dir",
        type=Path,
        help="Optional output folder for .npy embeddings.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Enable verbose logging.",
    )
    return parser


def _validate_args(args: argparse.Namespace, parser: argparse.ArgumentParser) -> None:
    single_mode = args.person is not None or args.images is not None
    batch_mode = args.dataset is not None

    if single_mode and batch_mode:
        parser.error("Use either --person/--images or --dataset, not both.")

    if not single_mode and not batch_mode:
        parser.error("Provide either --person and --images, or provide --dataset.")

    if single_mode and (args.person is None or args.images is None):
        parser.error("Single-person mode requires both --person and --images.")


def train_single_person(
    system: FaceAuthSystem,
    person_name: str,
    image_folder: Path,
) -> Path:
    if not image_folder.exists() or not image_folder.is_dir():
        raise ValueError(f"Image folder does not exist or is not a directory: {image_folder}")

    saved_path = system.register_face(image_folder=image_folder, person_name=person_name)
    logger.info("Trained '%s' -> %s", person_name, saved_path)
    return saved_path


def train_dataset(system: FaceAuthSystem, dataset_root: Path) -> tuple[list[Path], list[str]]:
    if not dataset_root.exists() or not dataset_root.is_dir():
        raise ValueError(f"Dataset folder does not exist or is not a directory: {dataset_root}")

    saved_paths: list[Path] = []
    failures: list[str] = []

    person_dirs = sorted(path for path in dataset_root.iterdir() if path.is_dir())
    if not person_dirs:
        raise ValueError(f"No person subfolders found in dataset: {dataset_root}")

    for person_dir in person_dirs:
        person_name = person_dir.name
        try:
            saved_path = train_single_person(system, person_name, person_dir)
            saved_paths.append(saved_path)
        except Exception as exc:  # continue training remaining identities
            failures.append(f"{person_name}: {exc}")
            logger.warning("Skipping '%s': %s", person_name, exc)

    return saved_paths, failures


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    _validate_args(args, parser)

    logging.basicConfig(
        level=logging.INFO if args.verbose else logging.WARNING,
        format="%(levelname)s: %(message)s",
    )

    system = FaceAuthSystem(
        embeddings_dir=args.embeddings_dir if args.embeddings_dir else config.EMBEDDINGS_DIR
    )

    try:
        if args.dataset is not None:
            saved_paths, failures = train_dataset(system, args.dataset)
            print(f"Trained {len(saved_paths)} identity(s).")
            for path in saved_paths:
                print(f"  OK  {path.stem} -> {path}")
            if failures:
                print(f"Skipped {len(failures)} identity(s).")
                for failure in failures:
                    print(f"  ERR {failure}")
                return 1
            return 0

        saved_path = train_single_person(system, args.person, args.images)
        print(f"Training complete: {args.person} -> {saved_path}")
        return 0
    except Exception as exc:
        print(f"Training failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
