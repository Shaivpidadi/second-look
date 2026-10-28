# Second Look

In 2020 Citibank wired $900M to Revlon's lenders by mistake. The screen
looked right. Nobody read it twice. Second Look is the co-signer that
reads the paperwork before you sign: glasses watch the paper, a screen
reader watches the typed values, and the system acts. It catches
mismatches live, blocks submit, proposes fixes, logs an audit trail,
and drafts damage claims.

A warehouse worker types data from logistics paperwork (bill of lading,
air waybill, commercial invoice, packing list, proof of delivery, pallet
SSCC label) into a receiving form. Second Look compares the paper
against the typed values through a tiered pipeline and stops bad
submissions before they leave the dock.

## Try it in 2 minutes (no keys, no network)

```sh
pnpm install
pnpm --filter @second-look/web dev   # open http://localhost:3000/demo, press Start
```

In another terminal:

```sh
pnpm --filter @second-look/eval eval -- --arms check-digit-only,single-model,tiered --limit 5
```

No `.env` needed: stubs serve every model call. On `/form`, type a
wrong AWB digit and watch the submit gate block with a fix. The
numbers below come from the same runner with live arms (STATUS.md
records shapes, latency, and spend per batch).

## Checks

1. Field match: paper vs. typed value (transpositions, dropped digits,
   swapped fields).
2. Deterministic check digits before any model call: AWB mod-7, ISO 6346
   container, SSCC/GS1 mod-10.
3. Cross-document: invoice qty vs. packing list, BOL weight vs. AWB, POD
   received vs. shipped count.
4. Handwritten POD exceptions ("2 cartons damaged") become a claim draft.

## How it uses Meta models

- Muse Spark (`muse-spark-1.3`, Responses API) is the escalation
  brain: one image-grounded call per check explains the mismatch and
  proposes the paper value as the fix. The same model reads document
  pixels directly in the vision eval arm (100% recall on the hard
  split, including validator-blind forms) and localizes crop boxes
  through the JSON-box fallback while SAM stays parked.
- SAM 3.1 is the designed crop localizer behind the `SamAdapter`
  interface, parked because it returns empty text for document
  concepts; the swap back is one adapter.
- Glimmer is the local-first tier by design: validators, then a
  local pass that redacts PII, then cloud only on disagreement.
  The stub serves until local weights land.

Measured results are in the eval table below: 98.8 to 100% recall
at roughly $0.003 per text form, and end-to-end checks under 5
seconds live (3.4s block with fix, 4.9s warn with escalation).

## Architecture

```
[POV clip / glasses frames] --> [SAM 3.1 crop] --> crops
                                                     |
[Mock form] --typed values--> [Screen reader]        |
                                                     v
[Submit gate: BLOCK/ALLOW] <-- [Verdict] <-- [Check digits FIRST]
                                                        |
                                                 [Glimmer local pass + redact]
                                                        | disagree only
                                                        v
                                              [Spark escalation]
                                                        |
                    +----------------+------------------+------------------+
                    v                v                  v                  v
                 [Fix]          [Audit log]          [Claim]          [Dashboard]
```

- `apps/web`: Next.js app with the mock warehouse form (`/form`),
  dashboard (`/dashboard`), and API routes (`/api/events`,
  `/api/submit`, `/api/verdicts`, `/api/claims`, `/api/audit`). Live
  verdicts reach the form over SSE with per-field debounce and
  session sequence numbers.
- `packages/validators`: check-digit validators (AWB, ISO 6346,
  GS1/SSCC) with zero dependencies.
- `packages/pipeline`: SAM crop, Glimmer, Spark, verdict, audit,
  claim, and audit export. Deterministic validators run before any
  model call; the Glimmer local pass runs before any cloud call;
  Spark sees only redacted payloads on disagreement.
- `eval/generator`: synthetic documents (6 types) plus a seeded
  error injector. No real PII.
- `eval`: eval runner over a generated corpus (3 arms:
  check-digit-only, single-model, tiered) plus the clip path
  (`eval/clips`: render, ingest, scripted E2E, audit export).
- `clips/`: POV fallback clips plus sidecars and E2E audit exports.
  Generated, gitignored; record real POV clips by hand.

## Setup

```sh
cp .env.example .env   # add MODEL_API_KEY when you have one; never commit .env
pnpm install
```

Requires Node 22 and, for the clip path only,
`/opt/homebrew/bin/ffmpeg` (override with `FFMPEG_BIN`).

## Run the form and dashboard

```sh
pnpm --filter @second-look/web dev   # http://localhost:3000/form and /dashboard
```

`/form` is prefilled with valid values. Change an AWB digit or short the
received count and submit: the gate blocks with the cited rule plus an
Apply-fix button. Live verdicts stream in as you type
(`VERDICT_DELAY_MS=2000 pnpm --filter @second-look/web dev` simulates a
slow pipeline). `/dashboard` shows verdicts, per-call latency/cost
("Glimmer agree, no Spark call, $0" vs escalations), claim drafts with a
copy button, and the audit trail. Form audit logs live in `.audit/`
(gitignored) or `AUDIT_DIR`.

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

## Tests and typecheck

```sh
pnpm -r test
pnpm -r typecheck
```

## What is real and what is stubbed

- Spark: REAL via `muse-spark-1.3` on the Responses API (verified
  request/response shapes, `max_output_tokens`, minimal reasoning
  effort). `SECOND_LOOK_MODELS=real` plus a key selects it; otherwise
  the deterministic stub serves. Costs price each response at
  official Standard rates.
- SAM: direct `sam-3.1` PARKED. It answers HTTP 200 via
  `/v1/responses` but returns empty text for document concepts even
  with the documented bare-noun-phrase request (5 probes), and is
  rejected on `/v1/chat/completions` ("Use /v1/responses").
  `RealSamAdapter` sends the documented shape and parses the token
  grammar for when it fires; meanwhile real mode crops via
  `SparkBoxAdapter` (Spark JSON boxes, same `SamAdapter` interface),
  and the stub (generator boxes, centered fallback) covers offline.
- Glimmer: STUB. `RealGlimmerAdapter` needs local weights, which go
  only under `/Volumes/Crucial X9/second-look-models`, never the
  internal disk. No weights are downloaded by any script.
- All real adapters read `MODEL_API_KEY` (alias `META_API_KEY`) from
  the environment at call time (the Next app loads `.env`
  automatically; eval CLIs need it exported first) and fail cleanly
  naming both vars when unset.
- Claim drafts use the deterministic template; the Spark body hook is
  wired but the E2E keeps the template path.

## Human tasks (not in this repo's scripts)

API keys in `.env`, glasses developer mode + pairing, Xcode signing,
recording real POV clips, and the demo video. See PLAN.md.
