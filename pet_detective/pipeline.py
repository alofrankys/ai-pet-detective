from __future__ import annotations

from datetime import datetime, timezone
from .events import BehaviourEngine
from .models import Detection
from .storage import EventStore
from .tracking import DogTracker


class PetPipeline:
    def __init__(self, store: EventStore, dog_ids: list[str] | None = None,
                 sofa: tuple[float, float, float, float] | None = None,
                 pixels_per_metre: float | None = None):
        self.store, self.tracker = store, DogTracker(dog_ids or ["cavalier", "mixed"])
        self.behaviour = BehaviourEngine(sofa)
        self.pixels_per_metre = pixels_per_metre
        self._configured_sessions: set[str] = set()

    def ingest(self, session_id: str, detections: list[Detection], at: datetime | None = None,
               frame_size: tuple[int, int] | None = None) -> None:
        at = at or datetime.now(timezone.utc)
        if session_id not in self._configured_sessions:
            self.store.configure_session(session_id, self.pixels_per_metre)
            self._configured_sessions.add(session_id)
        tracks = self.tracker.update(detections, at)
        self.store.add_samples(session_id, tracks, at)
        self.store.add(self.behaviour.observe(session_id, tracks, at, frame_size))

    def finish(self, session_id: str, at: datetime | None = None) -> dict:
        self.store.add(self.behaviour.close(session_id, at or datetime.now(timezone.utc)))
        return self.store.report(session_id)
