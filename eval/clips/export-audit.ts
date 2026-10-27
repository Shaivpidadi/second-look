import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  exportAuditCsv,
  exportAuditMarkdown,
  listAuditSessions,
  readSessionAudit,
} from "@second-look/pipeline";

/**
 * Re-export any session audit (JSONL) as a readable Markdown table plus CSV.
 * Defaults to the clip E2E session; point --dir at .audit for form sessions.
 */
export async function exportSession(
  dir: string,
  sessionId: string,
  outDir: string,
): Promise<{ markdown: string; csv: string; entries: number }> {
  const entries = await readSessionAudit(sessionId, { dir });
  if (entries.length === 0) {
    const sessions = await listAuditSessions({ dir });
    throw new Error(
      `no audit entries for session ${JSON.stringify(sessionId)} in ${dir}` +
        (sessions.length > 0 ? ` (have: ${sessions.join(", ")})` : " (no sessions logged yet)"),
    );
  }
  const markdown = join(outDir, `audit-${sessionId}.md`);
  const csv = join(outDir, `audit-${sessionId}.csv`);
  await writeFile(markdown, exportAuditMarkdown(entries));
  await writeFile(csv, exportAuditCsv(entries));
  return { markdown, csv, entries: entries.length };
}

function argValue(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dir =
    argValue(args, "--dir") ?? new URL("../../clips", import.meta.url).pathname;
  const sessionId = argValue(args, "--session") ?? "clip-e2e";
  const outDir = argValue(args, "--out") ?? dir;
  const result = await exportSession(dir, sessionId, outDir);
  console.log(
    `exported ${result.entries} entries for ${sessionId}:\n  ${result.markdown}\n  ${result.csv}`,
  );
}

const isMainEntry = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainEntry) {
  await main();
}
