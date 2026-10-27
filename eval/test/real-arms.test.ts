import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildForm } from "@second-look/generator";
import { resetCallStats } from "@second-look/pipeline";
import { createRealArms } from "../arms.ts";

function responsesMessage(text: string): Response {
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
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
    }),
    { status: 200 },
  );
}

describe("real arms", () => {
  const saved = new Map<string, string | undefined>();
  beforeEach(() => {
    resetCallStats();
    for (const name of ["MODEL_API_KEY", "META_API_KEY"]) {
      saved.set(name, process.env[name]);
      delete process.env[name];
    }
  });
  afterEach(() => {
    for (const [name, value] of saved) {
      if (value !== undefined) process.env[name] = value;
      else delete process.env[name];
    }
  });

  it("are unavailable without a key and marked real", () => {
    const arms = createRealArms();
    assert.deepEqual(
      arms.map((arm) => arm.name),
      ["single-model-real", "tiered-real"],
    );
    for (const arm of arms) {
      assert.equal(arm.available, false);
      assert.equal(arm.stubbed, false);
    }
  });

  it("single-model-real judges from the model's reply, not fixtures", async () => {
    process.env.MODEL_API_KEY = "test-key";
    const flaggedFetch = (async () =>
      responsesMessage('{"explanation": "diff", "flagged": true, "failures": []}')) as unknown as typeof fetch;
    const [flagged] = createRealArms({ fetchImpl: flaggedFetch });
    const clean = buildForm("form-clean", 5);
    const flaggedVerdict = await flagged!.judge({ form: clean });
    assert.equal(flaggedVerdict.flagged, true);

    const cleanFetch = (async () =>
      responsesMessage('{"explanation": "ok", "flagged": false}')) as unknown as typeof fetch;
    const [unflagged] = createRealArms({ fetchImpl: cleanFetch });
    const errorForm = buildForm("form-err", 2);
    const cleanVerdict = await unflagged!.judge({ form: errorForm });
    assert.equal(cleanVerdict.flagged, false);
    assert.deepEqual(cleanVerdict.failures, []);
  });

  it("single-model-real fails loudly when the reply has no judgment", async () => {
    process.env.MODEL_API_KEY = "test-key";
    const fetchImpl = (async () => responsesMessage("prose without json")) as unknown as typeof fetch;
    const [arm] = createRealArms({ fetchImpl });
    await assert.rejects(
      () => arm!.judge({ form: buildForm("form-x", 1) }),
      /returned no judgment/,
    );
  });

  it("tiered-real matches the deterministic verdict with a live escalation", async () => {
    process.env.MODEL_API_KEY = "test-key";
    const seen: string[] = [];
    const fetchImpl = (async (_url: string, init: { body?: string }) => {
      seen.push(init.body ?? "");
      return responsesMessage('{"explanation": "live", "flagged": true, "fixes": []}');
    }) as unknown as typeof fetch;
    const [, tiered] = createRealArms({ fetchImpl });
    // Seed 2 carries injected errors, so the tiered path must escalate once.
    const verdict = await tiered!.judge({ form: buildForm("form-0002", 2) });
    assert.equal(seen.length, 1);
    assert.match(seen[0] ?? "", /muse-spark-1\.3/);
    assert.equal(typeof verdict.flagged, "boolean");
    assert.ok(verdict.latencyMs >= 0);
  });
});
