from __future__ import annotations

from datetime import datetime
from math import hypot

from .models import Detection, Track


def iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    x1, y1 = max(a[0], b[0]), max(a[1], b[1])
    x2, y2 = min(a[2], b[2]), min(a[3], b[3])
    intersection = max(0, x2 - x1) * max(0, y2 - y1)
    union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection
    return intersection / union if union else 0.0


class DogTracker:
    """Motion-aware two-subject tracker; replaceable with ReID/BoT-SORT later."""
    def __init__(self, dog_ids: list[str], min_iou: float = 0.10, max_missed: int = 20,
                 max_centroid_distance: float = 180.0):
        self.dog_ids, self.min_iou, self.max_missed = dog_ids, min_iou, max_missed
        self.max_centroid_distance = max_centroid_distance
        self._tracks: dict[int, Track] = {}
        self._next_id = 1

    def update(self, detections: list[Detection], at: datetime) -> list[Track]:
        candidates = []
        for tid, track in self._tracks.items():
            predicted = self._predicted_center(track, at)
            for idx, detection in enumerate(detections):
                overlap = iou(track.bbox, detection.bbox)
                distance = hypot(predicted[0] - detection.center[0], predicted[1] - detection.center[1])
                if overlap >= self.min_iou or distance <= self.max_centroid_distance:
                    candidates.append((overlap * 2 - distance / self.max_centroid_distance, tid, idx))
        candidates.sort(reverse=True)
        matched_tracks, matched_detections = set(), set()
        for _, tid, idx in candidates:
            if tid in matched_tracks or idx in matched_detections:
                continue
            track = self._tracks[tid]
            track.bbox, track.updated_at, track.missed_frames = detections[idx].bbox, at, 0
            track.history.append((at, track.center))
            track.history = track.history[-300:]
            matched_tracks.add(tid); matched_detections.add(idx)
        for tid, track in list(self._tracks.items()):
            if tid not in matched_tracks:
                track.missed_frames += 1
                if track.missed_frames > self.max_missed:
                    del self._tracks[tid]
        assigned = {t.dog_id for t in self._tracks.values() if t.dog_id}
        free_ids = [x for x in self.dog_ids if x not in assigned]
        for idx, detection in enumerate(detections):
            if idx in matched_detections:
                continue
            tid = self._next_id; self._next_id += 1
            dog_id = free_ids.pop(0) if free_ids else None
            self._tracks[tid] = Track(tid, detection.bbox, at, at, dog_id, [(at, detection.center)])
        return list(self._tracks.values())

    @staticmethod
    def _predicted_center(track: Track, at: datetime) -> tuple[float, float]:
        if len(track.history) < 2:
            return track.center
        (t1, p1), (t2, p2) = track.history[-2:]
        sample_seconds = (t2 - t1).total_seconds()
        future_seconds = (at - t2).total_seconds()
        if sample_seconds <= 0 or future_seconds > 2:
            return track.center
        return (p2[0] + (p2[0] - p1[0]) / sample_seconds * future_seconds,
                p2[1] + (p2[1] - p1[1]) / sample_seconds * future_seconds)


def speed_px_s(track: Track, window: int = 10) -> float:
    samples = track.history[-window:]
    if len(samples) < 2: return 0.0
    travelled = sum(hypot(b[0]-a[0], b[1]-a[1]) for (_, a), (_, b) in zip(samples, samples[1:]))
    seconds = (samples[-1][0] - samples[0][0]).total_seconds()
    return travelled / seconds if seconds else 0.0
