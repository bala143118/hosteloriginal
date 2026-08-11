"""
Standalone training entrypoint for the face_auth project.

Run from the project root:
    python train_faces.py --person alice --images photos/alice
    python train_faces.py --dataset photos
"""

from face_auth.train import main


if __name__ == "__main__":
    raise SystemExit(main())
