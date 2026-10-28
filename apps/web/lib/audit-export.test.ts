import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  auditToCsv,
  auditToJsonl,
  type ExportableEntry,
} from "./audit-export.ts";

const entries: ExportableEntry[] = [
  {
    ts: "2026-10-27T10:00:00.000Z",
    sessionId: "s1",
    fieldId: "invoice.totalQty",
    paperValue: "363",
    typedValue: "365",
    verdict: "mismatch",
    action: "flag:cross_doc",
  },
  {
    ts: "2026-10-27T10:00:01.000Z",
    sessionId: "s1",
    fieldId: "pod.exceptionNote",
    paperValue: null,
    typedValue: 'torn, "wet" box',
    verdict: "mismatch",
    action: "claim_draft",
  },
];

describe("auditToJsonl", () => {
  it("emits one parseable object per line in order", () => {
    const lines = auditToJsonl(entries).split("\n");
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]), {
      ts: "2026-10-27T10:00:00.000Z",
      sessionId: "s1",
      field: "invoice.totalQty",
      paper: "363",
      typed: "365",
      verdict: "mismatch",
      action: "flag:cross_doc",
    });
    assert.equal(JSON.parse(lines[1]).typed, 'torn, "wet" box');
  });

  it("emits an empty string for no entries", () => {
    assert.equal(auditToJsonl([]), "");
  });
});

describe("auditToCsv", () => {
  it("emits a header plus one row per entry", () => {
    const lines = auditToCsv(entries).split("\n");
    assert.equal(lines[0], "time,session,field,paper_value,typed_value,verdict,action");
    assert.equal(
      lines[1],
      "2026-10-27T10:00:00.000Z,s1,invoice.totalQty,363,365,mismatch,flag:cross_doc",
    );
  });

  it("quotes commas and doubles quotes, blanks nulls", () => {
    const lines = auditToCsv(entries).split("\n");
    assert.equal(
      lines[2],
      '2026-10-27T10:00:01.000Z,s1,pod.exceptionNote,,"torn, ""wet"" box",mismatch,claim_draft',
    );
  });

  it("emits header only for no entries", () => {
    assert.equal(
      auditToCsv([]),
      "time,session,field,paper_value,typed_value,verdict,action",
    );
  });
});
