import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ArmResult } from "../runner.ts";
import { formatReport, summarize } from "../report.ts";

function result(overrides: Partial<ArmResult> = {}): ArmResult {
  return {
    arm: "check-digit-only",
    available: true,
    forms: [
      { formId: "a", expected: true, flagged: true, latencyMs: 2, costUsd: 0 },
      { formId: "b", expected: true, flagged: false, latencyMs: 4, costUsd: 0 },
      { formId: "c", expected: false, flagged: true, latencyMs: 6, costUsd: 0 },
      { formId: "d", expected: false, flagged: false, latencyMs: 8, costUsd: 0 },
    ],
    ...overrides,
  };
}

describe("report", () => {
  it("computes precision/recall/latency/cost", () => {
    const summary = summarize(result());
    assert.equal(summary.forms, 4);
    assert.equal(summary.truePositives, 1);
    assert.equal(summary.falsePositives, 1);
    assert.equal(summary.trueNegatives, 1);
    assert.equal(summary.falseNegatives, 1);
    assert.equal(summary.precision, 0.5);
    assert.equal(summary.recall, 0.5);
    assert.equal(summary.avgLatencyMs, 5);
    assert.equal(summary.totalCostUsd, 0);
  });

  it("reports null precision when nothing is flagged", () => {
    const summary = summarize(
      result({
        forms: [{ formId: "a", expected: true, flagged: false, latencyMs: 1, costUsd: 0 }],
      }),
    );
    assert.equal(summary.precision, null);
    assert.equal(summary.recall, 0);
  });

  it("reports null recall when no form has errors", () => {
    const summary = summarize(
      result({
        forms: [{ formId: "a", expected: false, flagged: false, latencyMs: 1, costUsd: 0 }],
      }),
    );
    assert.equal(summary.precision, null);
    assert.equal(summary.recall, null);
  });

  it("formats a table with stubbed arms marked", () => {
    const text = formatReport([
      summarize(result()),
      summarize(result({ arm: "tiered", available: false, forms: [] })),
    ]);
    assert.match(text, /check-digit-only/);
    assert.match(text, /\| tiered \| stubbed \|/);
  });
});
