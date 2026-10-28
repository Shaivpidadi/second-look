# Demo script (3 minutes) + backup clip shot list

All numbers below are measured, not targets. Sources: STATUS.md
and the README eval table. Clips labelled synthetic are generator
renders; recorded footage is a human task (see shot list).

## One-command backup replay

```sh
pnpm --filter @second-look/eval clips:demo [-- --models real --pace 600]
```

Stub mode is offline and deterministic (exit 1 on verdict mismatch).
`--models real` needs `.env` and spends 4 calls (~$0.02) per replay.
`--pace` sets ms between narrated beats for screen recording.

## Live glasses preflight (before any on-camera take)

```sh
pnpm demo:lan        # start the server on 0.0.0.0, prints the LAN URL
pnpm demo:preflight # server, key, and LAN URL checks (exit 1 on failure)
```

Then set the printed URL in the app and open its Check setup screen:
every row (server, key, glasses link, audio route) must pass before
recording. Verdicts arrive in the frame POST responses, so a
multi-instance host is fine; the SSE stream is a backup.

## Plan B: phone camera (if glasses DAT fails on the day)

Same verdict and speech flow, same session, one tap. Either:

1. On the red failure banner, tap "Use phone camera". The app clears
   the failure, switches to the phone camera, and resumes streaming.
2. Any time, even mid-stream, tap "Source: glasses" to flip it to
   "Source: phone". A live stream restarts on the phone camera.

Then point the phone at the paper and keep going. The fallback
button appears only for glasses-link and glasses-permission
failures; server and quality failures are shown instead because
switching cameras would not fix them.

## The /demo record screen

A 1920x1080 screen-recordable page: glasses POV with animated crop
boxes (left), typed receiving values (middle), streaming verdict
cards (bottom), moments + latency/calls/cost/model + audit trail
(right). Four keyboard-stepped moments: AWB typo block, invoice vs
packing mismatch, handwritten POD claim, clean submit.

```sh
pnpm --filter @second-look/web build
pnpm --filter @second-look/web exec next start -p 3100
# open http://127.0.0.1:3100/demo
```

- Title card auto-advances after 10s (or click / press Right).
- `Right` next moment, `Left` back, `R` reset, or click a moment.
- `?record=1` hides the cursor and the top chrome for clean captures.
- Fixture replay by default (deterministic, offline); "Go live"
  posts each moment's values to the real `/api/submit`.
- Stills: `docs/shots/demo-title-1920.png` and
  `docs/shots/demo-step{1,2,3,4}-1920.png`, captured by
  `apps/web/scripts/shots.mts` (Playwright, system Chrome).

## Shot-by-shot script (2:30)

Record the app screens with `clips:demo -- --pace 800`, the /demo
page, and the dashboard; cut in recorded POV where the shot list
below has real footage, synthetic frames otherwise (always labelled
SYNTHETIC). All numbers are measured; sources are STATUS.md and the
README eval table.

### Shot 1, 0:00 to 0:15: hook

Screen: /demo title card.
Say: "In 2020 Citibank wired $900M to Revlon's lenders by mistake.
The screen looked right. Nobody read it twice."
Overlay: "Second Look reads the paperwork before you sign."

### Shot 2, 0:15 to 0:35: glasses POV

Screen: POV clip of the AWB (recorded footage, or clip-awb.mp4
labelled SYNTHETIC), crop boxes localizing the number block.
Say: "Every air waybill gets typed by hand at least once. The
glasses watch the paper while a screen reader watches the typing."
Overlay: `check-digit-only recall: 60.0% standard, 39.4% hard`.
Say: "Validators alone miss most real errors."

### Shot 3, 0:35 to 1:05: the catch, swapped AWB

Screen: /demo moment 1, or the replay: typed AWB has two digits
swapped. Verdict cards stream in.
Say: "A local verdict streams in about two hundred milliseconds.
One image-grounded Spark call refines it. Verdict: blocked, AWB
check digit invalid, fix proposes the paper value."
Overlay: "blocked in 3.4s end to end (measured live); fix correct
in 11 of 13 live runs; the verdict itself is deterministic."
Say: "Validators block instantly and for free. The model gets one
call to explain and propose the fix."

### Shot 4, 1:05 to 1:30: the catch, qty gap

Screen: /demo moment 2: invoice says 363, packing list says 365.
Say: "Paper matches typed, but the documents disagree with each
other. Warn on the cross-doc gap, escalated to Spark."
Overlay: "warned in 4.9s end to end (measured live); 1 keyframe
of 15 scanned; one Spark escalation plus SAM boxes per check."

### Shot 5, 1:30 to 1:50: dashboard

Screen: /dashboard overview: 40 checks, latency chart, verdict
breakdown; open one row to show reasoning, paper vs typed,
and the audit trail.
Say: "Every decision lands here with its reasoning, its latency
and cost, and an append-only audit trail."

### Shot 6, 1:50 to 2:05: claim draft

Screen: /demo moment 3, then the dashboard claim view.
Say: "The POD note reads 2 cartons damaged. A claim draft follows:
carrier plus BOL reference, 2 damaged, amount left for the adjuster."
Overlay: claim body with `[AMOUNT TBD]` highlighted.

### Shot 7, 2:05 to 2:25: the numbers

Screen: eval table overlay.

100-form standard corpus, 40-form hard corpus (near-miss check
digits, diff-free cross-doc gaps, notes everywhere, blur/glare/skew):

| arm | split | precision | recall | latency | cost |
| --- | --- | ---: | ---: | ---: | ---: |
| check-digit-only | hard 40 | 100.0% | 39.4% | <1ms | $0 |
| tiered-real | std 100 | 100.0% | 98.8% | 3118ms | † |
| single-model-real | hard 40 | 100.0% | 100.0% | 1849ms | $0.086 |
| vision-real | hard 40 | 100.0% | 100.0% | 3086ms | $0.62 |

† ~$0.46 combined upper bound for both standard real arms
(batch-6 token totals; per-arm split unrecorded).

Say: "Check digits alone collapse on the hard split. The tiered
pipeline holds 98.8 to 100% recall at about a third of a cent per
form for text, a cent and a half with full vision. The vision arm
reads paper straight from degraded pixels, including five
validator-blind near-miss forms, and abstains to needs-human when
it cannot read a field."

Note: abstention is wired and tested, including a same-call
confidence gate (`low_confidence` list); live runs so far report 0
abstentions on all 40 hard forms (the model reads through even
3x-stacked blur rather than abstaining). Do not claim abstentions
were observed.

### Shot 8, 2:25 to 2:30: close

Screen: landing hero with the measured strip.
Say: "Validators first, always free. A local pass over crops. Cloud
only on disagreement, one Spark call per verdict. What ships next:
on-glasses recording and local Glimmer weights."

## Shot list for human-recorded backup clips

Record on real glasses (developer mode + pairing required) or a
phone POV rig as fallback. Landscape, steady hands, office light
plus one shaded take.

1. `awb-closeup` (8s): slow push toward an AWB number block, hold
   3s. Pairs with the block+fix beat.
2. `pod-note` (8s): pan across a POD exception note ("2 cartons
   damaged" or similar), hold 3s. Pairs with the warn+claim beat.
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
