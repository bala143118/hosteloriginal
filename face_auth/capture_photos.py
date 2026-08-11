"""
OpenCV webcam capture tool for creating training photos.

Usage:
    python capture_photos.py --person alice

Controls:
    c = capture current frame
    q = quit
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2

from face_auth.camera import open_webcam


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Capture face photos from webcam into photos/<person_name>/"
    )
    parser.add_argument("--person", required=True, help="Person name")
    parser.add_argument("--output-dir", default="photos", help="Dataset root folder")
    parser.add_argument("--camera", type=int, default=0, help="Webcam index")
    return parser


def main() -> int:
    args = build_parser().parse_args()

    person_dir = Path(args.output_dir) / args.person
    person_dir.mkdir(parents=True, exist_ok=True)

    existing = sorted(person_dir.glob("*.jpg"))
    next_index = len(existing) + 1

    window_name = f"Capture Photos - {args.person}"

    with open_webcam(args.camera) as stream:
        for frame in stream.frames():
            preview = frame.copy()
            cv2.putText(
                preview,
                f"Person: {args.person} | Saved: {next_index - 1} | Press C to capture, Q to quit",
                (10, 30),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 0),
                2,
                cv2.LINE_AA,
            )
            cv2.imshow(window_name, preview)

            key = cv2.waitKey(1) & 0xFF
            if key == ord("c"):
                out_path = person_dir / f"{next_index:03d}.jpg"
                cv2.imwrite(str(out_path), frame)
                print(f"Saved: {out_path}")
                next_index += 1
            elif key == ord("q"):
                break

    cv2.destroyAllWindows()
    print(f"Done. Photos stored in: {person_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
