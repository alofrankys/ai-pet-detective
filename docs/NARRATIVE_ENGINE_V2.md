# AI Pet Detective — Narrative Engine V2

## Product goal

The project is not a motion logger. Its primary goal is to **tell, accurately and naturally, what happens in a dog video over time**.

The same architecture must work across:

- home / living room / bedroom
- garden / yard
- park / field
- street / sidewalk / crossing
- trail / forest
- beach / water
- car / vehicle
- stairs / entrances / gates
- indoor public spaces
- single-dog and multi-dog scenes
- handheld and fixed cameras

The uploaded couch video is Regression Video #001, not the design target.

## Core architecture

```text
FRAME
  ↓
RAW OBSERVATIONS
  detector boxes, tracker, pose keypoints, hands, face cues,
  object/context candidates, global camera motion
  ↓
STABLE STATE
  posture, support surface, scene/context, proximity, object ownership/contact
  ↓
SEMANTIC EVENTS
  picks_up, petting, jumping_off, tail_wagging, sniffing, playing...
  ↓
EVENT MERGER
  START → CONTINUE → END, duplicate suppression
  ↓
NARRATIVE PLANNER
  confidence × importance × novelty × temporal coverage
  ↓
SESSION STORY
  grounded, chronological, descriptive summary
```

Raw movement (`dx`, `dy`, scale change, closer/farther from camera) is telemetry, not story content.

## Event schema

Every semantic event should expose, when available:

- `id`
- `start`, `end` in video seconds
- `actor`
- `action`
- `target`
- `from`, `to`
- `objects`
- `modifiers`
- `evidence`
- `confidence`
- `importance`
- `description`
- `source`
- `rawIds`

Use generic transitions rather than hard-coded couch logic. Example:

```json
{
  "actor": "Dog 2",
  "action": "jumping_off",
  "from": {"surface": "couch"},
  "to": {"surface": "floor"}
}
```

The same representation supports bed→floor, bench→ground, car→sidewalk, stairs→floor, etc.

## Narrative vocabulary

### Posture and locomotion

standing, sitting, lying, resting, sleeping, crouching, walking, running, jumping, following, approaching, leaving, turning, rolling, rubbing, shaking, stretching, scratching.

State changes are more important than static repeats: `sitting_down`, `standing_up`, `lying_down`.

### Exploration

sniffing ground, object, vegetation, dog, or person; looking around; investigating an object or location.

### Object interactions

object_visible → approaches → contact → mouth_contact → picking_up → holding → carrying / playing / chewing / tugging → dropping.

Do not make COCO detection a hard prerequisite for an object claim. A generic `object`, `toy`, `rope-like toy`, `stick`, or `leash` can be proposed by VisionPsy when it is visually stable across multiple frames and confidence is sufficient.

### Human ↔ dog

petting, touching, feeding, offering, reaching, taking/giving objects, tug/play, holding, guiding.

A YOLO `person` box is a confidence bonus, not a mandatory prerequisite when a MediaPipe hand is clearly interacting with a dog.

### Dog ↔ dog

approach, close contact, sniffing, following, chasing, play, resting together. Mere proximity is not automatically play.

### Body cues

mouth_open, tongue_visible, head_tilt, head_lowered, tail_wagging, roll_on_side, roll_on_back, belly_exposed.

Do not convert these into certain emotions. `body language consistent with relaxation/playfulness/caution` may be used only as a lower-confidence interpretation.

### High-specificity actions

sleeping, biting, eating, drinking, urinating, defecating, aggression-like claims require strong multi-frame evidence. Mouth contact is not aggression.

## Context model

Maintain context as hypotheses with confidence and temporal support, not one string.

Suggested hierarchy:

```text
environment: indoor | outdoor | vehicle | unknown
scene: home | garden | park | sidewalk | street | trail | beach | water | public_indoor | unknown
surface: floor | couch | bed | chair | carpet | grass | dirt | pavement | road | stairs | water | unknown
structures: door | gate | fence | tree | bush | car | bench | couch | stairs | water_edge ...
```

Never infer a park from grass alone. Prefer concrete descriptions when scene confidence is weak: “walks on grass” rather than “walks through a park.”

## Temporal engines

### Posture stabilizer

A posture candidate must remain stable for ~500–800 ms before generating a state transition. One-frame flicker must not create events.

### Surface/location stabilizer

Track stable support or zone. Generate transition events only after confirmation. Use generic surfaces and zones.

### Tail wag detector

Do not map one displaced tail keypoint to `tail_wagging`. Use a 1–2 s temporal window and require repeated lateral reversals plus sufficient amplitude.

### Continuous interaction detector

Petting, playing, sniffing, walking, chewing, tail wagging, resting etc. have START / CONTINUE / END semantics and should merge into intervals.

## Camera motion compensation

Handheld videos are a primary use case.

Estimate global scene movement from stable environmental/reference tracks (or optical flow if added later), then subtract it from subject motion.

```text
subject_motion = observed_bbox_motion - global_camera_motion
```

Do not narrate `moved left/right/closer/farther` unless it is semantically needed and camera compensation supports it. These actions have narrative importance 0.

## VisionPsy sampling

Keep the current low-frequency semantic sampling as a baseline, but add event-triggered bursts.

Trigger a burst when one or more of these occur:

- sudden posture change
- support surface / zone change
- new object near dog
- hand approaches / contacts dog
- dog–dog proximity changes sharply
- dog disappears/reappears across a boundary
- acceleration / jump candidate
- tail oscillation candidate
- scene/context change

Use temporal evidence around the trigger when possible:

`t-0.6s, t, t+0.6s, t+1.2s`

VisionPsy should answer **what changed across the sequence**, not just describe the last frame.

## Final semantic pass

The live pass is not the final authority.

At end of uploaded/seekable video:

1. identify high-interest windows and gaps in coverage;
2. re-sample a limited set of representative mini-sequences;
3. ask VisionPsy to reconcile ambiguous events;
4. merge/re-score events;
5. generate the final story from grounded merged events.

This pass is especially important for short events missed between normal live semantic intervals.

## Narrative salience

Default order of importance:

1. high-impact needs / eating / drinking when reliable
2. human-dog interactions
3. dog-dog interactions
4. object interactions
5. entering/leaving/crossing/support transitions
6. play/chase/run
7. posture transitions
8. sniff/explore/body cues
9. walking/static posture
10. raw camera-relative motion (never story-worthy by itself)

Story selection must preserve temporal coverage. Do not simply take the six highest-scoring events from one portion of the video. Ensure beginning, middle and ending are represented when meaningful events exist there.

## Three outputs

### Scene now

Short current observation.

### Event timeline

Timestamped merged semantic intervals.

### Session story

Natural chronological narrative of the session. This is the product’s primary value.

## Debug and evaluation

Every session should be exportable as JSON with:

- source metadata
- detector/tracker observations
- pose/keypoints/cues
- hands/face cues
- camera motion
- context candidates
- raw VisionPsy responses
- semantic events
- merged events
- final narrative event selection
- final summary

The UI should expose `Export debug JSON`.

## Regression scenarios

Minimum suite:

1. Living room: rest → petting → couch/floor transition → toy play.
2. Fixed camera posture changes.
3. Heavy handheld pan: no false left/right story.
4. Garden: walk → sniff → run → roll.
5. Fetch: throw → chase → pick up → carry/return.
6. Tug toy / rope-like non-COCO object.
7. Two-dog interaction and crossing identities.
8. Street/sidewalk: walk → stop → resume → crossing if clear.
9. Leash scene.
10. Gate/door entry and scene change.
11. Car enter/exit.
12. Stairs up/down.
13. Water enter/move/exit/shake.
14. Bowl/drinking.
15. Food/eating with conservative evidence.
16. Urination/defecation with very strong evidence.
17. Occlusion and re-identification.
18. Low light: prefer unknown over hallucination.

## Initial quality targets

- high-salience precision > 85%
- high-salience recall > 75%
- key-event timing error < ±1.5 s
- false camera-motion narratives near zero
- continuous-event duplicate rate < 10%
- summary hallucination < 5%
- key-event summary coverage > 80%
- identity switches near zero in two-dog regression clips

These are engineering targets, not claims of current performance.
