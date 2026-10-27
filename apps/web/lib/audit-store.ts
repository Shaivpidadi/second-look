import { join } from "node:path";
import {
  appendAudit,
  listAuditSessions,
  readSessionAudit,
} from "@second-look/pipeline";
import type { AuditEntry } from "@second-look/pipeline";

/** Server-side audit store. Logs live in AUDIT_DIR or ./.audit (gitignored). */
export function auditDir(): string {
  return process.env.AUDIT_DIR ?? join(process.cwd(), ".audit");
}

export async function logAuditEntry(entry: AuditEntry): Promise<void> {
  await appendAudit(entry, { dir: auditDir() });
}

export async function getSessionAudit(sessionId: string): Promise<AuditEntry[]> {
  return readSessionAudit(sessionId, { dir: auditDir() });
}

export async function getAuditSessions(): Promise<string[]> {
  return listAuditSessions({ dir: auditDir() });
}
