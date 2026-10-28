# Second Look — Build Plan (Oct 27–Nov 4)

## Goal
Ship a hackathon entry where glasses watch PAPER, a screen reader watches TYPED values, and the system ACTS: catches mismatches live, blocks submit, proposes fixes, logs audit trail, drafts damage claims. Deadline Nov 4, 9pm ET (event page); internal target finish by Nov 3, 9pm ET.

## Success Criteria
- Live loop works on mock form: type wrong AWB digit or short count → blocked submit + fix proposal in <5s on fallback-clip path.
- All 4 BRIEF checks run: field match, check digits (AWB mod-7, ISO 6346, SSCC/GS1 mod-10) before any model call, cross-doc, handwritten-exception → claim draft.
- Tiered pipeline demonstrated: Glimmer local pass + redact → Spark only on disagreement; SAM 3.1 crops glasses frames.
- Eval: ~100 synthetic forms, precision/recall/latency/cost per form for 3 arms (check-digit-only, single-model, tiered).
- 3-min video: Revlon-wire hook → dock scene (swapped AWB digit + POD short count → block + fix + claim draft) → eval numbers.
- Constraints: new code only, commits by Shaishav Pidadi only, repo private until submit, keys in gitignored `.env`.

## Approach
Pipeline-first, fallback-first: recorded POV clips and mock form drive the same code path as live glasses, so demo never depends on hardware. Deterministic validators run before any model call. Local Glimmer pass runs before any cloud call.

### Architecture (text diagram)
```
[Ray-Ban Gen1] --2-7fps 720x1280--> [iOS DAT app (CameraAccess fork)]
        |                                     | frames (live or Mock Device Kit)
        |                                     v
        |                            [Backend ingest] <-- [POV clip fallback (*.mp4)]
        |                                     |
        |                                     v
        |                              [SAM 3.1 crop] --crops--> [doc/field images]
        |                                     |
[Mock warehouse form] --typed values--> [Screen reader (form events, NOT via glasses)]
        |                                     |
        v                                     v
[Submit gate: BLOCK/ALLOW] <-- [Verdict] <-- [Check digits FIRST] <-- [Glimmer local pass + PII redact]
                                      ^              (AWB mod-7, ISO6346, GS1 mod-10)
                                      |
                               [Spark escalation (disagreements only)]
                                      |
                    +--------+--------+--------+--------+
                    v        v        v        v        v
                 [Fix]  [Audit log] [Claim] [Dashboard] [Eval harness]
                 propose append-only  draft   Next.js     100 forms x 3 arms
```

### Repo layout
```
second-look/
  BRIEF.md PLAN.md README.md .env.example .gitignore
  apps/
    ios/                 # Swift, fork of CameraAccess; live + mock + clip-upload modes
    web/                 # Next.js: /form (mock warehouse form) + /dashboard (verdicts, audit)
  packages/
    validators/          # awb.ts, iso6346.ts, gs1.ts + unit tests; zero deps
    pipeline/            # sam.ts, glimmer.ts, spark.ts, verdict.ts, audit.ts, claim.ts
  eval/
    generator/           # synthetic BOL/AWB/invoice/packing/POD/label + error injector
    corpus/              # generated JSON + PNGs (gitignored if large)
    runner.ts report.ts  # 3 arms, metrics: P/R/latency/cost
  clips/                 # POV fallback .mp4 + stills (gitignored or LFS)
```

### Components
- iOS DAT glasses app (Swift): fork `facebook/meta-wearables-dat-ios` CameraAccess. Modes: live glasses, Mock Device Kit (phone camera), clip upload. Sends 2–7fps JPEGs + timestamps to backend. No on-device ML.
- Backend (Next.js API routes or small TS server): owns ingest, ordering, verdict state machine per form session: `clean | mismatch | blocked`. Exposes WS/SSE to form for block/fix UX.
- Mock warehouse web form + screen reader: `/form` with fields mirroring BOL/AWB/POD; on-change/keystroke events POST typed values with field ids + timestamps. Screen reader = DOM events, never OCR of monitor.
- Check-digit validators (TS, no deps): AWB mod-7, ISO 6346 container, SSCC/GS1 mod-10. Run before any model call; fail = instant block with cited rule.
- Glimmer local pass (~30B open weights, Mac Studio or cloud GPU): per-field match/flag on (crop, typed) + PII redaction of payload before cloud. Output: `agree | disagree + reason`.
- Spark escalation: only on Glimmer disagree, validator fail needing explanation, cross-doc conflict, or handwriting. Reads crops, explains mismatch, proposes fix.
- SAM 3.1 cropping: `sam-3.1` via Responses API. One noun-phrase concept per request (`"shipping document"`, `"address label"`). Input: stills or short MP4 clips only. Output masks/boxes → crops fed to Glimmer/Spark. No live video input.
- Audit log: append-only JSONL per session (ts, field, paper value, typed value, rule/model verdict, action). Rendered in dashboard; export for video.
- Claim drafter: triggered by handwritten POD exception. Spark drafts claim (carrier, BOL/AWB refs, damaged qty, amount placeholder) into dashboard + copy button.
- Eval harness: runner executes 3 arms over corpus, records per-form verdict vs ground truth, latency, est. cost. Report table + charts for video close.
- Synthetic doc generator: script emitting ~100 PNG/JSON pairs across 6 doc types with seeded errors (transposition, dropped digit, swapped fields, short count, handwritten exception). No real PII.

## Steps (day-by-day, evenings + weekend)
- Tue Oct 27 evening (2h, tonight): scaffold repo + `.env.example`; spike 1–3 (Spark hello, SAM hello, DAT Mock build). Freeze API ids.
- Wed Oct 28 (2–3h): validators + unit tests; generator v1 (BOL/AWB/POD PNGs); mock form v1 with typed-event stream.
- Thu Oct 29 (2–3h): SAM crop service + 2 POV fallback clips through same path; submit-gate block/fix UX wired to stub verdict.
- Fri Oct 30 (2–3h): Glimmer local pass + redaction; verdict state machine (validators → Glimmer → Spark); audit log JSONL + dashboard view.
- Sat Oct 31 (6–8h): full tiered loop live; cross-doc checks; claim drafter v1; real-glasses pass if paired; fix latency to <5s fallback path.
- Sun Nov 1 (6–8h): generator to 100 forms; eval runner + 3-arm report; bugfix from eval; record backup demo clips.
- Mon Nov 2 (2–3h): FEATURE FREEZE. Real-glasses retest or lock fallback; README; audit export; dry-run demo script.
- Tue Nov 3 (2–3h): shoot + edit 3-min video; overlay eval numbers; captions; private upload check.
- Tue Nov 3 evening (finish by 9pm ET): final submit checklist (video, repo link/zip, description); keep private until submitted; submit. Wed Nov 4 is buffer; hard deadline Nov 4, 9pm ET (event page).

## Validation Plan
- Validators: unit tests incl. known-good AWB/container/SSCC numbers + transposition/dropped-digit negatives.
- E2E per check: (1) swapped AWB digit → block + fix; (2) bad check digit with models off → still blocks; (3) invoice-vs-packing qty gap → flag; (4) "2 cartons damaged" on POD → claim draft. Each run on fallback clip, no glasses needed.
- Tiering proof: dashboard shows Glimmer agree (no Spark call, $0) vs disagree (Spark call logged with latency/cost).
- Eval: 100 forms × 3 arms; report precision/recall/latency/cost per form; video uses these numbers.
- Highest-risk validation: Thu SAM crop on real POV frames (if boxes are garbage, pivot to full-frame + Spark grounding, keep SAM for doc localization only).

## Risks / Open Questions
Top 5 risks, each with a ≤30-min spike:
1. DAT live glasses path fails (firmware/app/SDK mismatch). Spike: build CameraAccess, run Mock Device Kit, then pair Gen 1 and stream 30s. Fallback already primary: clips use same pipeline.
2. SAM 3.1 API shape/quota/cost differs from BRIEF. Spike: POST one still + one 5s MP4 with concept `"shipping document"`; log output schema, latency, price. Pivot: full-frame to Glimmer/Spark if masks unusable.
3. Glimmer 30B too slow/large on Mac Studio. Spike: load runner (ollama/llama.cpp/vLLM), time 5 match/flag prompts on real crops. Pivot: cloud GPU for Glimmer, or smaller local model for redact + flag with Spark deciding.
4. Spark vision accuracy/cost on synthetic docs. Spike: 10 crops × 2 prompts; score field-read accuracy, measure $/form. Pivot: tighter crops, constrained JSON output, fewer escalations.
5. Form↔verdict sync flaky (race between typing and verdict). Spike: keystroke-event test with artificial 2s verdict delay; assert exactly one block + one fix render. Fix: per-field debounce + session sequence numbers.
- Open questions: none blocking; all API ids below are verify-tonight items.

## Meta API endpoints + model ids to verify (tonight)
- Base `https://api.meta.ai/v1`, auth `Authorization: Bearer $MODEL_API_KEY`. BRIEF says `META_API_KEY`; verify which env name docs use — support both, prefer `MODEL_API_KEY`.
- `POST /v1/responses` (Responses API, Meta-recommended): models `muse-spark-1.3` (latest per provider docs), `muse-spark-1.1` (fallback), `sam-3.1` (segmentation). Verify Spark vision input blocks + `max_output_tokens` cap name.
- `POST /v1/chat/completions` (OpenAI-compat): same Spark ids; cap is `max_completion_tokens` (`max_tokens` deprecated alias). Verify before using.
- `POST /v1/messages` (Anthropic-compat): same Spark ids. Only if needed.
- SAM 3.1 specifics to verify: model id `sam-3.1`; one noun-phrase concept/request; stills + short MP4/MOV (H.264/H.265/MPEG-4); no live video; mask/box schema; frame + object limits; pricing. Expect `404 model_not_found` if key lacks access.
- Baseten alt: model `meta-models/muse-spark-open-1026`. Verify endpoint + key only if Meta direct fails.
- Glimmer: verify exact open-weights repo id + 30B runner on this Mac Studio (RAM/VRAM, tok/s).
- DAT: docs `https://wearables.developer.meta.com/docs/develop/dat/`; repo `facebook/meta-wearables-dat-ios` (CameraAccess sample, Mock Device Kit, AGENTS.md); reqs iOS 17.2+, Xcode 26.4+.

## Human must do by hand
- DAT developer mode: Meta AI app → Settings → App Info → tap App version 5× → enable Developer Mode; pair Gen 1 glasses; check version-dependencies page; unpublished app appears under Meta AI settings → App connections → Developer mode apps.
- Xcode signing: Apple ID + team, provisioning for physical iPhone, camera/LAN permissions; human plugs phone + taps trust prompts.
- API keys in `.env` (never in code): `MODEL_API_KEY` (and `META_API_KEY` alias), optional Baseten key; verify with one curl each. `.env` stays gitignored.
- Repo hygiene: confirm `git config user.name/email` = Shaishav Pidadi; no AI trailers; repo private until submission day.
- Human-only media: record POV fallback clips + dock-scene demo; review + submit video and entry form.

## Sources
- https://wearables.developer.meta.com/docs/develop/dat/
- https://www.promptfoo.dev/docs/providers/meta/
- https://github.com/facebook/meta-wearables-dat-ios/blob/main/AGENTS.md
- https://ai.meta.com/blog/segment-anything-model-3/
- https://learnopencv.com/sam-3-whats-new/

## Batch log
- [x] Batch 8 (Oct 27): single-keyframe fast path (text verdict concurrent
  with crop, image-grounded refinement; first verdicts 2.7-4.5s p50 vs
  <5s over 3 real runs, one 284s API stall noted), `vision-real` arm on
  the hard split (100.0%/100.0% on 40 forms, needs-human abstention
  wired, 0 observed), and demo prep (`docs/DEMO.md` 3-minute script +
  `clips:demo` one-command replay, verified offline). 81/150 calls.
  See STATUS.md for the p50/p95 box and spend.
- [x] Batch 12 (Oct 28): reshoot committed, 15-shot critique fixed
  (one run-stats selector + agreement test, "<1ms" everywhere
  incl. the eval report, first-8 status mix, one Pass/Warn/Blocked/
  Needs-human vocabulary), audit JSONL+CSV export, tiering-proof
  card (selectTierStats; demo 14 local / 22 escalated / 4
  validators-only), `docs/SUBMIT.md` checklist + write-up, offline
  eval rerun identical to README. 0 calls. Screens changed:
  reshoot needed.
- [x] Batch 13 (Oct 28): reshoot committed, 15-shot critique in
  docs/critique-batch13.md with all 8 findings fixed (top-row
  severity order, chart sub-ms caption, landing mock numbers,
  chip/label vocabulary, trail wrap, cell titles), per-attempt API
  timeout with retry (closes the 284s-stall follow-up, tested
  offline), offline eval rerun identical. 0 calls. Screens
  changed: reshoot needed.
- [x] Batch 14 (Oct 28): reshoot committed, 15-shot critique in
  docs/critique-batch14.md with all 4 findings fixed (SSCC pool,
  audit shot, run instructions, .mts rename kills the module
  warning), same-call vision confidence gate measured on hard 40
  (100/100, 0 abstentions: kept, judge-always documented),
  sub-5s totals re-confirmed on stub and real clip E2E, DEMO.md
  dry-run corrections, SUBMIT.md final copy. 58/150 calls.
  Screens changed: reshoot needed.
- [x] Batch 15 (Oct 28): reshoot committed, 16-shot critique in
  docs/critique-batch15.md with all 3 findings fixed (Oct 27-28
  badges, strip E2E-total cell), headline number guard across
  four docs (35 assertions, no drift), Next steps rewritten,
  docs/SHOTLIST.md with dry-run numbers, a11y pass (contrast,
  drawer Escape/labels). 0 calls. Screens changed:
  reshoot needed.
- [x] Batch 16 (Oct 28): reshoot committed, 16-shot critique in
  docs/critique-batch16.md with the one finding fixed (mock
  3.1s), number guard extended to UI values + SHOTLIST (caught
  a real gap), drawer focus trap with tests, `pnpm
  check:submit` gate (clean), README quickstart. Step 7
  skipped with measured reasoning. 0 calls. Screens changed:
  reshoot needed.
- [x] Batch 17 (Oct 28): reshoot committed, `.vercelignore`
  excludes apps/android, DAT AGENTS.md + docs read into
  docs/ANDROID-NOTES.md, apps/android scaffolded (core JVM
  module + Compose app), register/permission/session/stream/
  verdict/mock/UI implemented, 13 core unit tests,
  `:core:test` green, debug + release APKs assemble,
  docs/ANDROID.md written. 0 calls. Screens unchanged: no
  new reshoot.
- [x] Batch 21 (Oct 28): judge output tightened (p90 3.2s
  to 2.8s, P/R 1.0/1.0, 36 calls), one-tap phone fallback,
  docs/video/ package under the number guard, SUBMIT
  judge-read fixes. 36 calls. Screens unchanged: no reshoot.
- [x] Batch 20 (Oct 28): deadline Nov 4 9pm ET + guard, POST
  verdicts + client memory, Android failure states, Check setup
  + demo:preflight/demo:lan, two-instance proof 4 calls, docs.
  4 calls. Screens unchanged: no new reshoot.
- [x] Batch 19 (Oct 28): session document memory with
  cross-doc verdicts, frame P50 7.6s to 3.6s (parallel
  boxes/judge, 1400px cap, hash-skip, ink dedupe),
  frame-subset P/R 1.0/1.0 before and after (768
  rejected on a hyphen misread), spoken verdicts with
  debounce + settings, walk-through proof 4 calls,
  Vercel route pinned (nodejs, 60s, size-tested).
  48 calls. Screens unchanged: no new reshoot.
- [x] Batch 18 (Oct 28): server judges frame.pov data URLs
  (validate, dedupe, throttle with visible throttled state,
  Spark boxes + judge on the SSE stream), dependency-free
  JPEG codec verified against sips files, live proof 4
  calls (clean 6.6s, mismatch 7.6s with exact paper fix),
  :core YUV detection + data URLs, CameraX phone fallback
  with source/fps/chroma toggles, debug LAN cleartext
  (release HTTPS-only), docs/ANDROID.md with Shaishav
  checklist. 4 calls. Screens unchanged: no new reshoot.
