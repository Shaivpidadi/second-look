# Critique, batch 15 reshoot (16 shots)

Numbers agreement verified first, all green:

- Overview: 40 = 18 + 10 + 7 + 5; tiering 14 + 22 + 4 = 40;
  $0.14 costs agree; chart p50 2.9s equals the KPI; top rows
  Blocked, Warn, Needs human.
- Audit view (new shot): rows match the checks view verdict by
  verdict (Blocked AWB, invoice 388 / packing 390 Warn pair,
  SSCC Needs human, passes); export buttons render; actions use
  the vocabulary. Clock times differ by seconds from the checks
  shot because each page load regenerates relative timestamps:
  expected, not drift.
- Drawer: 235ms + 3.8s rounds to the 4.0s row; paper/typed gap
  shown; trail wraps.
- Eval: vision row reads 3086ms / $0.62, matching README and
  DEMO.md. SSCCs vary down the checks table.
- Landing mock, strip figures, form, claims, and all four demo
  steps agree with batch-14 sources.

Findings:

1. Eval badge "Measured Oct 27" is stale: the vision row was
   re-measured Oct 28 (batch 14). All other rows are Oct 27
   (batches 6-8). Fix: "Measured Oct 27-28".
2. Landing "Oct 27 run" badge is stale for the same reason.
   Fix: "Oct 27-28 runs".
3. Landing strip "First verdict p50 · qty-gap 3.2s" is a batch-8
   figure under a retired definition (the current path streams a
   local preliminary near 0.2s, then refines to under-5s totals).
   The recorded headline is now totals: replace with "E2E total
   · qty-gap 4.9s, live, under 5s" (batch-11 instance, matches
   README and DEMO.md).

Accepted as is: landing-1920 changed bytes but renders
identically (font raster noise); eval page stays short;
truncation keeps hover titles; per-load clock times differ
across shots.
