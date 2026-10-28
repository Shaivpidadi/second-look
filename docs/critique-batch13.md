# Critique, batch 13 reshoot (15 shots)

Numbers agreement verified first, all green:

- Overview: 40 = 18 + 10 + 7 + 5 across KPIs and breakdown;
  tiering 14 + 22 + footnote 4 = 40; Model cost $0.14 equals the
  tiering $0.14; chart p50 2.9s equals the KPI.
- Drawer: 267ms + 2.9s rounds to the 3.2s row; invoice 388 vs
  packing 390 matches the cross-doc Warn and the "388 pcs" row.
- Demo steps: card latencies sum to the side stats (3.1s, 3.2s,
  191ms, 177ms); call counts (2, 1, 1, 1) and costs ($0.0021,
  $0.0024, $0, $0) match the cards; step-2 lines 198 + 165 = 363.
- Eval view matches README and DEMO.md cell for cell
  (1849/$0.086, 4438/$0.128, 2857/$0.61, 3118/†, <1ms).
- Landing strip matches STATUS (98.8%, 100%, 39.4%, 3.2s first
  verdict, $0.003 text, $0.015 vision).
- Form-typo: typed value, fix proposal, error text, Blocked badge,
  and the 1-event counter all agree.

Findings (fix every one):

1. Recent checks top rows are Warn, Pass, Pass, Needs human: no
   Blocked row on the first screen. Seed or order so Blocked,
   Warn, and Needs human all appear before any Pass, keeping
   timestamps newest-first and the one-source counts intact.
2. The latency chart is full of near-zero green bars with no
   explanation. Label them as validator-only sub-ms checks
   (legend or tooltip) using the "<1ms" wording.
3. Landing POV mock: the paper AWB in the crop box (87915419121)
   matches neither the typed value (14779271345) nor the fix in
   the strip (17479271345). Paper must equal the proposed fix.
4. Landing POV crop labels mix casing: "AWB" vs "origin".
5. Demo verdict-card chips read "block" / "warn" / "pass" /
   "info" in lowercase while every badge elsewhere reads Block /
   Warn / Pass. Capitalize the status chips.
6. Audit-trail action labels still say "flagged: documents
   disagree", "flagged: handwriting", and lowercase "blocked
   (check digit)". Status-carrying labels must use the Warn /
   Blocked vocabulary (dashboard audit column and drawer trail
   share these labels).
7. Drawer audit-trail lines truncate mid-word ("disagr...").
   Wrap instead of truncating.
8. Checks-table reference cells truncate mid-word with no way to
   see the full value. Keep the truncation, add the full value
   as a hover title.

Accepted as is: the eval page is short because the table is the
whole report; "flagged" survives only as the eval-report count
column header, which mirrors runner output; cause-prose keeps
"mismatch" where it names the defect, not the status.
