# Submit checklist and entry write-up

Hackathon: Meta Global AI Developer Hackathon, solo indie track.
Hard deadline: Wed Nov 4, 2026, 9:00 PM ET. Target: submit before 6:00 PM ET.

## Checklist

- [ ] Entry form filled: title, tagline, and description below, track (solo indie).
- [ ] Repo link or zip attached. Repo stays private until this step is done.
- [ ] 3-minute demo video uploaded and linked (primary judging artifact).
      Script and shot list: `docs/DEMO.md`. Human records and reviews.
- [ ] Video shows only work built during the event (Oct 27 to Nov 4).
- [ ] Every number in the video and description matches README/STATUS
      (table in README "Eval" section; detail in STATUS.md).
- [ ] Stub arms still labelled `(stubbed)` wherever they appear.
- [ ] Commits authored only by the local git identity (Shaishav Pidadi);
      no co-author, Generated-by, or AI trailers in commits, code, or docs.
- [ ] No secrets in the repo: `.env` gitignored, no keys, no raw API
      responses that could contain the key. Verify with
      `git log -p -- .env` (empty) and a grep for the key prefix.
- [ ] Meta stack gates all demonstrable:
      Muse Spark via Meta Model API (`muse-spark-1.3`),
      SAM 3.1 via Meta Model API (`sam-3.1`),
      Muse Glimmer local first pass with PII redaction,
      built with Muse Code.
- [ ] Tests and build green on the submit commit:
      `pnpm -r test`, `pnpm -r typecheck`,
      `pnpm --filter @second-look/web build`.
- [ ] After submitting, open the public entry page and confirm the
      video plays and the repo link resolves.

Human-only before submit: record the receiving-dock clips (script in
`docs/DEMO.md`), review the cut, fill and file the entry form. Real
glasses pairing is not required for submit; the recorded POV clips
run through the same pipeline as live frames.

## Entry write-up

Title: Second Look, the co-signer that actually reads the paperwork

Tagline: Glasses watch the paper, the screen reader watches the
typing, and the system blocks the submit before a typo ships.

Problem: in 2020 Citibank wired about $900M to Revlon lenders by
mistake after three people signed off. Paper-heavy receiving desks
still run on the same hope: that a tired human catches the swapped
digit, the short count, the damaged carton. Second Look is the
co-signer that reads every line, every time.

What it does: a warehouse worker types bill-of-lading, air-waybill,
invoice, packing-list, POD, and pallet-label values into a mock
receiving form. Second Look watches the paper through camera frames
and reads the typed values digitally. Deterministic check digits
(AWB mod-7, ISO 6346 container, SSCC mod-10) run before any model
call. Then a tiered pipeline, a local pass with PII redaction and
Spark only on disagreement, catches field mismatches,
cross-document gaps, and handwritten exceptions. It acts: it blocks
the submit gate, proposes the paper value as the fix, logs every
decision to an append-only audit trail, and drafts a damage claim
from the POD note.

Meta stack: Muse Spark (`muse-spark-1.3`) reads and reasons over the
documents, explains mismatches, and proposes fixes. SAM 3.1
(`sam-3.1`) localizes and crops the document in glasses frames.
The Glimmer tier (open weights, local first pass with PII
redaction) runs stubbed until weights land, which targets the
open-weight bonus. Claim drafts use a deterministic template. Built
with Muse Code. Glasses input follows the Wearables Device Access
Toolkit path with recorded POV clips running through the same
pipeline.

Measured results: 98.8% recall on the 100-form standard split for
both the single-model and tiered arms; 100% recall on the 40-form
hard split, where validators alone fall to 39.4%. The vision arm
reads paper pixels directly and holds 100%, including 5 near-miss
forms no text signal can catch. End-to-end checks land under 5
seconds live (3.4s block with fix, 4.9s warn with escalation);
tiered text checks cost about $0.003 per form. Full tables are in
the repo README, with shapes, p50/p95 latency, and spend in
STATUS.md.
