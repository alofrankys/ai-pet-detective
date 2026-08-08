# Narrative V2 integration checklist against current `main`

## 1. Add the pure engine

Copy:

- `qvac-worker/public/narrative-engine-v2.js`
- `qvac-worker/tests/narrative-engine-v2.test.mjs`
- `pet_detective/narrative_v2.py`
- `tests/test_narrative_v2.py`

Add to `qvac-worker/package.json`:

```json
"test:narrative": "node --test tests/narrative-engine-v2.test.mjs"
```

Do not remove existing scripts.

## 2. `qvac-worker/public/app.js`

Import:

```js
import {
  NarrativeEngineV2,
  SessionDebugRecorder,
  estimateCameraMotion,
  compensateMotion,
  summaryPayload
} from './narrative-engine-v2.js'
```

### Session data

Create one `SessionDebugRecorder` and `NarrativeEngineV2` per session. Reset them from `resetSession()`.

Persist raw observations at a rate that is useful for debugging without exploding memory (suggestion: 2–4 raw samples/s plus semantic-trigger samples). Raw debug does not have to be shown in the timeline.

### Replace the meaning of `sessionEvents`

Keep legacy timeline compatibility initially, but add a second collection for V2 semantic events. The session summary must use merged V2 events first and legacy events only as fallback.

`history.length` should no longer be labeled “events analysed” if it includes raw/legacy movement. Show separate counts, e.g.:

- 115 raw observations
- 14 behaviour events

### Generic movement

Current `motionNarrative()` / `temporalNarrative()` can continue to feed live telemetry but `movedLeft`, `movedRight`, `movedUp`, `movedDown`, `closer`, `farther`, `shifted` must not enter V2 story selection.

Implement camera-motion compensation before using bbox motion as subject evidence.

Reference motion can initially use stable environment detections retained separately from user-visible tracking. If not enough references exist, set camera-motion confidence low and avoid directional narrative rather than guessing.

### Posture

Use `NarrativeEngineV2.updatePosture()` with candidates derived from RTMPose + VisionPsy. Do not emit static posture every frame. Emit transition after stable confirmation.

Initial candidates: `standing`, `sitting`, `lying`, `unknown`.

If deterministic RTMPose geometry is ambiguous, leave `unknown` and allow a multi-frame VisionPsy posture candidate to participate.

### Surface / zone

Retain environment detections (couch, chair, bed, etc.) for relationship inference even if they are not normal tracked foreground subjects.

Derive support candidate from dog box/keypoints relative to surface boxes and VisionPsy context. Initial surfaces:

`floor`, `couch`, `bed`, `chair`, `grass`, `dirt`, `pavement`, `road`, `stairs`, `water`, `vehicle`, `unknown`.

Call `updateSurface()` only with supported candidates. Do not hard-code a couch-only state machine.

### Petting

The current hand-contact code requires both dog and person detections. Change it so:

- dog detection is required;
- a reliable hand track overlapping/near the dog for repeated moving contact is sufficient;
- person bbox increases confidence but is not mandatory;
- merge repeated contacts into a single interval.

### Tail wag

Pass normalized tail-root x samples and pose confidence to `NarrativeEngineV2.updateTail()`.

Only emit `tail_wagging` after oscillation is confirmed. Keep single tail displacement as raw pose evidence only.

### Object interactions

Keep COCO toy/food candidates as strong grounding but remove the current hard rule that forbids VisionPsy from naming an object when YOLO did not classify it.

Add generic temporally-confirmed object hypotheses. Suggested confidence gates:

- tracked YOLO object + VisionPsy agreement: >= .55
- VisionPsy-only generic object/toy stable in >=2 semantic sequences: >= .70
- specific uncommon object name from VisionPsy only: >= .78 and repeated confirmation

Track state transitions:

visible → approached → contact → mouth_contact → picking_up → holding → carrying/playing/chewing/tugging → dropping.

### Context

Replace the two-string `sessionContext` approach with confidence-bearing context hypotheses. Keep old facts in UI during migration.

Do not infer broad scene labels from one cue. Prefer `grass` to `park` unless broader context is stable.

### Semantic triggers

Retain current `sceneTempo().semanticGapMs` as baseline. Add an urgent semantic request queue for meaningful triggers. Respect `interpreting` so requests do not overlap; queue one pending high-priority trigger rather than dropping it.

### End-of-video pass

For uploaded and YouTube non-live videos, on `ended`:

1. call a new `/api/finalize-session` endpoint with merged event metadata, coverage gaps and representative evidence frames;
2. allow the backend to request/reconcile a bounded number of semantic windows;
3. regenerate merged events and summary;
4. store summary in the debug recorder.

Do not block live camera stop on an unbounded final pass.

### Export debug JSON

Add button `Export debug JSON` to the session modal. Call `debugRecorder.download()`.

## 3. `qvac-worker/studio.mjs`

### Structured event schema

Expand `allowedActions` with at least:

`crouching`, `sitting_down`, `standing_up`, `lying_down`, `rolling`, `rubbing`, `shaking`, `stretching`, `scratching`, `mouth_open`, `tongue_visible`, `head_tilt`, `jumping_on`, `jumping_off`, `entering`, `crossing`, `dropping`, `tugging`, `fetching`, `dog_dog_interaction`, `person_dog_interaction`, `scene_change`.

### Object grounding

Replace the current “No object is tracked: do not invent...” hard veto with conservative evidence language:

- detector objects are strong evidence;
- if no detector object exists, VisionPsy may report a generic or visually obvious object only when present across multiple sequence frames;
- never invent a specific object from one ambiguous frame.

### Prompt goal

Prompts should ask for **changes across time** and relationships, not the most descriptive last-frame sentence.

Do not force a single action when several linked actions form one meaningful short event.

### Summary input

`summarizeEvents()` must consume V2 merged events / `summaryPayload()` rather than filtering legacy text with a regex.

Preserve chronological order and temporal coverage. VisionPsy is a language realizer at this stage, not the authority deciding which raw movement records matter.

### New finalization endpoint

Add `/api/finalize-session` for seekable videos. It should:

- accept merged events and selected evidence sequences;
- perform bounded reconciliation;
- return `{events, summary, context}`;
- never hallucinate events absent from supplied visual evidence.

## 4. `index.html`

In session modal add:

```html
<button id="exportDebugButton" class="secondary">Export debug JSON</button>
```

Add i18n text in `app.js`.

Optional but useful UI facts:

- `N raw observations`
- `M behaviour events`
- context summary

## 5. Python backend

Do not break the current `PetEvent`/SQLite API immediately.

Introduce `BehaviourEventV2` alongside it, then migrate report-generation in a backward-compatible way. Existing tests must remain green.

Eventually add SQLite tables or JSON payload fields for event layer/source/confidence/importance/evidence.

## 6. Tests

Run:

```bash
pytest -q
cd qvac-worker && npm run test:narrative
```

Add integration tests for:

- no movement noise in final story;
- merged continuous petting;
- tail wag requires oscillation;
- posture flicker ignored;
- camera pan compensated;
- story covers beginning/middle/end;
- generic object can survive without COCO only with repeated Vision support;
- high-specificity actions require stricter confidence;
- two-dog identities remain distinct;
- final summary contains only merged semantic events.

## 7. Regression Video #001

Use the user’s uploaded couch video as a manual regression clip. Expected key-event coverage should include, approximately:

- two dogs initially resting on couch;
- petting of brown dog and side/back roll;
- dog activity / posture transitions;
- couch → floor transition;
- interaction with person on floor;
- floor → couch return;
- Cavalier receiving head petting;
- late toy presentation / mouth contact / play when visually supported.

Do not overfit timestamps or labels to this clip.
