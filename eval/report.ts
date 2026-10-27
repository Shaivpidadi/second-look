import type { ArmResult } from "./runner.ts";

export interface ArmSummary {
  arm: string;
  available: boolean;
  forms: number;
  flagged: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  /** Null when the arm flagged nothing; null recall when no form had errors. */
  precision: number | null;
  recall: number | null;
  avgLatencyMs: number;
  totalCostUsd: number;
}

function rate(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

/** Per-arm precision/recall/latency/cost over that arm's form results. */
export function summarize(result: ArmResult): ArmSummary {
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  let latencyMs = 0;
  let costUsd = 0;
  for (const form of result.forms) {
    if (form.flagged && form.expected) tp++;
    else if (form.flagged) fp++;
    else if (form.expected) fn++;
    else tn++;
    latencyMs += form.latencyMs;
    costUsd += form.costUsd;
  }
  return {
    arm: result.arm,
    available: result.available,
    forms: result.forms.length,
    flagged: tp + fp,
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    precision: rate(tp, tp + fp),
    recall: rate(tp, tp + fn),
    avgLatencyMs: result.forms.length === 0 ? 0 : latencyMs / result.forms.length,
    totalCostUsd: costUsd,
  };
}

function pct(value: number | null): string {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

/** One Markdown table comparing arms; stubbed arms show as such. */
export function formatReport(summaries: ArmSummary[]): string {
  const header =
    "| arm | forms | flagged | precision | recall | avg latency | cost |\n" +
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: |";
  const rows = summaries.map((s) =>
    s.available
      ? `| ${s.arm} | ${s.forms} | ${s.flagged} | ${pct(s.precision)} | ${pct(s.recall)} | ${s.avgLatencyMs.toFixed(1)}ms | $${s.totalCostUsd.toFixed(4)} |`
      : `| ${s.arm} | stubbed | — | — | — | — | — |`,
  );
  return ["# Second Look eval report", "", ...[header, ...rows]].join("\n") + "\n";
}
