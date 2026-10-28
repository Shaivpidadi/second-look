# Shotlist (hold beside the screen)

Server: `pnpm --filter @second-look/web build`,
`pnpm --filter @second-look/web exec next start -p 3100`.
Base: http://127.0.0.1:3100. All app numbers below are fixtures
or the fixed demo seed: they do not vary between takes.

## 1. Hook: /demo

See: title card, hook text, "Start the demo". No numbers.
Backup: `docs/shots/demo-title-1920.png`.

## 2. POV: footage + overlay

Recorded AWB footage, or `clip-awb.mp4` labelled SYNTHETIC.
Overlay: `check-digit-only recall: 60.0% standard, 39.4% hard`.

## 3. AWB catch: /demo, click Start (or wait 10s)

Moment 1. See: Blocked badge, typed 87915411921,
paper/fix 87915419121, three cards (Blocked/Warn/Info).
Expect: 3.1s, 2 calls, $0.0021, muse-spark-1.3.
Overlay: "blocked in 3.4s end to end; fix correct in 11 of 13".
Backup: fixture replay is offline by default;
still `docs/shots/demo-step1-1920.png`.

## 4. Qty gap: press Right

Moment 2. See: Warn badge, invoice 363 vs packing 365,
lines 198 + 165. Expect: 3.2s, 1 call, $0.0024.
Overlay: "warned in 4.9s; 1 keyframe of 15 scanned".
Backup: `docs/shots/demo-step2-1920.png`.

## 5. Dashboard: /dashboard?session=demo

See: KPIs 40 / 7 / 10 / 2.9s / $0.14; breakdown
18 / 10 / 7 / 5; tiering 14 agree ($0) vs 22 escalated
(22 calls, 3.1s median, $0.14); top rows Blocked, Warn,
Needs human. Click the first row: drawer shows Blocked AWB,
paper 02027342210 vs typed 02027342201, 235ms + 3.8s.
Backup: `docs/shots/dashboard-overview-1440.png`,
`dashboard-drawer-1440.png`.

## 6. Claim: /demo, press Right, then dashboard Claims

Moment 3. See: Warn badge, "2 cartons damaged", claim draft
box (Harbour Line Goods, BOL-36537779, qty 2, amount TBD).
Expect: 191ms, 1 call, $0. Dashboard Claims shows 2 drafts
with `[AMOUNT TBD]`. Backup: `docs/shots/demo-step3-1920.png`,
`dashboard-claims-1440.png`.

## 7. Numbers: eval overlay (static)

| tiered-real std 100 | 98.8% | 3118ms | † |
| single-model-real hard 40 | 100% | 1849ms | $0.086 |
| vision-real hard 40 | 100% | 3086ms | $0.62 |
| check-digit-only hard 40 | 39.4% | <1ms | $0 |
† ~$0.46 both standard real arms. Say: third of a cent
text, cent and a half vision, 5 validator-blind forms.
Backup: freeze-frame the dashboard Eval view (same values).

## 8. Close: landing hero

See: headline, POV mock, strip 98.8 / 100 / 39.4 / 4.9s /
$0.003. Backup: `docs/shots/landing-1920.png`.

## Terminal replay (optional cutaway)

`pnpm --filter @second-look/eval clips:demo -- --pace 800`.
Stub is deterministic: "verdict: Blocked (AWB check digit
invalid, 0.3s)", "verdict: Warn (invoice 363 vs packing 365,
0.3s)", "claim drafted: BOL-36537779, damagedQty=2".
Live variant spends 4 calls (~$0.02); if a call hangs past
60s it aborts and retries, so hold 10s and use the stub
take if the terminal stalls.
