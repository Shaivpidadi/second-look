# Second Look

Glasses watch the paper, a screen reader watches the typed values, and the
system acts: it catches mismatches live, blocks submit, proposes fixes, logs
an audit trail, and drafts damage claims.

A warehouse worker types data from logistics paperwork (bill of lading, air
waybill, commercial invoice, packing list, proof of delivery, pallet SSCC
label) into a receiving form. Second Look compares the paper against the
typed values through a tiered pipeline and stops bad submissions before
they leave the dock.

## Checks

1. Field match: paper vs. typed value (transpositions, dropped digits,
   swapped fields).
2. Deterministic check digits before any model call: AWB mod-7, ISO 6346
   container, SSCC/GS1 mod-10.
3. Cross-document: invoice qty vs. packing list, BOL weight vs. AWB, POD
   received vs. shipped count.
4. Handwritten POD exceptions ("2 cartons damaged") become a claim draft.

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

- `apps/web` — Next.js: mock warehouse form (`/form`), dashboard
  (`/dashboard`), API routes (`/api/events`, `/api/submit`,
  `/api/verdicts`, `/api/claims`, `/api/audit`). Live verdicts reach the
  form over SSE with per-field debounce and session sequence numbers.
- `packages/validators` — check-digit validators (AWB, ISO 6346, GS1/SSCC),
  zero dependencies.
- `packages/pipeline` — SAM crop, Glimmer, Spark, verdict, audit, claim,
  audit export. Deterministic validators run before any model call; the
  Glimmer local pass runs before any cloud call; Spark sees only redacted
  payloads on disagreement.
- `eval/generator` — synthetic documents (6 types) plus a seeded error
  injector. No real PII.
- `eval` — eval runner over a generated corpus (3 arms:
  check-digit-only, single-model, tiered) plus the clip path
  (`eval/clips`: render, ingest, scripted E2E, audit export).
- `clips/` — POV fallback clips plus sidecars and E2E audit exports.
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
(calls, retries, tokens in/out). Pricing is unverified, so cost reads
$0 and tokens are the spend signal. Every HTTP attempt counts against
the `SECOND_LOOK_CALL_BUDGET` cap (default 300); 429/5xx retry with
backoff. Latest 100-form numbers (Oct 27, 184 live calls, 0 retries):

| arm | flagged | precision | recall | avg latency |
| --- | ---: | ---: | ---: | ---: |
| check-digit-only | 48 | 100.0% | 60.0% | 0.0ms |
| single-model (stubbed) | 79 | 100.0% | 98.8% | 0.0ms |
| tiered (stubbed) | 79 | 100.0% | 98.8% | 0.0ms |
| single-model-real | 79 | 100.0% | 98.8% | 1897.4ms |
| tiered-real | 79 | 100.0% | 98.8% | 3117.7ms |

See STATUS.md for the smoke-test shapes, per-call tokens, real clip
E2E latency, and batch spend.

## Run the clip path

```sh
pnpm --filter @second-look/eval clips:render   # 2 synthetic POV clips (ffmpeg)
pnpm --filter @second-look/eval clips:e2e      # 4 checks + audit export
```

`clips:render` builds `clip-awb.mp4` and `clip-pod.mp4` (720x1280, title
card + tilted page with blur and handheld jitter) with JSON sidecars
carrying the documented ground truth. Both clips open with a
SYNTHETIC PLACEHOLDER card; real POV clips are a human task.

`clips:e2e` samples each clip at 2 fps and runs every frame through the
same crop -> validators -> Glimmer -> Spark path live glasses would use:

- swapped AWB digit -> block + fix
- bad check digit with models off -> still blocks (validators alone)
- invoice vs packing qty gap -> flag + Spark escalation
- "2 cartons damaged" on POD -> claim draft

It reports end-to-end latency per check against the <5s target and writes
`audit-clip-e2e.jsonl` plus `.md`/`.csv` summaries into `clips/`. With a
key in `.env`, `--models real` (or `SECOND_LOOK_MODELS=real`) reruns the
same checks with the real Spark adapter and reports live per-check
latency plus a `real model calls` line:

```sh
pnpm --filter @second-look/eval clips:e2e -- --models real
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
  the deterministic stub serves. Pricing is unverified, so live cost
  reads $0 and runs report tokens instead.
- SAM: STUB retained. `sam-3.1` answers HTTP 200 via `/v1/responses`
  but returns empty text with no boxes, masks, or annotations, and is
  rejected on `/v1/chat/completions` ("Use /v1/responses"); no usable
  box shape is verified, so real mode keeps `StubSamAdapter` (generator
  ground-truth boxes, centered document box fallback). `RealSamAdapter`
  stays ready for when a mask/box shape is confirmed.
- Glimmer: STUB. `RealGlimmerAdapter` needs local weights, which go
  only under `/Volumes/Crucial X9/second-look-models`, never the
  internal disk. No weights are downloaded by any script.
- All real adapters read `MODEL_API_KEY` (alias `META_API_KEY`) from
  the environment at call time (CLIs load `.env` at startup) and fail
  cleanly naming both vars when unset.
- Claim drafts use the deterministic template; the Spark body hook is
  wired but the E2E keeps the template path.

## Human tasks (not in this repo's scripts)

API keys in `.env`, glasses developer mode + pairing, Xcode signing,
recording real POV clips, and the demo video. See PLAN.md.
