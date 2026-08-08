from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from .models import Detection, PetEvent
from .pipeline import PetPipeline
from .qvac import QvacVision
from .detectors import QvacOnnxDetector, UltralyticsDetector


def analyse_video(source: str, session_id: str, pipeline: PetPipeline, use_qvac: bool = False,
                  sample_seconds: int = 15, detector_name: str = "ultralytics",
                  detector_endpoint: str = "http://127.0.0.1:8795/detect") -> dict:
    """Run local COCO dog detection. Imports heavy dependencies only when used."""
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError("Install video support: pip install -e '.[vision]'") from exc
    capture = cv2.VideoCapture(int(source) if source.isdigit() else source)
    if not capture.isOpened(): raise RuntimeError(f"Cannot open source: {source}")
    fps = capture.get(cv2.CAP_PROP_FPS) or 30
    detector = QvacOnnxDetector(detector_endpoint) if detector_name == "qvac" else UltralyticsDetector()
    vision = QvacVision()
    start, frame_no, next_semantic = datetime.now(timezone.utc), 0, 0.0
    while True:
        ok, frame = capture.read()
        if not ok: break
        seconds = frame_no / fps; at = start + timedelta(seconds=seconds)
        detections = detector.detect(frame)
        pipeline.ingest(session_id, detections, at, (frame.shape[1], frame.shape[0]))
        if use_qvac and vision.enabled and detections and seconds >= next_semantic:
            Path("data/captures").mkdir(parents=True, exist_ok=True)
            image_path = f"data/captures/{session_id}-{frame_no}.jpg"; cv2.imwrite(image_path, frame)
            semantic = vision.analyse(image_path)
            if semantic:
                pipeline.store.add([PetEvent(session_id, None, "qvac_observation", at, at, semantic)])
            next_semantic = seconds + sample_seconds
        frame_no += 1
    capture.release()
    return pipeline.finish(session_id, start + timedelta(seconds=frame_no / fps))
