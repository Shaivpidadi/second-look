# Status — Batch 7 done: latency, Spark-box crops, hard split (Oct 27)

## Latency: keyframes, caches, streaming, output cap

The clip path now runs verdicts on sampled keyframes only (3 max:
sharpness via Laplacian variance plus dhash change detection over
pure-TS PNG decoding), caches extractions by frame hash
(`CropCache`) and escalations by readings hash (`VerdictCache`, with
changed-fields-only resends on repeat disagreements), streams one
partial verdict per keyframe (`runClipFramesStream` + E2E partial
log), and caps clip-path Spark output at 768 tokens. E2E shares both
caches across checks, so the claim check reuses the qty-gap check's
crops and escalation with zero new calls.

Real clip E2E per-check latency, 3 runs (p50/p95, nearest-rank, n=3):

```
| check                    | p50 total | p95 total | p50 first | p95 first |
| awb-swap -> block + fix  | 17191ms   | 25874ms   | 9941ms    | 10772ms   |
| models-off -> blocks     | 122ms     | 124ms     | 122ms     | 124ms     |
| qty-gap -> flag          | 8779ms    | 18318ms   | 4086ms    | 7955ms    |
| claim draft (cached)     | 359ms     | 362ms     | 208ms     | 211ms     |
```

Was 74-85s per escalating check at 45 calls/run; now 9-26s at
8 calls/run (3 keyframes of 15 scanned, 2 spark-cache hits per
escalating check, ~$0.02/run). First verdicts still miss <5s
(4.1-9.9s p50; one qty-gap first verdict hit 3975ms). Next lever:
overlap the crop and escalation calls or verdict on a single
keyframe. Functionally 8/8 runs pass checks 2-4; check 1 passed 7/8
(run 1 proposed a wrong fix once — live-model nondeterminism).

## SAM: official docs, 5 empty probes, Spark-box fallback

Meta's official SAM docs (dev.meta.ai/docs/sam/segmenting,
reading-segmentation) say the concept prompt must be a bare noun
phrase ("glasses") in `input_text` — instructions and questions
"often return nothing" — with a `type: "message"` item, `input_image`
or `input_video` media, and streamed or plain responses carrying
`<Nf>id<|box;x1;y1;x2;y2;w;h|><|mask;...|>` token-grammar lines
(inclusive corners, one line per frame, empty text = zero matches).
`RealSamAdapter` now sends exactly that shape and parses the grammar.

5 probes, all HTTP 200 `completed` with empty text: "shipping
document", "document", "paper" on the AWB page, streamed "document",
and "barcode label" on the label page. Per the docs that means zero
matches, so `sam-3.1` does not fire on these document concepts.
Fallback, stated plainly: real mode crops via `SparkBoxAdapter`
(same `SamAdapter` interface, one concept per request), which asks
`muse-spark-1.3` for 0-1000 JSON boxes. Real E2E runs on live boxes;
direct SAM stays parked until a matching concept or shape is found.

## Eval honesty: hard split + official pricing

The standard corpus is too easy for diff-aware arms (98.8-100%).
New hard split, 40 forms (`generate --split hard` into
`eval/corpus-hard/`): near-miss check-digit swaps that still validate
(check-digit-blind), cross-doc-only gaps with no paper/typed diffs,
handwritten/benign POD notes on every form, and rotating
blur/glare/skew image degradations. Both splits, stub arms:

```
| arm (standard 100)       | flagged | precision | recall |
| check-digit-only         | 48      | 100.0%    | 60.0%  |
| single-model (stubbed)   | 79      | 100.0%    | 98.8%  |
| tiered (stubbed)         | 79      | 100.0%    | 98.8%  |
| arm (hard 40)            | flagged | precision | recall |
| check-digit-only         | 13      | 100.0%    | 39.4%  |
| single-model (stubbed)   | 33      | 100.0%    | 100.0% |
| tiered (stubbed)         | 33      | 100.0%    | 100.0% |
```

check-digit-only recall collapses to 39.4% on hard, as designed.
Text-judging real arms still ace hard (below) — expected, since
near-miss/cross-doc-only keep the same text signal; the degradations
bite only a vision-judging arm, which is future work (1 call of
budget left, so not this batch).

Costs are now real dollars at official Standard rates
(dev.meta.ai/docs/pricing-rate-limits): Spark $1.25/$4.25 per 1M
in/out, $0.15 cached input (from `cached_tokens`); SAM $2.50/1K
images, $0.20/1K video frames. Stub estimate updated to the measured
mean, $0.0025/call. Hard-split real arms (80 calls, 0 retries,
35.9K/39.9K tokens):

```
| single-model-real | 40 | 33 | 100.0% | 100.0% | 1848.5ms | $0.0855 |
| tiered-real       | 40 | 33 | 100.0% | 100.0% | 4438.4ms | $0.1276 |
```

tiered-real is slower per form here because every hard form carries
a note, so all 40 escalate. Standard-split real costs were not
re-run (budget); batch-6 token totals re-price to ~$0.46 upper bound
(82.6K in / 84.8K out, cache split unrecorded then).

## Batch spend

149/150 real API calls, 0 retries: 5 SAM probes, 64 clip E2E (8
runs x 8 calls), 80 hard-split eval. ~103K in / ~57K out tokens,
~$0.35 total (E2E ~$0.02/run, hard eval $0.2131). SAM probes bill
$0.0025/image each with zero token usage.

## Test results

- `pnpm -r test`: 224 pass, 0 fail — validators 22, pipeline 114,
  web 24, generator 28, eval 36 (keyframes, caches, token grammar,
  spark-box, pricing, hard split, all mock/offline).
- `pnpm -r typecheck`: pass (5 projects).
- Stub clip E2E: 4/4 PASS within <5s (3 keyframes, partials + cache
  hits logged).
- Real clip E2E: checks pass (check-1 fix 7/8), latency gate red —
  the gate measures, not breaks.

## Skipped (need a human)

- SAM `sam-3.1` still yields no boxes for document concepts despite
  the documented request shape; needs a matching concept, provider
  docs deep-dive, or support channel. Spark boxes cover crops meanwhile.
- <5s live loop: needs the single-keyframe fast path and/or
  overlapped crop+escalation calls (first verdicts at 4-10s now).
- Vision-judging arm over degraded hard images (text arms cannot see
  blur/glare/skew).
- Glasses developer mode + pairing, Xcode signing + device trust,
  recording real POV clips (E2E clips still synthetic placeholders).
- Glimmer local runner spike (weights only under
  `/Volumes/Crucial X9/second-look-models`, never the internal disk).
- Live-server smoke: unchanged, sandbox blocks listening sockets.

## Next steps (from PLAN.md)

- Single-keyframe verdict + overlapped calls; re-measure vs <5s.
- Vision-judging arm on the hard split; fold degradations into scoring.
- Record backup demo clips; dry-run the demo script.
- Shoot + edit the 3-min video; overlay the real eval numbers above.
