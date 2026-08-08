# AI Pet Detective — V3 Deep Recorded Video Analysis

Work in repository `ai-pet-detective`.

## Branching and scope
- Start from branch `agent/narrative-engine-v2`.
- Create a new branch: `agent/deep-video-v3`.
- Do not modify `main`.
- Preserve the V2 debug export and Narrative Engine work unless explicitly replaced below.
- Do not spend time rewriting the final prose style first. Fix perception, tracking, temporal event extraction, and final reconciliation before summary wording.

## Product goal
The goal is not object detection. The goal is:

> Watch a recorded dog video and accurately tell the viewer what happened over time: who did what, where, with whom/what, and how the situation changed.

The solution must generalize to indoor rooms, gardens, parks, sidewalks/streets, trails, cars, stairs, water, and other normal dog environments. Regression Video #001 is a golden test, not a special-case implementation.

---

## Evidence from current V2 regression failure

The latest V2 debug session for `IMG_5760.MOV` showed these systemic failures:

1. The real video contains 2 dogs but the tracker created `Dog 3`.
2. The same couch is repeatedly classified as `bed` and `couch`, producing false high-salience couch↔bed story events.
3. Camera-motion estimation is zero/low-confidence for most of the session, while detections visibly shift because the phone moves.
4. VisionPsy sometimes observes useful behavior (e.g. tail wagging / petting) but those observations frequently do not become structured semantic events.
5. Recorded-video semantic analysis is too sparse; important intervals can pass while VisionPsy is busy.
6. The current final review is too small/fragile and can return malformed or low-confidence output.
7. The final summary is therefore dominated by upstream false events. Do not patch the wording to hide this.

---

# Architecture change: split LIVE from RECORDED

Keep Live Camera behavior lightweight.

For uploaded files and resolved YouTube videos, introduce a dedicated `Deep Recorded Analysis` pipeline.

Recorded video must no longer depend on wall-clock playback speed.

## Recorded pipeline

### PASS A — Full local perception pass
Process the complete video by seeking/sampling it independently of normal playback.

Target sampling rates:
- detector/tracker: 5–8 fps effective
- animal pose: 2–4 fps effective
- hand analysis: event-triggered / when person-hand-dog proximity is plausible
- camera motion: every sampled frame pair
- semantic VLM: not during this pass except if strictly necessary

Create a time-indexed observation store containing at least:
- video timestamp
- detections
- stable subject IDs
- temporary track IDs
- bounding boxes
- confidence
- pose keypoints/cues
- hands
- scene/surface hypotheses
- camera transform
- camera-compensated subject motion
- object candidates
- person/dog/dog relations

The pass must finish even if normal video playback is paused.

### PASS B — Candidate interval generation
Generate candidate windows from:
- subject motion after camera compensation
- posture transitions
- stable surface/location relation changes
- hand↔dog contact
- dog↔dog proximity/relative motion
- new object appearance near dog/person
- mouth/object proximity
- acceleration / jump-like trajectory
- identity loss/reappearance
- scene/environment changes

Merge overlapping candidates before VLM review.

Always add temporal coverage windows so quiet but narratively relevant periods can still be understood.

### PASS C — Temporal VisionPsy analysis
For each candidate interval, build a chronological contact sheet / frame sequence with enough frames to show BEFORE → ACTION → AFTER.

Prefer 4–8 frames per interval depending on duration.

VisionPsy must return STRICT STRUCTURED JSON, never just a sentence.

Required shape:

```json
{
  "events": [
    {
      "actor_ref": "subject_1",
      "action": "petting|lying_down|standing_up|jumping_off|jumping_on|approaching_person|rear_up|tail_wagging|sniffing|object_presented|mouth_contact|picking_up|holding|playing|dropping|dog_dog_interaction|other",
      "target_ref": "subject_2|person_1|object_1|null",
      "start": 12.4,
      "end": 18.7,
      "surface_before": "couch|null",
      "surface_after": "floor|null",
      "object_label": "rope-like toy|toy|object|null",
      "confidence": 0.0,
      "evidence": ["short observable reason"]
    }
  ],
  "context": {
    "environment": "indoor|outdoor|vehicle|unknown",
    "scene": "home|garden|park|sidewalk|street|trail|beach|water|public_indoor|unknown"
  }
}
```

Rules:
- Validate JSON.
- On invalid JSON, do one repair/retry request with the malformed output and schema.
- If repair still fails, parse only conservative recognizable actions from the text as a fallback.
- Never silently discard a high-confidence useful VisionPsy observation.
- Do not invent emotional states.
- Generic `toy` / `object` is allowed when visually persistent even if COCO has no exact label.
- Surface names must not be accepted solely because a detector label changed.

### PASS D — Global reconciliation
After all candidate windows:
- reconcile persistent subject identities
- reconcile surfaces/scene entities
- merge duplicate events
- resolve contradictions
- rank salience
- guarantee beginning/middle/end temporal coverage
- produce the final narrative from reconciled semantic events only

No raw dx/dy/scale movement may enter the story directly.

---

# 1. Persistent dog identity: fix Dog 3

Separate:
- `track_id`: temporary detector/tracker fragment
- `subject_id`: persistent narrative identity

Narrative names (`Dog 1`, `Dog 2`) must use `subject_id`, not raw track creation order.

Do NOT create a new persistent dog identity immediately when a new track appears.

New dog identity creation requires:
- repeated evidence for >= ~2 seconds or equivalent sampled frames, AND
- failure to match any recently lost dog.

Improve ReID beyond the current tiny RGB grid.

Use a combination such as:
- HSV/color histogram
- normalized shape/aspect/size features
- temporal/spatial continuity after camera compensation
- optional local image embedding if a suitable local model/runtime is already available without cloud dependency

Keep a retired-subject memory across long occlusions.

For a 2-dog video, temporary fragments are fine, but the story must remain two persistent dogs.

Add debug fields:
- track_id
- subject_id
- reid_score
- reid_components
- identity_decision: matched|revived|new|uncertain

---

# 2. Real camera-motion estimation

Replace furniture-label-based camera estimation as the primary estimator.

Implement pixel/background-based global motion.

A dependency-free implementation is acceptable and preferred if robust enough:
1. downscale frame to grayscale
2. mask dynamic regions from dog/person/object bboxes, expanded by margin
3. collect stable background features/patches over the remaining image
4. match them to previous frame
5. reject outliers with robust median/RANSAC-like consensus
6. estimate at minimum global translation dx/dy
7. estimate scale/affine transform when evidence supports it
8. emit confidence based on inlier count, residual error, and spatial coverage

If a local lightweight library is clearly superior, it may be added, but document why and keep everything local.

Store:
```json
{
  "camera_motion": {
    "dx": 0,
    "dy": 0,
    "scale": 0,
    "rotation": 0,
    "confidence": 0,
    "inliers": 0,
    "residual": 0
  }
}
```

Subject world-motion = observed image motion - global camera transform.

Important rule:
If camera confidence is low, DO NOT narrate left/right/up/down/closer/farther as meaningful behavior.

Tests must include:
- static dog + moving camera => near-zero subject motion
- moving dog + static camera => subject motion retained
- camera and dog moving in same direction => residual motion correct
- camera pan with multiple static background features

---

# 3. Persistent scene/surface map

Do not assign a dog's surface from a single YOLO frame label.

Create scene entities:
```json
{
  "surface_id": "surface_1",
  "type_probs": {
    "couch": 0.74,
    "bed": 0.16,
    "chair": 0.10
  },
  "geometry_history": [],
  "stable_type": "couch"
}
```

Requirements:
- associate furniture detections by geometry across frames
- fuse label probabilities over time
- use hysteresis before changing stable type
- a couch→bed label flip on the same geometry is NOT a dog transition
- a dog transition requires a RELATION change:
  `on(surface_1)` → `floor`
  or `floor` → `on(surface_1)`
- prefer generic `furniture/surface` over a wrong precise label
- surface transition confidence must combine stable surface identity + dog relation change + temporal persistence

Add tests:
- alternating couch/bed labels for same box => zero transition events
- dog truly leaves persistent couch entity => one `jumping_off`/`leave_surface`
- dog returns => one `jumping_on`/`enter_surface`

---

# 4. Dog posture V3

Current deterministic posture is insufficient.

Add a temporal posture classifier using AP-10K keypoints and ratios/orientation, with states:
- standing
- sitting
- lying
- crouching
- unknown

Use multi-frame smoothing/hysteresis.

Do not emit a posture transition when confidence is weak.

`sitting` must be explicitly implemented instead of depending mostly on VLM text.

Record:
- posture candidate
- posture confidence
- stable posture
- transition confidence

---

# 5. Petting / human interaction

Keep MediaPipe hand logic but make it identity-safe.

Petting may be recognized with:
- hand detected
- repeated overlap/proximity with dog body
- hand travel/contact pattern over time

Whole-person YOLO detection is a confidence bonus, not a requirement.

Map contact to persistent `subject_id`.

Add separate semantic candidates for:
- petting
- offering object
- taking object
- tug interaction
- general person-dog contact

Do not interpret every hand proximity as petting.

---

# 6. Object interaction without COCO dependency

The rope/tug toy in Regression #001 is not reliably represented by COCO.

Recorded pipeline must support generic persistent visual object hypotheses.

State machine:
- object_visible
- person_presents_object
- dog_approaches
- mouth_contact
- picks_up
- holding
- carrying
- playing/manipulating
- tugging
- drops/releases

Generic `toy` or `object` is acceptable.

Require temporal persistence / multi-frame evidence.

Do not require exact detector class for VisionPsy to report a clearly persistent object.

---

# 7. VisionPsy structured event conversion

This is mandatory.

Instrument metrics:
- vision_calls
- valid_structured_responses
- repaired_responses
- fallback_parsed_responses
- discarded_responses
- structured_events_created

Add acceptance metric:
`structured_events_created / useful_vision_responses >= 0.70` on regression tests where useful observations exist.

If VisionPsy says something equivalent to:
- tail wagging
- petting
- object grab
- lying down
and confidence is acceptable, the information must either:
1. become a semantic event, or
2. be explicitly rejected with a logged reason.

Never disappear silently.

---

# 8. Final review V3

Replace the current tiny final review.

The final review should inspect:
- every high-salience candidate interval
- every unresolved contradiction
- every identity discontinuity
- temporal coverage windows

Do NOT cap review to four sequences when more meaningful windows exist.

Batch carefully if needed, but process the whole candidate queue.

Validate final-review JSON and retry malformed output once.

Final review can:
- confirm
- lower confidence
- reject
- add a clearly visible missing event

Every decision must be logged.

---

# 9. Narrative rules

Only after reconciliation, generate summary.

Priority:
1. human-dog / dog-dog / object interactions
2. entry/exit / surface/location changes
3. posture transitions
4. locomotion
5. stable resting/background state
6. camera-relative motion = never a primary story event

Use chronology and natural grouping.

Example desired style for Regression #001 (do not hardcode):
"The two dogs initially rest together on the couch. One receives petting and rolls partly onto its side/back. The brown dog later jumps down, approaches a person, and then returns to the couch. Later the other dog is petted. Near the end, a person presents a rope-like toy, which the brown dog grabs and plays with."

---

# 10. Golden Regression Video #001

Create a test fixture/spec at:
`tests/fixtures/regression-video-001.expected.json`

Use this ground truth with tolerance rather than exact timestamps.

Video:
`IMG_5760.MOV`
duration ≈ 101.5 s

Real subjects:
- 2 dogs
- at least 1 person
- NEVER a persistent Dog 3

Expected narrative beats:

1. 00:00–00:12
   Both dogs resting/lying together on couch.
   Useful context but not mandatory for pass.

2. 00:12–00:20
   REQUIRED
   Person pets brown dog.
   Brown dog rolls/turns partly onto side/back.

3. 00:37–00:41
   REQUIRED
   Brown dog leaves/jumps down from couch to floor.

4. 00:40–00:45
   REQUIRED
   Brown dog approaches/interacts with person on floor; briefly rises toward person.

5. 00:48–00:53
   REQUIRED
   Brown dog returns/gets back onto couch.

6. 00:64–00:71
   REQUIRED
   Cavalier receives petting on head/neck.

7. 00:87–00:94
   REQUIRED
   Person presents rope-like toy and brown dog grabs it with mouth.

8. 00:92–00:98
   REQUIRED
   Brown dog holds/manipulates/plays with toy.

Soft/optional:
- tail wagging where temporally supported
- posture changes
- open-mouth/tongue-visible observable facial cue

Forbidden:
- bed transitions in this video
- third persistent dog identity
- a summary dominated by left/right/closer/farther
- treating couch↔bed detector label flips as dog movement

---

# 11. Acceptance criteria

Do not call the V3 complete unless the implementation/tests can demonstrate:

Regression #001:
- persistent dog identities <= 2
- `Dog 3` count in semantic/narrative output = 0
- false bed transitions = 0
- at least 6 of the 7 REQUIRED beat groups are recalled within reasonable temporal tolerance
- final summary includes >= 75% of high-salience detected key beats
- no camera-relative motion used as a primary story event
- debug export clearly distinguishes observed image motion vs camera-compensated subject motion

Camera-motion unit/integration tests:
- static subject / moving camera passes
- moving subject / static camera passes
- combined movement passes

Surface tests:
- alternating couch/bed labels over same geometry creates no surface transition

Identity tests:
- lost/reappearing dog reuses persistent subject identity

Vision tests:
- malformed structured output is repaired/retried
- useful high-confidence observation cannot disappear without an explicit logged rejection reason

---

# 12. Debug export V3

Keep existing debug export and add:

```json
{
  "analysis_mode": "recorded_deep_v3",
  "pass_a": {
    "frames_processed": 0,
    "effective_detector_fps": 0,
    "pose_frames": 0
  },
  "camera_motion_metrics": {},
  "identity_metrics": {},
  "surface_entities": [],
  "candidate_intervals": [],
  "vision_metrics": {},
  "semantic_events_before_reconciliation": [],
  "identity_reconciliation": [],
  "surface_reconciliation": [],
  "semantic_events_final": [],
  "summary_input": [],
  "final_summary": ""
}
```

Make it possible to diagnose every dropped event.

---

# 13. Tests and run

Before finishing:
1. run existing Python tests
2. run existing Narrative V2 Node tests
3. add and run V3 tests
4. start Studio
5. fix syntax/runtime errors
6. verify uploaded-video deep mode works end-to-end
7. do not remove Live mode
8. do not use cloud APIs

At completion report:
- files changed
- architecture changes
- test results
- regression #001 measured metrics
- anything still requiring real-video tuning

If the actual video file is available locally, run it and export the new V3 debug JSON. If it is not available, implement the fixture/tests and explicitly tell me to rerun Regression #001 manually.

Proceed directly with implementation; do not stop at planning/scaffolding.
