# Status — Tiered batch done (Oct 27)

## What works
- Tiered verdict pipeline end to end (`packages/pipeline`): deterministic
  validators first (check digits, paper/typed match, cross-doc), then the
  Glimmer stub pass (deterministic agree/disagree from fixtures plus PII
  redaction), then the Spark stub only on disagreement, cross-doc
  conflict, or handwriting. Check-digit failures block with no Spark call.
- Real adapters read `MODEL_API_KEY` (alias `META_API_KEY`) from env at
  call time and fail cleanly naming both vars when no key exists.
- Per-call latency and estimated cost ride the audit log (`modelCalls`);
  the dashboard shows "Glimmer agree, no Spark call, $0" vs Spark
  escalation runs plus session totals.
- Live verdict to `/form` over SSE (`/api/verdicts`): typed events
  publish partial verdicts with session sequence numbers; the client
  tracker applies per-field debounce plus stale-sequence drops, so an
  artificial verdict delay (`VERDICT_DELAY_MS`, e.g. 2000) still renders
  exactly one block and one fix (test in `lib/live-verdict.test.ts`,
  PLAN risk 5).
- Claim drafter v1: a POD exception note mentioning damage (e.g. "2
  cartons damaged") produces a template draft (carrier, BOL/AWB refs,
  damaged qty, `[AMOUNT TBD]`) with a Spark adapter hook for later; the
  dashboard lists drafts with a copy button.
- Generator defaults to a 100-form corpus; the eval runner reports the
  PLAN trio (check-digit-only, single-model, tiered) with stubbed model
  arms labelled "(stubbed)".
- `/form` mock warehouse receiving form: AWB, BOL number, carrier,
  container, SSCC, shipped/received cartons, POD exception note.
  Submit-gate BLOCK carries cited rules plus deterministic fixes with an
  Apply-fix button.

## Test results
- `pnpm -r test`: 130 pass, 0 fail — validators 22, pipeline 48, web 24,
  generator 17, eval 19.
- `pnpm -r typecheck`: pass (5 projects).
- `next build` (`@second-look/web`): pass — `/`, `/form`,
  `/dashboard`, `/api/events`, `/api/submit`, `/api/verdicts`,
  `/api/claims`, `/api/audit`.
- Eval over 100 generated forms: check-digit-only P 100% / R 60% / $0;
  single-model (stubbed) P 100% / R 98.8% / $0.50; tiered (stubbed)
  P 100% / R 98.8% / $0.42. The one miss is a no-op injection (identical
  adjacent digits swapped) that leaves no signal.
- Live-server smoke (SSE push, submit, claims) not run: the shell
  sandbox in this session blocks listening sockets. Routes are covered
  by `next build` plus unit tests of the bus, tracker, and gate; rerun
  `/tmp/sl-smoke.py` against `PORT=3101 pnpm start` with networked
  sandbox flags to smoke them live.

## Skipped (need a human)
- API keys in `.env` (`MODEL_API_KEY` / `META_API_KEY`): real Spark and
  SAM calls stay unwired until a key exists; stubs cover every path.
- Glasses developer mode + pairing, Xcode signing + physical-device
  trust prompts, POV fallback clip recording.
- Verifying the Meta Responses API request/response shapes and pricing
  (PLAN spikes 2 and 4) once a key is available.

## Next steps (from PLAN.md)
- SAM crop service + 2 POV fallback clips through the same path.
- Glimmer local runner spike (weights only under
  `/Volumes/Crucial X9/second-look-models`, never the internal disk).
- Record backup demo clips; README + audit export for the video close.
