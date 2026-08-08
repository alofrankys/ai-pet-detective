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

## Mac live studio

The recordable webcam experience lives in `qvac-worker/`. It uses the QVAC ONNX
runtime with Core ML for COCO objects, then applies a two-threshold,
appearance-assisted tracker to keep labels stable without covering the scene.
An optional RTMPose AP-10K pass adds observable dog posture keypoints, while a
local MediaPipe pass contributes facial gestures without treating them as
certain emotions.

```bash
cd qvac-worker
npm install
npm run setup:models
npm run studio
```

Open `http://127.0.0.1:8790`, allow camera access, and use the four compact
filters. The studio stays useful with detection alone. If a compatible local
VisionPsy server is already running, enable periodic visual observations with:

```bash
VISIONPSY_ENDPOINT=http://127.0.0.1:8788/v1/chat/completions npm run studio
```

VisionPsy receives a chronological contact sheet of up to four recent frames,
grounded by QVAC detections, measured motion, dog keypoints and local facial
cues. Its cadence adapts from roughly 3.2 seconds in an active scene to 6.2
seconds in a calm one, so text remains readable while quick interactions still
produce useful events. The confidence shown for an observation combines the
available visual evidence; it is not a measurement of a person’s or animal’s
internal emotional state.

Dog-focused prompts include common interactions and locations without forcing
them: sitting, lying, sleeping, walking, running, sniffing, rubbing, rolling,
shaking, stretching, climbing, descending, couch/bed/floor/grass/garden, plus
ball, rope/tug toy, ring, frisbee, plush, bone, stick, Kong/puzzle, chew or
squeaky toy, bowl, food, snack and treat. YOLO grounds only the classes it
actually supports; the remaining items are semantic vocabulary and are named
only when VisionPsy sees them clearly.

The studio starts in English and includes an Italian language switch. Its
minimal labels can be hidden for a clean recording. Animal tracks receive
session-scoped names such as `Dog 1` and `Dog 2`, plus observed movement and
apparent image size. These names survive brief occlusions but are not biometric
identity: reliable recognition across sessions still requires owner-specific
ReID enrollment. Recorded MP4 files can be opened directly, providing a safe
ingestion path for exported fixed-camera clips without pretending that a
vendor-specific live stream is available.

### Fixed-camera sources

The source boundary is intentionally separate from detection and tracking:

```text
webcam | recorded video | future RTSP/ONVIF adapter
                         -> QVAC detector -> session tracks -> temporal events
```

For long unattended sessions, an RTSP/ONVIF camera is the clean live-source
target. Blink footage can currently enter through exported or locally stored
MP4 clips. A direct Blink live adapter is not advertised because it has not
been verified against a supported public streaming interface.

### Live architecture and verified QVAC boundary

```text
camera / recorded video
  -> YOLOv10m on @qvac/onnx (Core ML requested)
  -> two-threshold tracker + appearance memory
  -> RTMPose AP-10K on @qvac/onnx for detected dogs
  -> local face gestures (MediaPipe WASM) for detected people
  -> 1-4 selected frames + measured facts
  -> compatible local VisionPsy server
  -> readable scene history + compact temporal events
```

On this Mac, `@qvac/onnx` 0.15.1 successfully loads YOLOv10m through Core ML.
Direct VisionPsy Flash loading through `@qvac/sdk` 0.16.0 was also tested, but
the standard SDK worker rejects the model’s custom multimodal projector with
`MODEL_LOAD_FAILED` / `MtmdLlm`. Until the patched projector support is built
into the QVAC native addon, the compatible local VisionPsy Metal server remains
an explicit fallback rather than being described as QVAC SDK inference.

The current Mac choice is VisionPsy Nano 460M Flash Q5_K_M with a Q8 vision
projector: it is small enough for a live demo while retaining more visual
fidelity than Q4. Q4_K_M is the planned iPhone quantization after the mobile
runtime is verified.

### Short recording scenarios

1. Hold a phone, mouse, ball and plush in turn: object boxes retain their own
   colours while the scene sentence follows the held object.
2. Change expression while moving: the event combines measured movement with a
   visible smile, open mouth, raised brows or another conservative facial cue.
3. Let one or two dogs enter, leave and return: Dog 1 / Dog 2 keep session
   identity, while posture and nearby toys or food become the narrative focus.
4. Open an iPhone-recorded clip: the same detector, tracker and event UI analyse
   the recording locally, demonstrating that capture and processing are cleanly
   separated.

## Real video or camera

```bash
petdetective analyze --source /path/to/dogs.mp4 --session morning-01
# or
petdetective analyze --source 0 --session living-room-live
```

Use the local camera configuration to give the two initially assigned tracks
meaningful IDs, enable the normalized sofa zone, and (only when measured)
convert distance to metres:

```bash
cp config/dogs.example.json config/dogs.json
petdetective --config config/dogs.json analyze --source /path/to/dogs.mp4 --session morning-01
```

`pixels_per_metre` stays `null` until you measure it for that camera. Reports
then contain only `distance_px`; with a valid calibration they also include
`distance_m` and `calibrated: true`.

To use the QVAC detector worker instead of Ultralytics, install its dependencies,
start it with the YOLOv10 ONNX model, then select the backend:

```bash
cd qvac-worker && npm install
npx bare detector.mjs 8795 ../models/yolov10m.onnx
petdetective analyze --source 0 --session living-room --detector qvac
```

`analyze` needs the optional `vision` dependencies. Ultralytics COCO detects
the `dog` class; configure the two track IDs in `config/dogs.example.json`
(copy to `config/dogs.json`) or allow the first two tracks to use the default
IDs. The assignment is motion-based, not individual visual recognition.
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
`confidence`). An unavailable, malformed, or non-responsive endpoint simply
skips that semantic observation; local detection, tracking and event recording
continue. Confirm the actual installed QVAC vision model and endpoint
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
