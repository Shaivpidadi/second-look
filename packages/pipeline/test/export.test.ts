import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { exportAuditCsv, exportAuditMarkdown } from "../src/index.ts";
import type { AuditEntry } from "../src/types.ts";

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    ts: "2026-10-27T20:00:00.000Z",
    sessionId: "clip-e2e",
    fieldId: "awb.awbNumber",
    paperValue: "02027342210",
    typedValue: "02027342211",
    verdict: "blocked",
    action: "block+fix",
    modelCalls: [
      { model: "glimmer", adapter: "stub", outcome: "disagree", latencyMs: 0.5, costUsd: 0 },
      { model: "spark", adapter: "stub", outcome: "escalation", latencyMs: 1.5, costUsd: 0.005 },
    ],
    ...overrides,
  };
}

describe("exportAuditMarkdown", () => {
  it("renders one table row per entry with summed latency and cost", () => {
    const text = exportAuditMarkdown([entry()]);
    assert.match(text, /^# Second Look audit export/m);
    assert.match(text, /\| time \| session \| field \|/);
    assert.match(text, /\| clip-e2e \| awb\.awbNumber \| 02027342210 \| 02027342211 \| blocked \| block\+fix \| 2\.0ms \| \$0\.0050 \|/);
  });

  it("renders nulls as dashes and missing model calls as zero", () => {
    const text = exportAuditMarkdown([
      entry({ paperValue: null, typedValue: null, modelCalls: undefined }),
    ]);
    assert.match(text, /\| — \| — \|/);
    assert.match(text, /0\.0ms \| \$0\.0000/);
  });
});

describe("exportAuditCsv", () => {
  it("renders a header plus one row per entry", () => {
    const text = exportAuditCsv([entry()]);
    const lines = text.trim().split("\n");
    assert.equal(lines.length, 2);
    assert.equal(
      lines[0],
      "ts,session_id,field_id,paper_value,typed_value,verdict,action,latency_ms,cost_usd",
    );
    assert.match(lines[1]!, /clip-e2e,awb\.awbNumber,02027342210,02027342211,blocked,block\+fix,2\.0,0\.0050/);
  });

  it("quotes values containing commas or quotes", () => {
    const text = exportAuditCsv([
      entry({ fieldId: "pod.exceptionNote", paperValue: '2 cartons "damaged", wet', typedValue: "2 cartons damaged" }),
    ]);
    assert.match(text, /"2 cartons ""damaged"", wet",2 cartons damaged/);
  });
});
