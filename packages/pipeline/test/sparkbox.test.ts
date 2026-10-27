import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  parseNormalizedBoxes,
  resetCallStats,
  SparkBoxAdapter,
  sparkCostUsd,
} from "../src/index.ts";

const FRAME = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

describe("parseNormalizedBoxes", () => {
  it("scales 0-1000 boxes to frame pixels", () => {
    assert.deepEqual(
      parseNormalizedBoxes('[{"x_min":0,"y_min":0,"x_max":1000,"y_max":1000}]', 720, 1280),
      [{ x: 0, y: 0, width: 720, height: 1280 }],
    );
    assert.deepEqual(
      parseNormalizedBoxes('[{"x_min":100,"y_min":200,"x_max":600,"y_max":700}]', 1000, 1000),
      [{ x: 100, y: 200, width: 500, height: 500 }],
    );
  });

  it("tolerates fences and prose, clamps and drops bad entries", () => {
    const text =
      'Here: ```json\n[{"x_min":-5,"y_min":0,"x_max":2000,"y_max":500},{"x_min":9,"y_min":9,"x_max":9,"y_max":9},{"nope":1}]\n```';
    assert.deepEqual(parseNormalizedBoxes(text, 1000, 1000), [
      { x: 0, y: 0, width: 1000, height: 500 },
    ]);
    assert.deepEqual(parseNormalizedBoxes("no boxes here", 720, 1280), []);
    assert.deepEqual(parseNormalizedBoxes(null, 720, 1280), []);
    assert.deepEqual(parseNormalizedBoxes('{"x_min":0}', 720, 1280), []);
  });
});

describe("SparkBoxAdapter", () => {
  const saved = process.env.MODEL_API_KEY;
  beforeEach(() => {
    resetCallStats();
    process.env.MODEL_API_KEY = "test-key";
  });
  afterEach(() => {
    if (saved !== undefined) process.env.MODEL_API_KEY = saved;
    else delete process.env.MODEL_API_KEY;
  });

  function boxResponse(text: string): Response {
    return new Response(
      JSON.stringify({
        object: "response",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text, annotations: [] }],
            status: "completed",
          },
        ],
        usage: { input_tokens: 2000, output_tokens: 100, total_tokens: 2100 },
      }),
      { status: 200 },
    );
  }

  it("asks Spark for JSON boxes and prices the usage", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init: { body?: string }) => {
      seen.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
      return boxResponse('[{"x_min":100,"y_min":100,"x_max":900,"y_max":900}]');
    }) as unknown as typeof fetch;
    const out = await new SparkBoxAdapter({ fetchImpl }).crop({
      image: FRAME,
      concept: "shipping document",
      frameWidth: 720,
      frameHeight: 1280,
    });
    assert.equal(seen[0]?.model, "muse-spark-1.3");
    const content = (
      ((seen[0]?.input as Array<Record<string, unknown>>)[0] as Record<string, unknown>)
        .content as Array<Record<string, unknown>>
    );
    assert.match(String(content[0]?.text), /shipping document/);
    assert.match(String(content[0]?.text), /0-1000/);
    assert.equal(content[1]?.type, "input_image");
    assert.deepEqual(
      out.crops.map((c) => c.box),
      [{ x: 72, y: 128, width: 576, height: 1024 }],
    );
    assert.equal(out.costUsd, sparkCostUsd(2000, 100, 0));
    assert.ok(out.latencyMs >= 0);
  });

  it("yields zero crops on empty output and enforces one concept", async () => {
    const fetchImpl = (async () => boxResponse("")) as unknown as typeof fetch;
    const out = await new SparkBoxAdapter({ fetchImpl }).crop({
      image: FRAME,
      concept: "shipping document",
    });
    assert.deepEqual(out.crops, []);
    await assert.rejects(
      () => new SparkBoxAdapter({ fetchImpl }).crop({ image: FRAME, concept: "a, b" }),
      /one noun phrase/,
    );
  });
});
