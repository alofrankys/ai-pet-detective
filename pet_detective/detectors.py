from __future__ import annotations

import json
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .models import Detection


class Detector(Protocol):
    name: str

    def detect(self, frame) -> list[Detection]: ...


class UltralyticsDetector:
    name = "ultralytics-yolo11n"

    def __init__(self, model: str = "yolo11n.pt", confidence: float = 0.35):
        try:
            from ultralytics import YOLO
        except ImportError as exc:
            raise RuntimeError("Install video support: pip install -e '.[vision]'") from exc
        self.model = YOLO(model)
        self.confidence = confidence

    def detect(self, frame) -> list[Detection]:
        result = self.model(frame, classes=[16], conf=self.confidence, verbose=False)[0]
        return [Detection(tuple(map(float, box.xyxy[0].tolist())), float(box.conf[0])) for box in result.boxes]


class QvacOnnxDetector:
    """Client for the local QVAC ONNX worker derived from TwinPaws."""
    name = "qvac-onnx-yolov10"

    def __init__(self, endpoint: str = "http://127.0.0.1:8795/detect", confidence: float = 0.45):
        self.endpoint = endpoint
        self.confidence = confidence

    def detect(self, frame) -> list[Detection]:
        try:
            import cv2
        except ImportError as exc:
            raise RuntimeError("Install video support: pip install -e '.[vision]'") from exc
        height, width = frame.shape[:2]
        rgb = cv2.cvtColor(cv2.resize(frame, (640, 640)), cv2.COLOR_BGR2RGB)
        request = Request(self.endpoint, data=rgb.tobytes(), headers={"Content-Type": "application/octet-stream"})
        try:
            with urlopen(request, timeout=10) as response:
                payload = json.load(response)
        except (HTTPError, URLError, TimeoutError) as exc:
            raise RuntimeError(f"QVAC detector unavailable at {self.endpoint}: {exc}") from exc
        detections = []
        for item in payload.get("objects", []):
            if item.get("label") != "dog" or float(item.get("score", 0)) < self.confidence:
                continue
            x1, y1, x2, y2 = map(float, item["box"])
            detections.append(Detection((x1 * width, y1 * height, x2 * width, y2 * height), float(item["score"])))
        return detections
