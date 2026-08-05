"""
camera.py
---------
Unified video source wrapper around cv2.VideoCapture. Supports:
  * a local webcam (integer index, e.g. 0)
  * an RTSP stream URL (e.g. "rtsp://user:pass@host:554/stream")
  * a video file path (e.g. "footage.mp4")

This module only reads frames - it has no knowledge of detection,
recognition, or drawing, so it can be reused for other purposes too.
"""

from __future__ import annotations

import time
from collections.abc import Iterator
from typing import Union

import cv2
import numpy as np

VideoSource = Union[int, str]


class VideoStream:
    """
    Thin wrapper around `cv2.VideoCapture` with sane defaults for CCTV/RTSP
    use: automatic reconnect on read failure, and an iterator interface.

    Example
    -------
        with VideoStream("rtsp://camera.local/stream") as stream:
            for frame in stream.frames():
                ...
    """

    def __init__(
        self,
        source: VideoSource,
        reconnect_delay_sec: float = 2.0,
        max_reconnect_attempts: int = 5,
        buffer_size: int = 1,
    ) -> None:
        """
        Parameters
        ----------
        source:
            0/1/... for a local webcam index, an "rtsp://..." URL for an IP
            camera, or a filesystem path/string for a recorded video file.
        reconnect_delay_sec:
            Seconds to wait between reconnect attempts if the stream drops
            (mainly relevant for flaky RTSP connections).
        max_reconnect_attempts:
            Give up after this many consecutive failed reconnects.
        buffer_size:
            OpenCV capture buffer size. Kept small (default 1) for live
            streams so `authenticate()` always sees the *latest* frame
            rather than lagging behind on a backlog.
        """
        self.source = source
        self.reconnect_delay_sec = reconnect_delay_sec
        self.max_reconnect_attempts = max_reconnect_attempts
        self.buffer_size = buffer_size
        self._cap: cv2.VideoCapture | None = None
        self._open()

    def _open(self) -> None:
        self._cap = cv2.VideoCapture(self.source)
        # CAP_PROP_BUFFERSIZE is not honored by every backend, but it's a
        # no-op if unsupported rather than an error.
        self._cap.set(cv2.CAP_PROP_BUFFERSIZE, self.buffer_size)
        if not self._cap.isOpened():
            raise ConnectionError(f"Unable to open video source: {self.source!r}")

    def read(self) -> np.ndarray | None:
        """
        Read a single frame. Returns None (after exhausting reconnect
        attempts) if the source is unrecoverable - e.g. end of a video
        file, or a persistently dead RTSP link.
        """
        assert self._cap is not None

        ok, frame = self._cap.read()
        if ok:
            return frame

        # Try to recover (mainly useful for RTSP streams that hiccup).
        for attempt in range(1, self.max_reconnect_attempts + 1):
            time.sleep(self.reconnect_delay_sec)
            self._cap.release()
            try:
                self._open()
            except ConnectionError:
                continue
            ok, frame = self._cap.read()
            if ok:
                return frame

        return None

    def frames(self) -> Iterator[np.ndarray]:
        """Yield frames until the source ends or becomes unrecoverable."""
        while True:
            frame = self.read()
            if frame is None:
                return
            yield frame

    def release(self) -> None:
        if self._cap is not None:
            self._cap.release()
            self._cap = None

    def __enter__(self) -> "VideoStream":
        return self

    def __exit__(self, *_exc_info: object) -> None:
        self.release()

    def is_opened(self) -> bool:
        return self._cap is not None and self._cap.isOpened()


def open_webcam(index: int = 0) -> VideoStream:
    """Convenience helper for a local webcam by device index."""
    return VideoStream(index)


def open_rtsp(url: str) -> VideoStream:
    """Convenience helper for an RTSP IP-camera stream."""
    return VideoStream(url)


def open_video_file(path: str) -> VideoStream:
    """Convenience helper for a recorded video file on disk."""
    return VideoStream(path)
