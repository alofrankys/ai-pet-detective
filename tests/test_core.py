from datetime import datetime, timedelta, timezone
from pet_detective.events import BehaviourEngine
from pet_detective.config import load_config
from pet_detective.models import Detection
from pet_detective.pipeline import PetPipeline
from pet_detective.qvac import QvacVision
from pet_detective.storage import EventStore
from pet_detective.tracking import DogTracker
from pet_detective.sources import is_youtube_url, youtube_embed_url


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


def test_youtube_links_are_recognised_and_embedded_safely():
    url = "https://www.youtube.com/watch?v=DCoYgADsmts"
    assert is_youtube_url(url)
    assert youtube_embed_url(url) == "https://www.youtube.com/embed/DCoYgADsmts"
    assert not is_youtube_url("https://example.com/watch?v=DCoYgADsmts")


def test_configured_calibration_is_persisted_in_report(tmp_path):
    config_file = tmp_path / "dogs.json"
    config_file.write_text('{"dogs":[{"id":"ada"},{"id":"bruno"}],"calibration":{"pixels_per_metre":100}}')
    config = load_config(str(config_file))
    pipeline = PetPipeline(EventStore(str(tmp_path / "events.db")), config.dog_ids, config.sofa, config.pixels_per_metre)
    start = datetime.now(timezone.utc)
    pipeline.ingest("s", [Detection((0, 0, 10, 10), .9), Detection((50, 0, 60, 10), .9)], start, (100, 100))
    pipeline.ingest("s", [Detection((100, 0, 110, 10), .9), Detection((50, 0, 60, 10), .9)], start + timedelta(seconds=1), (100, 100))
    report = pipeline.finish("s", start + timedelta(seconds=2))
    assert report["calibrated"] is True
    assert report["dogs"]["ada"]["distance_m"] == 1.0


def test_unavailable_qvac_semantic_endpoint_falls_back_to_local_processing(tmp_path):
    image = tmp_path / "frame.jpg"
    image.write_bytes(b"not-a-real-jpeg")
    vision = QvacVision("http://127.0.0.1:1/v1/chat/completions", "local-model")
    assert vision.analyse(str(image)) is None
