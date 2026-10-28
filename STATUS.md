# Status — Batch 11 done: critique fixes, sub-5s checks, demo script (Oct 28)

## Batch 11 changes

- Committed the batch-10 reshoot (15 PNGs), then critiqued every
  frame (findings kept under "Batch 11 critique" below) and fixed
  all 14: field paths and rule codes removed from visible UI
  (shared lib/fields.ts labels; raw ids stay in data attributes),
  invalid focus ring fixed, demo fixtures say "glimmer · local",
  dashboard KPIs count runs, demo data shuffled with randomized
  seconds, count references carry units, demo audit uses moment
  tags, landing POV frame cropped to the document.
- Latency: end-to-end checks under 5s live (details under "Batch
  11 latency" below). 10 real API calls, 0 retries.
- docs/DEMO.md is now a shot-by-shot 2:30 script with exact
  screens, lines, and overlays; README gained the hook, a Meta
  models section for judges, and corrected clip-path numbers.
- 240 tests pass, 0 fail (3 new: skipSpark, single escalation,
  single-keyframe default); typecheck (5 projects) and next build
  green. No em dashes in user-facing copy; no real company names
  outside the hook line.

## Batch 11 latency: end-to-end checks under 5s

Before (batch 8 real E2E, p50 over 3 runs): qty-gap total 11102ms
(first verdict 3241ms), awb-swap total 11022ms. Two sequential live
Spark calls per keyframe (text, then image-grounded) plus a
sequential 3-keyframe tail. Stub E2E was already green at ~350ms,
so the target could only be hit by restructuring the real call
graph, verified with 4 minimal real probes (10 calls total).

Fix, in eval/clips/ingest.ts plus two pipeline options:

- Single keyframe default (frames.ts `maxKeyframes` 3 to 1).
  Worst-of-3 scanning stays available explicitly; no test pinned
  the old default.
- `runTieredPipeline` grew `skipSpark`: validators plus the local
  Glimmer pass report escalation reasons without calling Spark.
- The k1 fast verdict is now that local preliminary (streams in
  ~200ms with no Spark explanation) and exactly one image-grounded
  escalation refines it. The image call starts on the frame bytes
  immediately instead of waiting for SAM boxes: both adapters send
  the whole frame as the crop image, so the inputs are identical
  and SAM latency drops off the critical path. FAST/FULL phases,
  verdicts, fixes, and cache behavior are unchanged.

After (real, this batch, 0 retries):

- qty-gap: verdict mismatch, total 4892ms (fast 245ms), 2 calls,
  $0.0057. Previous probe of the intermediate design (two
  overlapped sparks) took 5839ms; the text call was redundant.
- awb-swap: verdict blocked, total 3401ms, fix proposes the exact
  paper value. 2 calls.

Spark cost per escalating check roughly halves (one escalation,
not two). Two eval tests pinned the old call counts (3 and 2 live
escalations); they now pin 2 and 1 with the same cache-reuse
contracts. Rendezvous overlap test still passes: the image
escalation starts while the crop is in flight. Follow-up: per-call
API variance (±2s observed) is now the whole budget; shorter
Spark explanations would add margin.

## Batch 11 critique

Harsh pass over all 15 screenshots in docs/shots, judged against
Linear and Vercel dashboard quality:

1. Landing hero mock: large gray dead area above the document in
   the POV pane (photo backdrop reads as a broken image). Crop the
   frame to the document and reposition the crop boxes.
2. Landing mock status strip shows raw code
   (`awb.awbNumber check_digit`). Humanize it.
3. /form shows developer field paths (awb.awbNumber) next to every
   label. Remove from visible UI, keep as ids and data attributes.
4. /form invalid input still shows a blue focus ring over the red
   border. Scope the invalid focus style so red wins.
5. /form error text prefixes the raw rule code
   (`awb_check_digit:`). Show the message only.
6. /form live rail shows a raw field id plus rule tag, and the
   card says "Pushed over SSE". Human labels and plain words.
7. Dashboard KPI "Warned 20" counts entries while "Checks run 40"
   counts runs. Count runs everywhere.
8. Dashboard demo data is grouped by verdict over time (visible
   color bands in the latency chart, first table page all clean)
   and every timestamp ends in :45. Shuffle run order, randomize
   seconds.
9. Dashboard bare count references ("POD 100") are meaningless.
   Add units.
10. Dashboard drawer and audit log show raw field paths and
    snake_case actions. Humanize; keep raw values in data
    attributes and hover titles.
11. /demo card footers still say "glimmer · stub". Fixtures must
    say "glimmer · local".
12. /demo leaks field paths in typed-field corners, crop chips,
    card bodies, and audit entries. Human labels everywhere.
13. /demo claim card body shows `damagedQty=2` code. Plain words.
14. /demo audit fixture times (09:41) disagree with the REC clock.
    Label entries by moment instead.

Accepted as is: the verdict strip grows left to right as cards
stream in (empty space is future cards); the eval page is short
because the table is the whole report.

## Batch 9 done: full UI redesign + /demo screen (Oct 28)

## UI redesign: every page rebuilt, screenshot-verified

Tailwind v4 theme, self-hosted Geist, lucide icons, motion, and a
local `ui/` component set (Button, Card, Badge, Input, Select,
Table, Tabs, Tooltip, Kbd, Separator, Skeleton, StatusDot). All
existing APIs, SSE wiring, and tests untouched and green.

- `/` landing: Revlon hook, JSX product miniature, 3 features,
  measured-numbers strip (98.8% tiered recall std100, 100% vision
  recall hard40, 39.4% validators-only, 3.2s first-verdict p50
  qty-gap, $0.003/form tiered text — all from README/STATUS).
- `/form`: grouped Shipment/Identifiers/Counts/Exception cards,
  sticky live-verdict rail (SSE), inline errors, submit disabled
  while live-blocked. Fixed a hydration mismatch (render-time
  `crypto.randomUUID` -> client-side session id).
- `/dashboard`: app shell (Overview/Checks/Claims/Audit/Eval),
  KPI cards, checks table, row drawer (reasoning, paper-vs-typed
  diff, audit trail), claim doc view, eval table with † footnote.
- `/demo`: 1920x1080 record screen — POV with line-anchored crop
  boxes + frame strip + detection log, typed values with paper
  lines, streaming verdict cards, moments/stats/audit side panel,
  10s title card, Right/Left/R stepping, `?record=1` chrome+cursor
  hiding, fixture replay with live `/api/submit` toggle.
- `apps/web/scripts/shots.ts` (Playwright + system Chrome; the
  sandbox blocks browser installs and listening sockets, so shots
  need one approved unsandboxed run): 15 PNGs in `docs/shots/`
  at 1440x900 and 1920x1080, 2 critique-fix-reshoot rounds.
  Note: `docs/shots/demo-step*.png` predate the final one-line
  crop-chip move (left -> right anchor) by minutes; rebuild and
  typecheck pass, re-shoot when approvals are available.

Batch spend: 0 model API calls (UI fixtures + stub adapters only).
`pnpm -r test`: 237 pass, 0 fail. `pnpm -r typecheck`: pass
(5 projects). `next build`: pass.

## Batch 8 done: fast path, vision arm, demo prep (Oct 27)

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
