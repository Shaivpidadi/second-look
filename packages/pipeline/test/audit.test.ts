import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendAudit,
  listAuditSessions,
  readSessionAudit,
} from "../src/audit.ts";
import type { AuditEntry } from "../src/types.ts";

function entry(sessionId: string, fieldId: string): AuditEntry {
  return {
    ts: new Date().toISOString(),
    sessionId,
    fieldId,
    paperValue: "02027342210",
    typedValue: "02027342211",
    verdict: "blocked",
    action: "submit_block:awb_check_digit",
  };
}

describe("audit log", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "second-look-audit-"));
  });

  it("appends and reads entries in order", async () => {
    await appendAudit(entry("s1", "awb.awbNumber"), { dir });
    await appendAudit(entry("s1", "bol.containerNumber"), { dir });
    const entries = await readSessionAudit("s1", { dir });
    assert.equal(entries.length, 2);
    assert.equal(entries[0]?.fieldId, "awb.awbNumber");
    assert.equal(entries[1]?.fieldId, "bol.containerNumber");
  });

  it("writes one JSON object per line", async () => {
    await appendAudit(entry("s1", "awb.awbNumber"), { dir });
    await appendAudit(entry("s1", "bol.containerNumber"), { dir });
    const raw = await readFile(join(dir, "audit-s1.jsonl"), "utf8");
    const lines = raw.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]!).fieldId, "awb.awbNumber");
  });

  it("keeps sessions in separate files", async () => {
    await appendAudit(entry("s1", "awb.awbNumber"), { dir });
    await appendAudit(entry("s2", "awb.awbNumber"), { dir });
    assert.equal((await readSessionAudit("s1", { dir })).length, 1);
    assert.equal((await readSessionAudit("s2", { dir })).length, 1);
  });

  it("returns [] for sessions and dirs without logs", async () => {
    assert.deepEqual(await readSessionAudit("missing", { dir }), []);
    assert.deepEqual(await readSessionAudit("s1", { dir: join(dir, "nope") }), []);
    assert.deepEqual(await listAuditSessions({ dir: join(dir, "nope") }), []);
  });

  it("lists sessions most-recently-written first", async () => {
    await appendAudit(entry("s1", "awb.awbNumber"), { dir });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await appendAudit(entry("s2", "awb.awbNumber"), { dir });
    assert.deepEqual(await listAuditSessions({ dir }), ["s2", "s1"]);
  });

  it("sanitizes hostile session ids into the audit dir", async () => {
    await appendAudit(entry("../../evil", "awb.awbNumber"), { dir });
    const entries = await readSessionAudit("../../evil", { dir });
    assert.equal(entries.length, 1);
  });
});
