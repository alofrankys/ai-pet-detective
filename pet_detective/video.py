from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

from .models import Detection, PetEvent
from .pipeline import PetPipeline
from .qvac import QvacVision
from .detectors import QvacOnnxDetector, UltralyticsDetector
from .sources import resolve_video_source


def analyse_video(source: str, session_id: str, pipeline: PetPipeline, use_qvac: bool = False,
                  sample_seconds: int = 15, detector_name: str = "ultralytics",
                  detector_endpoint: str = "http://127.0.0.1:8795/detect",
                  on_progress: Callable[[dict], None] | None = None) -> dict:
    """Run local COCO dog detection. Imports heavy dependencies only when used."""
    try:
        import cv2
    except ImportError as exc:
        raise RuntimeError("Install video support: pip install -e '.[vision]'") from exc
    resolved = resolve_video_source(source)
    capture_source = int(source) if source.isdigit() else resolved.stream_url
    capture = cv2.VideoCapture(capture_source)
    if not capture.isOpened():
        raise RuntimeError(f"Non riesco ad aprire la sorgente video: {resolved.label}")
    fps = capture.get(cv2.CAP_PROP_FPS) or 30
    total_frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    duration = total_frames / fps if total_frames and not resolved.is_live else None
    detector = QvacOnnxDetector(detector_endpoint) if detector_name == "qvac" else UltralyticsDetector()
    vision = QvacVision()
    start, frame_no, next_semantic, last_progress = datetime.now(timezone.utc), 0, 0.0, -1
    while True:
        ok, frame = capture.read()
        if not ok: break
        seconds = frame_no / fps; at = start + timedelta(seconds=seconds)
        detections = detector.detect(frame)
        events = pipeline.ingest(session_id, detections, at, (frame.shape[1], frame.shape[0]))
        live_events = list(events)
        # Vision is event-driven, with a periodic safety sample for long stable scenes.
        if use_qvac and vision.enabled and detections and (events or seconds >= next_semantic):
            Path("data/captures").mkdir(parents=True, exist_ok=True)
            image_path = f"data/captures/{session_id}-{frame_no}.jpg"; cv2.imwrite(image_path, frame)
            semantic = vision.analyse(image_path)
            if semantic:
                observation = PetEvent(session_id, None, "qvac_observation", at, at, semantic)
                pipeline.store.add([observation])
                live_events.append(observation)
            next_semantic = seconds + sample_seconds
        progress_second = int(seconds)
        if on_progress and progress_second != last_progress:
            on_progress({
                "processed_seconds": round(seconds, 1), "duration_seconds": duration,
                "progress": round(frame_no / total_frames * 100, 1) if total_frames else None,
                "states": pipeline.current_states(),
                "events": [{
                    "kind": e.kind, "dog_id": e.dog_id, "at": e.ended_at.isoformat(),
                    "video_seconds": round(seconds, 1), "description": e.payload.get("description"),
                } for e in live_events],
            })
            last_progress = progress_second
        frame_no += 1
    capture.release()
    return pipeline.finish(session_id, start + timedelta(seconds=frame_no / fps))
