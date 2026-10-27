import { appendFile, mkdir, readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { AuditEntry } from "./types.ts";

export interface AuditStoreOptions {
  /** Directory holding per-session `audit-<sessionId>.jsonl` files. */
  dir: string;
}

function fileFor(dir: string, sessionId: string): string {
  const safe = sessionId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return join(dir, `audit-${safe}.jsonl`);
}

/**
 * Append one entry to the session JSONL audit log, creating the directory
 * as needed. The log is append-only: entries are never edited in place.
 */
export async function appendAudit(
  entry: AuditEntry,
  options: AuditStoreOptions,
): Promise<void> {
  await mkdir(options.dir, { recursive: true });
  await appendFile(
    fileFor(options.dir, entry.sessionId),
    `${JSON.stringify(entry)}\n`,
    "utf8",
  );
}

/** Read a session's audit trail in append order; [] when it has none. */
export async function readSessionAudit(
  sessionId: string,
  options: AuditStoreOptions,
): Promise<AuditEntry[]> {
  let raw: string;
  try {
    raw = await readFile(fileFor(options.dir, sessionId), "utf8");
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as AuditEntry);
}

/** List session ids that have audit logs, most recently written first. */
export async function listAuditSessions(
  options: AuditStoreOptions,
): Promise<string[]> {
  let files: string[];
  try {
    files = await readdir(options.dir);
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return [];
    throw error;
  }
  const logs = files.filter(
    (name) => name.startsWith("audit-") && name.endsWith(".jsonl"),
  );
  const withTime = await Promise.all(
    logs.map(async (name) => ({
      name,
      mtime: (await stat(join(options.dir, name))).mtimeMs,
    })),
  );
  withTime.sort((a, b) => b.mtime - a.mtime);
  return withTime.map(({ name }) => name.slice("audit-".length, -".jsonl".length));
}
