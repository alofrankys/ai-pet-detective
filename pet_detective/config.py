from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class PetConfig:
    dog_ids: list[str]
    sofa: tuple[float, float, float, float] | None = None
    pixels_per_metre: float | None = None


def load_config(path: str | None) -> PetConfig:
    """Load the small, local camera configuration used by a session.

    Zone coordinates are normalized (0..1), so the same configuration works
    for every resolution from the same camera.
    """
    if path is None:
        return PetConfig(["cavalier", "mixed"])
    source = Path(path)
    try:
        raw = json.loads(source.read_text())
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(f"Cannot read configuration {source}: {exc}") from exc
    dogs = raw.get("dogs", [])
    dog_ids = [dog.get("id") for dog in dogs if isinstance(dog, dict) and isinstance(dog.get("id"), str)]
    if len(dog_ids) != 2 or len(set(dog_ids)) != 2:
        raise ValueError("Configuration must define exactly two distinct dogs[].id values")
    sofa = raw.get("zones", {}).get("sofa")
    if sofa is not None:
        if not isinstance(sofa, list) or len(sofa) != 4 or any(not isinstance(v, (int, float)) or not 0 <= v <= 1 for v in sofa):
            raise ValueError("zones.sofa must contain four normalized coordinates between 0 and 1")
        if sofa[0] >= sofa[2] or sofa[1] >= sofa[3]:
            raise ValueError("zones.sofa must be ordered [x1, y1, x2, y2]")
        sofa = tuple(float(v) for v in sofa)
    ppm = raw.get("calibration", {}).get("pixels_per_metre")
    if ppm is not None and (not isinstance(ppm, (int, float)) or ppm <= 0):
        raise ValueError("calibration.pixels_per_metre must be a positive number or null")
    return PetConfig(dog_ids, sofa, float(ppm) if ppm is not None else None)
