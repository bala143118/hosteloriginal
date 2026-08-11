"""
face_auth
=========
Standalone face authentication module (detection + ArcFace recognition).

This package is a pure computer-vision component: it detects faces, builds
identity embeddings, and matches faces against those embeddings. It does
NOT provide a database, user-management, login/session, or web layer -
plug it into your own application/backend as needed.

Typical usage
-------------
    from face_auth.face_auth import FaceAuthSystem

    system = FaceAuthSystem()
    system.register_face("photos/alice", "alice")

    results = system.authenticate(frame)          # list[AuthResult]
    annotated_frame = system.draw_results(frame, results)
"""

from .face_auth import AuthResult, FaceAuthSystem

__all__ = ["FaceAuthSystem", "AuthResult"]
__version__ = "1.0.0"
