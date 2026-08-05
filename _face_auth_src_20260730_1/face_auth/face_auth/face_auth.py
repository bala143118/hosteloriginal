"""
face_auth.py
------------
Top-level API for the face authentication module:

    * register_face(image_folder, person_name) -> Path
    * authenticate(frame) -> list[AuthResult]
    * draw_results(frame, results) -> np.ndarray

This file wires together detector.py, recognizer.py, embedding_manager.py,
and utils.py. It intentionally contains NO database, web server, or login
logic - it is a pure computer-vision component meant to be imported into a
larger application, which owns identity/session/user-management concerns.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

from . import config, embedding_manager
from .detector import Detection, FaceDetector
from .recognizer import FaceRecognizer
from .utils import assess_face_quality

logger = logging.getLogger(__name__)


@dataclass
class AuthResult:
    """Result of matching a single detected face against known identities."""

    name: str                              # matched name, or "Unknown"
    confidence: float                      # cosine similarity to best match, 0-1-ish
    bbox: tuple[int, int, int, int]        # (x1, y1, x2, y2)
    matched: bool                          # True iff confidence >= MATCH_THRESHOLD


class FaceAuthSystem:
    """
    Stateful facade combining detection, recognition, and embedding storage.

    Construct one instance and reuse it - it lazily loads the (fairly
    heavy) InsightFace models once, and caches the known-embeddings dict in
    memory, refreshing it whenever `register_face` is called or on demand
    via `reload_known_faces()`.
    """

    def __init__(
        self,
        embeddings_dir: Path = config.EMBEDDINGS_DIR,
        face_threshold: float = config.FACE_THRESHOLD,
        match_threshold: float = config.MATCH_THRESHOLD,
        min_face_size: int = config.MIN_FACE_SIZE,
    ) -> None:
        self.embeddings_dir = Path(embeddings_dir)
        self.face_threshold = face_threshold
        self.match_threshold = match_threshold
        self.min_face_size = min_face_size

        self.detector = FaceDetector(face_threshold=face_threshold)
        self.recognizer = FaceRecognizer()
        self.known_embeddings: dict[str, np.ndarray] = embedding_manager.load_embeddings(
            self.embeddings_dir
        )

    # -- Registration --------------------------------------------------

    def register_face(self, image_folder: str | Path, person_name: str) -> Path:
        """
        Build one identity embedding from a folder of 10-30 photos of a
        single person and persist it as `<embeddings_dir>/<person_name>.npy`.

        Pipeline per image:
            1. load image
            2. detect faces, keep the single largest/most-confident face
               (registration photos are assumed to contain one person)
            3. reject faces below MIN_FACE_SIZE / FACE_THRESHOLD
            4. reject blurry / too dark / too bright crops
            5. reject extreme side-profile shots (yaw too large to align well)
            6. align to canonical 112x112 and extract an ArcFace embedding

        All surviving per-image embeddings are averaged (in normalized
        space) into one robust identity embedding.

        Raises
        ------
        ValueError
            If fewer than `config.MIN_REGISTRATION_IMAGES` usable faces are
            found across the folder, or the folder contains no images.
        """
        image_folder = Path(image_folder)
        image_paths = sorted(
            p
            for p in image_folder.iterdir()
            if p.suffix.lower() in {".jpg", ".jpeg", ".png", ".bmp", ".webp"}
        )
        if not image_paths:
            raise ValueError(f"No image files found in {image_folder}")

        if len(image_paths) > config.MAX_REGISTRATION_IMAGES:
            logger.info(
                "Received %d images; using the first %d as per MAX_REGISTRATION_IMAGES.",
                len(image_paths), config.MAX_REGISTRATION_IMAGES,
            )
            image_paths = image_paths[: config.MAX_REGISTRATION_IMAGES]

        embeddings: list[np.ndarray] = []
        rejected: list[tuple[str, str]] = []

        for image_path in image_paths:
            image = cv2.imread(str(image_path))
            if image is None:
                rejected.append((image_path.name, "unreadable image file"))
                continue

            detections = self.detector.detect_faces(image)
            if not detections:
                rejected.append((image_path.name, "no face detected"))
                continue

            # Assume one subject per registration photo: take the largest,
            # highest-confidence detection (already sorted by det_score;
            # break ties by size to avoid picking a small background face).
            detection = max(detections, key=lambda d: (d.det_score, d.size))

            if detection.size < self.min_face_size:
                rejected.append((image_path.name, "face too small"))
                continue

            if abs(detection.yaw_deg) > config.MAX_REGISTRATION_YAW:
                rejected.append(
                    (image_path.name, f"pose too extreme (yaw={detection.yaw_deg:.1f}deg)")
                )
                continue

            x1, y1, x2, y2 = detection.bbox
            crop = image[y1:y2, x1:x2]
            quality = assess_face_quality(crop, min_size=self.min_face_size)
            if not quality.passed:
                rejected.append((image_path.name, quality.reason))
                continue

            embedding = self.recognizer.get_embedding(image, detection)
            embeddings.append(embedding)

        if rejected:
            logger.info(
                "register_face(%s): rejected %d/%d images: %s",
                person_name, len(rejected), len(image_paths), rejected,
            )

        if len(embeddings) < config.MIN_REGISTRATION_IMAGES:
            raise ValueError(
                f"Only {len(embeddings)} usable face image(s) found for "
                f"'{person_name}' (need >= {config.MIN_REGISTRATION_IMAGES}). "
                f"Rejected images: {rejected}"
            )

        final_embedding = FaceRecognizer.average_embeddings(embeddings)
        saved_path = embedding_manager.save_embedding(
            person_name, final_embedding, self.embeddings_dir
        )

        # Keep the in-memory cache in sync for immediate use by authenticate().
        self.known_embeddings[person_name] = final_embedding

        logger.info(
            "Registered '%s' from %d/%d usable images -> %s",
            person_name, len(embeddings), len(image_paths), saved_path,
        )
        return saved_path

    def reload_known_faces(self) -> None:
        """Re-read all `.npy` files from `embeddings_dir` into memory."""
        self.known_embeddings = embedding_manager.load_embeddings(self.embeddings_dir)

    # -- Authentication --------------------------------------------------

    def authenticate(self, frame: np.ndarray) -> list[AuthResult]:
        """
        Detect every face in `frame`, compare each against the known
        identity embeddings, and return one `AuthResult` per detected face
        (including unmatched/unknown ones, so callers can still draw boxes
        for every face seen).
        """
        results: list[AuthResult] = []
        if frame is None or frame.size == 0:
            return results

        detections = self.detector.detect_faces(frame)

        for detection in detections:
            if detection.size < self.min_face_size:
                # Too small/far to trust a recognition decision - report as
                # unknown rather than silently dropping the box, so the
                # caller's UI can still indicate "a face was seen here".
                results.append(
                    AuthResult(
                        name="Unknown",
                        confidence=0.0,
                        bbox=detection.bbox,
                        matched=False,
                    )
                )
                continue

            embedding = self.recognizer.get_embedding(frame, detection)
            name, score = embedding_manager.find_best_match(
                embedding, self.known_embeddings
            )

            matched = name is not None and score >= self.match_threshold
            results.append(
                AuthResult(
                    name=name if matched else "Unknown",
                    confidence=max(score, 0.0),
                    bbox=detection.bbox,
                    matched=matched,
                )
            )

        return results

    # -- Visualization --------------------------------------------------

    def draw_results(
        self,
        frame: np.ndarray,
        results: list[AuthResult] | None = None,
    ) -> np.ndarray:
        """
        Draw bounding boxes + labels onto a copy of `frame`:
            * green box + name + confidence for matched/authenticated faces
            * red box + "Unknown" + confidence for unmatched faces

        If `results` is not provided, `authenticate(frame)` is run
        internally for convenience.
        """
        if results is None:
            results = self.authenticate(frame)

        annotated = frame.copy()
        green = (0, 200, 0)
        red = (0, 0, 255)

        for result in results:
            color = green if result.matched else red
            x1, y1, x2, y2 = result.bbox
            cv2.rectangle(annotated, (x1, y1), (x2, y2), color, 2)

            label = f"{result.name} ({result.confidence * 100:.1f}%)"
            (text_w, text_h), baseline = cv2.getTextSize(
                label, cv2.FONT_HERSHEY_SIMPLEX, 0.55, 1
            )
            label_y1 = max(y1 - text_h - baseline - 4, 0)
            cv2.rectangle(
                annotated, (x1, label_y1), (x1 + text_w + 4, y1), color, thickness=-1
            )
            cv2.putText(
                annotated,
                label,
                (x1 + 2, y1 - 4 if y1 - 4 > text_h else y1 + text_h),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (255, 255, 255),
                1,
                cv2.LINE_AA,
            )

        return annotated
