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
Model arms are labelled `(stubbed)` until keys and weights exist.

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
`audit-clip-e2e.jsonl` plus `.md`/`.csv` summaries into `clips/`.
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

## What is stubbed until keys exist

- SAM: `StubSamAdapter` returns generator ground-truth boxes (or a
  centered document box for live frames). `RealSamAdapter` posts one
  noun-phrase concept plus one frame to the Responses API `sam-3.1`
  model; request/response shapes are unverified until a key exists.
- Glimmer: `StubGlimmerAdapter` agrees/disagrees deterministically from
  fixtures and redacts free text. `RealGlimmerAdapter` needs local
  weights, which go only under `/Volumes/Crucial X9/second-look-models`,
  never the internal disk. No weights are downloaded by any script.
- Spark: `StubSparkAdapter` explains diffs and proposes paper values as
  fixes with a placeholder per-call cost. `RealSparkAdapter` calls the
  Responses API; prompts and pricing are unverified until a key exists.
- All real adapters read `MODEL_API_KEY` (alias `META_API_KEY`) from the
  environment at call time and fail cleanly naming both vars when unset.
- Claim drafts use the deterministic template; the Spark body hook is
  wired but unused without a key.

## Human tasks (not in this repo's scripts)

API keys in `.env`, glasses developer mode + pairing, Xcode signing,
recording real POV clips, and the demo video. See PLAN.md.
