"""
detector.py
-----------
Face detection layer. Produces bounding boxes, 5-point landmarks, and
detection confidence for every face in an image/frame.

Supports:
1. Native OpenCV cv2.dnn SCRFD detection using buffalo_l/det_10g.onnx
2. InsightFace FaceAnalysis if installed
3. YOLO11 person/head detection fallback
"""

from __future__ import annotations

import os
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import cv2
import numpy as np

from . import config


@dataclass
class Detection:
    """A single detected face."""

    bbox: tuple[int, int, int, int]      # (x1, y1, x2, y2) in pixel coords
    landmarks_5pt: np.ndarray            # shape (5, 2): left eye, right eye,
                                          # nose, mouth-left, mouth-right
    det_score: float                     # detector confidence, 0-1
    yaw_deg: float                       # rough estimated head yaw

    @property
    def width(self) -> int:
        return self.bbox[2] - self.bbox[0]

    @property
    def height(self) -> int:
        return self.bbox[3] - self.bbox[1]

    @property
    def size(self) -> int:
        return min(self.width, self.height)


class SCRFDDetector:
    """Fast, dependency-free SCRFD face detector using OpenCV DNN."""

    def __init__(self, model_path: str | Path, face_threshold: float = 0.35) -> None:
        self.model_path = str(model_path)
        self.face_threshold = face_threshold
        self.net = cv2.dnn.readNetFromONNX(self.model_path)
        self.input_size = (640, 640)
        self.strides = [8, 16, 32]
        self.num_anchors = 2

    def detect(self, image_bgr: np.ndarray) -> list[Detection]:
        if image_bgr is None or image_bgr.size == 0:
            return []

        orig_h, orig_w = image_bgr.shape[:2]
        im_ratio = float(orig_h) / float(orig_w)
        if im_ratio > 1.0:
            new_h = self.input_size[1]
            new_w = int(new_h / im_ratio)
        else:
            new_w = self.input_size[0]
            new_h = int(new_w * im_ratio)

        det_scale = float(new_h) / float(orig_h)
        resized_img = cv2.resize(image_bgr, (new_w, new_h))
        det_img = np.zeros((self.input_size[1], self.input_size[0], 3), dtype=np.uint8)
        det_img[:new_h, :new_w, :] = resized_img

        blob = cv2.dnn.blobFromImage(
            det_img, 1.0 / 128.0, self.input_size, (127.5, 127.5, 127.5), swapRB=True
        )
        self.net.setInput(blob)
        outs = self.net.forward(self.net.getUnconnectedOutLayersNames())

        scores_list = [o for o in outs if o.shape[1] == 1]
        bboxes_list = [o for o in outs if o.shape[1] == 4]
        kps_list = [o for o in outs if o.shape[1] == 10]

        scores_list.sort(key=lambda x: x.shape[0], reverse=True)
        bboxes_list.sort(key=lambda x: x.shape[0], reverse=True)
        kps_list.sort(key=lambda x: x.shape[0], reverse=True)

        all_boxes, all_scores, all_kps = [], [], []

        for idx, stride in enumerate(self.strides):
            if idx >= len(scores_list) or idx >= len(bboxes_list) or idx >= len(kps_list):
                continue
            scores = scores_list[idx]
            bboxes = bboxes_list[idx]
            kps = kps_list[idx]
            feat_h = self.input_size[1] // stride
            feat_w = self.input_size[0] // stride

            grid_y, grid_x = np.meshgrid(np.arange(feat_h), np.arange(feat_w), indexing="ij")
            anchor_centers = np.repeat(
                np.stack([grid_x, grid_y], axis=-1).astype(np.float32) * stride,
                self.num_anchors,
                axis=1,
            ).reshape(-1, 2)

            pos = np.where(scores >= self.face_threshold)[0]
            for i in pos:
                cx, cy = anchor_centers[i]
                dx1, dy1, dx2, dy2 = bboxes[i] * stride
                kp = kps[i].reshape(5, 2) * stride
                kp[:, 0] = (cx + kp[:, 0]) / det_scale
                kp[:, 1] = (cy + kp[:, 1]) / det_scale
                x1 = (cx - dx1) / det_scale
                y1 = (cy - dy1) / det_scale
                x2 = (cx + dx2) / det_scale
                y2 = (cy + dy2) / det_scale

                all_boxes.append([x1, y1, x2, y2])
                all_scores.append(float(scores[i, 0]))
                all_kps.append(kp)

        if not all_boxes:
            return []

        nms_boxes = [
            [int(b[0]), int(b[1]), int(b[2] - b[0]), int(b[3] - b[1])] for b in all_boxes
        ]
        indices = cv2.dnn.NMSBoxes(nms_boxes, all_scores, self.face_threshold, 0.4)
        if len(indices) == 0:
            return []

        from .utils import estimate_yaw_from_landmarks

        detections: list[Detection] = []
        for idx in indices:
            i = idx[0] if isinstance(idx, (list, tuple, np.ndarray)) else int(idx)
            x1, y1, x2, y2 = [int(round(v)) for v in all_boxes[i]]
            x1 = max(0, min(x1, orig_w - 1))
            y1 = max(0, min(y1, orig_h - 1))
            x2 = max(x1 + 1, min(x2, orig_w))
            y2 = max(y1 + 1, min(y2, orig_h))

            kp = all_kps[i]
            yaw = estimate_yaw_from_landmarks(kp)

            detections.append(
                Detection(
                    bbox=(x1, y1, x2, y2),
                    landmarks_5pt=kp,
                    det_score=float(all_scores[i]),
                    yaw_deg=yaw,
                )
            )

        detections.sort(key=lambda d: d.det_score, reverse=True)
        return detections


class YOLOFallbackDetector:
    """Fallback detector using Ultralytics YOLO person detection."""

    def __init__(self, model_path: str = "models/yolo11n.pt") -> None:
        from ultralytics import YOLO
        self.model = YOLO(model_path)

    def detect(self, image_bgr: np.ndarray) -> list[Detection]:
        if image_bgr is None or image_bgr.size == 0:
            return []

        results = self.model(image_bgr, verbose=False)
        detections: list[Detection] = []
        for r in results:
            for box in r.boxes:
                cls_id = int(box.cls[0])
                if cls_id != 0:  # 0 is 'person' in COCO
                    continue
                conf = float(box.conf[0])
                if conf < 0.35:
                    continue

                px1, py1, px2, py2 = [float(v) for v in box.xyxy[0].tolist()]
                pw = px2 - px1
                ph = py2 - py1

                # Approximate head / face bounding box from upper 35% of person box
                fx1 = int(round(px1 + pw * 0.15))
                fx2 = int(round(px2 - pw * 0.15))
                fy1 = int(round(py1))
                fy2 = int(round(py1 + ph * 0.35))

                fw = fx2 - fx1
                fh = fy2 - fy1

                # Synthesize 5 canonical facial landmarks
                left_eye = [fx1 + fw * 0.3, fy1 + fh * 0.38]
                right_eye = [fx1 + fw * 0.7, fy1 + fh * 0.38]
                nose = [fx1 + fw * 0.5, fy1 + fh * 0.55]
                mouth_left = [fx1 + fw * 0.35, fy1 + fh * 0.75]
                mouth_right = [fx1 + fw * 0.65, fy1 + fh * 0.75]
                landmarks = np.array([left_eye, right_eye, nose, mouth_left, mouth_right], dtype=np.float32)

                detections.append(
                    Detection(
                        bbox=(fx1, fy1, fx2, fy2),
                        landmarks_5pt=landmarks,
                        det_score=conf,
                        yaw_deg=0.0,
                    )
                )

        detections.sort(key=lambda d: d.det_score, reverse=True)
        return detections


class FaceDetector:
    """
    Unified FaceDetector with multi-engine support:
    1. SCRFD ONNX (OpenCV DNN)
    2. InsightFace FaceAnalysis
    3. YOLO11 person detector fallback
    """

    def __init__(self, face_threshold: float = config.FACE_THRESHOLD) -> None:
        self.face_threshold = face_threshold
        self._scrfd: Optional[SCRFDDetector] = None
        self._yolo: Optional[YOLOFallbackDetector] = None
        self._app = None

        # Check for SCRFD ONNX model
        model_paths = [
            Path.home() / ".insightface" / "models" / "buffalo_l" / "det_10g.onnx",
            Path(__file__).resolve().parent.parent / "models" / "det_10g.onnx",
            Path("models/det_10g.onnx"),
        ]
        for p in model_paths:
            if p.exists():
                try:
                    self._scrfd = SCRFDDetector(p, face_threshold=face_threshold)
                    break
                except Exception:
                    pass

        if self._scrfd is None:
            try:
                self._app = get_shared_app()
            except Exception:
                pass

        if self._scrfd is None and self._app is None:
            try:
                self._yolo = YOLOFallbackDetector()
            except Exception:
                pass

    def detect_faces(self, image_bgr: np.ndarray) -> list[Detection]:
        if image_bgr is None or image_bgr.size == 0:
            return []

        # 1. SCRFD (OpenCV DNN)
        if self._scrfd is not None:
            try:
                return self._scrfd.detect(image_bgr)
            except Exception as exc:
                pass

        # 2. InsightFace
        if self._app is not None:
            try:
                raw_faces = self._app.get(image_bgr)
                from .utils import estimate_yaw_from_landmarks

                detections: list[Detection] = []
                for face in raw_faces:
                    det_score = float(face.det_score)
                    if det_score < self.face_threshold:
                        continue
                    x1, y1, x2, y2 = [int(v) for v in face.bbox]
                    landmarks = np.asarray(face.kps, dtype=np.float32)
                    yaw = estimate_yaw_from_landmarks(landmarks)
                    detections.append(
                        Detection(
                            bbox=(x1, y1, x2, y2),
                            landmarks_5pt=landmarks,
                            det_score=det_score,
                            yaw_deg=yaw,
                        )
                    )
                detections.sort(key=lambda d: d.det_score, reverse=True)
                return detections
            except Exception:
                pass

        # 3. YOLO fallback
        if self._yolo is not None:
            try:
                return self._yolo.detect(image_bgr)
            except Exception:
                pass

        return []


# ---------------------------------------------------------------------------
# Shared, lazily-initialized FaceAnalysis instance (optional)
# ---------------------------------------------------------------------------

_app_lock = threading.Lock()
_shared_app = None


def get_shared_app():
    global _shared_app
    if _shared_app is not None:
        return _shared_app

    with _app_lock:
        if _shared_app is None:
            try:
                from insightface.app import FaceAnalysis
                app = FaceAnalysis(
                    name=config.INSIGHTFACE_MODEL_PACK,
                    root=config.INSIGHTFACE_ROOT,
                    providers=config.EXECUTION_PROVIDERS,
                )
                app.prepare(ctx_id=config.CTX_ID, det_size=config.DETECTION_INPUT_SIZE)
                _shared_app = app
            except Exception as e:
                _shared_app = None
                raise RuntimeError(f"Unable to load insightface: {e}")

    return _shared_app
