from __future__ import annotations

import argparse, json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from .models import Detection
from .pipeline import PetPipeline
from .storage import EventStore
from .video import analyse_video


def demo(args):
    pipe = PetPipeline(EventStore(args.db))
    start = datetime.now(timezone.utc)
    for second in range(90):
        # Two paths: rest, walk, then a short close interaction.
        a = (50 + max(0, second-25)*15, 100, 130 + max(0, second-25)*15, 200)
        b = (650 - max(0, second-45)*15, 110, 740 - max(0, second-45)*15, 215)
        pipe.ingest(args.session, [Detection(a,.98), Detection(b,.97)], start + timedelta(seconds=second), (800, 450))
    result = pipe.finish(args.session, start + timedelta(seconds=90))
    save_report(result); print(json.dumps(result, indent=2))


def save_report(result):
    Path("data/reports").mkdir(parents=True, exist_ok=True)
    Path(f"data/reports/{result['session_id']}.json").write_text(json.dumps(result, indent=2))


def report(args):
    result = EventStore(args.db).report(args.session); save_report(result); print(json.dumps(result, indent=2))


def dashboard(args):
    from .dashboard import app
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=args.port)


def analyze(args):
    store = EventStore(args.db)
    result = analyse_video(args.source, args.session, PetPipeline(store), args.qvac, args.semantic_every,
                           args.detector, args.detector_endpoint)
    save_report(result); print(json.dumps(result, indent=2))


def main():
    parser = argparse.ArgumentParser(prog="petdetective")
    parser.add_argument("--db", default="data/pet_detective.db")
    sub = parser.add_subparsers(required=True)
    p = sub.add_parser("demo"); p.add_argument("--session", default="demo-session"); p.set_defaults(func=demo)
    p = sub.add_parser("report"); p.add_argument("--session", required=True); p.set_defaults(func=report)
    p = sub.add_parser("dashboard"); p.add_argument("--port", type=int, default=8000); p.set_defaults(func=dashboard)
    p = sub.add_parser("analyze"); p.add_argument("--source", required=True, help="Video path or camera index")
    p.add_argument("--session", required=True); p.add_argument("--qvac", action="store_true")
    p.add_argument("--semantic-every", type=int, default=15)
    p.add_argument("--detector", choices=["ultralytics", "qvac"], default="ultralytics")
    p.add_argument("--detector-endpoint", default="http://127.0.0.1:8795/detect"); p.set_defaults(func=analyze)
    args = parser.parse_args(); args.func(args)

if __name__ == "__main__": main()
