from __future__ import annotations

from datetime import datetime
from math import hypot

from .models import PetEvent, Track
from .tracking import speed_px_s


class BehaviourEngine:
    def __init__(self, sofa: tuple[float, float, float, float] | None = None, state_hold_seconds: float = 1.0):
        self.sofa, self.state_hold_seconds = sofa, state_hold_seconds
        self._current, self._pending = {}, {}
        self._interaction_started: datetime | None = None

    def observe(self, session_id: str, tracks: list[Track], at: datetime,
                frame_size: tuple[int, int] | None = None) -> list[PetEvent]:
        events: list[PetEvent] = []
        visible = [t for t in tracks if t.dog_id and t.missed_frames == 0]
        for track in visible:
            state = self._state(track, frame_size)
            previous = self._current.get(track.dog_id)
            if not previous:
                self._current[track.dog_id] = (state, at)
            elif previous[0] != state:
                pending = self._pending.get(track.dog_id)
                if not pending or pending[0] != state:
                    self._pending[track.dog_id] = (state, at)
                elif (at - pending[1]).total_seconds() >= self.state_hold_seconds:
                    events.append(PetEvent(session_id, track.dog_id, previous[0], previous[1], pending[1],
                                           {"speed_px_s": round(speed_px_s(track), 2)}))
                    self._current[track.dog_id] = (state, pending[1])
                    self._pending.pop(track.dog_id, None)
            else:
                self._pending.pop(track.dog_id, None)
        interacting = self._is_interacting(visible, frame_size)
        if interacting and self._interaction_started is None:
            self._interaction_started = at
        elif not interacting and self._interaction_started is not None:
            events.append(PetEvent(session_id, None, "play_interaction", self._interaction_started, at,
                                   {"dogs": [t.dog_id for t in visible]}))
            self._interaction_started = None
        return events

    def close(self, session_id: str, at: datetime) -> list[PetEvent]:
        result = [PetEvent(session_id, dog, state, began, at) for dog, (state, began) in self._current.items()]
        if self._interaction_started is not None:
            result.append(PetEvent(session_id, None, "play_interaction", self._interaction_started, at))
            self._interaction_started = None
        self._current.clear(); return result

    def _state(self, track: Track, frame_size: tuple[int, int] | None) -> str:
        x, y = track.center
        if self.sofa and frame_size:
            width, height = frame_size
            x1, y1, x2, y2 = self.sofa
            if x1 * width <= x <= x2 * width and y1 * height <= y <= y2 * height:
                return "on_sofa"
        diagonal = hypot(*frame_size) if frame_size else 1000
        return "resting" if speed_px_s(track) / diagonal < 0.012 else "walking"

    @staticmethod
    def _is_interacting(visible: list[Track], frame_size: tuple[int, int] | None) -> bool:
        if len(visible) != 2:
            return False
        diagonal = hypot(*frame_size) if frame_size else 1000
        a, b = visible
        distance = hypot(a.center[0]-b.center[0], a.center[1]-b.center[1]) / diagonal
        motion = (speed_px_s(a) + speed_px_s(b)) / diagonal
        return distance < 0.16 and motion > 0.02
