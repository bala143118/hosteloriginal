"""
config.py
---------
Central configuration for the face authentication module.

All tunable thresholds and paths live here so the rest of the codebase
never hard-codes a "magic number". Adjust these values to trade off
precision vs. recall for your specific CCTV deployment.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

try:
    import onnxruntime as ort
except ImportError:  # onnxruntime is a hard dependency of insightface, but
    # guard the import so config.py can still be inspected without it installed.
    ort = None  # type: ignore


def _detect_execution_providers() -> list[str]:
    """
    Detect the best available ONNXRuntime execution providers.

    Returns a provider list ordered by preference. If a CUDA-capable GPU
    and the onnxruntime-gpu build are available, CUDAExecutionProvider is
    placed first with CPU as a fallback. Otherwise CPU only.
    """
    if ort is None:
        return ["CPUExecutionProvider"]

    available = ort.get_available_providers()
    providers: list[str] = []

    if "CUDAExecutionProvider" in available:
        providers.append("CUDAExecutionProvider")
    if "CPUExecutionProvider" in available:
        providers.append("CPUExecutionProvider")

    return providers or ["CPUExecutionProvider"]


# ---------------------------------------------------------------------------
# Device / execution configuration
# ---------------------------------------------------------------------------

EXECUTION_PROVIDERS: list[str] = _detect_execution_providers()
USE_GPU: bool = "CUDAExecutionProvider" in EXECUTION_PROVIDERS

# insightface's FaceAnalysis uses ctx_id: 0 (or any GPU index) for GPU, -1 for CPU.
CTX_ID: int = 0 if USE_GPU else -1

# ---------------------------------------------------------------------------
# Model configuration
# ---------------------------------------------------------------------------

# "buffalo_l" is InsightFace's high-accuracy model pack: SCRFD (RetinaFace-family)
# detector + 5-point landmarks + ArcFace (ResNet100) recognition model.
# Swap to "buffalo_s" for a lighter/faster (lower accuracy) pack if needed.
INSIGHTFACE_MODEL_PACK: str = os.environ.get("FACE_AUTH_MODEL_PACK", "buffalo_l")

# Directory where insightface downloads/caches its model weights.
INSIGHTFACE_ROOT: str = os.environ.get(
    "FACE_AUTH_MODEL_ROOT", str(Path.home() / ".insightface")
)

# Detector input size. Larger => better recall on small/far faces, slower.
DETECTION_INPUT_SIZE: tuple[int, int] = (640, 640)

# ---------------------------------------------------------------------------
# Storage paths
# ---------------------------------------------------------------------------

BASE_DIR: Path = Path(__file__).resolve().parent
EMBEDDINGS_DIR: Path = Path(
    os.environ.get("FACE_AUTH_EMBEDDINGS_DIR", str(BASE_DIR / "embeddings"))
)
EMBEDDINGS_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# Thresholds
# ---------------------------------------------------------------------------

# Minimum detector confidence score (0-1) for a detection to be considered
# a real face at all (applies both during registration and authentication).
FACE_THRESHOLD: float = float(os.environ.get("FACE_AUTH_FACE_THRESHOLD", 0.65))

# Minimum cosine similarity (0-1, after L2 normalization) required for two
# embeddings to be considered the same identity. ArcFace embeddings compared
# with cosine similarity typically separate well above ~0.35-0.45; raise this
# for stricter (fewer false accepts) matching, lower it for more lenient CCTV
# conditions at the cost of more false accepts.
MATCH_THRESHOLD: float = float(os.environ.get("FACE_AUTH_MATCH_THRESHOLD", 0.45))

# Minimum face bounding-box size (pixels, min(width, height)) to attempt
# recognition on. Faces smaller than this in typical CCTV footage produce
# unreliable embeddings.
MIN_FACE_SIZE: int = int(os.environ.get("FACE_AUTH_MIN_FACE_SIZE", 60))

# --- Registration-time image quality gates -------------------------------

# Variance of the Laplacian below this value marks an image as "too blurry".
# Lower this if your registration photos are inherently soft (e.g. webcam).
BLUR_THRESHOLD: float = float(os.environ.get("FACE_AUTH_BLUR_THRESHOLD", 80.0))

# Mean pixel intensity (0-255) outside this range marks an image as too dark
# or too overexposed to trust for a registration embedding.
MIN_BRIGHTNESS: float = float(os.environ.get("FACE_AUTH_MIN_BRIGHTNESS", 40.0))
MAX_BRIGHTNESS: float = float(os.environ.get("FACE_AUTH_MAX_BRIGHTNESS", 230.0))

# A registration image is rejected if the detector's pose estimate implies
# a yaw beyond this many degrees (too extreme a side-profile to align well).
MAX_REGISTRATION_YAW: float = float(os.environ.get("FACE_AUTH_MAX_YAW", 40.0))

# Minimum number and maximum number of valid images expected for register_face.
MIN_REGISTRATION_IMAGES: int = 5
MAX_REGISTRATION_IMAGES: int = 30

# ---------------------------------------------------------------------------
# Alignment
# ---------------------------------------------------------------------------

# Standard ArcFace-aligned output crop size (pixels). Do not change unless
# you also retrain/replace the recognition model - 112x112 is what the
# bundled ArcFace model expects.
ALIGNED_FACE_SIZE: int = 112


@dataclass(frozen=True)
class FaceAuthConfig:
    """Convenience bundle of the module-level settings above, for code that
    prefers to pass a single config object around (e.g. tests)."""

    face_threshold: float = FACE_THRESHOLD
    match_threshold: float = MATCH_THRESHOLD
    min_face_size: int = MIN_FACE_SIZE
    blur_threshold: float = BLUR_THRESHOLD
    min_brightness: float = MIN_BRIGHTNESS
    max_brightness: float = MAX_BRIGHTNESS
    max_registration_yaw: float = MAX_REGISTRATION_YAW
    embeddings_dir: Path = field(default_factory=lambda: EMBEDDINGS_DIR)
