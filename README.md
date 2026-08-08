# AI Pet Detective

Local-first activity analytics for two dogs. A video/camera stream is reduced to
dog detections, stable tracks, temporal events and a compact one-hour report.
QVAC is used only for periodic semantic interpretation of meaningful frames;
the high-frequency measurements remain deterministic and local.

## What is included

- YOLO-backed dog detector (optional) and deterministic JSON replay detector
- optional QVAC ONNX/YoloV10 worker adapted from TwinPaws without collapsing the two dogs into one class
- lightweight IoU/centroid multi-object tracker, including identity assignment
- state machine for resting, walking, playing, sofa visits and interactions
- SQLite event store, session metrics and JSON reporting
- QVAC OpenAI-compatible semantic adapter, disabled safely unless configured
- FastAPI dashboard/API and a complete synthetic demo

## Quick start

Requires Python 3.11+.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e '.[vision,dashboard]'
petdetective demo
petdetective report --session demo-session
petdetective dashboard
```

The demo creates `data/pet_detective.db` and `data/reports/demo-session.json`.
Open `http://127.0.0.1:8000` for the dashboard.

The dashboard starts with a single source chooser: **Camera live** (camera 0
on the computer running the dashboard), **Carica video** (MP4, MOV, M4V, AVI
or MKV) or **Link YouTube**. Each choice uses the same live state/event panel
and report. A local upload is replayed in sync with analysis; YouTube is shown
in its embedded player while its stream is analysed locally. Motion/tracking
runs on every frame. Optional QVAC vision is triggered at activity changes,
with the selected interval acting only as a safety check during long,
unchanging scenes.

## Real video or camera

```bash
petdetective analyze --source /path/to/dogs.mp4 --session morning-01
# or
petdetective analyze --source 0 --session living-room-live
```

### YouTube

Public YouTube videos and live streams can be analysed without downloading the
full video. Install the optional resolver, then pass the normal URL as the
source:

```bash
pip install -e '.[vision,youtube]'
petdetective analyze --source 'https://www.youtube.com/watch?v=DCoYgADsmts' --session youtube-test
```

The stream is resolved when processing begins, so it may fail for private,
age-restricted, region-restricted, or otherwise unavailable videos. A YouTube
live is processed as a live source; it cannot offer an accurate completion
percentage or seekable event playback.

To use the QVAC detector worker instead of Ultralytics, install its dependencies,
start it with the YOLOv10 ONNX model, then select the backend:

```bash
cd qvac-worker && npm install
npx bare detector.mjs 8795 ../models/yolov10m.onnx
petdetective analyze --source 0 --session living-room --detector qvac
```

`analyze` needs the optional `vision` dependencies. Ultralytics COCO detects
the `dog` class; label the two tracks once in `config/dogs.example.json` (copy
to `config/dogs.json`) or allow the first two tracks to be named automatically.
For reliable individual identity, the next production step is a small,
owner-specific ReID classifier trained with photos of both dogs.

## QVAC semantic enrichment

The adapter speaks the OpenAI-compatible endpoint exposed by a local QVAC
server. It is deliberately isolated from tracking so an unavailable model never
stops recording.

```bash
export QVAC_ENDPOINT=http://127.0.0.1:11434/v1/chat/completions
export QVAC_MODEL=my-vision-model
petdetective analyze --source /path/to/dogs.mp4 --qvac
```

At most one representative frame per configured interval is sent to the local
endpoint, with a request for strict JSON (`activity`, `description`,
`confidence`). Confirm the actual installed QVAC vision model and endpoint
before enabling it; QVAC's public SDK is currently JavaScript/TypeScript, so
this Python bridge uses its documented OpenAI-compatible local server instead
of claiming a nonexistent Python SDK.

## Architecture

```text
camera/video -> detector -> tracker -> behaviour state machine -> SQLite
                              |                 |                    |
                              |                 +--> metrics/report  +--> API/dashboard
                              +--> selected frames -> QVAC local vision -> semantic events
```

All timestamps are stored in UTC ISO-8601 form. Distances are in pixels until a
floor calibration is supplied; this prevents reporting invented metres.
