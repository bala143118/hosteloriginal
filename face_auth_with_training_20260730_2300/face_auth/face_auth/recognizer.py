"""
recognizer.py
-------------
ArcFace embedding extraction. Given an already-detected face (bounding box +
landmarks from detector.py), this module aligns the face crop and produces
a unit-normalized 512-D ArcFace embedding suitable for cosine-similarity
comparison.

Accuracy notes
--------------
* Alignment (utils.align_face) is applied before every embedding
  extraction - ArcFace was trained on aligned faces, and skipping this step
  is the single most common cause of poor real-world accuracy.
* Embeddings are always L2-normalized, so cosine similarity == dot product,
  which is what embedding_manager.cosine_similarity assumes.
"""

from __future__ import annotations

import numpy as np

from . import config
from .detector import Detection, get_shared_app
from .utils import align_face, l2_normalize


class FaceRecognizer:
    """
    Wraps the ArcFace recognition model bundled inside InsightFace's shared
    `FaceAnalysis` app (see detector.get_shared_app) and exposes a simple
    `get_embedding` API that takes a raw frame + a `Detection`.
    """

    def __init__(self) -> None:
        self._app = get_shared_app()
        # `FaceAnalysis` exposes the loaded recognition model via the
        # "recognition" entry of its `models` dict. We call it directly on
        # our own aligned crop rather than relying on `app.get()`'s internal
        # (re-)alignment, so that detector.py and recognizer.py stay cleanly
        # decoupled and we control the exact alignment used everywhere.
        self._rec_model = self._app.models.get("recognition")
        if self._rec_model is None:
            raise RuntimeError(
                "InsightFace FaceAnalysis did not load a recognition model. "
                f"Check that the '{config.INSIGHTFACE_MODEL_PACK}' model pack "
                "includes an ArcFace recognition module."
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
        Exposed separately so callers who already have an aligned crop
        (e.g. cached from registration) don't need to re-align.
        """
        embedding = self._rec_model.get_feat(aligned_face_bgr)
        embedding = np.asarray(embedding, dtype=np.float32).reshape(-1)
        return l2_normalize(embedding)

    @staticmethod
    def average_embeddings(embeddings: list[np.ndarray]) -> np.ndarray:
        """
        Combine multiple per-image embeddings (from register_face) into one
        representative identity embedding: mean followed by re-normalization.
        Averaging in the normalized embedding space and re-normalizing is the
        standard, well-behaved way to fuse multiple ArcFace samples of the
        same identity - it reduces the influence of any single noisy/odd-angle
        sample.
        """
        if not embeddings:
            raise ValueError("Cannot average an empty list of embeddings.")
        stacked = np.stack(embeddings, axis=0)
        mean_vec = stacked.mean(axis=0)
        return l2_normalize(mean_vec)
