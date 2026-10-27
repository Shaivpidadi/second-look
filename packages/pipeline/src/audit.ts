import type { AuditEntry } from "./types.ts";

/** Append one entry to the session JSONL audit log. */
export async function appendAudit(_entry: AuditEntry): Promise<void> {
  throw new Error("audit.appendAudit: not implemented");
}
