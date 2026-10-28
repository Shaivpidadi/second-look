# Critique batch 21: judge-read of SUBMIT.md and README.md

Read against BRIEF.md (Meta Global AI Developer Hackathon, solo
indie track): required Meta stack (Spark + SAM 3.1 via Meta Model
API, Glimmer open weights, built with Muse Code), ~100-form eval
with P/R/latency/cost for single-model vs tiered vs
check-digit-only, 3-minute demo video, must act (block, fix, log,
draft).

## Findings (fixed this batch)

1. SUBMIT.md "Meta stack" overclaims SAM 3.1. It says SAM 3.1
   "localizes and crops the document in glasses frames", but
   README.md ("What is real and what is stubbed") says direct
   `sam-3.1` is parked after empty-text replies and Spark JSON
   boxes cover the same interface. A judge running the glasses
   path gets Spark boxes, not SAM crops. Fixed: the paragraph
   now states the parked status and the fallback, matching
   README.
2. SUBMIT.md checklist "Meta stack gates all demonstrable" lists
   bare "SAM 3.1 via Meta Model API (`sam-3.1`)", implying live
   SAM. Fixed: annotated as documented-shape adapter, parked,
   Spark-box fallback covers.
3. SUBMIT.md checklist video line references only docs/DEMO.md;
   the docs/video/ package (SCRIPT.md, OVERLAYS.txt,
   captions.srt) and its number-guard coverage are
   unreferenced. Fixed: the line now names the package and the
   guard.

## Checked and clear (no fix)

- Spark real via `muse-spark-1.3`, shapes verified; Glimmer
  stubbed and labelled `(stubbed)` wherever arms appear; PII
  redaction really runs (`redactReadings` in the Glimmer tier),
  so "local first pass with PII redaction" is demonstrable in
  structure with stub verdicts.
- Eval table reports P/R/latency/cost for all three required
  arms on both splits; stubs labelled.
- "Measured results" numbers all backed: 98.8% both arms std
  (README table), 100% hard with validators at 39.4% (README
  table), 5 near-miss forms (STATUS.md), 3.4s/4.9s E2E
  (STATUS.md "Batch 11 latency", totals 3401ms/4892ms),
  $0.003/form (README), p50/p95 clip latency (STATUS.md
  batch-8 table), spend (STATUS.md per-batch lines).
- Must-act behaviors documented with paths: submit gate block,
  paper-value fix, append-only audit, POD claim draft.
- Deadline lines canonical; no secrets guidance missing;
  video-only-event-work rule present; repo-private-until-submit
  present.
- BRIEF prefers Swift for iOS but requires only a DAT glasses
  path with a recorded-clip fallback; the Android DAT client
  plus clips through the same pipeline satisfies the
  requirement, so no doc change.
