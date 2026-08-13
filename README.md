# VisionPsy Moment Lens

A small local demo built around VisionPsy-Nano's intended single-image use.

Point the camera at a scene, open a video, or choose one or more local photos.
Select one clear image and press **Compare this moment**. The Studio freezes or
converts exactly that selected image, then sends the
same JPEG and the same short English prompt once to each of two local models:
VisionPsy-Nano-460M-Flash and VisionPsy-Nano-460M Full.

## What it does

- camera, local video or local photo as the main visual area;
- a navigable local queue when multiple photos are selected;
- one manually selected frame per request;
- three focused prompts: **Describe**, **Objects** and **Spatial**;
- two short factual answers with model names and separately measured inference
  times;
- honest `Unclear frame — try another moment` results;
- rejection of JSON, templates, prompt echoes, long responses, emotion,
  intention and temporal inference;
- local processing with no cloud upload.

The comparison changes the VisionPsy variant, not the main-weight
quantization: both main models use the official `Q4_K_M-imat` weights. Moment
Only the currently selected photo is analysed; selecting multiple photos never
starts an automatic batch or sends neighbouring images. Moment Lens deliberately
does not perform video understanding, tracking,
action recognition, timeline construction or narrative generation. It never
sends multiple images, contact sheets, neighbouring frames, detector data,
timestamps or schemas to VisionPsy.

## Official model assets

The setup uses these exact files from Tether's official Hugging Face
repositories:

| Variant | Artifact | Size (bytes) | SHA-256 |
| --- | --- | ---: | --- |
| Flash | [`visionpsy-nano-460m-flash-q4_k_m-imat.gguf`](https://huggingface.co/qvac/VisionPsy-Nano-460M-Flash-GGUFs/resolve/main/visionpsy-nano-460m-flash-q4_k_m-imat.gguf) | 303,143,488 | `90b0abe16180f1fe5918bc5d89c3b6eeaf40520a50f906d6303a59a32b699fbc` |
| Flash | [`mmproj-visionpsy-nano-460m-flash-q8.gguf`](https://huggingface.co/qvac/VisionPsy-Nano-460M-Flash-GGUFs/resolve/main/mmproj-visionpsy-nano-460m-flash-q8.gguf) | 108,782,144 | `bbb0691873a4e638f6928898b3c3be9a4730bd4ced301197726a4fcb549695d0` |
| Full | [`visionpsy-nano-460m-q4_k_m-imat.gguf`](https://huggingface.co/qvac/VisionPsy-Nano-460M-GGUFs/resolve/main/visionpsy-nano-460m-q4_k_m-imat.gguf) | 303,143,488 | `41794b9f501e30f44f19c8be4b87b965db77fbd3e4c7625291999cff7966db8a` |
| Full | [`mmproj-visionpsy-nano-460m-q8.gguf`](https://huggingface.co/qvac/VisionPsy-Nano-460M-GGUFs/resolve/main/mmproj-visionpsy-nano-460m-q8.gguf) | 108,782,144 | `92f1bb80acaba3e7b59b6534f47447b830330bc9051018d6d8b5d768e58503c2` |

The two `mmproj-...-q8.gguf` files are Tether's official, variant-specific
multimodal projectors. Their names do **not** mean that an alternative Q8 main
model is being compared: the two main model-weight files above are both Q4.

Download all four files atomically into the ignored local `models/` directory
and verify their byte sizes and SHA-256 hashes:

```bash
cd qvac-worker
npm run models:download
```

To check an existing local installation without downloading anything:

```bash
npm run models:verify
```

## Run

Requires Node.js 20 or newer and the patched `llama-server` runtime supplied by
the sibling `visionpsy-twinpaws` project. The Studio starts the verified Flash
Q4 model on port 8788 and Full Q4 model on port 8789; it will not silently
accept another quantization or model on either port.

```bash
cd qvac-worker
npm install
npm run studio
```

Open [http://127.0.0.1:8803/](http://127.0.0.1:8803/).

## Test

```bash
cd qvac-worker
npm test
```

The tests enforce the one-image/one-call-per-model contract, identical input
and sampling for both variants, sequential execution, the exact prompts, raw
answer preservation, `UNCLEAR` handling, output sanitation and inference-time
measurement.

## Accurate public claim

> Two VisionPsy-Nano variants analyse the same selected image locally with the
> same prompt and Q4 model-weight quantization—no cloud upload.

Do not describe this demo as video understanding or temporal reasoning.
