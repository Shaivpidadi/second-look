# Eval and clip path

Full eval tables and the commands that produce them. The README keeps only the headline rows; per-batch shapes, p50/p95 latency, and spend live in STATUS.md.

## Run the eval

```sh
pnpm --filter @second-look/generator generate -- --seed 1 --count 100
pnpm --filter @second-look/eval eval
```

The report prints precision/recall/latency/cost per form for the 3 arms.
Model arms are labelled `(stubbed)` until keys and weights exist. With a
key in `.env`, the live Spark arms run alongside them:

```sh
pnpm --filter @second-look/eval eval -- --arms single-model-real,tiered-real --limit 10
pnpm --filter @second-look/eval eval -- --arms check-digit-only,single-model,tiered,single-model-real,tiered-real
```

`--limit N` pilots on the first N forms. Real arms judge from live
`muse-spark-1.3` replies; the run ends with a `real model calls` line
(calls, retries, tokens in/out). Every HTTP attempt counts against
the `SECOND_LOOK_CALL_BUDGET` cap (default 300); 429/5xx retry with
backoff. Costs are real dollars at official Standard rates (Spark
$1.25/$4.25 per 1M in/out, $0.15 cached; SAM $2.50/1K images).
`vision-real` judges from the six document images plus typed values
(no paper text) and abstains to needs-human on unreadable fields,
reported as a trailing `needs-human abstentions:` line:

```sh
pnpm --filter @second-look/eval eval -- --arms vision-real --corpus corpus-hard --limit 10
```

```sh
pnpm --filter @second-look/generator generate -- --seed 5001 --count 40 --split hard
pnpm --filter @second-look/eval eval -- --corpus corpus-hard
```

The hard split (near-miss check digits, diff-free cross-doc gaps,
notes on every form, blur/glare/skew images) drops check-digit-only
recall to 39.4% while diff-aware arms hold 100%. Latest numbers:

| arm | split | flagged | precision | recall | avg latency | cost |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| check-digit-only | std 100 | 48 | 100.0% | 60.0% | <1ms | $0.0000 |
| single-model (stubbed) | std 100 | 79 | 100.0% | 98.8% | <1ms | $0.2500 |
| tiered (stubbed) | std 100 | 79 | 100.0% | 98.8% | <1ms | $0.2100 |
| single-model-real | std 100 | 79 | 100.0% | 98.8% | 1897.4ms | † |
| tiered-real | std 100 | 79 | 100.0% | 98.8% | 3117.7ms | † |
| check-digit-only | hard 40 | 13 | 100.0% | 39.4% | <1ms | $0.0000 |
| single-model (stubbed) | hard 40 | 33 | 100.0% | 100.0% | <1ms | $0.1000 |
| tiered (stubbed) | hard 40 | 33 | 100.0% | 100.0% | <1ms | $0.1000 |
| single-model-real | hard 40 | 33 | 100.0% | 100.0% | 1848.5ms | $0.0855 |
| tiered-real | hard 40 | 33 | 100.0% | 100.0% | 4438.4ms | $0.1276 |
| vision-real | hard 40 | 33 | 100.0% | 100.0% | 3085.7ms | $0.6169 |

† ~$0.46 combined upper bound for both standard real arms,
re-priced from batch-6 token totals (82.6K in / 84.8K out; per-arm
and cache splits unrecorded, so no per-arm figure). Hard costs are
exact per-response prices. See STATUS.md for shapes, p50/p95 clip
latency, and batch spend.

## Run the clip path

```sh
pnpm --filter @second-look/eval clips:render   # 2 synthetic POV clips (ffmpeg)
pnpm --filter @second-look/eval clips:e2e      # 4 checks + audit export
```

`clips:render` builds `clip-awb.mp4` and `clip-pod.mp4` (720x1280, title
card + tilted page with blur and handheld jitter) with JSON sidecars
carrying the documented ground truth. Both clips open with a
SYNTHETIC PLACEHOLDER card; real POV clips are a human task.

`clips:e2e` samples each clip at 2 fps, picks the single sharpest
keyframe (sharpness + change detection), and streams verdicts
through the same crop -> validators -> Glimmer -> Spark path live
glasses would use. A local verdict streams in ~200ms while the crop
runs; exactly one image-grounded Spark escalation refines it, so
end-to-end checks land under 5s live (3.4s block with fix, 4.9s
warn with escalation, 0 retries). Crop and verdict caches are
shared across the run, so repeat frames cost nothing. The four
checks are:

- swapped AWB digit -> block + fix
- bad check digit with models off -> still blocks (validators alone)
- invoice vs packing qty gap -> warn + Spark escalation
- "2 cartons damaged" on POD -> claim draft

It reports end-to-end latency per check against the <5s target and writes
`audit-clip-e2e.jsonl` plus `.md`/`.csv` summaries into `clips/`. With a
key in `.env`, `--models real` (or `SECOND_LOOK_MODELS=real`) reruns the
same checks with the real Spark adapter and reports live per-check
latency plus a `real model calls` line:

```sh
pnpm --filter @second-look/eval clips:e2e -- --models real
```

One-command narrated replay for the screen-recorded backup demo
(see `docs/DEMO.md` for the shot-by-shot script and shot list):

```sh
pnpm --filter @second-look/eval clips:demo [-- --models real --pace 600]
```

Re-export any session later with:

```sh
pnpm --filter @second-look/eval clips:export -- --dir clips --session clip-e2e
pnpm --filter @second-look/eval clips:export -- --dir .audit --session <form-session>
```
