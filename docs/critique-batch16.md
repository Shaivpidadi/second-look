# Critique, batch 16 reshoot (16 shots)

Numbers agreement verified first, all green except finding 1:

- Overview: 40 = 18 + 10 + 7 + 5; tiering 14 + 22 + 4 = 40;
  $0.14 costs agree; chart p50 2.9s equals the KPI; top rows
  Blocked, Warn, Needs human; spark line reads 22 calls,
  3.1s median, $0.14.
- Audit, checks, drawer, claims: rows agree across views;
  drawer 235ms + 3.8s rounds to the 4.0s row.
- Eval: rows match README and DEMO.md; badge reads Oct 27-28.
- Landing strip: 98.8 / 100 / 39.4 / 4.9s E2E total / $0.003,
  badge Oct 27-28 runs; mock typed/fix/paper agree.
- Demo steps: side stats match card footers on all four
  moments (3.1s/2/$0.0021, 3.2s/1/$0.0024, 191ms/1/$0,
  177ms/1/$0); SHOTLIST quotes all of them exactly.
- Form, typo, title: unchanged and consistent.

Findings:

1. Landing hero mock strip reads "fix 87915419121 · 3.2s" but
   the /demo moment 1 it miniaturizes reports 3.1s. The mock
   should match the screen it depicts. Fix: 3.2s to 3.1s.

Nothing else worth fixing. Deliberately not touched: eval
page brevity (the table is the report), per-load clock times
differing across shots (relative timestamps by design),
truncation with hover titles, audit-trail log casing.
