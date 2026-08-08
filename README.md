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

## VisionPsy Live Studio

The polished recording interface lives in `qvac-worker/`. It keeps the same
analysis and timeline for three interchangeable sources: the Mac camera, a
video selected with the native file picker, or a public YouTube recording
resolved from its URL. YouTube media is proxied through the local server so the
frames remain available to the detector instead of being trapped in a
cross-origin embed.

```bash
pip install -e '.[youtube]'
cd qvac-worker
npm install
npm run setup:models
npm run studio
```

Open `http://127.0.0.1:8790`. The studio combines YOLOv10m on `@qvac/onnx`, an
appearance-assisted tracker, RTMPose AP-10K dog keypoints, local MediaPipe face
and hand cues, and the existing local VisionPsy endpoint. VisionPsy receives a
short chronological evidence sheet and grounded detector facts. The UI retains
the full session history and creates a final narrative popup when a recording
ends.

The narrative vocabulary covers visible posture and locomotion, object
manipulation, person-person, person-animal, animal-animal and subject-object
interactions, plus conservative hand and facial gestures. Specific claims such
as biting, eating, drinking, sleeping, urinating and defecating require stronger
multi-frame evidence. The application does not turn body language into a
certain emotion or infer aggression from mouth contact.

On macOS, QVAC requests Core ML for the detector and animal pose models. The
studio continues with deterministic detection and tracking if the semantic
endpoint is temporarily unavailable. Model files and local runtime data are
excluded from Git.

## Real video or camera

```bash
petdetective analyze --source /path/to/dogs.mp4 --session morning-01
# or
petdetective analyze --source 0 --session living-room-live
```

Copy `config/dogs.example.json` to `config/dogs.json` to configure stable dog
names, a normalized sofa zone and an optional measured pixel-to-metre
calibration:

```bash
petdetective --config config/dogs.json analyze --source /path/to/dogs.mp4 --session morning-01
```

`pixels_per_metre` stays unset until it is measured for the specific camera.
Reports always include `distance_px`; calibrated sessions also include
`distance_m` and `calibrated: true`.

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
