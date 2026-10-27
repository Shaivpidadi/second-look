import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createGlimmerAdapter,
  createSparkAdapter,
  ESTIMATED_SPARK_CALL_COST_USD,
  isFreeTextField,
  redactReadings,
  RealGlimmerAdapter,
  RealSparkAdapter,
  requireModelApiKey,
  StubGlimmerAdapter,
  StubSparkAdapter,
} from "../src/index.ts";
import type { FieldReading } from "../src/types.ts";

function reading(
  fieldId: string,
  paperValue: string | null,
  typedValue: string | null,
): FieldReading {
  return { fieldId, paperValue, typedValue };
}

function withCleanKeys<T>(fn: () => T): T {
  const model = process.env.MODEL_API_KEY;
  const meta = process.env.META_API_KEY;
  delete process.env.MODEL_API_KEY;
  delete process.env.META_API_KEY;
  try {
    return fn();
  } finally {
    if (model !== undefined) process.env.MODEL_API_KEY = model;
    if (meta !== undefined) process.env.META_API_KEY = meta;
  }
}

describe("requireModelApiKey", () => {
  it("prefers MODEL_API_KEY and accepts META_API_KEY", () => {
    const model = process.env.MODEL_API_KEY;
    const meta = process.env.META_API_KEY;
    try {
      process.env.MODEL_API_KEY = "model-key";
      process.env.META_API_KEY = "meta-key";
      assert.equal(requireModelApiKey(), "model-key");
      delete process.env.MODEL_API_KEY;
      assert.equal(requireModelApiKey(), "meta-key");
    } finally {
      if (model !== undefined) process.env.MODEL_API_KEY = model;
      else delete process.env.MODEL_API_KEY;
      if (meta !== undefined) process.env.META_API_KEY = meta;
      else delete process.env.META_API_KEY;
    }
  });

  it("fails cleanly naming both env vars when no key exists", () => {
    withCleanKeys(() => {
      assert.throws(() => requireModelApiKey(), /MODEL_API_KEY.*META_API_KEY/);
    });
  });
});

describe("StubGlimmerAdapter", () => {
  const stub = new StubGlimmerAdapter();

  it("agrees when paper and typed match", async () => {
    const out = await stub.pass({
      crops: [],
      readings: [reading("awb.awbNumber", "02027342210", "02027342210")],
    });
    assert.equal(out.outcome, "agree");
    assert.equal(out.reason, undefined);
    assert.equal(out.costUsd, 0);
    assert.ok(out.latencyMs >= 0);
  });

  it("agrees when the paper value is unknown", async () => {
    const out = await stub.pass({
      crops: [],
      readings: [reading("awb.awbNumber", null, "02027342210")],
    });
    assert.equal(out.outcome, "agree");
  });

  it("disagrees deterministically on paper/typed diffs", async () => {
    const input = {
      crops: [],
      readings: [reading("awb.awbNumber", "02027342210", "02027342211")],
    };
    const first = await stub.pass(input);
    const second = await stub.pass(input);
    assert.equal(first.outcome, "disagree");
    assert.equal(second.outcome, "disagree");
    assert.equal(first.reason, second.reason);
    assert.match(first.reason ?? "", /awb\.awbNumber/);
  });

  it("redacts free text and passes identifiers through", async () => {
    const out = await stub.pass({
      crops: [],
      readings: [
        reading("awb.awbNumber", "02027342210", "02027342210"),
        reading("pod.exceptionNote", "2 cartons damaged", "2 cartons damaged"),
      ],
    });
    assert.deepEqual(out.redacted, [
      reading("awb.awbNumber", "02027342210", "02027342210"),
      reading("pod.exceptionNote", "[redacted]", "[redacted]"),
    ]);
  });
});

describe("redaction policy", () => {
  it("flags free-text fields and not identifiers", () => {
    assert.equal(isFreeTextField("pod.exceptionNote"), true);
    assert.equal(isFreeTextField("bol.shipperName"), true);
    assert.equal(isFreeTextField("awb.awbNumber"), false);
    assert.equal(isFreeTextField("bol.containerNumber"), false);
    assert.equal(isFreeTextField("label.sscc"), false);
    assert.equal(isFreeTextField("bol.cartons"), false);
  });

  it("leaves nulls and empty notes alone", () => {
    assert.deepEqual(
      redactReadings([
        reading("pod.exceptionNote", null, null),
        reading("pod.exceptionNote", "", ""),
      ]),
      [reading("pod.exceptionNote", null, null), reading("pod.exceptionNote", "", "")],
    );
  });
});

describe("StubSparkAdapter", () => {
  const stub = new StubSparkAdapter();

  it("explains diffs and proposes paper values as fixes", async () => {
    const out = await stub.escalate({
      readings: [reading("awb.awbNumber", "02027342210", "02027342211")],
      crops: [],
      question: "the local pass disagrees",
    });
    assert.match(out.explanation, /awb\.awbNumber/);
    assert.match(out.explanation, /the local pass disagrees/);
    assert.deepEqual(out.proposedFixes, [
      reading("awb.awbNumber", "02027342210", "02027342211"),
    ]);
    assert.equal(out.costUsd, ESTIMATED_SPARK_CALL_COST_USD);
    assert.ok(out.latencyMs >= 0);
  });

  it("proposes nothing on pure cross-doc or handwriting escalation", async () => {
    const out = await stub.escalate({
      readings: [reading("awb.awbNumber", "02027342210", "02027342210")],
      crops: [],
      question: "cross-document conflict",
    });
    assert.deepEqual(out.proposedFixes, []);
    assert.match(out.explanation, /no paper\/typed diffs/);
  });
});

describe("real adapters without keys", () => {
  it("RealGlimmerAdapter fails cleanly naming the key env vars", async () => {
    await withCleanKeys(async () => {
      await assert.rejects(
        () => new RealGlimmerAdapter().pass({ crops: [], readings: [] }),
        /MODEL_API_KEY/,
      );
    });
  });

  it("RealSparkAdapter fails cleanly naming the key env vars", async () => {
    await withCleanKeys(async () => {
      await assert.rejects(
        () =>
          new RealSparkAdapter().escalate({ readings: [], crops: [], question: "q" }),
        /MODEL_API_KEY/,
      );
    });
  });

  it("RealSparkAdapter reads the key at call time, then attempts the call", async () => {
    const model = process.env.MODEL_API_KEY;
    try {
      process.env.MODEL_API_KEY = "test-key";
      const adapter = new RealSparkAdapter({ baseUrl: "http://127.0.0.1:1" });
      await assert.rejects(
        () => adapter.escalate({ readings: [], crops: [], question: "q" }),
        /Model API request failed/,
      );
    } finally {
      if (model !== undefined) process.env.MODEL_API_KEY = model;
      else delete process.env.MODEL_API_KEY;
    }
  });
});

describe("adapter factories", () => {
  it("default to stubs and build real adapters on request", () => {
    assert.equal(createGlimmerAdapter().name, "stub");
    assert.equal(createSparkAdapter().name, "stub");
    assert.equal(createGlimmerAdapter("real").name, "real");
    assert.equal(createSparkAdapter("real").name, "real");
  });
});
