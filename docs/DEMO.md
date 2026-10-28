# Demo script (3 minutes) + backup clip shot list

All numbers below are measured, not targets. Sources: STATUS.md
batches 6-8. Clips labelled synthetic are generator renders;
recorded footage is a human task (see shot list).

## One-command backup replay

```sh
pnpm --filter @second-look/eval clips:demo [-- --models real --pace 600]
```

Stub mode is offline and deterministic (exit 1 on verdict mismatch).
`--models real` needs `.env` and spends ~10 calls (~$0.03) per replay.
`--pace` sets ms between narrated beats for screen recording.

## The /demo record screen

A 1920x1080 screen-recordable page: glasses POV with animated crop
boxes (left), typed receiving values (middle), streaming verdict
cards (bottom), moments + latency/calls/cost/model + audit trail
(right). Four keyboard-stepped moments: AWB typo block, invoice vs
packing mismatch, handwritten POD claim, clean submit.

```sh
pnpm --filter @second-look/web build
pnpm --filter @second-look/web start --port 3100
# open http://127.0.0.1:3100/demo
```

- Title card auto-advances after 10s (or click / press Right).
- `Right` next moment, `Left` back, `R` reset, or click a moment.
- `?record=1` hides the cursor and the top chrome for clean captures.
- Fixture replay by default (deterministic, offline); "Go live"
  posts each moment's values to the real `/api/submit`.
- Stills: `docs/shots/demo-title-1920.png` and
  `docs/shots/demo-step{1,2,3,4}-1920.png`, captured by
  `apps/web/scripts/shots.ts` (Playwright, system Chrome).

## Script

### 0:00-0:20 — Cold open (problem)

"Every air waybill gets typed by hand at least once. One swapped digit
in the AWB number and the shipment sits at customs while someone
re-keys eleven digits from a photo. Second Look checks the typing
against the paper, live, through the glasses."

Overlay: `check-digit-only recall: 60.0% standard, 39.4% hard` —
validators alone miss most real errors.

### 0:20-1:00 — Live check 1: swapped AWB (block + fix)

Run the replay (or recorded POV): typed AWB has two digits swapped.

- First verdict streams in ~3-4s (measured p50 4280ms over 3 real
  runs; one run hit a 284s API stall outlier).
- Verdict BLOCKED: AWB check digit invalid. Fix proposes the paper
  value (observed correct 9 of 11 live runs; verdict itself is
  deterministic, wording varies).
- Full refined verdict follows at ~11s p50 (3 keyframes of 15
  scanned, image-grounded escalation, 2 spark-cache hits).

Say: "Validators block instantly and for free; the model only gets
called to explain and propose the fix."

### 1:00-1:40 — Live check 2: qty gap plus damage note (flag + claim)

Second scenario: invoice says 363, packing list says 365, POD note
reads "2 cartons damaged".

- First verdict ~3.2s p50 (all 3 runs under 5s: 3241/4506/3084ms).
- Verdict FLAG on the cross-doc gap, escalated to Spark.
- Claim draft follows from the template: carrier + BOL ref,
  damagedQty=2, `[AMOUNT TBD]` placeholder the adjuster must replace.
- Repeat view is instant: shared caches serve the claim check in
  ~340ms with zero new calls.

### 1:40-2:20 — The numbers (eval overlay)

100-form standard corpus, 40-form hard corpus (near-miss check
digits, diff-free cross-doc gaps, notes everywhere, blur/glare/skew):

| arm | split | precision | recall | latency | cost |
| --- | --- | ---: | ---: | ---: | ---: |
| check-digit-only | hard 40 | 100.0% | 39.4% | 0ms | $0 |
| tiered-real | std 100 | 100.0% | 98.8% | 3118ms | † |
| single-model-real | hard 40 | 100.0% | 100.0% | 1849ms | $0.086 |
| vision-real | hard 40 | 100.0% | 100.0% | 2857ms | $0.61 |

† ~$0.46 combined upper bound for both standard real arms
(batch-6 token totals; per-arm split unrecorded).

\* Combined ~$0.46 upper bound for both standard real arms.

Say: "Check digits alone collapse on the hard split. The tiered
pipeline holds 98.8-100% recall at about a third of a cent per form
for text, a cent and a half with full vision. The vision arm reads
paper straight from degraded pixels — including five
validator-blind near-miss forms — and abstains to needs-human when
it cannot read a field."

Note: abstention is wired and tested; live runs so far report 0
abstentions (the model reads through even 3x-stacked blur rather
than abstaining). Do not claim abstentions were observed.

### 2:20-2:50 — Architecture in 30 seconds

"Validators first, always free. A local pass over crops. Cloud only
on disagreement — one call per verdict, text first for speed, images
for grounding. Keyframes cut fifteen frames to three; caches make
repeats free; unreadable fields go to a human, never a silent pass."

### 2:50-3:00 — Close

"What ships next: on-glasses recording, local Glimmer weights, and
the single-keyframe fast path already landing first verdicts under
five seconds."

## Shot list for human-recorded backup clips

Record on real glasses (developer mode + pairing required) or a
phone POV rig as fallback. Landscape, steady hands, office light
plus one shaded take.

1. `awb-closeup` (8s): slow push toward an AWB number block, hold
   3s. Pairs with the block+fix beat.
2. `pod-note` (8s): pan across a POD exception note ("2 cartons
   damaged" or similar), hold 3s. Pairs with the flag+claim beat.
3. `label-shelf` (6s): pallet SSCC label at a slight angle.
   Pairs with the crop/box overlay.
4. `desk-wide` (6s): stack of the six doc types, slow pan. Title
   card background.

Screen-record segments (no human on camera needed):

5. Replay: `clips:demo -- --pace 800` in a terminal, 60s.
6. Eval: `eval -- --arms check-digit-only,tiered-real,vision-real
   --corpus corpus-hard --limit 5`, 60s (spends ~10 calls).
7. Freeze-frames of the eval table and the p50/p95 latency box
   from this file's numbers.

Label every synthetic render on screen: "SYNTHETIC PLACEHOLDER".
