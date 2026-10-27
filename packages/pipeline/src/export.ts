import type { AuditEntry } from "./types.ts";

function cell(value: string | null): string {
  return value ?? "—";
}

function totals(entry: AuditEntry): { latencyMs: number; costUsd: number } {
  let latencyMs = 0;
  let costUsd = 0;
  for (const call of entry.modelCalls ?? []) {
    latencyMs += call.latencyMs;
    costUsd += call.costUsd;
  }
  return { latencyMs, costUsd };
}

/**
 * Render audit entries as a readable Markdown report: one table row per
 * entry with the verdict, action, and summed model latency/cost. For the
 * video close and human review; the JSONL log stays the source of truth.
 */
export function exportAuditMarkdown(entries: AuditEntry[]): string {
  const header =
    "| time | session | field | paper | typed | verdict | action | latency | cost |\n" +
    "| --- | --- | --- | --- | --- | --- | --- | ---: | ---: |";
  const rows = entries.map((entry) => {
    const { latencyMs, costUsd } = totals(entry);
    return (
      `| ${entry.ts} | ${entry.sessionId} | ${entry.fieldId} | ` +
      `${cell(entry.paperValue)} | ${cell(entry.typedValue)} | ${entry.verdict} | ` +
      `${entry.action} | ${latencyMs.toFixed(1)}ms | $${costUsd.toFixed(4)} |`
    );
  });
  return ["# Second Look audit export", "", ...[header, ...rows]].join("\n") + "\n";
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/**
 * Render audit entries as CSV: one row per entry with the same columns as
 * the Markdown export, plus per-call model detail folded into the totals.
 * Values are RFC 4180 quoted.
 */
export function exportAuditCsv(entries: AuditEntry[]): string {
  const header = "ts,session_id,field_id,paper_value,typed_value,verdict,action,latency_ms,cost_usd";
  const rows = entries.map((entry) => {
    const { latencyMs, costUsd } = totals(entry);
    return [
      entry.ts,
      entry.sessionId,
      entry.fieldId,
      entry.paperValue ?? "",
      entry.typedValue ?? "",
      entry.verdict,
      entry.action,
      latencyMs.toFixed(1),
      costUsd.toFixed(4),
    ]
      .map(csvCell)
      .join(",");
  });
  return [header, ...rows].join("\n") + "\n";
}
