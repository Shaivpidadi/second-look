/**
 * Single source of truth for the headline numbers quoted across
 * README.md, docs/DEMO.md, docs/SUBMIT.md, and STATUS.md. Each entry
 * lists the exact rendering every doc must contain (rounding variants
 * allowed where noted). When a measurement changes, update the docs
 * and this table together; eval/test/numbers.test.ts fails on drift.
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
    ],
  },
  {
    source: "clip E2E AWB fix observations, batches 8/11/14",
    quotes: [
      { file: "docs/DEMO.md", text: "fix correct in 11 of 13 live runs" },
      { file: "STATUS.md", text: "now 11 of 13 live runs" },
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
    ],
  },
  {
    source: "dashboard demo dataset (one-selector agreement test)",
    quotes: [
      { file: "STATUS.md", text: "40 = 18 + 10 + 7 + 5" },
      { file: "STATUS.md", text: "14 local, 22 escalated, 4 validators-only" },
    ],
  },
  {
    source: "per-batch real API call counts",
    quotes: [
      { file: "STATUS.md", text: "58/150 real API calls" },
      { file: "STATUS.md", text: "81/150 real API calls" },
    ],
  },
];
