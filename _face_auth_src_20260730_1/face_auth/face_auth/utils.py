"""
utils.py
--------
Low-level helpers shared across the face-auth module:
  * image quality gating (blur / brightness / size / pose)
  * face alignment to the canonical 112x112 ArcFace crop
  * embedding L2 normalization
  * small numeric/geometry helpers

These are intentionally free of any model-loading logic so they can be
unit-tested in isolation.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from . import config


# ---------------------------------------------------------------------------
# Quality assessment
# ---------------------------------------------------------------------------

@dataclass
class QualityReport:
    """Result of running quality gates on a single face crop."""

    passed: bool
    blur_score: float
    brightness: float
    reason: str = ""


def variance_of_laplacian(gray_image: np.ndarray) -> float:
    """
    Classic focus-measure operator. Sharp images have a wide spread of
    intensities in the Laplacian (lots of edges); blurry images have low
    variance. Higher = sharper.
    """
    return float(cv2.Laplacian(gray_image, cv2.CV_64F).var())


def mean_brightness(gray_image: np.ndarray) -> float:
    """Average pixel intensity, used to reject near-black / blown-out crops."""
    return float(np.mean(gray_image))


def assess_face_quality(
    face_crop_bgr: np.ndarray,
    blur_threshold: float = config.BLUR_THRESHOLD,
    min_brightness: float = config.MIN_BRIGHTNESS,
    max_brightness: float = config.MAX_BRIGHTNESS,
    min_size: int = config.MIN_FACE_SIZE,
) -> QualityReport:
    """
    Run the full set of quality gates on a cropped face region (BGR, as
    produced by OpenCV). Used both at registration time (to reject unusable
    source photos) and, more leniently, before trusting an authentication
    match on a live CCTV frame.
    """
    if face_crop_bgr is None or face_crop_bgr.size == 0:
        return QualityReport(passed=False, blur_score=0.0, brightness=0.0,
                              reason="empty crop")

    h, w = face_crop_bgr.shape[:2]
    if min(h, w) < min_size:
        return QualityReport(passed=False, blur_score=0.0, brightness=0.0,
                              reason=f"face too small ({w}x{h} < {min_size}px)")

    gray = cv2.cvtColor(face_crop_bgr, cv2.COLOR_BGR2GRAY)
    blur = variance_of_laplacian(gray)
    brightness = mean_brightness(gray)

    if blur < blur_threshold:
        return QualityReport(passed=False, blur_score=blur, brightness=brightness,
                              reason=f"too blurry (score={blur:.1f} < {blur_threshold})")

    if brightness < min_brightness:
        return QualityReport(passed=False, blur_score=blur, brightness=brightness,
                              reason=f"too dark (brightness={brightness:.1f})")

    if brightness > max_brightness:
        return QualityReport(passed=False, blur_score=blur, brightness=brightness,
                              reason=f"overexposed (brightness={brightness:.1f})")

    return QualityReport(passed=True, blur_score=blur, brightness=brightness)


def estimate_yaw_from_landmarks(landmarks_5pt: np.ndarray) -> float:
    """
    Rough yaw (left/right head turn) estimate in degrees from the 5-point
    landmarks (left eye, right eye, nose, mouth-left, mouth-right) that
    InsightFace's detector already provides. This is a cheap heuristic
    (not a full 3D pose solve) good enough to reject extreme profile shots
    during registration.

    A yaw of 0 means the nose sits exactly between the eyes horizontally.
    """
    left_eye, right_eye, nose = landmarks_5pt[0], landmarks_5pt[1], landmarks_5pt[2]
    eye_mid_x = (left_eye[0] + right_eye[0]) / 2.0
    eye_dist = np.linalg.norm(right_eye - left_eye)
    if eye_dist < 1e-6:
        return 0.0
    # Normalized horizontal offset of the nose relative to eye separation,
    # mapped to a plausible degree range via a simple linear scale.
    offset_ratio = (nose[0] - eye_mid_x) / eye_dist
    yaw_deg = float(np.clip(offset_ratio * 90.0, -90.0, 90.0))
    return yaw_deg


# ---------------------------------------------------------------------------
# Alignment
# ---------------------------------------------------------------------------

# Canonical ArcFace 5-point reference landmarks for a 112x112 output crop.
# (Standard InsightFace / ArcFace alignment template.)
_ARCFACE_REFERENCE_5PT = np.array(
    [
        [38.2946, 51.6963],
        [73.5318, 51.5014],
        [56.0252, 71.7366],
        [41.5493, 92.3655],
        [70.7299, 92.2041],
    ],
    dtype=np.float32,
)


def align_face(
    image_bgr: np.ndarray,
    landmarks_5pt: np.ndarray,
    output_size: int = config.ALIGNED_FACE_SIZE,
) -> np.ndarray:
    """
    Warp the input image so the detected 5-point facial landmarks map onto
    the canonical ArcFace reference positions, producing a normalized
    `output_size x output_size` crop. This similarity-transform alignment
    is what makes ArcFace embeddings robust to in-plane rotation and
    moderate pose variation - never skip it and pass a raw crop instead.
    """
    landmarks_5pt = np.asarray(landmarks_5pt, dtype=np.float32)
    reference = _ARCFACE_REFERENCE_5PT * (output_size / 112.0)

    transform_matrix, _ = cv2.estimateAffinePartial2D(
        landmarks_5pt, reference, method=cv2.LMEDS
    )
    if transform_matrix is None:
        # Fall back to a plain resize of a square crop around the landmarks
        # if the similarity transform is degenerate (should be rare).
        x_min, y_min = landmarks_5pt.min(axis=0)
        x_max, y_max = landmarks_5pt.max(axis=0)
        pad_w, pad_h = (x_max - x_min), (y_max - y_min)
        x0 = max(int(x_min - pad_w), 0)
        y0 = max(int(y_min - pad_h), 0)
        x1 = int(x_max + pad_w)
        y1 = int(y_max + pad_h)
        crop = image_bgr[y0:y1, x0:x1]
        if crop.size == 0:
            crop = image_bgr
        return cv2.resize(crop, (output_size, output_size))

    aligned = cv2.warpAffine(
        image_bgr, transform_matrix, (output_size, output_size), borderValue=0.0
    )
    return aligned


# ---------------------------------------------------------------------------
# Embedding math
# ---------------------------------------------------------------------------

def l2_normalize(vector: np.ndarray, eps: float = 1e-10) -> np.ndarray:
    """Normalize a 1-D embedding vector to unit length."""
    norm = np.linalg.norm(vector)
    return vector / max(norm, eps)


def clamp_bbox(
    bbox: tuple[int, int, int, int], frame_width: int, frame_height: int
) -> tuple[int, int, int, int]:
    """Clip a (x1, y1, x2, y2) bounding box to valid frame coordinates."""
    x1, y1, x2, y2 = bbox
    x1 = max(0, min(x1, frame_width - 1))
    y1 = max(0, min(y1, frame_height - 1))
    x2 = max(0, min(x2, frame_width))
    y2 = max(0, min(y2, frame_height))
    return x1, y1, x2, y2
