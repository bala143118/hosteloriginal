# face_auth

A **standalone**, database-free face detection + recognition module built on
InsightFace (ArcFace embeddings + RetinaFace-family/SCRFD detection), OpenCV,
and NumPy. Designed to be dropped into a larger application as a pure
computer-vision component.

This module intentionally does **not** include: a database, user accounts,
login/session/JWT logic, or any web framework (Flask/FastAPI/React/HTML).
It only reads/writes local `.npy` embedding files, so you can swap that
storage layer for your own database later without touching the CV code.

## Install

```bash
pip install -r requirements.txt
# For GPU acceleration instead of CPU-only onnxruntime:
pip uninstall onnxruntime
pip install onnxruntime-gpu
```

GPU vs CPU is auto-detected at import time (`config.py`) - no code changes
needed either way.

## Layout

```
face_auth/
    __init__.py          # public API: FaceAuthSystem, AuthResult
    config.py            # all thresholds + model/device config
    utils.py             # quality gating, alignment, L2 normalize
    detector.py          # SCRFD/RetinaFace-family face detection
    recognizer.py         # ArcFace embedding extraction
    embedding_manager.py # load/save/compare .npy embeddings
    camera.py             # webcam / RTSP / video-file capture
    face_auth.py          # register_face / authenticate / draw_results
    example_usage.py       # illustrative, not part of the public API
```

## Quick start

```python
from face_auth import FaceAuthSystem

system = FaceAuthSystem()

# 1) Enroll a person from 10-30 photos (folder should contain only that
#    person's face across varied angles/lighting for best accuracy).
system.register_face(image_folder="photos/alice", person_name="alice")

# 2) Authenticate faces in a single frame (e.g. from OpenCV/RTSP/webcam).
import cv2
frame = cv2.imread("some_cctv_frame.jpg")
results = system.authenticate(frame)
for r in results:
    print(r.name, r.confidence, r.bbox, r.matched)

# 3) Get an annotated frame (green = matched, red = unknown) for display.
annotated = system.draw_results(frame, results)
cv2.imwrite("annotated.jpg", annotated)
```

## Separate training command

If you want training/enrollment in a dedicated file instead of calling
`register_face()` manually, use:

```bash
python -m face_auth.train --person alice --images photos/alice
```

For batch enrollment, organize your dataset like this:

```text
photos/
  alice/
    1.jpg
    2.jpg
  bob/
    1.jpg
    2.jpg
```

Then run:

```bash
python -m face_auth.train --dataset photos
```

This command reuses the existing registration pipeline, including face
detection, quality checks, embedding averaging, and `.npy` storage.

## Tuning accuracy (config.py)

| Setting | Meaning | Raise for... | Lower for... |
|---|---|---|---|
| `FACE_THRESHOLD` | min detector confidence | fewer false detections | recovering hard/small CCTV faces |
| `MATCH_THRESHOLD` | min cosine similarity to accept a match | fewer false accepts | more lenient matching in poor conditions |
| `MIN_FACE_SIZE` | min face box size (px) to attempt recognition | avoid unreliable tiny-face embeddings | recognize farther-away subjects |
| `BLUR_THRESHOLD` | min Laplacian variance for registration photos | stricter enrollment quality | accept softer source photos |

All of the above can also be set via environment variables
(`FACE_AUTH_FACE_THRESHOLD`, `FACE_AUTH_MATCH_THRESHOLD`, etc.) without
editing code - see `config.py`.

## Design notes for difficult CCTV conditions

- **Side faces**: `utils.estimate_yaw_from_landmarks` rejects extreme
  profile shots *at registration time only* (so your enrolled embedding is
  built from clean angles); `authenticate()` still attempts matching on
  side faces at runtime since CCTV cannot always guarantee a frontal view.
- **Poor lighting / low resolution**: brightness and blur gates
  (`assess_face_quality`) keep bad registration photos out of the identity
  embedding; `MIN_FACE_SIZE` filters out faces too small to trust at
  inference time.
- **Glasses / masks**: no special-casing is needed at the code level - the
  bundled ArcFace model (`buffalo_l`) is trained on large-scale data that
  includes occluded faces, so accuracy degrades gracefully rather than
  breaking. For heavy mask usage, consider lowering `MATCH_THRESHOLD`
  slightly and registering some masked photos alongside unmasked ones.
- **Multiple registration images**: `register_face` averages embeddings
  from many photos (in normalized space, then re-normalizes), which
  meaningfully reduces the effect of any single odd-angle/lighting sample.

## Not included by design

Database integration, authentication/session/JWT, admin panels, and any
web frontend are intentionally left out - integrate this module's
`FaceAuthSystem` into your own backend and decide how identities/sessions
are stored and exposed there.
