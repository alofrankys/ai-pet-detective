# VisionPsy Moment Lens

A small local demo built around VisionPsy-Nano's intended single-image use.

Point the camera at a scene or open a video, choose one clear moment and press
**Analyse this moment**. The Studio freezes exactly that frame and makes one
local VisionPsy request with one JPEG image and one short English prompt.

## What it does

- camera or local video as the main visual area;
- one manually selected frame per request;
- three focused prompts: **Describe**, **Objects** and **Spatial**;
- one short factual answer, model name and measured inference time;
- honest `Unclear frame — try another moment` results;
- rejection of JSON, templates, prompt echoes, long responses, emotion,
  intention and temporal inference;
- local processing with no cloud upload.

Moment Lens deliberately does not perform video understanding, tracking,
action recognition, timeline construction or narrative generation. It never
sends multiple images, contact sheets, neighbouring frames, detector data,
timestamps or schemas to VisionPsy.

## Run

Requires Node.js 20 or newer and a local VisionPsy OpenAI-compatible endpoint.
By default the Studio uses `http://127.0.0.1:8788/v1/chat/completions`. If the
sibling `visionpsy-twinpaws` runtime is available, the Studio can start it
automatically.

```bash
cd qvac-worker
npm install
npm run studio
```

Open [http://127.0.0.1:8803/](http://127.0.0.1:8803/).

To use another local endpoint:

```bash
VISIONPSY_ENDPOINT=http://127.0.0.1:8788/v1/chat/completions npm run studio
```

## Test

```bash
cd qvac-worker
npm test
```

The tests enforce the one-image/one-call contract, the exact prompts, raw
answer preservation, `UNCLEAR` handling, output sanitation and inference-time
measurement.

## Accurate public claim

> VisionPsy-Nano analyses one camera frame locally: one image, one focused
> answer, no cloud upload.

Do not describe this demo as video understanding or temporal reasoning.
