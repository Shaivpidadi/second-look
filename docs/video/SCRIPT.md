# Video script (3:00)

Matches docs/DEMO.md shot for shot: same 8 shots, same voiceover,
same overlays, retimed from 2:30 to 3:00 with roomier holds. The
only addition is the fresh-frame latency overlay in shot 2. Every
number is measured; per-number sources live in OVERLAYS.txt. The
voiceover text here is the caption source for captions.srt.

## Shot 1, 0:00 to 0:18: hook

Screen: /demo title card.
Say: "In 2020 Citibank wired $900M to Revlon's lenders by mistake.
The screen looked right. Nobody read it twice."
Overlay: "Second Look reads the paperwork before you sign."

## Shot 2, 0:18 to 0:42: glasses POV

Screen: POV clip of the AWB (recorded footage, or clip-awb.mp4
labelled SYNTHETIC), crop boxes localizing the number block.
Say: "Every air waybill gets typed by hand at least once. The
glasses watch the paper while a screen reader watches the typing."
Overlay: `check-digit-only recall: 60.0% standard, 39.4% hard`.
Overlay: `fresh frame verdict p50 2.3s, p90 2.8s (8-frame set, P/R 1.0/1.0, 0 abstentions)`.
Say: "Validators alone miss most real errors."

## Shot 3, 0:42 to 1:12: the catch, swapped AWB

Screen: /demo moment 1, or the replay: typed AWB has two digits
swapped. Verdict cards stream in.
Say: "A local verdict streams in about two hundred milliseconds.
One image-grounded Spark call refines it. Verdict: blocked, AWB
check digit invalid, fix proposes the paper value."
Overlay: "blocked in 3.4s end to end (measured live); fix correct
in 11 of 13 live runs; the verdict itself is deterministic."
Say: "Validators block instantly and for free. The model gets one
call to explain and propose the fix."

## Shot 4, 1:12 to 1:38: the catch, qty gap

Screen: /demo moment 2: invoice says 363, packing list says 365.
Say: "Paper matches typed, but the documents disagree with each
other. Warn on the cross-doc gap, escalated to Spark."
Overlay: "warned in 4.9s end to end (measured live); 1 keyframe
of 15 scanned; one Spark escalation plus SAM boxes per check."

## Shot 5, 1:38 to 2:00: dashboard

Screen: /dashboard overview: 40 checks, latency chart, verdict
breakdown; open one row to show reasoning, paper vs typed,
and the audit trail.
Say: "Every decision lands here with its reasoning, its latency
and cost, and an append-only audit trail."

## Shot 6, 2:00 to 2:14: claim draft

Screen: /demo moment 3, then the dashboard claim view.
Say: "The POD note reads 2 cartons damaged. A claim draft follows:
carrier plus BOL reference, 2 damaged, amount left for the adjuster."
Overlay: claim body with `[AMOUNT TBD]` highlighted.

## Shot 7, 2:14 to 2:46: the numbers

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

## Shot 8, 2:46 to 3:00: close

Screen: landing hero with the measured strip.
Say: "Validators first, always free. A local pass over crops. Cloud
only on disagreement, one Spark call per verdict. What ships next:
on-glasses recording and local Glimmer weights."
