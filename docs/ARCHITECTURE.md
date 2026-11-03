# Architecture, setup, and what is real

Detail moved out of the README: the checks, how Meta models are used, package layout, every env var, how to run each surface, and which adapters are real or stubbed.

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
numbers in docs/EVAL.md come from the same runner with live arms (STATUS.md
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

Measured results are in docs/EVAL.md: 98.8 to 100% recall
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

Every env var the code reads (see `.env.example`; `check:submit`
fails on drift):

| var | where it works | default |
| --- | --- | --- |
| `MODEL_API_KEY` / `META_API_KEY` | key for live models | none (stubs) |
| `MODEL_API_BASE_URL` | API base override | `https://api.meta.ai/v1` |
| `SECOND_LOOK_MODELS` | `real` selects live adapters | stubs |
| `SECOND_LOOK_CALL_BUDGET` | per-run real-call cap | 300 |
| `AUDIT_DIR` | form audit log directory | `.audit` |
| `FFMPEG_BIN` | ffmpeg binary for clips | `/opt/homebrew/bin/ffmpeg` |
| `PORT` | `demo:lan` / `demo:preflight` port | 3100 |
| `VERDICT_DELAY_MS` | simulated `/form` delay | unset (live) |
| `SHOTS_BASE` | screenshot base URL | `http://127.0.0.1:3100` |
| `SHOTS_CHROME` | screenshot Chrome binary | system Chrome path |

The Next.js app loads `.env` itself; eval CLIs read the five
`.env` allowlisted vars (`MODEL_API_KEY`, `META_API_KEY`,
`MODEL_API_BASE_URL`, `SECOND_LOOK_MODELS`,
`SECOND_LOOK_CALL_BUDGET`) from `.env` and the rest from the
exported shell environment.

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
