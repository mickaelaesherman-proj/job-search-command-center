# AI evaluation method

## What is measured

Accuracy is measured **only** on blind tests: the person rates postings without seeing the AI's score, and the AI scores without seeing hers. Suggestions she sees before deciding (Open Roles) are tracked for drift and override rate, never counted as accuracy, because seeing a score anchors a decision.

## Protocol

1. Every Monday the script draws up to 10 postings the scan found that did **not** reach Open Roles (about 7 Tier 1-2 titles and 3 others, at most 2 per company (3 before 10/19/2026), with a logged random seed so the draw is reproducible).
2. Each posting is scored through the Claude API. The prompt contains only the posting text, the candidate profile and the rubric.
3. Scores are **sealed**: stored outside the Sheet, with only a fingerprint (SHA-256) shown. Any change to a sealed score is detected at reveal.
4. She rates each posting 1-5 with a main reason.
5. "Reveal" works only when every row is rated. It writes the scores, verifies fingerprints, grades the batch, and records her ratings so later edits are flagged.

## Targets

| Measure | Target |
|---|---|
| Within one point of her rating | 80% or more |
| Average difference (AI minus her) | Within ±0.5 |
| AI says 4-5 where she says 1 | 0 |

Closed postings and Low-confidence scores are excluded. Three consecutive batches meeting every target would justify the first small automatic step: skipping roles the AI scores 1-2 that the rules already flag for review.

## Baseline: rubric v1 (21 postings, October 2026)

| Measure | Result |
|---|---|
| Within one point | 13 of 21 (62%) |
| Average difference | +1.57 (AI too high) |
| Big misses (2+ points) | 8, all AI too high |
| AI 4 where she said 1 | 6 |

**Diagnosis:** years-of-experience requirements acted as a veto for her but only as a 15% weight for the AI; transferable skills were credited too generously; the profile did not list her gaps; desirability was weighted like feasibility.

## Rubric v2 changes

- **Five gates** (ceilings applied after the weighted average): Scope 1 caps at 1; Level 1-2, Depth 1, Skills 1, or Skills 3 or lower with Depth 2 or lower cap at 2.
- **Stricter skills anchors:** only demonstrated, domain-specific experience earns 4-5.
- **Her stated gaps added to the profile.**
- **Level uses the posting's own years;** up to one year above her range is a stretch, not a gate.
- **Evidence rule:** no score without the posting text.

The gates were fitted to the same 21 postings, so they are hypotheses until the weekly blind batches confirm them. The overall score is computed by the script, not the model, so the arithmetic is deterministic and testable.
