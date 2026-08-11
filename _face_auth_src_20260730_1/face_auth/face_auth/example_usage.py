"""
example_usage.py
-----------------
Minimal illustration of how a *different* project would import and drive
this module. This file is not part of the module's public API and is not
required at runtime - it's just documentation-by-example.

Run from the directory that CONTAINS the `face_auth/` folder, e.g.:
    python -m face_auth.example_usage
"""

from __future__ import annotations

import cv2

from face_auth import FaceAuthSystem


def registration_example() -> None:
    system = FaceAuthSystem()
    # `photos/alice/` should contain 10-30 images of just Alice's face.
    system.register_face(image_folder="photos/alice", person_name="alice")


def webcam_authentication_example() -> None:
    from face_auth.camera import open_webcam

    system = FaceAuthSystem()

    with open_webcam(0) as stream:
        for frame in stream.frames():
            results = system.authenticate(frame)
            annotated = system.draw_results(frame, results)

            cv2.imshow("face_auth", annotated)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break

    cv2.destroyAllWindows()


def rtsp_authentication_example(rtsp_url: str) -> None:
    from face_auth.camera import open_rtsp

    system = FaceAuthSystem()

    with open_rtsp(rtsp_url) as stream:
        for frame in stream.frames():
            results = system.authenticate(frame)
            for r in results:
                print(r.name, r.confidence, r.bbox, r.matched)


if __name__ == "__main__":
    # registration_example()
    webcam_authentication_example()
