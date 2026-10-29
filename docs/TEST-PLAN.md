# Test plan: fake-video end to end

This plan checks that Second Look catches a mismatch between paper and the form no matter which comes first, and stays quiet when they agree.

- **Form first (bill to form check):** values are typed, then the glasses see the paper.
- **Docs first (paper to form check):** the glasses see the paper, then values are typed.
- **Paper vs paper:** two documents disagree with each other (BOL vs AWB, invoice vs packing list), in both orders.
- **Multi-doc sessions:** six documents in forward and reverse order, plus a glance at the form screen between papers.

No phone or glasses are needed. The harness renders synthetic shipping documents, films them as a shaky handheld clip, samples the clip at 2 fps, and posts the frames to the same `/api/events` endpoint the Android app uses. It types the form through the same endpoint, listens to `/api/verdicts` over SSE, and finally calls `/api/submit`.

## Run it

```sh
# server (real models): key from the root .env, never printed
pnpm demo:lan                        # or: SECOND_LOOK_MODELS=real next dev -p 3100
pnpm test:fake-video                 # full matrix, real mode, writes test/fake-video/out/results-<label>.{json,md}
pnpm test:fake-video --mode stub     # plumbing only, no model calls
pnpm test:fake-video --only bol-cartons,xdoc-qty --repeat 3 --label latency
pnpm test:fake-video --max-spend 5   # stop when the run's estimated spend passes $5
```

Pieces:

- `test/fake-video/render.py`: draws BOL, AWB, invoice, packing list, POD, pallet label, and a form-on-a-monitor screen. It adds perspective, tilt, drift, glare, blur, noise and warm cast, then encodes H.264. The `degrade: heavy` option makes a hard read, and `framing: tight` crops into the page edge.
- `test/fake-video/scenarios.mjs`: holds the paper truth, the typed form, and the cases. Each case expands into both directions, or into both document orders for paper-vs-paper cases.
- `scripts/fake-video-e2e.mjs`: the harness. Clips are cached by content hash and rendered before the clock starts. It reads spend from `/api/health` before and after the run.

## Scoring rules

- **Live result:**
  - PASS means every expected field was flagged on the SSE stream and nothing else was.
  - PASS (abstain) applies to `allowAbstain` cases. The system said "needs a human" for the expected field or for the view instead of flagging it. Silence is a FAIL.
  - A clean case passes only if no field is flagged.
- **Submit:** expected BLOCK for typed-vs-paper mismatches and ALLOW for clean cases. Paper-vs-paper conflicts are shown live but do not block typed values (`blockOnSubmit:false`). Degraded and cut-off cases do not score submit.
- **Latency:**
  - Judged-frame POST latency is the time from a frame POST to its response, for frames that went to the model.
  - Detection latency is measured from the trigger to the first expected flag. In form-first runs the trigger is the first frame; in docs-first runs it is the start of typing.
- **Spend:** tokens counted by the server (`/api/health` → `spendUsd`) are priced at Spark Standard rates with no cache discount, so the figure is an upper bound. Meta has no balance API: `/v1/usage`, `/v1/billing/*` and similar all return 404. Remaining credit can only be seen on the dashboard.

## Scenarios and expected verdicts

| case | what is planted | directions / orders | expected live | expected submit |
| --- | --- | --- | --- | --- |
| clean-bol | nothing | form-first, docs-first | no flags | ALLOW |
| bol-cartons | typed 102, paper 120 CTNS | both | flag `bol.cartons` | BLOCK, fix 120 |
| bol-number | BOL/PRO digits transposed | both | flag `bol.bolNumber` | BLOCK |
| bol-carrier | wrong party name (carrier) | both | flag `bol.carrier` | BLOCK |
| container-blind | wrong container with a valid check digit | both | flag `bol.containerNumber` | BLOCK |
| awb-blind | wrong AWB with a valid mod-7 check digit | both | flag `awb.awbNumber` | BLOCK |
| awb-swap | AWB digits swapped (check digit fails) | both | flag `awb.awbNumber` | BLOCK |
| sscc-blind | wrong SSCC with a valid GS1 check digit | both | flag `label.sscc` | BLOCK |
| pod-short | POD 118 received, "2 cartons damaged"; BOL + POD | both | flag `pod.receivedCartons` | BLOCK + claim |
| pod-typed-wrong | POD 118, typed 120 | both | flag `pod.receivedCartons` | BLOCK |
| xdoc-weight | BOL 2064 kg vs AWB 2046 kg | bol>awb, awb>bol | flag `awb.weightKg` (cross-doc) | not scored for block |
| xdoc-qty | invoice 363 vs packing 365 | invoice>packing, packing>invoice | flag `invoice.totalQty` (cross-doc) | not scored for block |
| clean-full | six documents, correct form | both | no flags | ALLOW |
| clean-full-shuffled | six documents in reverse order | both | no flags | ALLOW |
| screen-glance | glasses look at the form screen, then the BOL | form-first | no flags (a screen is not paper) | ALLOW |
| degraded-cartons | heavy blur and glare, wrong cartons | both | flag or abstain, never silent | n/a |
| cutoff-container | container number clipped by the frame edge | both | flag or abstain, never silent | n/a |

That is 33 scenarios per pass.

## Results

All runs used real models (Spark `muse-spark-1.3`) on 2026-10-28 (ET), with 6 frames per document at 2 fps.

| run | code | passed | form-first | docs-first | frame POST p50 / p90 | detection p50 / p90 | model calls | est. spend |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| before-fix (11-case subset) | 8375167 | 3/11 | 2/7 | 1/4 | 3182 / 6252 ms | 7906 / 7914 ms | 100 | ~$0.35 |
| full-1 | mid-fix | 26/29 | | | 2684 / 4281 ms | 2229 / 6506 ms | 96 | $0.34 |
| full-2 | mid-fix | 32/33 | 18/19 | 14/14 | 2900 / 4195 ms | 995 / 14317 ms* | 134 | $0.46 |
| **full-3 (x2 repeats)** | d82d1c1 | **66/66** | **38/38** | **28/28** | **2830 / 4215 ms** | **999 / 6330 ms** | 268 | $0.92 |
| stub (plumbing) | mid-fix | 29/29 plumbing | | | 60 / 64 ms | | 0 | $0 |

\* full-2 counted clip render time inside the form-first window. That was a harness artifact, fixed in full-3.

Before the fixes, the system failed in these ways:

- Docs-first missed every typed mismatch: no paper-vs-typed check existed.
- Submit never blocked a paper mismatch.
- Paper-vs-paper never judged the second document.
- A six-document session judged only one document.

Detection p90 (6.3 s) is set by paper-vs-paper cases, which must judge a second document. Single-document flags land in about 0.2-3.5 s.

Full per-scenario tables are in `test/fake-video/out/results-*.md`. That folder is gitignored; re-run to regenerate it.

## Bugs found by this plan and fixed

| bug | symptom | fix |
| --- | --- | --- |
| No paper-vs-typed check | Docs-first missed every mismatch, and submit allowed them | `lib/paper-match.ts`; frames store readings per document, the later side is compared against the earlier, and the gate blocks with the paper value as the fix (d82d1c1) |
| Every frame went to the judge | The per-minute throttle tripped, the dedupe key was set even when the call was refused, and later documents were never judged | Dedupe on ink difference only (threshold 2.0, from measurements), one judge in flight per session, key set only after the budget reserve (d82d1c1) |
| Judge reply cut off at 768 tokens | An empty reply read as "clean" (silent pass) | Cap raised to 1536; a reply with no judgment now abstains (d82d1c1) |
| Clipped number read as wrong | AWB "20-2734 2210" was flagged against a correct typed value | A digits-only prefix or suffix counts as cut-off, so the system abstains; the model's own reading arbitrates its flags (d82d1c1) |
| Camera misread flagged as a typing error | A heavy-blur misread of the container (CBQU03054383) blocked a correct value | A paper read that fails its own check digit is a misread, so the system abstains (d82d1c1) |
| Unreadable field passed silently | A clipped container gave no flag and no abstain | Typed fields whose document was seen but whose value was not read abstain (d82d1c1) |
| Route bundles had separate state | On a cold start, frame memory was invisible to submit and SSE | Process-wide `processMap` on `globalThis` (fe98c15) |
| Phone and form never shared a session | In the real product, glasses frames and typed values never met | `/form?session=glasses` joins the latest phone session via `/api/sessions/latest` and re-sends all values (caf875b) |
| `demo:lan` passed a stray `--` | next read the flag as a path | cd1d44b |
| Root `.env` not loaded by Next | The key was missing unless exported | 8375167 |
| Android: no BLUETOOTH_CONNECT request, and permission errors were hidden | Silent glasses failure | 1ba64a9 |
| No spend visibility | | `/api/health` reports calls, tokens and estimated spend (bcb1391) |

## Known gaps

- **Consignee and signature are not product fields.** The form has no consignee or signature field, so carrier stands in for the party-name case. A missing POD signature is not detected.
- **Remaining credit has no API.** Spend is estimated from tokens, and the balance is only on the Meta dashboard.
- **Not every document in a six-document session gets judged.** In full-3, one shuffled run never judged the AWB. The session still passes because the remaining documents agree, but a mismatch on a document that was never judged would be missed. Handheld dwell per page (3 s here) and the per-session throttle (16 calls/min, 2 per check) set the limit. Real use dwells longer.
- **Heavy blur abstains rather than flagging** (the expected safe behavior). It does not prove detection under heavy blur.
- **Form joining is checked with the API, not the browser.** `/api/sessions/latest` and `/form?session=glasses` were checked live; the browser click-through was not automated.
