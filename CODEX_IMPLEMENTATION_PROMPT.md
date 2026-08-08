You are working in the existing repository `ai-pet-detective` on its current `main` branch. Implement Narrative Engine V2 as a general-purpose dog-video understanding layer. Do not optimize only for the couch regression clip.

PRIMARY PRODUCT GOAL
The app must tell, reliably and chronologically, what happens in a dog video: who does what, where, with whom/what, and how the situation changes over time. It must work indoors, gardens, parks, streets, trails, cars, stairs, water/beach scenes, fixed cameras and handheld video, with one or multiple dogs.

IMPORTANT CONSTRAINTS
- Preserve the current local-first architecture and existing QVAC/ONNX + VisionPsy + MediaPipe + RTMPose functionality.
- Do not replace deterministic tracking with an LLM-only pipeline.
- Do not break current Python CLI/dashboard behavior.
- Keep existing tests green.
- Prefer conservative `unknown` over hallucination.
- Do not equate mouth contact with aggression, open mouth with smiling, proximity with play, or body language with a certain emotion.
- Do not narrate raw camera-relative left/right/up/down/closer/farther movement as meaningful story events.

IMPLEMENTATION PACKAGE
If the files from the supplied V2 bundle are present, integrate them rather than rewriting equivalent logic:
- `qvac-worker/public/narrative-engine-v2.js`
- `qvac-worker/tests/narrative-engine-v2.test.mjs`
- `pet_detective/narrative_v2.py`
- `tests/test_narrative_v2.py`
- `docs/NARRATIVE_ENGINE_V2.md`
- `docs/INTEGRATION_CHECKLIST.md`
- `docs/session-debug-schema.example.json`

If those files are not physically present, create them using the design below before integration.

PHASE 1 — DATA MODEL, MERGER, STORY PLANNER, DEBUG
1. Introduce layers: raw observations → stable states → semantic events → merged intervals → narrative planner → session story.
2. Use a V2 event schema with: id, start/end video seconds, actor, action, target, from/to, objects, modifiers, evidence, confidence, importance, description, source, rawIds.
3. Treat generic movement/detection records as raw telemetry. They must have narrative importance 0.
4. Merge continuous events using START/CONTINUE/END semantics. Petting/play/sniffing/walking/chewing/tail wag etc. should become intervals, not repeated cards.
5. Rank story events by semantic priority, confidence, novelty, duration relevance and temporal coverage. Preserve meaningful beginning/middle/end coverage.
6. Persist/export a complete debug session JSON containing raw observations, pose, hands, object/context candidates, camera motion, raw VisionPsy, semantic events, merged events and final summary.
7. Add an `Export debug JSON` button to the session summary modal.
8. Display raw-observation count separately from behaviour-event count. Do not label every raw/legacy record as an analysed behaviour event.

PHASE 2 — TEMPORAL UNDERSTANDING
9. Posture engine: standing/sitting/lying/unknown with ~500–800 ms stabilization and transition events (`sitting_down`, `standing_up`, `lying_down`). Avoid one-frame flicker.
10. Surface/location engine: generic support/zone transitions, not couch-specific logic. Initial support vocabulary: floor, couch, bed, chair, carpet, grass, dirt, pavement, road, stairs, water, vehicle, unknown. Generate events such as jumping_on/jumping_off/entering/leaving/crossing only when temporally supported.
11. Petting: remove the hard requirement for a YOLO person box. Reliable MediaPipe hand motion/contact with a tracked dog is enough; person detection is a confidence bonus. Merge into an interval.
12. Tail wag: use 1–2 s of tail-root/keypoint history and require repeated lateral oscillation/reversals. A single tail displacement remains raw pose evidence, not `tail_wagging`.
13. Object state machine: visible → approach → contact → mouth_contact → picking_up → holding → carrying/playing/chewing/tugging → dropping.
14. COCO object detection is strong evidence but not an absolute gate. VisionPsy may propose generic/object/toy/rope-like toy/stick/leash when it is stable across multiple frames at conservative confidence. Never let one ambiguous frame create a specific uncommon object.
15. Dog-person and dog-dog interactions should be explicit semantic relations. Mere proximity is not play.

PHASE 3 — CAMERA, CONTEXT, SEMANTIC SAMPLING
16. Add camera-motion compensation. Estimate global scene movement from stable environmental/reference features/detections (or a lightweight optical-flow method if cleanly implementable) and subtract it from subject motion. If camera-motion confidence is weak, avoid directional narration instead of guessing.
17. Context becomes confidence-bearing hypotheses, not only `indoor-floor` / `grassy-outdoor-area`. Suggested hierarchy:
   environment: indoor/outdoor/vehicle/unknown
   scene: home/garden/park/sidewalk/street/trail/beach/water/public_indoor/unknown
   surface: floor/couch/bed/chair/carpet/grass/dirt/pavement/road/stairs/water/unknown
   structures: door/gate/fence/tree/bush/car/bench/stairs/water_edge/etc.
   Do not infer a park from grass alone.
18. Keep current adaptive semantic interval as baseline but add event-triggered semantic bursts for posture/surface changes, new objects, hand-dog contact, abrupt dog-dog relationship changes, acceleration/jump candidates, tail oscillation, disappear/reappear around boundaries and scene changes.
19. Queue one high-priority pending semantic trigger when VisionPsy is busy rather than silently losing the event.
20. Build temporal evidence sequences around triggers when possible (before/start/after frames) and ask VisionPsy what changed across time.

PHASE 4 — FINAL VIDEO PASS AND SUMMARY
21. For uploaded/seekable non-live video, add a bounded final semantic pass after playback ends. Review high-interest windows plus temporal-coverage gaps, reconcile ambiguous events, merge again, then generate the final story.
22. The final session summary must be based on merged V2 semantic events, not regex-filtered legacy event text.
23. VisionPsy in summary generation is a language realizer. It may rephrase/reorder chronologically but may not invent facts absent from supplied merged events/evidence.
24. Maintain three outputs:
   - Scene now: compact live observation
   - Event timeline: timestamped merged behaviour intervals
   - Session story: natural chronological narrative (primary product output)

STUDIO.MJS SPECIFIC CHANGES
- Expand allowed actions at least with: crouching, sitting_down, standing_up, lying_down, rolling, rubbing, shaking, stretching, scratching, mouth_open, tongue_visible, head_tilt, jumping_on, jumping_off, entering, crossing, dropping, tugging, fetching, dog_dog_interaction, person_dog_interaction, scene_change.
- Replace the current hard prompt veto `No object is tracked: do not invent...` with conservative temporal Vision-only object evidence rules.
- Rewrite summary selection to consume merged V2 event payload, not the current regex that favors play/sniff/touch while dropping many posture/surface events.
- Add `/api/finalize-session` for bounded final-pass reconciliation on seekable videos.

APP.JS SPECIFIC CHANGES
- Import and instantiate NarrativeEngineV2/SessionDebugRecorder per session.
- Keep legacy UI behavior during migration but route final summary through V2 first.
- Feed RTMPose/hand/object/context evidence into V2 temporal engines.
- Separate raw count and behaviour-event count.
- Add debug export.
- Ensure resetSession resets all V2 temporal state.

PACKAGE/TESTS
- Add `"test:narrative": "node --test tests/narrative-engine-v2.test.mjs"` to qvac-worker/package.json.
- Run `pytest -q`.
- Run `cd qvac-worker && npm run test:narrative`.
- Add integration tests where practical.

REGRESSION SCENARIOS
Validate design for: living-room couch/petting/toy clip; fixed-camera postures; handheld camera pans; garden sniff/run/roll; fetch; rope/tug toy not in COCO; two dogs crossing identities; street/sidewalk; leash; door/gate; car in/out; stairs; water in/out/shake; bowl drinking; conservative eating; conservative toileting; occlusion/reappearance; low light.

REGRESSION VIDEO #001 EXPECTED KEY COVERAGE
The couch clip should approximately preserve: initial two-dog couch rest; petting of brown dog with side/back roll; posture/activity changes; couch→floor transition; person interaction on floor; return to couch; Cavalier head petting; late object/toy presentation, mouth contact and play when visually supported. Do not hard-code these timestamps or rules.

QUALITY TARGETS (engineering targets, not current claims)
- high-salience precision >85%
- high-salience recall >75%
- key timing error < ±1.5 s
- near-zero false camera-motion story statements
- continuous-event duplicate rate <10%
- summary hallucination <5%
- key-event summary coverage >80%
- near-zero dog identity switches in 2-dog regression clips

WORKFLOW
1. Inspect current files before editing and preserve current functionality.
2. Create a branch `agent/narrative-engine-v2` if possible.
3. Implement in coherent commits, but do not stop after scaffolding: integrate it into the running Studio.
4. Run all available tests.
5. Launch the Studio and fix syntax/runtime errors.
6. Report exactly which files changed, tests run and any remaining limitations requiring real-video tuning.
