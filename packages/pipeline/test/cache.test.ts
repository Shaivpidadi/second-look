import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  changedReadings,
  CropCache,
  hashReadings,
  runTieredPipeline,
  StubSparkAdapter,
  VerdictCache,
  type FieldReading,
  type SparkAdapter,
  type SparkEscalationOutput,
} from "../src/index.ts";

function reading(
  fieldId: string,
  paperValue: string | null,
  typedValue: string | null,
): FieldReading {
  return { fieldId, paperValue, typedValue };
}

const AWB = reading("awb.awbNumber", "02027342210", "02027342211");
const AWB_SAME = reading("awb.awbNumber", "02027342210", "02027342211");
const QTY = reading("invoice.totalQty", "363", "363");

describe("hashReadings", () => {
  it("is order-insensitive and value-sensitive", () => {
    assert.equal(hashReadings([AWB, QTY]), hashReadings([QTY, AWB_SAME]));
    assert.notEqual(hashReadings([AWB]), hashReadings([QTY]));
  });
});

describe("changedReadings", () => {
  it("reports edited, added, and removed fields", () => {
    const prev = [AWB, QTY];
    const next = [
      reading("awb.awbNumber", "02027342210", "02027342212"),
      reading("label.sscc", "1", "1"),
    ];
    assert.deepEqual(changedReadings(prev, next), [
      reading("awb.awbNumber", "02027342210", "02027342212"),
      reading("label.sscc", "1", "1"),
      { fieldId: "invoice.totalQty", paperValue: null, typedValue: null },
    ]);
    assert.deepEqual(changedReadings(prev, [QTY, AWB_SAME]), []);
  });
});

describe("VerdictCache", () => {
  const sparkOut: SparkEscalationOutput = {
    explanation: "e",
    proposedFixes: [],
    latencyMs: 42,
    costUsd: 0.001,
  };

  it("hits on identical readings and reasons with zero marginal cost", () => {
    const cache = new VerdictCache();
    const readings = [AWB, QTY];
    const reasons = ["glimmer_disagree"];
    assert.equal(cache.lookup(readings, reasons).hit, false);
    cache.store(readings, reasons, sparkOut);
    const hit = cache.lookup([QTY, AWB_SAME], [...reasons]);
    assert.equal(hit.hit, true);
    if (hit.hit) {
      assert.equal(hit.spark.explanation, "e");
      assert.equal(hit.spark.latencyMs, 0);
      assert.equal(hit.spark.costUsd, 0);
    }
    assert.equal(cache.hits, 1);
  });

  it("misses when reasons differ", () => {
    const cache = new VerdictCache();
    cache.store([AWB], ["glimmer_disagree"], sparkOut);
    const miss = cache.lookup([AWB_SAME], ["glimmer_disagree", "handwriting"]);
    assert.equal(miss.hit, false);
  });

  it("sends only changed fields on a disagreement repeat with edits", () => {
    const cache = new VerdictCache();
    cache.store([AWB, QTY], ["glimmer_disagree"], sparkOut);
    const edited = reading("awb.awbNumber", "02027342210", "02027342212");
    const miss = cache.lookup([edited, QTY], ["glimmer_disagree"]);
    assert.equal(miss.hit, false);
    if (!miss.hit) assert.deepEqual(miss.send, [edited]);
  });

  it("sends full readings for cross-doc and handwriting repeats", () => {
    const cache = new VerdictCache();
    cache.store([AWB, QTY], ["cross_doc_conflict"], sparkOut);
    const edited = reading("awb.awbNumber", "02027342210", "02027342212");
    const miss = cache.lookup([edited, QTY], ["cross_doc_conflict"]);
    assert.equal(miss.hit, false);
    if (!miss.hit) assert.equal(miss.send.length, 2);
  });
});

describe("CropCache", () => {
  it("hits by hash and copies crops", () => {
    const cache = new CropCache();
    const image = new Uint8Array([1]);
    assert.equal(cache.get("h"), null);
    cache.set("h", [{ box: { x: 1, y: 2, width: 3, height: 4 }, image }]);
    const hit = cache.get("h");
    assert.equal(hit?.length, 1);
    assert.notEqual(hit?.[0], undefined);
    assert.equal(cache.hits, 1);
    assert.equal(cache.size, 1);
  });
});

describe("runTieredPipeline with a verdict cache", () => {
  function countingSpark(counter: { calls: number; sent: FieldReading[][] }): SparkAdapter {
    const stub = new StubSparkAdapter();
    return {
      name: "counting",
      async escalate(input) {
        counter.calls += 1;
        counter.sent.push(input.readings);
        return stub.escalate(input);
      },
    };
  }

  it("escalates once for repeated identical readings", async () => {
    const counter = { calls: 0, sent: [] as FieldReading[][] };
    const cache = new VerdictCache();
    const input = {
      readings: [AWB],
      typedValues: { "awb.awbNumber": "02027342211" },
      spark: countingSpark(counter),
      verdictCache: cache,
    };
    const first = await runTieredPipeline(input);
    const second = await runTieredPipeline(input);
    assert.equal(counter.calls, 1);
    assert.equal(first.sparkCached, false);
    assert.equal(second.sparkCached, true);
    assert.equal(second.modelCalls[1]?.outcome, "escalation (cached)");
    assert.equal(second.modelCalls[1]?.latencyMs, 0);
  });

  it("sends only changed fields on the second escalation", async () => {
    const counter = { calls: 0, sent: [] as FieldReading[][] };
    const cache = new VerdictCache();
    const base = {
      typedValues: {
        "invoice.totalQty": "10",
        "packing.totalQty": "10",
        "bol.weightKg": "100",
        "awb.weightKg": "100",
        "bol.cartons": "5",
        "pod.receivedCartons": "5",
      },
      spark: countingSpark(counter),
      verdictCache: cache,
    };
    await runTieredPipeline({ ...base, readings: [AWB, QTY] });
    const edited = reading("awb.awbNumber", "02027342210", "02027342212");
    await runTieredPipeline({ ...base, readings: [edited, QTY] });
    assert.equal(counter.calls, 2);
    assert.deepEqual(counter.sent[1], [edited]);
  });
});
