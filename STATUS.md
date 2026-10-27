# Status — Real-model batch done (Oct 27)

## Smoke test (verified shapes, key redacted)

Key loads from `.env` (`MODEL_API_KEY`, alias `META_API_KEY`); never
printed, logged, or committed. 6 smoke calls + 5 debug probes, all small.

- Spark `muse-spark-1.3` via `POST /v1/responses`: works, no fallback
  needed. Vision blocks `{type: "input_text"}` / `{type: "input_image",
  image_url: dataUrl}` accepted. Read the generator AWB image correctly
  (`17479271345`, matches ground truth). Latency 4.9–9.1s per call.
  Usage with one 14 KiB PNG: ~1827 in / ~127 out.
- Token cap name is `max_output_tokens`. Reasoning defaults to `high`
  and eats small caps (`incomplete`, reasoning-only output at cap 64).
  `reasoning: {effort: "low"}` still burns the full 1024 on long
  prompts (1022 reasoning tokens, no answer); `{effort: "minimal"}` is
  accepted and answers fit: trivial prompt 70 out (55 reasoning),
  slimmed judge prompt 340 out (239 reasoning). `temperature: 0`
  accepted. Long check-digit-math rubrics explode hidden reasoning, so
  the judge rubric sticks to paper/typed diffs + cross-doc gaps (every
  injected error kind shows there).
- SAM `sam-3.1` via `POST /v1/responses`: HTTP 200 `completed` in
  3.6–5.5s, `images_processed: 1`, all token counts 0 — but the message
  holds EMPTY text with no boxes, masks, or annotations (two prompt
  variants tried). No `404 model_not_found`: the model is available to
  this key, its usable output shape is not. Via
  `/v1/chat/completions`: HTTP 404, `The model sam-3.1 is not
  available on this endpoint. Use /v1/responses.` Stub retained.
- `GET /v1/models` (200) lists `muse-spark-1.3`, `muse-spark-1.2`,
  `muse-spark-1.1`, `sam-3.1`, plus wonder/voice/image ids. No
  `muse-spark-1.3` 404, so the 1.1 fallback was never exercised.

Verified Spark request:

```json
POST {base}/responses
{"model": "muse-spark-1.3",
 "input": [{"role": "user", "content": [
   {"type": "input_text", "text": "..."},
   {"type": "input_image", "image_url": "data:image/png;base64,..."}]}],
 "max_output_tokens": 1024,
 "reasoning": {"effort": "minimal"}, "temperature": 0}
```

Verified response envelope: `{object: "response", status:
"completed"|"incomplete", output: [{type: "reasoning", ...},
{type: "message", content: [{type: "output_text", text}]}],
usage: {input_tokens, output_tokens, total_tokens},
incomplete_details: {reason: "max_output_tokens"}|null}`.

## What works

- `RealSparkAdapter` matches the verified shapes: message-style input
  with up to 1 crop image, `max_output_tokens`, minimal reasoning,
  temperature 0, shared retry transport. Replies follow a JSON contract
  (`explanation`, `flagged`, `failures[]`, `fixes[]` with paper values
  as corrections); raw-text and empty fallbacks stay. Reports token
  usage; `costUsd` stays 0 because pricing is unverified.
- `RealSamAdapter` routes through the shared transport with defensive
  box parsing; on the verified empty envelope it yields zero crops.
  Ready for real boxes once a mask/box shape is confirmed.
- Transport (`packages/pipeline/src/http.ts`): retry with exponential
  backoff for 429/5xx (3 retries, honors Retry-After), hard
  `SECOND_LOOK_CALL_BUDGET` cap (default 300, counts every attempt),
  per-process call/token stats printed by the CLIs.
- `.env` loads at runtime via `loadDotEnv()` (allowlisted vars only,
  never overrides, never prints). Library code reads `process.env`, so
  tests stay hermetic and offline.
- Mode selection: `SECOND_LOOK_MODELS=real` + key → real Spark, stub
  SAM (empty output, see above), stub Glimmer (no weights). Every
  adapter reports its own `name` for real-vs-stub labelling.
- Real eval arms (opt-in via `--arms`, never in the default set):
  `single-model-real` judges each form from one live Spark JSON reply;
  `tiered-real` runs the deterministic tiered pipeline with live Spark
  escalation. Runner adds `--limit N` pilots and a `real model calls`
  line. Clip E2E adds `--models stub|real`.

## Eval numbers (100 forms, real vs stub)

```
| arm                  | forms | flagged | precision | recall | avg latency | cost    |
| check-digit-only     | 100   | 48      | 100.0%    | 60.0%  | 0.0ms       | $0.0000 |
| single-model (stub)  | 100   | 79      | 100.0%    | 98.8%  | 0.0ms       | $0.5000 |
| tiered (stub)        | 100   | 79      | 100.0%    | 98.8%  | 0.0ms       | $0.4200 |
| single-model-real    | 100   | 79      | 100.0%    | 98.8%  | 1897.4ms    | $0.0000 |
| tiered-real          | 100   | 79      | 100.0%    | 98.8%  | 3117.7ms    | $0.0000 |
real model calls: 184 (retries 0, tokens in/out 82608/84812)
```

80/100 forms carry injected errors. Both real arms match the stub
verdicts exactly: `single-model-real` judged all 100 from live model
JSON (100.0% / 98.8%, one no-op injection missed, same as stubs);
`tiered-real` verdicts are validator-deterministic by design, so its
realness is live latency (~3.1s avg, 84 escalations), tokens, and
explanations. Real-arm cost reads $0: pricing unverified, tokens are
the spend signal (~450 in / ~450 out per call). 10-form pilot first:
both real arms 100.0% / 100.0%, 17 calls, 7672/7580 tokens.

## Clip E2E with real adapters (`--models real`)

Functionally 4/4 PASS with live Spark (fix proposes the paper AWB,
qty gap flags, template claim drafts, models-off still blocks), but
per-check latency misses <5s: 74.6s / 85.4s / 80.3s on the three
escalating checks (15 frames × ~5s Spark each), 125ms models-off.
45 calls, 0 retries, 71790/18542 tokens (frames ride along as images).
The <5s live loop needs verdicts on sampled frames (one cloud call per
verdict ≈ 5s, borderline) with caching — not a cloud call per frame.
Default stub E2E stays 4/4 green at ~90ms/check.

## Batch spend

~259 API calls total, under the ~300 cap: 11 smoke/debug probes,
2 failed pilot calls (output-cap `incomplete`s), 17 pilot, 184 full
eval, 45 clip E2E. ~172K in / ~111K out tokens on metered runs.
Pricing unverified, so $ cost is unknown. No 429/5xx seen (0 retries).

## Test results

- `pnpm -r test`: 179 pass, 0 fail — validators 22, pipeline 85, web
  24, generator 17, eval 31 (incl. retry/budget/dotenv/mode/real-arm
  tests, all on mock fetch; nothing hits the network).
- `pnpm -r typecheck`: pass (5 projects).
- Stub clip E2E: 4/4 PASS within <5s (rerun after the refactor).
- Real clip E2E: 4/4 checks PASS, latency gate red (see above; the gate
  is doing its job, not a broken test).

## Skipped (need a human)

- SAM `sam-3.1` box/mask output shape: the API returns empty text via
  `/v1/responses`. Needs provider docs or a support channel; until
  then the stub localizes crops.
- Spark/SAM pricing: verify $/1K tokens to turn token counts into the
  eval cost column.
- Glasses developer mode + pairing, Xcode signing + physical-device
  trust prompts, recording real POV clips (E2E clips still labelled
  synthetic placeholders).
- Glimmer local runner spike (weights only under
  `/Volumes/Crucial X9/second-look-models`, never the internal disk).
- Live-server smoke (SSE push, submit, claims): unchanged, sandbox
  blocks listening sockets; rerun `/tmp/sl-smoke.py` against a
  networked `pnpm start`.

## Next steps (from PLAN.md)

- Cut live-loop latency: verdict on one sampled frame per second with
  crop/verdict caching; re-measure real per-verdict latency vs <5s.
- Resolve the SAM output shape or pivot to Spark grounding for crops.
- Record backup demo clips; dry-run the demo script.
- Shoot + edit the 3-min video; overlay the real eval numbers above.
