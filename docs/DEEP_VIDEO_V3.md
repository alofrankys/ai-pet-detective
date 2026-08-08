# Deep Recorded Video V3

Deep Video V3 is the recorded-video path used by the VisionPsy Studio. Live
Camera continues to use the lower-latency V2 loop.

## Passes

1. **Full local perception** seeks the complete recording at 5–8 effective
   detector fps and 2–4 pose fps. Each observation stores detector boxes,
   temporary tracks, persistent subjects, pose, hands, object candidates,
   relations, pixel-derived camera motion and compensated subject motion.
2. **Candidate generation** turns posture/surface/contact/object/identity and
   compensated-motion changes into merged intervals. Coverage windows are
   added over the complete duration.
3. **Temporal VisionPsy review** sends 4–8 ordered frames for every candidate.
   Responses must match the V3 JSON schema. Malformed JSON is repaired once;
   conservative recognizable actions are retained as a logged fallback.
4. **Global reconciliation** validates persistent subjects, rejects surface
   contradictions, merges intervals, removes camera-relative telemetry and
   selects beginning/middle/end story events before prose generation.

Everything remains local. No cloud API is used.

## Persistent identity

`track_id` represents a short detector fragment. `subject_id` represents a
narrative dog identity. New subjects require repeated evidence; appearance is
described with HSV histograms and shape features, then combined with camera-
compensated spatial continuity and long-occlusion memory.

## Camera and surface evidence

Camera translation is estimated from downscaled grayscale background pixels
after masking dynamic boxes. Confidence uses inliers, residual and spatial
coverage. When confidence is weak, compensated directional motion is marked
invalid and cannot become a story event.

Furniture detections are associated into persistent `surface_id` entities.
Label probabilities are fused with hysteresis, so an alternating couch/bed
label on the same geometry does not create a dog transition. Events require a
persisting relation change between a subject and a surface entity.

## Debug and benchmark

The Session Summary export produces a V3 JSON containing every pipeline layer,
VisionPsy conversion metrics and explicit dropped-event decisions.

Regression Video #001 is described by
`tests/fixtures/regression-video-001.expected.json`. Run the measured benchmark
against the debug export generated from `IMG_5760.MOV`:

```bash
cd qvac-worker
npm run benchmark:regression -- /absolute/path/to/v3-debug.json
```

The benchmark reports required-beat recall, persistent identity count, Dog 3
events, false bed transitions, camera-motion story noise and the structured
VisionPsy conversion ratio.
