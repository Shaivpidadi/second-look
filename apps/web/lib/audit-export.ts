/** Client-side audit-log export. Pure string builders so tests stay offline. */

export interface ExportableEntry {
  ts: string;
  sessionId: string;
  fieldId: string;
  paperValue: string | null;
  typedValue: string | null;
  verdict: string;
  action: string;
}

/** One compact JSON object per line, in entry order. */
export function auditToJsonl(entries: ExportableEntry[]): string {
  return entries
    .map((e) =>
      JSON.stringify({
        ts: e.ts,
        sessionId: e.sessionId,
        field: e.fieldId,
        paper: e.paperValue,
        typed: e.typedValue,
        verdict: e.verdict,
        action: e.action,
      }),
    )
    .join("\n");
}

function csvCell(value: string | null): string {
  if (value === null) return "";
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Header plus one row per entry; commas, quotes, and newlines are quoted. */
export function auditToCsv(entries: ExportableEntry[]): string {
  const header = "time,session,field,paper_value,typed_value,verdict,action";
  const rows = entries.map((e) =>
    [
      csvCell(e.ts),
      csvCell(e.sessionId),
      csvCell(e.fieldId),
      csvCell(e.paperValue),
      csvCell(e.typedValue),
      csvCell(e.verdict),
      csvCell(e.action),
    ].join(","),
  );
  return [header, ...rows].join("\n");
}
