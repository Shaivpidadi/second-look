# Status — Batch 8 done: fast path, vision arm, demo prep (Oct 27)

## Fast path: sub-5s first verdicts (with one stall)

The sharpest keyframe now verdicts text-first while the crop runs
concurrently; the image-grounded rerun follows as the refined verdict
(full path unchanged otherwise). Text and image escalations cache
under separate verdict-cache keys. Stream phases are `fast`/`full`;
E2E asserts on the refined verdict and reports the fast time as
first-verdict latency. Real clip E2E, 3 runs (p50/p95, nearest-rank):

```
| check                    | p50 total | p95 total | p50 first | p95 first |
| awb-swap -> block + fix  | 11022ms   | 291821ms  | 4280ms    | 284594ms  |
| models-off -> blocks     | 98ms      | 99ms      | 98ms      | 99ms      |
| qty-gap -> flag          | 11102ms   | 11322ms   | 3241ms    | 4506ms    |
| claim draft (cached)     | 340ms     | 349ms     | 214ms     | 223ms     |
```

First verdicts beat <5s in 5 of 6 escalating measurements (2683-4506ms);
run 1 check 1 stalled 284s on a single hung API call (0 retries — a
server-side stall, not backoff), which dominates the awb-swap p95.
Totals still miss <5s on escalating checks (refinement + 2 more
keyframes at ~11s p50). 10 calls/run (~$0.03). Check 1's fix proposal
flaked 1/3 runs this batch (`fix=none` once; 2/11 cumulative) —
verdicts are deterministic, live fix wording is not. Follow-up: call
timeouts with retry, then a hung call fails fast instead of stalling.

## Vision arm: 100/100 on hard, 0 abstentions

`vision-real` sends all six degraded document images plus typed-only
readings (no paper text) to Spark in one call per form (cap 1536).
Fields the model lists under "unreadable" abstain to needs-human:
scored as judged, counted in the summary, and printed as a trailing
`needs-human abstentions:` line — never a silent pass. Pilot 10
(100/100, $0.16) then full hard 40:

```
| vision-real | 40 | 33 | 100.0% | 100.0% | 2856.9ms | $0.6106 |
40 calls, 0 retries, 453K/19K tokens (~11.3K in, ~$0.015/form)
```

Zero abstentions on all 40, plus a 1-call extreme-blur probe (3x
stacked blur over blur+glare+skew) that also judged correctly
without abstaining: Spark reads through the degradations rather
than admitting unreadability, so the abstain path is wired and
tested but unexercised live. Eliciting abstention (confidence
thresholds, read-then-judge passes) is follow-up work. The vision is
genuine: 100% recall includes 5 near-miss-only forms that are
invisible without reading paper pixels (valid check digits, no other
text signal).

## Demo prep

- `docs/DEMO.md`: 3-minute script (cold open, block+fix, flag+claim,
  eval overlay, architecture, close) using only measured numbers,
  plus a shot list for human-recorded backup clips and
  screen-record segments.
- `pnpm --filter @second-look/eval clips:demo [-- --models real
  --pace 600]`: one-command narrated replay of both synthetic clips
  through the pipeline. Stub mode is offline/deterministic and gates
  on verdicts (model wording reported, never gated); verified
  passing. Real replay spends ~10 calls.

## Batch spend

81/150 real API calls, 0 retries: 30 clip E2E (3 runs x 10), 51
vision (10 pilot + 40 full + 1 extreme probe). ~612K in / ~34K out
tokens, ~$0.91 total (E2E ~$0.08, vision ~$0.83).

## Test results

- `pnpm -r test`: 237 pass, 0 fail — validators 22, pipeline 117,
  web 24, generator 28, eval 46 (cache dimensions, fast-path overlap
  rendezvous, sharpest-first, unreadable parsing, vision arm, image
  loading, abstention scoring, demo beats; all mock/offline).
- `pnpm -r typecheck`: pass (5 projects).
- Stub clip E2E: 4/4 PASS within <5s after the fast-path change.
- Real clip E2E: 11/12 checks pass across 3 runs (one fix flake);
  latency gate red on totals, green on first verdicts modulo the
  stall.

## Skipped (need a human)

- Record the backup POV clips + screen segments in docs/DEMO.md
  (glasses developer mode + pairing, or phone POV fallback).
- Shoot + edit the 3-min video; overlay the measured numbers.
- SAM `sam-3.1` still yields no boxes for document concepts;
  Spark boxes cover crops meanwhile.
- Glimmer local runner spike (weights only under
  `/Volumes/Crucial X9/second-look-models`, never the internal disk).
- E2E clips still synthetic placeholders; Xcode signing + device
  trust untouched; live-server smoke unchanged (sandbox blocks
  listening sockets).

## Next steps (from PLAN.md)

- Request timeouts + retry so hung calls fail fast, not 284s.
- Elicit vision abstention (confidence/read-twice) or accept
  judge-always with measured P/R.
- Totals under 5s: single-keyframe verdict + overlapped calls.
- Record backup demo clips; dry-run the demo script.
