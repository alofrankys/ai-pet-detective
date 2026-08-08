from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Iterable

NOISE_ACTIONS = {
    "movement", "moved_left", "moved_right", "moved_up", "moved_down",
    "closer_to_camera", "farther_from_camera", "shifted", "detected",
    "bounding_box_change", "camera_relative_motion",
}

ACTION_PRIORITY = {
    "urinating": 5.0, "defecating": 5.0, "eating": 4.9, "drinking": 4.9,
    "petting": 4.9, "feeding": 4.9, "playing": 4.8, "chasing": 4.8,
    "fetching": 4.8, "tugging": 4.8, "picking_up": 4.8, "dropping": 4.6, "carrying": 4.5, "holding": 4.1, "chewing": 4.2, "mouth_contact": 4.1,
    "offering": 4.7, "throwing": 4.7, "using_object": 4.4,
    "entering": 4.8, "leaving": 4.8, "crossing": 4.7,
    "jumping_on": 4.7, "jumping_off": 4.7, "climbing": 4.5, "descending": 4.5,
    "dog_dog_interaction": 4.6, "person_dog_interaction": 4.7,
    "tail_wagging": 3.8, "rolling": 4.0, "rubbing": 3.7, "shaking": 3.8,
    "stretching": 3.4, "scratching": 3.3, "licking": 3.5, "sniffing": 3.3,
    "sitting_down": 3.7, "standing_up": 3.7, "lying_down": 3.8,
    "sitting": 2.8, "standing": 2.6, "lying": 2.8, "sleeping": 3.5,
    "running": 3.5, "walking": 2.4, "jumping": 4.0, "crouching": 2.8,
    "mouth_open": 2.2, "tongue_visible": 2.0, "head_tilt": 2.4,
    "scene_change": 3.2, "other": 2.0,
}

CONTINUOUS_ACTIONS = {
    "petting", "playing", "chasing", "sniffing", "walking", "running",
    "chewing", "tail_wagging", "resting", "sleeping", "holding", "carrying",
    "following", "dog_dog_interaction", "person_dog_interaction",
}


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(high, float(value)))


@dataclass
class BehaviourEventV2:
    id: str
    start: float
    end: float
    action: str
    actor: str | None = None
    target: str | None = None
    description: str = ""
    confidence: float = 0.5
    importance: float | None = None
    from_state: dict[str, Any] | None = None
    to_state: dict[str, Any] | None = None
    objects: list[Any] = field(default_factory=list)
    evidence: dict[str, Any] = field(default_factory=dict)
    source: str = "unknown"
    raw_ids: list[str] = field(default_factory=list)
    meta: dict[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.start = float(self.start)
        self.end = max(self.start, float(self.end))
        self.confidence = _clamp(self.confidence)
        if self.importance is None:
            self.importance = min(1.0, ACTION_PRIORITY.get(self.action, 2.0) / 5.0)
        else:
            self.importance = _clamp(self.importance)

    def key(self) -> tuple[Any, ...]:
        object_key = tuple(sorted(str(item.get("id") or item.get("label") or item) if isinstance(item, dict) else str(item) for item in self.objects))
        return (
            self.actor or "unknown", self.action, self.target or "",
            (self.from_state or {}).get("surface", ""),
            (self.to_state or {}).get("surface", ""), object_key,
        )

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


def event_salience(event: BehaviourEventV2, session_duration: float = 0.0, novelty: float = 1.0) -> float:
    if event.action in NOISE_ACTIONS:
        return 0.0
    priority = ACTION_PRIORITY.get(event.action, 2.0) / 5.0
    duration_score = min(1.0, max(0.0, event.end - event.start) / 6.0)
    duration_bonus = duration_score * 0.08 if event.action in CONTINUOUS_ACTIONS else 0.0
    edge_bonus = 0.0
    if session_duration:
        edge_bonus = 0.04 if event.start / session_duration < 0.12 or event.end / session_duration > 0.88 else 0.0
    return _clamp(priority * 0.46 + event.confidence * 0.28 + float(event.importance or 0) * 0.16 + duration_bonus + _clamp(novelty) * 0.06 + edge_bonus)


def merge_events(events: Iterable[BehaviourEventV2], gap_seconds: float = 1.6, continuous_gap_seconds: float = 2.8) -> list[BehaviourEventV2]:
    ordered = sorted((event for event in events if event.action not in NOISE_ACTIONS), key=lambda e: (e.start, e.end))
    merged: list[BehaviourEventV2] = []
    for event in ordered:
        previous = merged[-1] if merged else None
        allowed_gap = continuous_gap_seconds if event.action in CONTINUOUS_ACTIONS else gap_seconds
        if previous and previous.key() == event.key() and event.start - previous.end <= allowed_gap:
            previous.end = max(previous.end, event.end)
            previous.confidence = max(previous.confidence, event.confidence)
            previous.importance = max(float(previous.importance or 0), float(event.importance or 0))
            previous.evidence.update(event.evidence)
            previous.raw_ids = sorted(set(previous.raw_ids + event.raw_ids))
            if len(event.description) > len(previous.description):
                previous.description = event.description
        else:
            merged.append(BehaviourEventV2(**event.as_dict()))
    return merged


def select_story_events(events: Iterable[BehaviourEventV2], session_duration: float = 0.0, max_events: int = 8, min_confidence: float = 0.48) -> list[BehaviourEventV2]:
    merged = [event for event in merge_events(events) if event.confidence >= min_confidence]
    if not merged:
        return []
    duration = session_duration or max((event.end for event in merged), default=1.0)
    group_counts: dict[tuple[Any, ...], int] = {}
    for event in merged:
        group_counts[event.key()] = group_counts.get(event.key(), 0) + 1
    scored = [(event_salience(event, duration, 1 / (group_counts[event.key()] ** 0.5)), event) for event in merged]
    bins: list[list[tuple[float, BehaviourEventV2]]] = [[], [], [], []]
    for score, event in scored:
        midpoint = (event.start + event.end) / 2
        index = min(3, int((midpoint / max(duration, 1e-6)) * 4))
        bins[index].append((score, event))
    chosen: list[BehaviourEventV2] = []
    ids: set[str] = set()
    for bucket in bins:
        if bucket:
            _, event = max(bucket, key=lambda item: item[0])
            if event.id not in ids:
                chosen.append(event); ids.add(event.id)
    for _, event in sorted(scored, key=lambda item: item[0], reverse=True):
        if len(chosen) >= max_events:
            break
        if event.id not in ids:
            chosen.append(event); ids.add(event.id)
    return sorted(chosen, key=lambda event: event.start)
