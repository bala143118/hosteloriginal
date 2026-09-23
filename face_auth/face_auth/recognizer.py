"""
recognizer.py
-------------
ArcFace embedding extraction. Given an already-detected face (bounding box +
landmarks from detector.py), this module aligns the face crop and produces
a unit-normalized 512-D ArcFace embedding suitable for cosine-similarity
comparison.

Supports:
1. Native OpenCV cv2.dnn ArcFace using buffalo_l/w600k_r50.onnx
2. InsightFace FaceAnalysis if installed
"""

from __future__ import annotations

from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from . import config
from .detector import Detection, get_shared_app
from .utils import align_face, l2_normalize


class FaceRecognizer:
    """
    Wraps the ArcFace recognition model.
    Loads buffalo_l/w600k_r50.onnx using OpenCV cv2.dnn or InsightFace.
    """

    def __init__(self) -> None:
        self._dnn_net: Optional[cv2.dnn.Net] = None
        self._rec_model = None

        # Check for w600k_r50.onnx
        model_paths = [
            Path.home() / ".insightface" / "models" / "buffalo_l" / "w600k_r50.onnx",
            Path(__file__).resolve().parent.parent / "models" / "w600k_r50.onnx",
            Path("models/w600k_r50.onnx"),
        ]
        for p in model_paths:
            if p.exists():
                try:
                    self._dnn_net = cv2.dnn.readNetFromONNX(str(p))
                    break
                except Exception:
                    pass

        if self._dnn_net is None:
            try:
                app = get_shared_app()
                self._rec_model = app.models.get("recognition")
            except Exception:
                pass

        if self._dnn_net is None and self._rec_model is None:
            raise RuntimeError(
                "Could not load ArcFace recognition model (w600k_r50.onnx). "
                "Ensure buffalo_l is in ~/.insightface/models/buffalo_l/."
            )

    def align(self, image_bgr: np.ndarray, detection: Detection) -> np.ndarray:
        """Produce the canonical 112x112 aligned crop for a detection."""
        return align_face(image_bgr, detection.landmarks_5pt)

    def get_embedding(
        self, image_bgr: np.ndarray, detection: Detection
    ) -> np.ndarray:
        """
        Align the face described by `detection` within `image_bgr` and
        return its L2-normalized 512-D ArcFace embedding.
        """
        aligned = self.align(image_bgr, detection)
        return self.get_embedding_from_aligned(aligned)

    def get_embedding_from_aligned(self, aligned_face_bgr: np.ndarray) -> np.ndarray:
        """
        Compute the embedding for an already-aligned 112x112 BGR face crop.
        """
        if self._dnn_net is not None:
            blob = cv2.dnn.blobFromImage(
                aligned_face_bgr,
                1.0 / 127.5,
                (112, 112),
                (127.5, 127.5, 127.5),
                swapRB=True,
            )
            self._dnn_net.setInput(blob)
            embedding = self._dnn_net.forward().reshape(-1)
            return l2_normalize(np.asarray(embedding, dtype=np.float32))

        if self._rec_model is not None:
            embedding = self._rec_model.get_feat(aligned_face_bgr)
            embedding = np.asarray(embedding, dtype=np.float32).reshape(-1)
            return l2_normalize(embedding)

        raise RuntimeError("No recognition engine available.")

    @staticmethod
    def average_embeddings(embeddings: list[np.ndarray]) -> np.ndarray:
        """
        Combine multiple per-image embeddings (from register_face) into one
        representative identity embedding: mean followed by re-normalization.
        """
        if not embeddings:
            raise ValueError("Cannot average an empty list of embeddings.")
        stacked = np.stack(embeddings, axis=0)
        mean_vec = stacked.mean(axis=0)
        return l2_normalize(mean_vec)
