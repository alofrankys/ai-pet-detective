from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass(frozen=True)
class Detection:
    bbox: tuple[float, float, float, float]
    confidence: float
    label: str = "dog"

    @property
    def center(self) -> tuple[float, float]:
        x1, y1, x2, y2 = self.bbox
        return ((x1 + x2) / 2, (y1 + y2) / 2)


@dataclass
class Track:
    track_id: int
    bbox: tuple[float, float, float, float]
    created_at: datetime
    updated_at: datetime
    dog_id: str | None = None
    history: list[tuple[datetime, tuple[float, float]]] = field(default_factory=list)
    missed_frames: int = 0

    @property
    def center(self) -> tuple[float, float]:
        x1, y1, x2, y2 = self.bbox
        return ((x1 + x2) / 2, (y1 + y2) / 2)


@dataclass(frozen=True)
class PetEvent:
    session_id: str
    dog_id: str | None
    kind: str
    started_at: datetime
    ended_at: datetime
    payload: dict[str, Any] = field(default_factory=dict)
