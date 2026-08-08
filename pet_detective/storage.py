from __future__ import annotations

import json, sqlite3
from datetime import datetime
from pathlib import Path
from .models import PetEvent
from .models import Track


class EventStore:
    def __init__(self, path: str = "data/pet_detective.db"):
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        self.db.execute("""CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, session_id TEXT, dog_id TEXT,
            kind TEXT, started_at TEXT, ended_at TEXT, payload TEXT)""")
        self.db.execute("""CREATE TABLE IF NOT EXISTS track_samples (id INTEGER PRIMARY KEY, session_id TEXT,
            dog_id TEXT, track_id INTEGER, captured_at TEXT, x REAL, y REAL)""")
        self.db.execute("""CREATE TABLE IF NOT EXISTS sessions (session_id TEXT PRIMARY KEY,
            pixels_per_metre REAL)""")
        self.db.commit()

    def configure_session(self, session_id: str, pixels_per_metre: float | None) -> None:
        self.db.execute("INSERT OR IGNORE INTO sessions(session_id,pixels_per_metre) VALUES(?,?)",
                        (session_id, pixels_per_metre))
        self.db.commit()

    def add_samples(self, session_id: str, tracks: list[Track], at: datetime) -> None:
        visible = [t for t in tracks if t.dog_id and t.missed_frames == 0]
        self.db.executemany("INSERT INTO track_samples(session_id,dog_id,track_id,captured_at,x,y) VALUES(?,?,?,?,?,?)",
            [(session_id, t.dog_id, t.track_id, at.isoformat(), t.center[0], t.center[1]) for t in visible])
        self.db.commit()

    def add(self, events: list[PetEvent]) -> None:
        self.db.executemany("INSERT INTO events(session_id,dog_id,kind,started_at,ended_at,payload) VALUES(?,?,?,?,?,?)",
            [(e.session_id,e.dog_id,e.kind,e.started_at.isoformat(),e.ended_at.isoformat(),json.dumps(e.payload)) for e in events])
        self.db.commit()

    def report(self, session_id: str) -> dict:
        setting = self.db.execute("SELECT pixels_per_metre FROM sessions WHERE session_id=?", (session_id,)).fetchone()
        pixels_per_metre = setting[0] if setting else None
        rows = self.db.execute("SELECT dog_id,kind,started_at,ended_at,payload FROM events WHERE session_id=?", (session_id,)).fetchall()
        dogs, interactions, observations = {}, 0, []
        for dog, kind, start, end, payload in rows:
            duration = max(0, datetime.fromisoformat(end).timestamp() - datetime.fromisoformat(start).timestamp())
            if dog: dogs.setdefault(dog, {}).setdefault(kind, 0); dogs[dog][kind] += round(duration, 1)
            if kind == 'play_interaction': interactions += 1
            if kind == 'qvac_observation': observations.append({"at": start, **json.loads(payload)})
        samples = self.db.execute("SELECT dog_id,x,y FROM track_samples WHERE session_id=? ORDER BY captured_at,id", (session_id,)).fetchall()
        previous, distances = {}, {}
        for dog, x, y in samples:
            if dog in previous:
                px, py = previous[dog]
                distances[dog] = distances.get(dog, 0.0) + ((x-px)**2 + (y-py)**2) ** 0.5
            previous[dog] = (x, y)
        for dog, states in dogs.items():
            dogs[dog] = {kind: round(seconds, 1) for kind, seconds in states.items()}
            dogs[dog]["distance_px"] = round(distances.get(dog, 0.0), 1)
            if pixels_per_metre:
                dogs[dog]["distance_m"] = round(distances.get(dog, 0.0) / pixels_per_metre, 2)
        return {"session_id": session_id, "dogs": dogs, "play_interactions": interactions,
                "qvac_observations": observations, "event_count": len(rows),
                "calibrated": bool(pixels_per_metre)}
