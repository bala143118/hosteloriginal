"""Smart surveillance for restricted hostel areas.

Features
--------
* OpenCV camera, IP stream, or video-file input.
* Ultralytics YOLO11 person detection (class 0 only).
* Timezone-aware restricted schedules, including overnight schedules.
* Face-recognition based student identification and authorization.
* SQLite student/access-log storage and optional HTTP warden webhook alerts.

This module is intentionally independent from the fire/smoke CCTV worker.
Run ``python smart_surveillance.py --help`` for setup and usage commands.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sqlite3
import time
import uuid
from dataclasses import dataclass
from datetime import datetime, time as clock_time
from pathlib import Path
from typing import Iterable, Optional
from zoneinfo import ZoneInfo

import cv2
import numpy as np

# Heavy AI libraries (Ultralytics & Face Recognition) are loaded lazily for instant camera capture
YOLO = None
face_recognition = None

def get_face_recognition():
    global face_recognition
    if face_recognition is None:
        try:
            import face_recognition as _fr
            face_recognition = _fr
        except ImportError:
            face_recognition = None
    return face_recognition

try:
    import requests
except ImportError:
    requests = None


LOG = logging.getLogger("smart_surveillance")
PERSON_CLASS_ID = 0


@dataclass(frozen=True)
class Student:
    student_id: str
    name: str
    authorized: bool
    access_level: str
    encoding: np.ndarray


class SurveillanceDatabase:
    """SQLite repository for students, schedules, and auditable access events."""

    def __init__(self, path: str | Path) -> None:
        self.path = str(path)

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path)
        connection.row_factory = sqlite3.Row
        return connection

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS students (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    face_encoding BLOB NOT NULL,
                    authorized INTEGER NOT NULL DEFAULT 1 CHECK (authorized IN (0, 1)),
                    authorized_during_restricted_hours INTEGER NOT NULL DEFAULT 1 CHECK (authorized_during_restricted_hours IN (0, 1)),
                    access_level TEXT NOT NULL DEFAULT 'standard'
                );
                CREATE TABLE IF NOT EXISTS access_logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id TEXT,
                    timestamp TEXT NOT NULL,
                    action TEXT NOT NULL,
                    status TEXT NOT NULL,
                    camera_id TEXT NOT NULL,
                    details TEXT NOT NULL DEFAULT '{}',
                    FOREIGN KEY (student_id) REFERENCES students(student_id)
                );
                CREATE TABLE IF NOT EXISTS restricted_schedule (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
                    start_time TEXT NOT NULL,
                    end_time TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS surveillance_events (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_id TEXT NOT NULL UNIQUE,
                    camera_id TEXT NOT NULL,
                    timestamp TEXT NOT NULL,
                    student_id TEXT,
                    student_name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    yolo_confidence REAL,
                    face_match INTEGER NOT NULL DEFAULT 0,
                    proof_image TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    acknowledged INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS idx_access_logs_timestamp ON access_logs(timestamp);
                CREATE INDEX IF NOT EXISTS idx_surveillance_events_timestamp ON surveillance_events(timestamp);
                """
            )
            columns = {row[1] for row in connection.execute("PRAGMA table_info(students)").fetchall()}
            if "authorized_during_restricted_hours" not in columns:
                connection.execute("ALTER TABLE students ADD COLUMN authorized_during_restricted_hours INTEGER NOT NULL DEFAULT 1")

    def add_schedule(self, day_of_week: int, start_time: str, end_time: str) -> None:
        with self.connect() as connection:
            connection.execute(
                "INSERT INTO restricted_schedule(day_of_week, start_time, end_time) VALUES (?, ?, ?)",
                (day_of_week, start_time, end_time),
            )

    def enroll_student(
        self, student_id: str, name: str, encoding: np.ndarray, authorized: bool, access_level: str
    ) -> None:
        if encoding.shape != (128,):
            raise ValueError("Face encoding must contain exactly 128 values.")
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO students(student_id, name, face_encoding, authorized, authorized_during_restricted_hours, access_level)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(student_id) DO UPDATE SET
                    name=excluded.name,
                    face_encoding=excluded.face_encoding,
                    authorized=excluded.authorized,
                    authorized_during_restricted_hours=excluded.authorized_during_restricted_hours,
                    access_level=excluded.access_level
                """,
                (student_id, name, encoding.astype(np.float64).tobytes(), int(authorized), int(authorized), access_level),
            )

    def known_students(self) -> list[Student]:
        with self.connect() as connection:
            rows = connection.execute("SELECT * FROM students").fetchall()
        return [
            Student(
                student_id=row["student_id"],
                name=row["name"],
                authorized=bool(row["authorized_during_restricted_hours"] if "authorized_during_restricted_hours" in row.keys() else row["authorized"]),
                access_level=row["access_level"],
                encoding=np.frombuffer(row["face_encoding"], dtype=np.float64),
            )
            for row in rows
        ]

    def schedules(self) -> list[sqlite3.Row]:
        with self.connect() as connection:
            return connection.execute("SELECT day_of_week, start_time, end_time FROM restricted_schedule").fetchall()

    def log(self, student_id: Optional[str], timestamp: datetime, action: str, status: str, camera_id: str, **details: object) -> None:
        with self.connect() as connection:
            connection.execute(
                "INSERT INTO access_logs(student_id, timestamp, action, status, camera_id, details) VALUES (?, ?, ?, ?, ?, ?)",
                (student_id, timestamp.isoformat(), action, status, camera_id, json.dumps(details, default=str)),
            )

    def save_surveillance_event(self, event: dict) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT OR IGNORE INTO surveillance_events
                (event_id, camera_id, timestamp, student_id, student_name, status, event_type, reason,
                 yolo_confidence, face_match, proof_image, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (event["event_id"], event["camera_id"], event["timestamp"], event.get("student_id"),
                 event["student_name"], event["status"], event["event_type"], event["reason"],
                 event.get("yolo_confidence"), int(bool(event.get("face_match"))), event["proof_image"],
                 datetime.now().isoformat()),
            )


class RestrictedHours:
    def __init__(self, database: SurveillanceDatabase, timezone_name: str, config_path: str | Path = "data/db.json") -> None:
        self.database = database
        self.timezone = ZoneInfo(timezone_name)
        self.config_path = Path(config_path)

    @staticmethod
    def _to_time(value: str) -> clock_time:
        return clock_time.fromisoformat(value)

    def is_restricted(self, now: Optional[datetime] = None, test_override: bool = False) -> bool:
        current = (now or datetime.now(self.timezone)).astimezone(self.timezone)
        current_time = current.time().replace(tzinfo=None)
        today = current.weekday()
        yesterday = (today - 1) % 7
        try:
            config = json.loads(self.config_path.read_text(encoding="utf-8")) if self.config_path.exists() else {}
            restriction = config.get("nightRestriction") or {}
            if restriction.get("enabled") is False:
                return False
            if test_override:
                return True
            if restriction.get("enabled", True) and restriction.get("startTime") and restriction.get("endTime"):
                start, end = self._to_time(restriction["startTime"]), self._to_time(restriction["endTime"])
                if start <= end:
                    return start <= current_time < end
                return current_time >= start or current_time < end
        except (OSError, ValueError, KeyError, TypeError) as error:
            LOG.warning("Unable to read Node night restriction settings; using SQLite schedules: %s", error)
        if test_override:
            return True
        for row in self.database.schedules():
            start, end = self._to_time(row["start_time"]), self._to_time(row["end_time"])
            day = row["day_of_week"]
            if start <= end and day == today and start <= current_time < end:
                return True
            # An overnight 22:00-06:00 entry belongs to its starting weekday.
            if start > end and ((day == today and current_time >= start) or (day == yesterday and current_time < end)):
                return True
        return False


class WardenAlert:
    def __init__(self, webhook_url: Optional[str]) -> None:
        self.webhook_url = webhook_url

    def send(self, payload: dict) -> None:
        LOG.warning("WARDEN ALERT: %s", payload)
        if not self.webhook_url:
            return
        if requests is None:
            LOG.error("requests is required to deliver warden webhook alerts.")
            return
        try:
            response = requests.post(self.webhook_url, json=payload, timeout=5)
            response.raise_for_status()
        except requests.RequestException as error:
            LOG.error("Warden alert failed: %s", error)


class SmartSurveillance:
    def __init__(
        self,
        database: SurveillanceDatabase,
        model_path: str,
        camera_id: str,
        timezone_name: str,
        confidence: float = 0.5,
        face_threshold: float = 0.6,
        webhook_url: Optional[str] = None,
        event_cooldown_seconds: float = 30.0,
        backend_url: Optional[str] = None,
        evidence_dir: str | Path = "data/surveillance_events",
        required_confirmation_frames: int = 5,
        backend_token: Optional[str] = None,
        test_restricted_hours: bool = False,
        live_frame_path: Optional[str | Path] = None,
        minimum_presence_seconds: float = 60.0,
    ) -> None:
        self.database = database
        self.model_path = model_path
        self._model: Optional[YOLO] = None
        self.camera_id = camera_id
        self.confidence = confidence
        self.face_threshold = face_threshold
        self.hours = RestrictedHours(database, timezone_name)
        self.alert = WardenAlert(webhook_url)
        self.timezone = ZoneInfo(timezone_name)
        self.event_cooldown_seconds = event_cooldown_seconds
        self.backend_url = (backend_url or "").rstrip("/")
        self.backend_token = backend_token or os.getenv("SECURITY_EVENT_INGEST_TOKEN")
        self.evidence_dir = Path(evidence_dir)
        self.required_confirmation_frames = max(1, int(required_confirmation_frames))
        self.test_restricted_hours = bool(test_restricted_hours)
        self.live_frame_path = Path(live_frame_path) if live_frame_path else None
        self.minimum_presence_seconds = max(0.0, float(minimum_presence_seconds))
        if self.live_frame_path:
            self.live_frame_path.parent.mkdir(parents=True, exist_ok=True)
        self.last_event_by_identity: dict[str, float] = {}
        self.confirmation_state: dict[str, dict[str, float | int]] = {}
        self.pending_backend_events: list[dict] = []
        # Face recognition is much more expensive than person detection. Keep
        # the last result briefly and refresh it periodically while YOLO still
        # runs on every frame.
        self.frame_number = 0
        self.face_refresh_interval = 3
        self.face_cache: list[tuple[int, int, int, int, Optional[Student], float]] = []
        self.current_fps = 0.0

    @property
    def model(self):
        global YOLO
        if self._model is None:
            if YOLO is None:
                from ultralytics import YOLO as _YOLO
                YOLO = _YOLO
            self._model = YOLO(self.model_path)
        return self._model

    def _match_face(self, encoding: np.ndarray, students: Iterable[Student]) -> Optional[Student]:
        fr = get_face_recognition()
        if fr is None:
            return None
        candidates = list(students)
        if not candidates:
            return None
        distances = fr.face_distance([student.encoding for student in candidates], encoding)
        index = int(np.argmin(distances))
        return candidates[index] if distances[index] <= self.face_threshold else None

    def _can_log(self, identity: str) -> bool:
        now = time.monotonic()
        previous = self.last_event_by_identity.get(identity, 0)
        if now - previous < self.event_cooldown_seconds:
            return False
        self.last_event_by_identity[identity] = now
        return True

    def _post_backend_event(self, event: dict) -> bool:
        if not self.backend_url:
            LOG.warning("Security event backend is not configured; event retained locally: %s", event["event_id"])
            return False
        if requests is None:
            LOG.error("requests is required to deliver security events to the backend.")
            return False
        try:
            headers = {"Authorization": f"Bearer {self.backend_token}"} if self.backend_token else {}
            response = requests.post(f"{self.backend_url}/api/surveillance/events", json=event, headers=headers, timeout=5)
            response.raise_for_status()
            LOG.info("Event sent to backend: %s", event["event_id"])
            return True
        except requests.RequestException as error:
            LOG.error("Security event backend unavailable; surveillance will continue: %s", error)
            return False

    def _retry_backend_events(self) -> None:
        if not self.pending_backend_events:
            return
        pending = self.pending_backend_events[:]
        self.pending_backend_events.clear()
        for event in pending:
            if not self._post_backend_event(event):
                self.pending_backend_events.append(event)

    def _confirmed(self, identity: str, now: float, seen: set[str]) -> bool:
        state = self.confirmation_state.setdefault(identity, {"frames": 0, "last_seen": now, "first_seen": now, "alerted": 0})
        if now - float(state["last_seen"]) > 2.0:
            state["frames"] = 0
            state["first_seen"] = now
        state["frames"] = int(state["frames"]) + 1
        state["last_seen"] = now
        seen.add(identity)
        presence_seconds = now - float(state.get("first_seen", now))
        if int(state.get("alerted", 0)) or int(state["frames"]) < self.required_confirmation_frames or presence_seconds < self.minimum_presence_seconds:
            return False
        state["alerted"] = 1
        return True

    def _reset_missing(self, seen: set[str], now: float) -> None:
        for identity in list(self.confirmation_state):
            state = self.confirmation_state[identity]
            if identity not in seen and now - float(state["last_seen"]) > 1.0:
                del self.confirmation_state[identity]

    def _create_security_event(self, frame: np.ndarray, identity: str, matched: Optional[Student], timestamp: datetime, box: tuple[int, int, int, int], confidence: float) -> dict:
        event_id = str(uuid.uuid4())
        event_day = timestamp.strftime("%Y-%m-%d")
        event_dir = self.evidence_dir / event_day
        event_dir.mkdir(parents=True, exist_ok=True)
        evidence_file = event_dir / f"{timestamp.strftime('%Y-%m-%d_%H-%M-%S')}_{self.camera_id}_{matched.student_id if matched else 'UNKNOWN'}_{event_id}.jpg"
        evidence_path = str(evidence_file).replace("\\", "/")
        left, top, right, bottom = box
        cv2.rectangle(frame, (left, top), (right, bottom), (0, 0, 255), 3)
        student_name = matched.name if matched else "Unknown person"
        student_id = matched.student_id if matched else None
        lines = [
            "UNAUTHORIZED NIGHT ACTIVITY",
            f"Camera: {self.camera_id}",
            f"Time: {timestamp.strftime('%H:%M:%S')}",
            f"Student: {student_name}",
            f"ID: {student_id or 'Unknown'}",
        ]
        cv2.rectangle(frame, (0, 0), (min(frame.shape[1], 760), 150), (18, 24, 38), -1)
        for index, line in enumerate(lines):
            cv2.putText(frame, line, (18, 30 + index * 25), cv2.FONT_HERSHEY_SIMPLEX, 0.68 if index == 0 else 0.56, (80, 220, 255) if index == 0 else (255, 255, 255), 2, cv2.LINE_AA)
        if not cv2.imwrite(str(evidence_file), frame):
            raise RuntimeError(f"Unable to save evidence frame: {evidence_file}")
        event = {
            "event_id": event_id,
            "camera_id": self.camera_id,
            "student_id": student_id,
            "student_name": student_name,
            "event_type": "NIGHT_RESTRICTION",
            "status": "UNAUTHORIZED",
            "reason": "Person detected during restricted hours",
            "timestamp": timestamp.isoformat(),
            "evidence_path": evidence_path,
            "proof_image": evidence_path,
            "yolo_confidence": confidence,
            "face_match": bool(matched),
            "acknowledged": False,
            "confidence": confidence,
        }
        self.database.save_surveillance_event(event)
        self.database.log(student_id, timestamp, "NIGHT_RESTRICTION", "UNAUTHORIZED", self.camera_id, event_id=event_id, evidence_path=evidence_path, confidence=confidence)
        if not self._post_backend_event(event):
            self.pending_backend_events.append(event)
        self.alert.send(event)
        return event

    def _draw_corner_rect(self, img: np.ndarray, x1: int, y1: int, x2: int, y2: int, color: tuple[int, int, int], thickness: int = 2, corner_len: int = 18) -> None:
        """Draw a sleek surveillance targeting frame with 4 corner brackets."""
        # Translucent bounding box
        cv2.rectangle(img, (x1, y1), (x2, y2), color, 1, cv2.LINE_AA)
        cl = min(corner_len, max(8, (x2 - x1) // 4), max(8, (y2 - y1) // 4))
        t = thickness
        # Top-Left
        cv2.line(img, (x1, y1), (x1 + cl, y1), color, t, cv2.LINE_AA)
        cv2.line(img, (x1, y1), (x1, y1 + cl), color, t, cv2.LINE_AA)
        # Top-Right
        cv2.line(img, (x2, y1), (x2 - cl, y1), color, t, cv2.LINE_AA)
        cv2.line(img, (x2, y1), (x2, y1 + cl), color, t, cv2.LINE_AA)
        # Bottom-Left
        cv2.line(img, (x1, y2), (x1 + cl, y2), color, t, cv2.LINE_AA)
        cv2.line(img, (x1, y2), (x1, y2 - cl), color, t, cv2.LINE_AA)
        # Bottom-Right
        cv2.line(img, (x2, y2), (x2 - cl, y2), color, t, cv2.LINE_AA)
        cv2.line(img, (x2, y2), (x2, y2 - cl), color, t, cv2.LINE_AA)

    def _draw_badge(self, img: np.ndarray, text: str, x: int, y: int, bg_color: tuple[int, int, int], text_color: tuple[int, int, int] = (255, 255, 255), scale: float = 0.46, thickness: int = 1, padding: int = 5) -> None:
        """Draw a high-visibility, professional anti-aliased badge tag."""
        (tw, th), baseline = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, scale, thickness)
        bx1 = x
        by1 = max(0, y - th - padding * 2)
        bx2 = x + tw + padding * 2
        by2 = by1 + th + padding * 2
        
        overlay = img.copy()
        cv2.rectangle(overlay, (bx1, by1), (bx2, by2), bg_color, -1)
        cv2.addWeighted(overlay, 0.90, img, 0.10, 0, img)
        cv2.rectangle(img, (bx1, by1), (bx2, by2), bg_color, 1, cv2.LINE_AA)
        cv2.putText(img, text, (bx1 + padding, by2 - padding - 1), cv2.FONT_HERSHEY_SIMPLEX, scale, text_color, thickness, cv2.LINE_AA)

    def _draw_cctv_hud(self, img: np.ndarray, is_restricted: bool, timestamp_dt: datetime) -> None:
        """Draw the CCTV security OSD around the already-annotated camera frame."""
        h, w = img.shape[:2]
        overlay = img.copy()
        
        # CCTV-style frame and telemetry bars.
        cv2.rectangle(img, (8, 8), (w - 9, h - 9), (72, 185, 220), 2, cv2.LINE_AA)
        cv2.rectangle(overlay, (0, 0), (w, 38), (15, 23, 42), -1)
        cv2.rectangle(overlay, (0, h - 30), (w, h), (15, 23, 42), -1)
        cv2.addWeighted(overlay, 0.78, img, 0.22, 0, img)
        
        # Top-left: recording state and camera information.
        cv2.circle(img, (16, 18), 5, (0, 0, 245), -1, cv2.LINE_AA)
        cv2.putText(img, "LIVE REC", (26, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (0, 0, 255), 1, cv2.LINE_AA)
        cv2.putText(img, f"{self.camera_id} | CAM-01", (88, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (230, 235, 245), 1, cv2.LINE_AA)
        
        # Top-center: access-hours state.
        mode_text = "RESTRICTED HOURS ACTIVE" if is_restricted else "NORMAL ACCESS HOURS"
        mode_bg = (30, 30, 220) if is_restricted else (35, 155, 45)
        (mw, mh), _ = cv2.getTextSize(mode_text, cv2.FONT_HERSHEY_SIMPLEX, 0.38, 1)
        mx1 = (w - mw) // 2
        cv2.rectangle(img, (mx1 - 8, 7), (mx1 + mw + 8, 30), mode_bg, -1, cv2.LINE_AA)
        cv2.putText(img, mode_text, (mx1, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.38, (255, 255, 255), 1, cv2.LINE_AA)
        
        # Top-right: current date and time.
        ts = timestamp_dt.strftime("%Y-%m-%d  %H:%M:%S")
        (tw, th), _ = cv2.getTextSize(ts, cv2.FONT_HERSHEY_SIMPLEX, 0.40, 1)
        cv2.putText(img, ts, (w - tw - 12, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.40, (210, 230, 255), 1, cv2.LINE_AA)
        
        # Bottom overlay: engine and security product information.
        cv2.putText(img, "AI ENGINE: YOLO11 + BIOMETRIC GUARD | HOSTELFIX SECURITY", (14, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.34, (160, 175, 200), 1, cv2.LINE_AA)
        
        # Bottom-right: live FPS and armed state.
        fps = getattr(self, "current_fps", 0.0)
        fps_text = f"{fps:.1f} FPS | SYSTEM ARMED"
        (fw, fh), _ = cv2.getTextSize(fps_text, cv2.FONT_HERSHEY_SIMPLEX, 0.34, 1)
        cv2.putText(img, fps_text, (w - fw - 14, h - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.34, (34, 197, 94), 1, cv2.LINE_AA)

    def process_frame(self, frame: np.ndarray) -> np.ndarray:
        """Detect people and authorize faces when a restricted schedule is active."""
        self.frame_number += 1
        self._retry_backend_events()
        h, w = frame.shape[:2]
        resized = cv2.resize(frame, (640, 640), interpolation=cv2.INTER_LINEAR)
        scale_x, scale_y = w / 640.0, h / 640.0
        results = self.model(resized, classes=[PERSON_CLASS_ID], conf=self.confidence, verbose=False)
        restricted = self.hours.is_restricted(test_override=self.test_restricted_hours)
        if not restricted:
            self.face_cache = []

        now_mono = time.monotonic()
        if restricted:
            if not hasattr(self, "_cached_students") or (now_mono - getattr(self, "_cached_students_time", 0)) > 5.0:
                self._cached_students = self.database.known_students()
                self._cached_students_time = now_mono
            students = self._cached_students
        else:
            students = []

        seen_identities: set[str] = set()
        frame_now = now_mono
        boxes = results[0].boxes if len(results) > 0 else []

        current_boxes: list[tuple[int, int, int, int, float]] = []
        for box in boxes:
            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
            left = max(0, int(x1 * scale_x))
            top = max(0, int(y1 * scale_y))
            right = min(w, int(x2 * scale_x))
            bottom = min(h, int(y2 * scale_y))
            confidence = float(box.conf[0])
            current_boxes.append((left, top, right, bottom, confidence))

        refresh_faces = restricted and (
            not self.face_cache or self.frame_number % self.face_refresh_interval == 0
        )
        refreshed_cache: list[tuple[int, int, int, int, Optional[Student], float]] = []
        recognized_faces: list[tuple[int, int, int, int, Optional[Student]]] = []
        if refresh_faces and students:
            fr = get_face_recognition()
            if fr is not None:
                # Detect faces once on the complete frame. This is more reliable
                # than searching separately inside a downscaled person crop.
                # Keep faces large enough for HOG recognition on the website's
                # 960x540 stream, while still avoiding full-resolution work.
                face_scale = min(1.0, 800.0 / max(w, h))
                face_frame = frame
                if face_scale < 1.0:
                    face_frame = cv2.resize(frame, (max(1, int(w * face_scale)), max(1, int(h * face_scale))), interpolation=cv2.INTER_AREA)
                face_rgb = cv2.cvtColor(face_frame, cv2.COLOR_BGR2RGB)
                face_locations = fr.face_locations(face_rgb, number_of_times_to_upsample=1, model="hog")
                face_encodings = fr.face_encodings(face_rgb, face_locations)
                for location, encoding in zip(face_locations, face_encodings):
                    face_top, face_right, face_bottom, face_left = location
                    inv_scale = 1.0 / face_scale
                    left_face = int(face_left * inv_scale)
                    top_face = int(face_top * inv_scale)
                    right_face = int(face_right * inv_scale)
                    bottom_face = int(face_bottom * inv_scale)
                    recognized_faces.append((left_face, top_face, right_face, bottom_face, self._match_face(encoding, students)))

        for left, top, right, bottom, confidence in current_boxes:
            label = f"PERSON {confidence:.0%}"
            color = (246, 130, 59)     # Modern blue
            bg_color = (180, 85, 20)

            if restricted:
                matched = None
                cache_match = None
                if not refresh_faces:
                    best_iou = 0.0
                    for cached_left, cached_top, cached_right, cached_bottom, cached_student, cached_at in self.face_cache:
                        if now_mono - cached_at > 1.0:
                            continue
                        ix1 = max(left, cached_left)
                        iy1 = max(top, cached_top)
                        ix2 = min(right, cached_right)
                        iy2 = min(bottom, cached_bottom)
                        intersection = max(0, ix2 - ix1) * max(0, iy2 - iy1)
                        union = ((right - left) * (bottom - top) +
                                 (cached_right - cached_left) * (cached_bottom - cached_top) - intersection)
                        iou = intersection / union if union > 0 else 0.0
                        if iou > best_iou:
                            best_iou = iou
                            cache_match = cached_student
                    if best_iou >= 0.25:
                        matched = cache_match
                if refresh_faces:
                    best_face_area = 0
                    for face_left, face_top, face_right, face_bottom, face_student in recognized_faces:
                        face_center_x = (face_left + face_right) / 2
                        face_center_y = (face_top + face_bottom) / 2
                        if left <= face_center_x <= right and top <= face_center_y <= bottom:
                            face_area = max(1, (face_right - face_left) * (face_bottom - face_top))
                            if face_area > best_face_area:
                                best_face_area = face_area
                                matched = face_student
                if refresh_faces:
                    refreshed_cache.append((left, top, right, bottom, matched, now_mono))

                timestamp = datetime.now(self.timezone)
                if matched and matched.authorized:
                    label = f"PERSON {confidence:.0%} | AUTHORIZED: {matched.name}"
                    color = (34, 197, 94)    # Emerald green
                    bg_color = (20, 145, 45)
                    if self._can_log(matched.student_id):
                        self.database.log(matched.student_id, timestamp, "RESTRICTED_AREA_ENTRY", "AUTHORIZED", self.camera_id, confidence=confidence)
                else:
                    identity = matched.student_id if matched else "unknown-person"
                    confirmed = self._confirmed(identity, frame_now, seen_identities)
                    label = f"PERSON {confidence:.0%} | UNAUTHORIZED: {matched.name}" if matched else f"PERSON {confidence:.0%} | UNAUTHORIZED: Unknown"
                    color = (50, 50, 240)    # Crimson red
                    bg_color = (30, 30, 220)
                    if confirmed and self._can_log(identity):
                        self._create_security_event(frame.copy(), identity, matched, timestamp, (left, top, right, bottom), confidence)

            self._draw_corner_rect(frame, left, top, right, bottom, color, thickness=2)
            self._draw_badge(frame, label, left, top, bg_color)

        if refresh_faces:
            self.face_cache = refreshed_cache

        # Draw sleek on-screen surveillance HUD
        timestamp_now = datetime.now(self.timezone)
        self._draw_cctv_hud(frame, restricted, timestamp_now)

        if self.live_frame_path:
            temp_path = self.live_frame_path.with_name(f"{self.live_frame_path.stem}_tmp{self.live_frame_path.suffix}")
            cv2.imwrite(str(temp_path), frame, [cv2.IMWRITE_JPEG_QUALITY, 72])
            try:
                temp_path.replace(self.live_frame_path)
            except OSError:
                pass
        self._reset_missing(seen_identities, frame_now)
        return frame

    def run(self, source: str, display: bool = True, target_fps: float = 20.0) -> None:
         

        camera_source: int | str = int(source) if source.isdigit() else source

        if str(source).isdigit():
            capture = cv2.VideoCapture(int(source), cv2.CAP_DSHOW)
        else:
            capture = cv2.VideoCapture(source)

        if not capture.isOpened():
            raise RuntimeError(f"Unable to open camera/video source: {source}")

        if isinstance(camera_source, int):
            capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)
            capture.set(cv2.CAP_PROP_FRAME_WIDTH, 960)
            capture.set(cv2.CAP_PROP_FRAME_HEIGHT, 540)

        # Instantly capture and output initial live frame so status becomes ONLINE in < 0.5s!
        ok, first_frame = capture.read()
        if ok and self.live_frame_path:
            init_frame = first_frame.copy()
            cv2.putText(
                init_frame,
                "CCTV ACTIVE - INITIALIZING DETECTION...",
                (18, 32),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 200, 255),
                2,
                cv2.LINE_AA,
            )
            temp_path = self.live_frame_path.with_name(
                f"{self.live_frame_path.stem}_tmp{self.live_frame_path.suffix}"
            )
            cv2.imwrite(
                str(temp_path),
                init_frame,
                [cv2.IMWRITE_JPEG_QUALITY, 72],
            )
            try:
                temp_path.replace(self.live_frame_path)
            except OSError:
                pass

        # Warm up YOLO model
        _ = self.model

        frame_interval = 1 / max(1, min(target_fps, 30))

        fps_started = time.monotonic()
        processed_frames = 0
        try:
            while True:
                started = time.monotonic()
                ok, frame = capture.read()
                if not ok:
                    LOG.info("Video stream ended or camera frame could not be read.")
                    break
                annotated = self.process_frame(frame)
                processed_frames += 1
                fps_elapsed = time.monotonic() - fps_started
                if fps_elapsed >= 1.0:
                    self.current_fps = processed_frames / fps_elapsed
                    processed_frames = 0
                    fps_started = time.monotonic()
                if display:
                    cv2.imshow("Smart Surveillance - press Q to exit", annotated)
                    if cv2.waitKey(1) & 0xFF in (ord("q"), 27):
                        break
                remaining = frame_interval - (time.monotonic() - started)
                if remaining > 0:
                    time.sleep(remaining)
        finally:
            capture.release()
            cv2.destroyAllWindows()


def enroll_from_image(database: SurveillanceDatabase, args: argparse.Namespace) -> None:
    fr = get_face_recognition()
    if fr is None:
        raise RuntimeError("Install face-recognition before enrolling students.")
    image = fr.load_image_file(args.image)
    encodings = fr.face_encodings(image)
    if len(encodings) == 0:
        face_locs = fr.face_locations(image, number_of_times_to_upsample=1, model="hog")
        if not face_locs:
            face_locs = fr.face_locations(image, number_of_times_to_upsample=2, model="hog")
        if face_locs:
            encodings = fr.face_encodings(image, face_locs)
    if len(encodings) == 0:
        raise ValueError("No face detected in the snapshot. Please center your face in the camera frame and ensure good lighting.")
    database.enroll_student(args.student_id, args.name, encodings[0], not args.unauthorized, args.access_level)
    print(f"Enrolled {args.student_id}: {args.name}")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="YOLO11 + face recognition restricted-area surveillance")
    parser.add_argument("--db", default="data/surveillance.db", help="SQLite database path")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("init-db", help="Create database tables")
    schedule = subparsers.add_parser("add-schedule", help="Add a restricted schedule (Monday is 0)")
    schedule.add_argument("--day", type=int, required=True, choices=range(7))
    schedule.add_argument("--start", required=True, help="24-hour time, for example 22:00")
    schedule.add_argument("--end", required=True, help="24-hour time, for example 06:00")
    enroll = subparsers.add_parser("enroll", help="Enroll a student from a single-face image")
    enroll.add_argument("--student-id", required=True)
    enroll.add_argument("--name", required=True)
    enroll.add_argument("--image", required=True)
    enroll.add_argument("--access-level", default="standard")
    enroll.add_argument("--unauthorized", action="store_true", help="Enroll but deny restricted-area access")
    run = subparsers.add_parser("run", help="Run webcam, IP camera, or video file surveillance")
    run.add_argument("--source", default="0", help="Webcam index, RTSP/HTTP URL, or video-file path")
    run.add_argument("--camera-id", default="HOSTEL-CCTV-01")
    run.add_argument("--model", default="yolo11n.pt")
    run.add_argument("--timezone", default=os.getenv("SURVEILLANCE_TIMEZONE", "Asia/Kolkata"))
    run.add_argument("--confidence", type=float, default=0.5)
    run.add_argument("--face-threshold", type=float, default=0.6)
    run.add_argument("--target-fps", type=float, default=float(os.getenv("SURVEILLANCE_TARGET_FPS", "10")))
    run.add_argument("--warden-webhook", default=os.getenv("WARDEN_WEBHOOK_URL"), help="Optional HTTP endpoint for unauthorized-access alerts")
    run.add_argument("--backend-url", default=os.getenv("SURVEILLANCE_API_URL", "http://localhost:5000"), help="HostelFix Node.js backend URL")
    run.add_argument("--evidence-dir", default="data/surveillance_events", help="Directory for event-only evidence snapshots")
    run.add_argument("--confirmation-frames", type=int, default=int(os.getenv("SURVEILLANCE_CONFIRMATION_FRAMES", "5")), help="Frames required before an unauthorized event")
    run.add_argument("--cooldown-seconds", type=float, default=float(os.getenv("SURVEILLANCE_COOLDOWN_SECONDS", "30")), help="Per-identity alert cooldown")
    run.add_argument("--backend-token", default=os.getenv("SURVEILLANCE_API_KEY") or os.getenv("SECURITY_EVENT_INGEST_TOKEN"), help="Bearer token for backend ingestion")
    run.add_argument("--test-restricted-hours", action="store_true", help="Override only the time check; camera, YOLO, and face recognition remain real")
    run.add_argument("--live-frame-path", help="Optional latest-frame JPEG path for the authenticated HostelFix dashboard stream")
    run.add_argument("--minimum-presence-seconds", type=float, default=float(os.getenv("SURVEILLANCE_MINIMUM_PRESENCE_SECONDS", "60")), help="Continuous presence required before creating an alert")
    run.add_argument("--no-display", action="store_true")
    return parser


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    args = build_parser().parse_args()
    database = SurveillanceDatabase(args.db)
    database.initialize()
    if args.command == "init-db":
        print(f"Initialized {args.db}")
    elif args.command == "add-schedule":
        RestrictedHours._to_time(args.start)
        RestrictedHours._to_time(args.end)
        database.add_schedule(args.day, args.start, args.end)
        print(f"Added restricted schedule for day {args.day}: {args.start}-{args.end}")
    elif args.command == "enroll":
        enroll_from_image(database, args)
    elif args.command == "run":
        SmartSurveillance(database, args.model, args.camera_id, args.timezone, args.confidence, args.face_threshold, args.warden_webhook, args.cooldown_seconds, args.backend_url, args.evidence_dir, args.confirmation_frames, args.backend_token, args.test_restricted_hours, args.live_frame_path, args.minimum_presence_seconds).run(args.source, not args.no_display, args.target_fps)


if __name__ == "__main__":
    main()
