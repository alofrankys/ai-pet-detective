from datetime import datetime, timedelta, timezone
from pet_detective.events import BehaviourEngine
from pet_detective.models import Detection
from pet_detective.tracking import DogTracker


def test_tracker_preserves_two_dogs_while_crossing():
    tracker = DogTracker(["cavalier", "mixed"])
    start = datetime.now(timezone.utc)
    for second in range(8):
        left = Detection((20 + second*20, 30, 100 + second*20, 130), .9)
        right = Detection((300 - second*20, 30, 380 - second*20, 130), .9)
        tracks = tracker.update([left, right], start + timedelta(seconds=second))
    assert {track.dog_id for track in tracks} == {"cavalier", "mixed"}
    assert len(tracks) == 2


def test_play_is_one_session_not_one_event_per_frame():
    tracker = DogTracker(["cavalier", "mixed"])
    engine = BehaviourEngine(state_hold_seconds=0)
    start = datetime.now(timezone.utc)
    events = []
    for second in range(6):
        tracks = tracker.update([
            Detection((100+second*15, 100, 180+second*15, 200), .9),
            Detection((300-second*15, 100, 380-second*15, 200), .9)], start+timedelta(seconds=second))
        events += engine.observe("s", tracks, start+timedelta(seconds=second), (640, 480))
    events += engine.close("s", start+timedelta(seconds=6))
    assert sum(event.kind == "play_interaction" for event in events) <= 1
