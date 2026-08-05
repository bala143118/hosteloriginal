"""
detector.py
-----------
Face detection layer. Wraps InsightFace's bundled detector (SCRFD, a
RetinaFace-family single-stage detector) to produce bounding boxes, 5-point
landmarks, and detection confidence for every face in an image/frame.

This module deliberately only does *detection* - no embeddings are computed
here. See recognizer.py for the ArcFace embedding step.
"""

from __future__ import annotations

import threading
from dataclasses import dataclass

import numpy as np
from insightface.app import FaceAnalysis

from . import config


@dataclass
class Detection:
    """A single detected face."""

    bbox: tuple[int, int, int, int]      # (x1, y1, x2, y2) in pixel coords
    landmarks_5pt: np.ndarray            # shape (5, 2): left eye, right eye,
                                          # nose, mouth-left, mouth-right
    det_score: float                     # detector confidence, 0-1
    yaw_deg: float                       # rough estimated head yaw

    @property
    def width(self) -> int:
        return self.bbox[2] - self.bbox[0]

    @property
    def height(self) -> int:
        return self.bbox[3] - self.bbox[1]

    @property
    def size(self) -> int:
        return min(self.width, self.height)


class FaceDetector:
    """
    Thin, thread-safe wrapper around insightface.app.FaceAnalysis's
    detection + landmark stage.

    InsightFace's `FaceAnalysis` object bundles detector + landmark +
    recognition models together and shares them efficiently, so
    `FaceDetector` and `recognizer.FaceRecognizer` both hold a reference to
    the *same* underlying `FaceAnalysis` instance (see `get_shared_app()`)
    rather than each loading their own copy of the models.
    """

    def __init__(self, face_threshold: float = config.FACE_THRESHOLD) -> None:
        self.face_threshold = face_threshold
        self._app = get_shared_app()

    def detect_faces(self, image_bgr: np.ndarray) -> list[Detection]:
        """
        Run detection on a BGR image (OpenCV convention) and return one
        `Detection` per face that clears `face_threshold`, sorted by
        detection confidence (highest first).
        """
        if image_bgr is None or image_bgr.size == 0:
            return []

        raw_faces = self._app.get(image_bgr)
        detections: list[Detection] = []

        from .utils import estimate_yaw_from_landmarks  # local import avoids cycle

        for face in raw_faces:
            det_score = float(face.det_score)
            if det_score < self.face_threshold:
                continue

            x1, y1, x2, y2 = [int(v) for v in face.bbox]
            landmarks = np.asarray(face.kps, dtype=np.float32)  # (5, 2)
            yaw = estimate_yaw_from_landmarks(landmarks)

            detections.append(
                Detection(
                    bbox=(x1, y1, x2, y2),
                    landmarks_5pt=landmarks,
                    det_score=det_score,
                    yaw_deg=yaw,
                )
            )

        detections.sort(key=lambda d: d.det_score, reverse=True)
        return detections


# ---------------------------------------------------------------------------
# Shared, lazily-initialized FaceAnalysis instance
# ---------------------------------------------------------------------------

_app_lock = threading.Lock()
_shared_app: FaceAnalysis | None = None


def get_shared_app() -> FaceAnalysis:
    """
    Return a process-wide singleton `FaceAnalysis` instance, loading it on
    first use. Loading the full `buffalo_l` pack (detector + landmarks +
    ArcFace recognizer) takes a couple of seconds, so we only want to do
    this once regardless of how many `FaceDetector` / `FaceRecognizer`
    objects are created.
    """
    global _shared_app
    if _shared_app is not None:
        return _shared_app

    with _app_lock:
        if _shared_app is None:
            app = FaceAnalysis(
                name=config.INSIGHTFACE_MODEL_PACK,
                root=config.INSIGHTFACE_ROOT,
                providers=config.EXECUTION_PROVIDERS,
            )
            app.prepare(ctx_id=config.CTX_ID, det_size=config.DETECTION_INPUT_SIZE)
            _shared_app = app

    return _shared_app
