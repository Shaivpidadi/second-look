import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ESTIMATED_SPARK_CALL_COST_USD,
  hasHandwriting,
  runTieredPipeline,
  StubGlimmerAdapter,
  StubSparkAdapter,
  type SparkAdapter,
  type SparkEscalationInput,
  type SparkEscalationOutput,
} from "../src/index.ts";
import type { FieldReading } from "../src/types.ts";

const AWB = "02027342210";
const CONTAINER = "CSQU3054383";
const SSCC = "106141410000001238";

function reading(
  fieldId: string,
  paperValue: string | null,
  typedValue: string | null,
): FieldReading {
  return { fieldId, paperValue, typedValue };
}

function cleanReadings(): FieldReading[] {
  return [
    reading("awb.awbNumber", AWB, AWB),
    reading("bol.containerNumber", CONTAINER, CONTAINER),
    reading("label.sscc", SSCC, SSCC),
    reading("bol.cartons", "120", "120"),
    reading("pod.receivedCartons", "120", "120"),
    reading("pod.exceptionNote", null, null),
  ];
}

function cleanTyped(): Record<string, string> {
  return {
    "invoice.totalQty": "120",
    "packing.totalQty": "120",
    "bol.weightKg": "2400",
    "awb.weightKg": "2400",
    "bol.cartons": "120",
    "pod.receivedCartons": "120",
  };
}

class CountingSpark implements SparkAdapter {
  readonly name = "counting-stub";
  calls = 0;
  private readonly inner = new StubSparkAdapter();

  async escalate(input: SparkEscalationInput): Promise<SparkEscalationOutput> {
    this.calls++;
    return this.inner.escalate(input);
  }
}

describe("runTieredPipeline", () => {
  it("agrees with no Spark call and $0 on a clean form", async () => {
    const spark = new CountingSpark();
    const result = await runTieredPipeline({
      readings: cleanReadings(),
      typedValues: cleanTyped(),
      glimmer: new StubGlimmerAdapter(),
      spark,
    });
    assert.equal(result.verdict.state, "clean");
    assert.equal(result.escalated, false);
    assert.equal(result.spark, null);
    assert.equal(spark.calls, 0);
    assert.deepEqual(result.escalationReasons, []);
    assert.equal(result.modelCalls.length, 1);
    assert.equal(result.modelCalls[0]?.model, "glimmer");
    assert.equal(result.modelCalls[0]?.outcome, "agree");
    assert.equal(result.modelCalls[0]?.costUsd, 0);
    assert.ok((result.modelCalls[0]?.latencyMs ?? -1) >= 0);
  });

  it("runs validators first: check-digit failure blocks with no Spark call", async () => {
    const spark = new CountingSpark();
    const readings = cleanReadings().map((r) =>
      r.fieldId === "awb.awbNumber" ? reading(r.fieldId, AWB, "02027342211") : r,
    );
    const result = await runTieredPipeline({
      readings,
      typedValues: cleanTyped(),
      spark,
    });
    assert.equal(result.verdict.state, "blocked");
    assert.ok(
      result.verdict.failures.some(
        (f) => f.fieldId === "awb.awbNumber" && f.kind === "check_digit",
      ),
    );
    // A swapped AWB digit also trips field match, so Glimmer disagrees and
    // Spark is consulted: the block itself comes from the validator.
    assert.equal(spark.calls, 1);
    assert.ok(result.escalationReasons.includes("glimmer_disagree"));
  });

  it("blocks without Spark when only the check digit fails", async () => {
    // Paper unknown (live form): no field match to disagree on, so a bad
    // check digit blocks on validators alone.
    const spark = new CountingSpark();
    const readings = [
      reading("awb.awbNumber", null, "02027342211"),
      reading("bol.containerNumber", null, CONTAINER),
      reading("label.sscc", null, SSCC),
    ];
    const result = await runTieredPipeline({
      readings,
      typedValues: {
        "bol.cartons": "120",
        "pod.receivedCartons": "120",
      },
      spark,
      crossDocOptions: { skipMissingInputs: true },
    });
    assert.equal(result.verdict.state, "blocked");
    assert.equal(result.escalated, false);
    assert.equal(spark.calls, 0);
    assert.equal(result.modelCalls.length, 1);
  });

  it("escalates to Spark on a cross-doc conflict", async () => {
    const spark = new CountingSpark();
    const result = await runTieredPipeline({
      readings: cleanReadings(),
      typedValues: { ...cleanTyped(), "pod.receivedCartons": "118" },
      spark,
    });
    assert.equal(result.verdict.state, "mismatch");
    assert.equal(result.escalated, true);
    assert.equal(spark.calls, 1);
    assert.ok(result.escalationReasons.includes("cross_doc_conflict"));
    assert.match(result.spark?.explanation ?? "", /conflict/);
    const calls = Object.fromEntries(result.modelCalls.map((c) => [c.model, c]));
    assert.equal(calls.glimmer?.costUsd, 0);
    assert.equal(calls.spark?.costUsd, ESTIMATED_SPARK_CALL_COST_USD);
    assert.ok((calls.spark?.latencyMs ?? -1) >= 0);
  });

  it("escalates to Spark when Glimmer disagrees", async () => {
    const spark = new CountingSpark();
    const readings = cleanReadings().map((r) =>
      r.fieldId === "bol.cartons" ? reading(r.fieldId, "120", "121") : r,
    );
    const result = await runTieredPipeline({
      readings,
      typedValues: cleanTyped(),
      spark,
    });
    assert.equal(result.glimmer.outcome, "disagree");
    assert.equal(result.escalated, true);
    assert.equal(spark.calls, 1);
    assert.ok(result.escalationReasons.includes("glimmer_disagree"));
    assert.deepEqual(
      result.spark?.proposedFixes.map((f) => f.fieldId),
      ["bol.cartons"],
    );
  });

  it("escalates on handwriting but keeps the verdict clean", async () => {
    const spark = new CountingSpark();
    const readings = cleanReadings().map((r) =>
      r.fieldId === "pod.exceptionNote"
        ? reading(r.fieldId, "2 cartons damaged", "2 cartons damaged")
        : r,
    );
    const result = await runTieredPipeline({
      readings,
      typedValues: cleanTyped(),
      spark,
    });
    assert.equal(hasHandwriting(readings), true);
    assert.equal(result.verdict.state, "clean");
    assert.equal(result.escalated, true);
    assert.ok(result.escalationReasons.includes("handwriting"));
    assert.match(result.spark?.explanation ?? "", /handwritten/);
    // The cloud tier saw redacted free text, not the note.
    assert.equal(result.glimmer.redacted.find(
      (r) => r.fieldId === "pod.exceptionNote",
    )?.typedValue, "[redacted]");
  });

  it("skips missing-input cross-doc checks for partial form values", async () => {
    const result = await runTieredPipeline({
      readings: [
        reading("awb.awbNumber", null, AWB),
        reading("bol.containerNumber", null, CONTAINER),
        reading("label.sscc", null, SSCC),
        reading("bol.cartons", null, "120"),
        reading("pod.receivedCartons", null, "120"),
      ],
      typedValues: { "bol.cartons": "120", "pod.receivedCartons": "120" },
      crossDocOptions: { skipMissingInputs: true },
    });
    assert.equal(result.verdict.state, "clean");
    assert.equal(result.escalated, false);
  });
});
