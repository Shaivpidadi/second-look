import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  getCallStats,
  RealSparkAdapter,
  resetCallStats,
  sparkCostUsd,
} from "../src/index.ts";

/** Canned Responses payload matching the verified live envelope. */
function responsesMessage(
  text: string,
  usage = { input_tokens: 42, output_tokens: 17, total_tokens: 59 },
): Response {
  return new Response(
    JSON.stringify({
      object: "response",
      status: "completed",
      output: [
        { type: "reasoning", summary: [], status: "completed" },
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text, annotations: [] }],
          status: "completed",
        },
      ],
      usage,
    }),
    { status: 200 },
  );
}

describe("RealSparkAdapter verified shapes", () => {
  const saved = process.env.MODEL_API_KEY;
  beforeEach(() => {
    resetCallStats();
    process.env.MODEL_API_KEY = "test-key";
  });
  afterEach(() => {
    if (saved !== undefined) process.env.MODEL_API_KEY = saved;
    else delete process.env.MODEL_API_KEY;
  });

  it("posts message input with caps and parses text, usage, judgment, fixes", async () => {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const reply = JSON.stringify({
      explanation: "AWB differs",
      flagged: true,
      failures: [{ fieldId: "awb.awbNumber", kind: "field_match", detail: "d1" }],
      fixes: [{ fieldId: "awb.awbNumber", correctedValue: "02027342210" }],
    });
    const fetchImpl = (async (url: string, init: { body?: string }) => {
      seen.push({ url, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
      return responsesMessage(reply);
    }) as unknown as typeof fetch;
    const out = await new RealSparkAdapter({
      baseUrl: "https://spark.test/v1",
      fetchImpl,
    }).escalate({
      readings: [{ fieldId: "awb.awbNumber", paperValue: "02027342210", typedValue: "02027342211" }],
      crops: [],
      question: "judge this",
    });
    assert.equal(seen.length, 1);
    assert.equal(seen[0]?.url, "https://spark.test/v1/responses");
    const body = seen[0]?.body;
    assert.equal(body?.model, "muse-spark-1.3");
    assert.equal(body?.max_output_tokens, 1024);
    assert.deepEqual(body?.reasoning, { effort: "minimal" });
    const content = (
      (body?.input as Array<Record<string, unknown>>)[0] as Record<string, unknown>
    ).content as Array<Record<string, unknown>>;
    assert.equal(content[0]?.type, "input_text");
    assert.match(String(content[0]?.text), /judge this/);
    assert.match(String(content[0]?.text), /awb\.awbNumber/);
    assert.equal(out.explanation, "AWB differs");
    assert.deepEqual(out.judgment, {
      flagged: true,
      failures: [{ fieldId: "awb.awbNumber", kind: "field_match", passed: false, detail: "d1" }],
    });
    assert.deepEqual(out.proposedFixes, [
      { fieldId: "awb.awbNumber", paperValue: "02027342210", typedValue: "02027342211" },
    ]);
    assert.deepEqual(out.usage, { inputTokens: 42, outputTokens: 17, cachedInputTokens: 0 });
    assert.deepEqual(getCallStats().inputTokens, 42);
    assert.equal(out.costUsd, sparkCostUsd(42, 17, 0));
    assert.ok(out.latencyMs >= 0);
  });

  it("attaches at most maxImages crops as input_image blocks", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init: { body?: string }) => {
      seen.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
      return responsesMessage('{"explanation": "ok", "flagged": false}');
    }) as unknown as typeof fetch;
    const crop = (byte: number) => ({
      box: { x: 0, y: 0, width: 1, height: 1 },
      image: new Uint8Array([0x89, 0x50, byte]),
    });
    await new RealSparkAdapter({ fetchImpl, maxImages: 1 }).escalate({
      readings: [],
      crops: [crop(1), crop(2)],
      question: "q",
    });
    const content = (
      ((seen[0]?.input as Array<Record<string, unknown>>)[0] as Record<string, unknown>)
        .content as Array<Record<string, unknown>>
    );
    assert.equal(content.length, 2);
    assert.equal(content[1]?.type, "input_image");
    assert.match(String(content[1]?.image_url), /^data:image\/png;base64,/);
  });

  it("maps unknown failure kinds and derives flagged from failures", async () => {
    const fetchImpl = (async () =>
      responsesMessage('{"explanation": "x", "failures": [{"fieldId": "a", "kind": "bogus"}, {"nope": 1}]}')) as unknown as typeof fetch;
    const out = await new RealSparkAdapter({ fetchImpl }).escalate({
      readings: [],
      crops: [],
      question: "q",
    });
    assert.deepEqual(out.judgment, {
      flagged: true,
      failures: [{ fieldId: "a", kind: "field_match", passed: false, detail: undefined }],
    });
  });

  it("falls back to raw text without JSON, and to empty-response without text", async () => {
    const plain = (async () => responsesMessage("just prose")) as unknown as typeof fetch;
    const prose = await new RealSparkAdapter({ fetchImpl: plain }).escalate({
      readings: [],
      crops: [],
      question: "q",
    });
    assert.equal(prose.explanation, "just prose");
    assert.equal(prose.judgment, undefined);
    assert.deepEqual(prose.proposedFixes, []);

    const empty = (async () =>
      new Response(JSON.stringify({ object: "response", status: "incomplete", output: [] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const none = await new RealSparkAdapter({ fetchImpl: empty }).escalate({
      readings: [],
      crops: [],
      question: "q",
    });
    assert.equal(none.explanation, "spark: empty response");
  });

  it("discounts cached input tokens in costUsd", async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          object: "response",
          status: "completed",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: '{"explanation": "ok", "flagged": false}', annotations: [] }],
              status: "completed",
            },
          ],
          usage: {
            input_tokens: 1000,
            input_tokens_details: { cached_tokens: 400 },
            output_tokens: 100,
            total_tokens: 1100,
          },
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const out = await new RealSparkAdapter({ fetchImpl }).escalate({
      readings: [],
      crops: [],
      question: "q",
    });
    assert.deepEqual(out.usage, { inputTokens: 1000, outputTokens: 100, cachedInputTokens: 400 });
    assert.equal(out.costUsd, sparkCostUsd(1000, 100, 400));
    assert.ok(out.costUsd < sparkCostUsd(1000, 100, 0));
  });

  it("parses the unreadable field list when present", async () => {
    const fetchImpl = (async () =>
      responsesMessage(
        '{"explanation": "blur", "flagged": false, "unreadable": ["awb.awbNumber", 7]}',
      )) as unknown as typeof fetch;
    const out = await new RealSparkAdapter({ fetchImpl }).escalate({
      readings: [],
      crops: [],
      question: "q",
    });
    assert.deepEqual(out.unreadable, ["awb.awbNumber"]);

    const plain = (async () =>
      responsesMessage('{"explanation": "ok", "flagged": false}')) as unknown as typeof fetch;
    const readable = await new RealSparkAdapter({ fetchImpl: plain }).escalate({
      readings: [],
      crops: [],
      question: "q",
    });
    assert.equal(readable.unreadable, undefined);
  });

  it("retries a 429 through the shared transport", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return new Response("busy", { status: 429 });
      return responsesMessage('{"explanation": "recovered", "flagged": false}');
    }) as unknown as typeof fetch;
    const out = await new RealSparkAdapter({
      fetchImpl,
      retry: { sleep: async () => {} },
    }).escalate({ readings: [], crops: [], question: "q" });
    assert.equal(out.explanation, "recovered");
    assert.equal(getCallStats().httpCalls, 2);
    assert.equal(getCallStats().retriedCalls, 1);
  });
});
