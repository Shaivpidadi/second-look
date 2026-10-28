/**
 * Single source of truth for the headline numbers quoted across
 * README.md, docs/DEMO.md, docs/SUBMIT.md, STATUS.md, and the
 * docs/video/ package (SCRIPT.md, OVERLAYS.txt, captions.srt). Each
 * entry lists the exact rendering every doc must contain (rounding
 * variants allowed where noted). When a measurement changes, update
 * the docs and this table together; eval/test/numbers.test.ts fails
 * on drift.
 */

export interface HeadlineQuote {
  /** Docs that quote this number, with the exact expected rendering. */
  quotes: Array<{ file: string; text: string }>;
  /** Where the number was measured. */
  source: string;
}

export const HEADLINES: HeadlineQuote[] = [
  {
    source: "forms eval, std 100 + hard 40 corpora",
    quotes: [
      { file: "README.md", text: "| check-digit-only | std 100 | 48 | 100.0% | 60.0%" },
      { file: "docs/DEMO.md", text: "100-form standard corpus, 40-form hard corpus" },
      { file: "docs/SUBMIT.md", text: "100-form standard split" },
      { file: "docs/SUBMIT.md", text: "40-form hard split" },
      { file: "docs/video/SCRIPT.md", text: "100-form standard corpus, 40-form hard corpus" },
      { file: "docs/video/OVERLAYS.txt", text: "100-form standard corpus, 40-form hard corpus" },
    ],
  },
  {
    source: "forms eval, tiered-real std 100",
    quotes: [
      {
        file: "README.md",
        text: "| tiered-real | std 100 | 79 | 100.0% | 98.8% | 3117.7ms | † |",
      },
      {
        file: "docs/DEMO.md",
        text: "| tiered-real | std 100 | 100.0% | 98.8% | 3118ms | † |",
      },
      { file: "docs/SUBMIT.md", text: "98.8% recall on the 100-form standard split" },
      {
        file: "docs/video/SCRIPT.md",
        text: "| tiered-real | std 100 | 100.0% | 98.8% | 3118ms | † |",
      },
      {
        file: "docs/video/OVERLAYS.txt",
        text: "| tiered-real | std 100 | 100.0% | 98.8% | 3118ms | † |",
      },
      { file: "docs/video/SCRIPT.md", text: "holds 98.8 to 100% recall" },
      { file: "docs/video/captions.srt", text: "holds 98.8 to 100% recall" },
    ],
  },
  {
    source: "forms eval, check-digit-only hard 40",
    quotes: [
      {
        file: "README.md",
        text: "| check-digit-only | hard 40 | 13 | 100.0% | 39.4% | <1ms | $0.0000 |",
      },
      { file: "docs/DEMO.md", text: "check-digit-only recall: 60.0% standard, 39.4% hard" },
      { file: "docs/SUBMIT.md", text: "validators alone fall to 39.4%" },
      {
        file: "docs/video/SCRIPT.md",
        text: "check-digit-only recall: 60.0% standard, 39.4% hard",
      },
      {
        file: "docs/video/OVERLAYS.txt",
        text: "check-digit-only recall: 60.0% standard, 39.4% hard",
      },
    ],
  },
  {
    source: "forms eval, diff-aware arms hard 40",
    quotes: [
      {
        file: "README.md",
        text: "| single-model-real | hard 40 | 33 | 100.0% | 100.0% | 1848.5ms | $0.0855 |",
      },
      {
        file: "docs/DEMO.md",
        text: "| single-model-real | hard 40 | 100.0% | 100.0% | 1849ms | $0.086 |",
      },
      { file: "docs/SUBMIT.md", text: "100% recall on the 40-form hard split" },
      {
        file: "docs/video/SCRIPT.md",
        text: "| single-model-real | hard 40 | 100.0% | 100.0% | 1849ms | $0.086 |",
      },
      {
        file: "docs/video/OVERLAYS.txt",
        text: "| single-model-real | hard 40 | 100.0% | 100.0% | 1849ms | $0.086 |",
      },
    ],
  },
  {
    source: "forms eval, vision-real hard 40 (batch 14, gated prompt)",
    quotes: [
      {
        file: "README.md",
        text: "| vision-real | hard 40 | 33 | 100.0% | 100.0% | 3085.7ms | $0.6169 |",
      },
      {
        file: "docs/DEMO.md",
        text: "| vision-real | hard 40 | 100.0% | 100.0% | 3086ms | $0.62 |",
      },
      { file: "STATUS.md", text: "full hard 40 at 100.0%/100.0% (3085.7ms, $0.6169)" },
      {
        file: "docs/video/SCRIPT.md",
        text: "| vision-real | hard 40 | 100.0% | 100.0% | 3086ms | $0.62 |",
      },
      {
        file: "docs/video/OVERLAYS.txt",
        text: "| vision-real | hard 40 | 100.0% | 100.0% | 3086ms | $0.62 |",
      },
    ],
  },
  {
    source: "clip E2E totals, batch 11 instances (README pins these)",
    quotes: [
      { file: "README.md", text: "(3.4s block with fix, 4.9s warn with escalation)" },
      { file: "docs/DEMO.md", text: "blocked in 3.4s end to end (measured live)" },
      { file: "docs/DEMO.md", text: "warned in 4.9s end to end (measured live)" },
      { file: "docs/SUBMIT.md", text: "(3.4s block with fix, 4.9s warn with escalation)" },
      { file: "STATUS.md", text: "total 4892ms (fast 245ms)" },
      { file: "STATUS.md", text: "total 3401ms" },
      { file: "docs/video/SCRIPT.md", text: "blocked in 3.4s end to end (measured live)" },
      { file: "docs/video/OVERLAYS.txt", text: "blocked in 3.4s end to end (measured live)" },
      { file: "docs/video/SCRIPT.md", text: "warned in 4.9s end to end (measured live)" },
      { file: "docs/video/OVERLAYS.txt", text: "warned in 4.9s end to end (measured live)" },
    ],
  },
  {
    source: "clip E2E AWB fix observations, batches 8/11/14",
    quotes: [
      { file: "docs/DEMO.md", text: "fix correct in 11 of 13 live runs" },
      { file: "STATUS.md", text: "now 11 of 13 live runs" },
      { file: "docs/video/SCRIPT.md", text: "fix correct in 11 of 13 live runs" },
      { file: "docs/video/OVERLAYS.txt", text: "fix correct in 11 of 13 live runs" },
    ],
  },
  {
    source: "priced token totals (std upper bound, vision exact)",
    quotes: [
      { file: "README.md", text: "roughly $0.003 per text form" },
      { file: "docs/DEMO.md", text: "a third of a cent per form for text" },
      { file: "docs/SUBMIT.md", text: "tiered text checks cost about $0.003 per form" },
      { file: "README.md", text: "~$0.46 combined upper bound for both standard real arms" },
      { file: "docs/DEMO.md", text: "~$0.46 combined upper bound for both standard real arms" },
      { file: "docs/DEMO.md", text: "a cent and a half with full vision" },
      { file: "STATUS.md", text: "~$0.015/form" },
      { file: "docs/video/SCRIPT.md", text: "a third of a cent per form for text" },
      { file: "docs/video/SCRIPT.md", text: "a cent and a half with full vision" },
      {
        file: "docs/video/SCRIPT.md",
        text: "~$0.46 combined upper bound for both standard real arms",
      },
      {
        file: "docs/video/OVERLAYS.txt",
        text: "~$0.46 combined upper bound for both standard real arms",
      },
      { file: "docs/video/captions.srt", text: "a third of a cent per form for text" },
    ],
  },
  {
    source: "dashboard demo dataset (one-selector agreement test)",
    quotes: [
      { file: "STATUS.md", text: "40 = 18 + 10 + 7 + 5" },
      { file: "STATUS.md", text: "14 local, 22 escalated, 4 validators-only" },
      { file: "apps/web/lib/dashboard-stats.test.ts", text: "assert.equal(stats.total, 40)" },
      { file: "apps/web/lib/dashboard-stats.test.ts", text: "assert.equal(stats.pass, 18)" },
      { file: "apps/web/lib/dashboard-stats.test.ts", text: "assert.equal(stats.warn, 10)" },
      { file: "apps/web/lib/dashboard-stats.test.ts", text: "assert.equal(stats.blocked, 7)" },
      { file: "apps/web/lib/dashboard-stats.test.ts", text: "assert.equal(stats.needsHuman, 5)" },
      { file: "apps/web/lib/dashboard-stats.test.ts", text: "assert.equal(tiers.local, 14)" },
      { file: "apps/web/lib/dashboard-stats.test.ts", text: "assert.equal(tiers.escalated, 22)" },
      {
        file: "apps/web/lib/dashboard-stats.test.ts",
        text: "assert.equal(tiers.validatorsOnly, 4)",
      },
      { file: "apps/web/lib/dashboard-stats.test.ts", text: "assert.equal(tiers.sparkCalls, 22)" },
      { file: "docs/SHOTLIST.md", text: "KPIs 40 / 7 / 10 / 2.9s / $0.14" },
      { file: "docs/SHOTLIST.md", text: "breakdown 18 / 10 / 7 / 5" },
      { file: "docs/SHOTLIST.md", text: "tiering 14 agree ($0) vs 22 escalated" },
      { file: "docs/SHOTLIST.md", text: "(22 calls, 3.1s median, $0.14)" },
      { file: "docs/SHOTLIST.md", text: "235ms + 3.8s" },
    ],
  },
  {
    source: "dashboard eval view (rounded from README)",
    quotes: [
      {
        file: "apps/web/app/dashboard/page.tsx",
        text: '{ arm: "check-digit-only", split: "hard 40", precision: "100.0%", recall: "39.4%", latency: "<1ms", cost: "$0" }',
      },
      {
        file: "apps/web/app/dashboard/page.tsx",
        text: '{ arm: "single-model-real", split: "hard 40", precision: "100.0%", recall: "100.0%", latency: "1849ms", cost: "$0.086" }',
      },
      {
        file: "apps/web/app/dashboard/page.tsx",
        text: '{ arm: "tiered-real", split: "hard 40", precision: "100.0%", recall: "100.0%", latency: "4438ms", cost: "$0.128" }',
      },
      {
        file: "apps/web/app/dashboard/page.tsx",
        text: '{ arm: "vision-real", split: "hard 40", precision: "100.0%", recall: "100.0%", latency: "3086ms", cost: "$0.62" }',
      },
      {
        file: "apps/web/app/dashboard/page.tsx",
        text: '{ arm: "tiered-real", split: "std 100", precision: "100.0%", recall: "98.8%", latency: "3118ms", cost: "†" }',
      },
      { file: "docs/SHOTLIST.md", text: "| tiered-real std 100 | 98.8% | 3118ms | † |" },
      { file: "docs/SHOTLIST.md", text: "| vision-real hard 40 | 100% | 3086ms | $0.62 |" },
    ],
  },
  {
    source: "/demo fixture cards (side stats sum these)",
    quotes: [
      { file: "apps/web/components/demo/fixtures.ts", text: "latencyMs: 212" },
      { file: "apps/web/components/demo/fixtures.ts", text: "latencyMs: 2840" },
      { file: "apps/web/components/demo/fixtures.ts", text: "costUsd: 0.0021" },
      { file: "apps/web/components/demo/fixtures.ts", text: "latencyMs: 3210" },
      { file: "apps/web/components/demo/fixtures.ts", text: "costUsd: 0.0024" },
      { file: "apps/web/components/demo/fixtures.ts", text: "latencyMs: 188" },
      { file: "apps/web/components/demo/fixtures.ts", text: "latencyMs: 176" },
      { file: "docs/SHOTLIST.md", text: "Expect: 3.1s, 2 calls, $0.0021" },
      { file: "docs/SHOTLIST.md", text: "Expect: 3.2s, 1 call, $0.0024" },
      { file: "docs/SHOTLIST.md", text: "Expect: 191ms, 1 call, $0" },
      { file: "docs/SHOTLIST.md", text: "Expect: 177ms, 1 call, $0" },
      { file: "docs/SHOTLIST.md", text: "invoice 363 vs packing 365" },
      { file: "docs/SHOTLIST.md", text: "lines 198 + 165" },
    ],
  },
  {
    source: "stub clip replay beats + live replay cost",
    quotes: [
      {
        file: "docs/SHOTLIST.md",
        text: "verdict: Blocked (AWB check digit invalid, 0.3s)",
      },
      {
        file: "docs/SHOTLIST.md",
        text: "verdict: Warn (invoice 363 vs packing 365, 0.3s)",
      },
      { file: "docs/SHOTLIST.md", text: "claim drafted: BOL-36537779, damagedQty=2" },
      { file: "docs/SHOTLIST.md", text: "Live variant spends 4 calls (~$0.02)" },
    ],
  },
  {
    source: "per-batch real API call counts",
    quotes: [
      { file: "STATUS.md", text: "58/150 real API calls" },
      { file: "STATUS.md", text: "81/150 real API calls" },
    ],
  },
  {
    source: "clip E2E, single keyframe scan (Batch 14)",
    quotes: [
      { file: "STATUS.md", text: "Single keyframe (1/15)" },
      { file: "docs/video/SCRIPT.md", text: "1 keyframe of 15 scanned" },
      { file: "docs/video/OVERLAYS.txt", text: "1 keyframe of 15 scanned" },
    ],
  },
  {
    source: "frame judge A/B after-run (Batch 21, fixed 8-frame set)",
    quotes: [
      { file: "STATUS.md", text: "after p50 2326ms p90 2808ms" },
      {
        file: "docs/video/SCRIPT.md",
        text: "fresh frame verdict p50 2.3s, p90 2.8s (8-frame set, P/R 1.0/1.0, 0 abstentions)",
      },
      {
        file: "docs/video/OVERLAYS.txt",
        text: "fresh frame verdict p50 2.3s, p90 2.8s (8-frame set, P/R 1.0/1.0, 0 abstentions)",
      },
    ],
  },
  {
    source: "/demo moment 3 claim fixture (DEMO shot list)",
    quotes: [
      { file: "docs/DEMO.md", text: "2 cartons damaged" },
      { file: "docs/video/SCRIPT.md", text: "2 cartons damaged" },
      { file: "docs/video/captions.srt", text: "2 cartons damaged" },
    ],
  },
];
