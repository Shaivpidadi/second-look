import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildDemoDataset } from "./demo-data.ts";
import { groupRuns, selectRunStats } from "./dashboard-stats.ts";
import type { StatsEntry } from "./dashboard-stats.ts";

function entry(overrides: Partial<StatsEntry> & { ts: string; verdict: string }): StatsEntry {
  return { modelCalls: undefined, ...overrides };
}

describe("groupRuns", () => {
  it("groups entries sharing a timestamp and keeps the worst verdict", () => {
    const runs = groupRuns([
      entry({ ts: "t1", verdict: "clean" }),
      entry({ ts: "t1", verdict: "mismatch" }),
      entry({ ts: "t2", verdict: "blocked" }),
    ]);
    assert.equal(runs.length, 2);
    // Newest first.
    assert.equal(runs[0]?.ts, "t2");
    assert.equal(runs[0]?.verdict, "blocked");
    assert.equal(runs[1]?.verdict, "mismatch");
  });

  it("takes model calls from the first entry that carries them", () => {
    const calls = [
      { model: "spark", adapter: "muse-spark-1.3", outcome: "escalation", latencyMs: 100, costUsd: 0.001 },
    ];
    const runs = groupRuns([
      entry({ ts: "t1", verdict: "blocked", modelCalls: calls }),
      entry({ ts: "t1", verdict: "blocked", modelCalls: calls }),
    ]);
    assert.equal(runs.length, 1);
    // Redundantly logged calls must not double count.
    assert.equal(runs[0]?.latencyMs, 100);
    assert.equal(runs[0]?.costUsd, 0.001);
  });
});

describe("selectRunStats", () => {
  it("adds every aggregate from one pass over the runs", () => {
    const runs = groupRuns([
      entry({ ts: "t1", verdict: "clean" }),
      entry({ ts: "t2", verdict: "mismatch" }),
      entry({ ts: "t3", verdict: "blocked" }),
      entry({ ts: "t4", verdict: "needs-human" }),
    ]);
    const stats = selectRunStats(runs);
    assert.equal(stats.total, 4);
    assert.equal(stats.pass, 1);
    assert.equal(stats.warn, 1);
    assert.equal(stats.blocked, 1);
    assert.equal(stats.needsHuman, 1);
    assert.equal(stats.pass + stats.warn + stats.blocked + stats.needsHuman, stats.total);
  });

  it("computes median latency and total cost", () => {
    const call = (latencyMs: number, costUsd: number) => ({
      model: "spark",
      adapter: "muse-spark-1.3",
      outcome: "escalation",
      latencyMs,
      costUsd,
    });
    const runs = groupRuns([
      entry({ ts: "t1", verdict: "clean", modelCalls: [call(100, 0.001)] }),
      entry({ ts: "t2", verdict: "clean", modelCalls: [call(300, 0.003)] }),
    ]);
    const stats = selectRunStats(runs);
    assert.equal(stats.medianLatencyMs, 200);
    assert.equal(stats.totalCostUsd, 0.004);
  });

  it("keeps KPI totals, breakdown totals, and row count in agreement", () => {
    // The dashboard's KPIs, breakdown bars, and table rows all derive
    // from this selector over this run list; pin that contract on the
    // demo dataset itself.
    const { entries } = buildDemoDataset(Date.now());
    const runs = groupRuns(entries);
    const stats = selectRunStats(runs);
    assert.equal(stats.total, runs.length);
    assert.equal(stats.total, 40);
    assert.equal(stats.pass + stats.warn + stats.blocked + stats.needsHuman, runs.length);
    assert.equal(stats.pass, 18);
    assert.equal(stats.warn, 10);
    assert.equal(stats.blocked, 7);
    assert.equal(stats.needsHuman, 5);
    // Median of the fixture latencies, p50 near 3s by design.
    assert.ok(stats.medianLatencyMs > 2000 && stats.medianLatencyMs < 4000);
  });
});
