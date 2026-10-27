# Status — Clip-path batch done (Oct 27)

## What works
- SAM crop service (`packages/pipeline/src/sam.ts`): `SamAdapter`
  interface with a deterministic stub (one crop per generator
  ground-truth box, centered document box fallback, $0) and a real
  `sam-3.1` Responses API adapter. Both enforce one noun-phrase concept
  per request; the real adapter reads `MODEL_API_KEY` (alias
  `META_API_KEY`) at call time and fails cleanly naming both vars when
  unset. Crops feed the Glimmer/Spark adapters.
- Fallback clip path: `eval/clips/render.ts` renders 2 synthetic POV
  clips (`clip-awb.mp4`, `clip-pod.mp4`, 720x1280 H.264, ~80 KiB each)
  from generator PNGs with a SYNTHETIC PLACEHOLDER title card,
  perspective tilt, slight blur, and handheld jitter. JSON sidecars
  carry the documented ground truth plus nominal stub boxes.
  `eval/clips/ingest.ts` samples frames at 2-7 fps (ffmpeg) and runs
  each through SAM crop -> validators -> Glimmer -> Spark, the same
  path live glasses would use. Generated clips, sidecars, and audit
  exports stay gitignored.
- Scripted E2E (`eval/clips/e2e.ts`, 2 fps): all 4 PLAN checks pass —
  swapped AWB digit -> block + fix (paper value proposed); bad check
  digit with models off -> still blocks on validators alone (0 model
  calls); invoice (363) vs packing (365) qty gap -> mismatch flag +
  Spark escalation; "2 cartons damaged" on POD -> template claim draft
  with damagedQty 2. End-to-end latency per check: 84-93ms, far under
  the <5s target.
- Audit export: E2E writes `audit-clip-e2e.jsonl` plus readable
  `.md`/`.csv` summaries (`packages/pipeline/src/export.ts`); the
  `clips:export` CLI re-exports any session, including form sessions
  under `.audit/`.
- README.md covers what it does, architecture, how to run the form,
  dashboard, eval, and clip path, and which parts are stubbed until
  keys exist.

## Test results
- `pnpm -r test`: 153 pass, 0 fail — validators 22, pipeline 66, web
  24, generator 17, eval 24 (incl. clip ingest + ffmpeg sampling).
- `pnpm -r typecheck`: pass (5 projects).
- `next build` (`@second-look/web`): pass — `/`, `/form`,
  `/dashboard`, `/api/events`, `/api/submit`, `/api/verdicts`,
  `/api/claims`, `/api/audit`.
- Clip E2E: 4/4 PASS, each <5000ms (measured 84-93ms on stub adapters;
  real-model latency unmeasured until keys exist).
- Live-server smoke (SSE push, submit, claims) not run: the shell
  sandbox in this session blocks listening sockets. Routes are covered
  by `next build` plus unit tests of the bus, tracker, and gate; rerun
  `/tmp/sl-smoke.py` against `PORT=3101 pnpm start` with networked
  sandbox flags to smoke them live.

## Skipped (need a human)
- API keys in `.env` (`MODEL_API_KEY` / `META_API_KEY`): real Spark and
  SAM calls stay unwired until a key exists; stubs cover every path.
  Responses API request/response shapes and pricing unverified (PLAN
  spikes 2 and 4).
- Glasses developer mode + pairing, Xcode signing + physical-device
  trust prompts, recording real POV clips (the 2 committed-path clips
  are labelled synthetic placeholders).
- Glimmer local runner spike (weights only under
  `/Volumes/Crucial X9/second-look-models`, never the internal disk).

## Next steps (from PLAN.md)
- Glimmer local runner spike; point the clip path at real crops/reads.
- Record backup demo clips; dry-run the demo script.
- Shoot + edit the 3-min video; overlay eval numbers; submit Nov 4.
