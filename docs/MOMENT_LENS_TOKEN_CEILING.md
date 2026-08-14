# Moment Lens output-token ceiling

## Current public setting

Moment Lens keeps a shared `max_tokens: 256` and `temperature: 0` for Flash and
Full. The shared ceiling makes the visual comparison fair. The Studio exposes a
**Max reached** state rather than hiding a length stop or rewriting the model's
answer.

The ceiling moved from 128 to 256 after the initial 71-photo pass reached 128
tokens in 67/71 Flash responses (94.4%) and 38/71 Full responses (53.5%).

## 1024-token diagnostic

A separate local Studio instance was run with a 1024-token ceiling. It was not
used as, and did not change, the public default. Generated answers were
tokenized with the same local VisionPsy runtime and exact prefixes were
reconstructed at 128, 256 and 512 tokens.

All 71 photos were attempted. The run acquired 64 paired results. Seven images
exceeded the long-run request timeout. Of the 64 pairs, Flash had two additional
model-call timeouts; Full had none. Simulated-threshold percentages below use
only the valid answer for that model.

| Model | Valid answers | Would reach 128 | Would reach 256 | Would reach 512 | Reached 1024 |
| --- | ---: | ---: | ---: | ---: | ---: |
| Flash Q4 | 62 | 58 (93.5%) | 53 (85.5%) | 13 (21.0%) | 6 (9.7%) |
| Full Q4 | 64 | 34 (53.1%) | 1 (1.6%) | 0 (0%) | 0 (0%) |

Exact prefixes ending without sentence-final punctuation:

| Model | At 128 | At 256 | At 512 |
| --- | ---: | ---: | ---: |
| Flash Q4 | 51 | 47 | 12 |
| Full Q4 | 34 | 1 | 0 |

At 1024, Flash averaged 441.3 output tokens with a 396-token median and still
reached the ceiling in six valid responses. It also caused the long-run
timeouts. Full averaged 134.1 tokens, had a 130-token median, and naturally
stopped by 282 tokens in every valid response.

## Decision

- `1024` is not a suitable public default. It substantially increases latency
  and lets a minority of repetitive Flash generations continue without solving
  their underlying loop.
- `256` is already sufficient for almost every Full response in this dataset.
- `512` is the strongest candidate for a later shared public ceiling: it covers
  every valid Full response and reduces Flash threshold hits from 85.5% at 256
  to 21.0%, while keeping the loop cases visibly bounded.
- The public default remains `256` until the 512 candidate is explicitly chosen
  and visually tested. This diagnostic does not silently change production
  behavior.

These figures are directional diagnostics from one local run on a selected
71-photo set. They are not an official VisionPsy benchmark and do not establish
general model quality.
