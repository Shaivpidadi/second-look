import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  callBudgetLimit,
  DEFAULT_CALL_BUDGET,
  getCallStats,
  postJson,
  recordUsage,
  resetCallStats,
} from "../src/index.ts";

function jsonResponse(payload: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), { status, headers });
}

describe("call budget", () => {
  beforeEach(() => {
    resetCallStats();
  });

  it("defaults to 300 and reads SECOND_LOOK_CALL_BUDGET", () => {
    assert.equal(callBudgetLimit({}), DEFAULT_CALL_BUDGET);
    assert.equal(callBudgetLimit({ SECOND_LOOK_CALL_BUDGET: "" }), DEFAULT_CALL_BUDGET);
    assert.equal(callBudgetLimit({ SECOND_LOOK_CALL_BUDGET: "5" }), 5);
    assert.throws(() => callBudgetLimit({ SECOND_LOOK_CALL_BUDGET: "many" }), /non-negative integer/);
    assert.throws(() => callBudgetLimit({ SECOND_LOOK_CALL_BUDGET: "-1" }), /non-negative integer/);
  });

  it("throws once the budget is exhausted", async () => {
    const budget = process.env.SECOND_LOOK_CALL_BUDGET;
    try {
      process.env.SECOND_LOOK_CALL_BUDGET = "1";
      const fetchImpl = (async () => jsonResponse({ ok: true })) as unknown as typeof fetch;
      await postJson({ fetchImpl, url: "https://x.test/v1/responses", key: "k", body: {}, what: "test" });
      await assert.rejects(
        () => postJson({ fetchImpl, url: "https://x.test/v1/responses", key: "k", body: {}, what: "test" }),
        /call budget exhausted/,
      );
      assert.equal(getCallStats().httpCalls, 1);
    } finally {
      if (budget !== undefined) process.env.SECOND_LOOK_CALL_BUDGET = budget;
      else delete process.env.SECOND_LOOK_CALL_BUDGET;
    }
  });
});

describe("postJson", () => {
  beforeEach(() => {
    resetCallStats();
  });

  it("posts JSON with the bearer key and returns the payload", async () => {
    const seen: Array<{ url: string; init: { headers?: Record<string, string>; body?: string } }> = [];
    const fetchImpl = (async (url: string, init: { headers?: Record<string, string>; body?: string }) => {
      seen.push({ url, init });
      return jsonResponse({ output_text: "hi" });
    }) as unknown as typeof fetch;
    const payload = await postJson({
      fetchImpl,
      url: "https://x.test/v1/responses",
      key: "secret",
      body: { model: "m" },
      what: "test",
    });
    assert.deepEqual(payload, { output_text: "hi" });
    assert.equal(seen[0]?.init.headers?.authorization, "Bearer secret");
    assert.deepEqual(JSON.parse(seen[0]?.init.body ?? "{}"), { model: "m" });
    assert.equal(getCallStats().httpCalls, 1);
  });

  it("retries 429/5xx with exponential backoff, then succeeds", async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls <= 2) return new Response("busy", { status: calls === 1 ? 429 : 503 });
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    const payload = await postJson({
      fetchImpl,
      url: "https://x.test/v1/responses",
      key: "k",
      body: {},
      what: "test",
      retry: { baseMs: 100, sleep: async (ms) => { waits.push(ms); } },
    });
    assert.deepEqual(payload, { ok: true });
    assert.deepEqual(waits, [100, 200]);
    assert.equal(getCallStats().httpCalls, 3);
    assert.equal(getCallStats().retriedCalls, 2);
  });

  it("honors Retry-After up to the ceiling", async () => {
    const waits: number[] = [];
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      if (calls === 1) return new Response("slow", { status: 429, headers: { "retry-after": "2" } });
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    await postJson({
      fetchImpl,
      url: "https://x.test/v1/responses",
      key: "k",
      body: {},
      what: "test",
      retry: { baseMs: 100, sleep: async (ms) => { waits.push(ms); } },
    });
    assert.deepEqual(waits, [2000]);
  });

  it("gives up after max retries and reports the status", async () => {
    const fetchImpl = (async () => new Response("down", { status: 500 })) as unknown as typeof fetch;
    await assert.rejects(
      () =>
        postJson({
          fetchImpl,
          url: "https://x.test/v1/responses",
          key: "k",
          body: {},
          what: "spark",
          retry: { maxRetries: 1, sleep: async () => {} },
        }),
      /spark: Model API request failed with status 500: down/,
    );
    assert.equal(getCallStats().httpCalls, 2);
  });

  it("does not retry 4xx other than 429", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      return new Response("no such model", { status: 404 });
    }) as unknown as typeof fetch;
    await assert.rejects(
      () =>
        postJson({
          fetchImpl,
          url: "https://x.test/v1/responses",
          key: "k",
          body: {},
          what: "sam",
          retry: { sleep: async () => {} },
        }),
      /status 404/,
    );
    assert.equal(calls, 1);
  });

  it("wraps transport failures without retrying", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls += 1;
      throw new Error("connect ECONNREFUSED");
    }) as unknown as typeof fetch;
    await assert.rejects(
      () =>
        postJson({ fetchImpl, url: "http://127.0.0.1:1/v1/responses", key: "k", body: {}, what: "spark" }),
      /spark: Model API request failed \(connect ECONNREFUSED\)/,
    );
    assert.equal(calls, 1);
  });
});

describe("call stats", () => {
  it("accumulates usage and resets", () => {
    resetCallStats();
    recordUsage(10, 5);
    recordUsage(0, 0);
    recordUsage(Number.NaN, 3);
    assert.deepEqual(getCallStats(), { httpCalls: 0, retriedCalls: 0, inputTokens: 10, outputTokens: 8 });
    resetCallStats();
    assert.deepEqual(getCallStats(), { httpCalls: 0, retriedCalls: 0, inputTokens: 0, outputTokens: 0 });
  });
});
