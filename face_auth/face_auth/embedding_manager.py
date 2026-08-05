"""
embedding_manager.py
--------------------
Persistence and comparison of face embeddings using plain .npy files on
disk (no database). One file per identity: `<embeddings_dir>/<name>.npy`,
storing a single L2-normalized 512-D float32 vector.

This is intentionally the *only* module that touches storage, so it's the
one place to swap out later if you replace flat files with a real database.
"""

from __future__ import annotations

import re
from pathlib import Path

import numpy as np

from . import config
from .utils import l2_normalize


def _sanitize_name(name: str) -> str:
    """Turn a person's display name into a filesystem-safe identifier."""
    safe = re.sub(r"[^\w\-]+", "_", name.strip())
    if not safe:
        raise ValueError("Person name must contain at least one valid character.")
    return safe


def save_embedding(
    name: str,
    embedding: np.ndarray,
    embeddings_dir: Path = config.EMBEDDINGS_DIR,
) -> Path:
    """
    Save a single identity's averaged embedding to
    `<embeddings_dir>/<name>.npy`. Overwrites any existing file for that name.

    Returns the path written to.
    """
    embeddings_dir = Path(embeddings_dir)
    embeddings_dir.mkdir(parents=True, exist_ok=True)

    embedding = l2_normalize(np.asarray(embedding, dtype=np.float32).reshape(-1))
    out_path = embeddings_dir / f"{_sanitize_name(name)}.npy"
    np.save(out_path, embedding)
    return out_path


def load_embeddings(
    embeddings_dir: Path = config.EMBEDDINGS_DIR,
) -> dict[str, np.ndarray]:
    """
    Load every `.npy` embedding file in `embeddings_dir` into a
    `{name: embedding}` dict. The filename stem (without extension) is used
    as the identity name.
    """
    embeddings_dir = Path(embeddings_dir)
    if not embeddings_dir.exists():
        return {}

    embeddings: dict[str, np.ndarray] = {}
    for npy_path in sorted(embeddings_dir.glob("*.npy")):
        try:
            vector = np.load(npy_path).astype(np.float32).reshape(-1)
        except (OSError, ValueError):
            continue  # skip unreadable/corrupt files rather than crash
        embeddings[npy_path.stem] = l2_normalize(vector)

    return embeddings


def delete_embedding(name: str, embeddings_dir: Path = config.EMBEDDINGS_DIR) -> bool:
    """Remove a stored identity's embedding file. Returns True if it existed."""
    path = Path(embeddings_dir) / f"{_sanitize_name(name)}.npy"
    if path.exists():
        path.unlink()
        return True
    return False


def cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
    """
    Cosine similarity between two embeddings, in [-1, 1] (in practice
    ArcFace genuine-pair similarities land roughly in [0.4, 1.0] and
    impostor pairs in [-0.2, 0.4], hence config.MATCH_THRESHOLD ~ 0.45).

    Both vectors are re-normalized here defensively so this function is
    correct even if called with non-normalized inputs.
    """
    a = l2_normalize(np.asarray(vec_a, dtype=np.float32).reshape(-1))
    b = l2_normalize(np.asarray(vec_b, dtype=np.float32).reshape(-1))
    return float(np.dot(a, b))


def find_best_match(
    query_embedding: np.ndarray,
    known_embeddings: dict[str, np.ndarray],
) -> tuple[str | None, float]:
    """
    Compare `query_embedding` against every entry in `known_embeddings` and
    return the (name, similarity) of the best match. Returns (None, 0.0)
    if `known_embeddings` is empty.
    """
    if not known_embeddings:
        return None, 0.0

    best_name: str | None = None
    best_score = -1.0
    for name, stored_embedding in known_embeddings.items():
        score = cosine_similarity(query_embedding, stored_embedding)
        if score > best_score:
            best_score = score
            best_name = name

    return best_name, best_score
