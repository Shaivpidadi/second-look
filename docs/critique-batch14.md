# Critique, batch 14 reshoot (15 shots)

Numbers agreement verified first, all green:

- Overview: 40 = 18 + 10 + 7 + 5; tiering 14 + 22 + 4 = 40;
  Model cost $0.14 equals tiering $0.14; chart p50 2.9s equals
  the KPI; top rows are Blocked, Warn, Needs human.
- Drawer: 235ms + 3.8s rounds to the 4.0s row; paper 02027342210
  vs typed 02027342201; "blocked (AWB check digit)".
- Eval, landing strip, demo steps, form, claims, title: every
  figure matches README, DEMO.md, and STATUS.md as in batch 13.
- Landing mock: typed 87915411921 is a transposition of paper
  87915419121, and the strip proposes the paper value.

Findings:

1. The SSCC 106141410000004412 repeats three times in the checks
   table (pool has only 3 values). Enlarge the demo SSCC pool so
   visible rows read as distinct shipments.
2. There is no audit-log screenshot, so the batch-12 JSONL/CSV
   export buttons have never been visually verified. Add a
   dashboard-audit shot to the shots script (next reshoot
   covers it).
3. shots.ts header documents a broken server command
   (`start -- -p 3100` fails with "Invalid project directory").
   The working form is `pnpm --filter @second-look/web exec
   next start -p 3100`; DEMO.md uses yet another form
   (`start --port 3100`). Unify on the working form.
4. Running shots.ts prints MODULE_TYPELESS_PACKAGE_JSON because
   apps/web has no "type" field. Rename to shots.mts (explicit
   module) and keep it typechecked; do not add "type": "module"
   to the Next app package.

Accepted as is: truncated table cells keep standard ellipsis now
that hover titles carry the full value; audit-trail lowercase is
the deliberate log style with vocabulary words ("warned",
"blocked"); the eval page stays short.
