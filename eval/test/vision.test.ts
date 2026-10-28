import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildForm } from "@second-look/generator";
import { resetCallStats } from "@second-look/pipeline";
import { createVisionArms, VISION_DOCS } from "../arms.ts";

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
      usage: { input_tokens: 11000, output_tokens: 400, total_tokens: 11400 },
    }),
    { status: 200 },
  );
}

const IMAGES = Object.fromEntries(
  VISION_DOCS.map((doc) => [doc, new Uint8Array([0x89, 0x50, doc.length])]),
);

describe("vision-real", () => {
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

  it("is unavailable without a key and wants images", () => {
    const [arm] = createVisionArms();
    assert.equal(arm?.name, "vision-real");
    assert.equal(arm?.available, false);
    assert.equal(arm?.stubbed, false);
    assert.equal(arm?.needsImages, true);
  });

  it("sends every document image with typed-only readings", async () => {
    process.env.MODEL_API_KEY = "test-key";
    const seen: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_url: string, init: { body?: string }) => {
      seen.push(JSON.parse(init.body ?? "{}") as Record<string, unknown>);
      return responsesMessage('{"explanation": "ok", "flagged": false}');
    }) as unknown as typeof fetch;
    const [arm] = createVisionArms({ fetchImpl });
    const verdict = await arm!.judge({ form: buildForm("form-v", 5), images: IMAGES });
    assert.equal(verdict.flagged, false);
    assert.equal(verdict.abstained, false);
    const content = (
      ((seen[0]?.input as Array<Record<string, unknown>>)[0] as Record<string, unknown>)
        .content as Array<Record<string, unknown>>
    );
    assert.equal(content.filter((part) => part.type === "input_image").length, 6);
    assert.match(String(content[0]?.text), /Vision judge/);
    assert.match(String(content[0]?.text), /paper=\?/);
    assert.equal(seen[0]?.max_output_tokens, 1536);
  });

  it("abstains when the model reports unreadable fields", async () => {
    process.env.MODEL_API_KEY = "test-key";
    const fetchImpl = (async () =>
      responsesMessage(
        '{"explanation": "glare", "flagged": false, "unreadable": ["awb.awbNumber"]}',
      )) as unknown as typeof fetch;
    const [arm] = createVisionArms({ fetchImpl });
    const verdict = await arm!.judge({ form: buildForm("form-v", 2), images: IMAGES });
    assert.equal(verdict.flagged, false);
    assert.equal(verdict.abstained, true);
  });

  it("abstains when the model reports low-confidence fields", async () => {
    process.env.MODEL_API_KEY = "test-key";
    const fetchImpl = (async () =>
      responsesMessage(
        '{"explanation": "skew", "flagged": true, "failures": [], "low_confidence": ["label.sscc", 7]}',
      )) as unknown as typeof fetch;
    const [arm] = createVisionArms({ fetchImpl });
    const verdict = await arm!.judge({ form: buildForm("form-v", 2), images: IMAGES });
    assert.equal(verdict.flagged, true);
    assert.equal(verdict.abstained, true);
  });

  it("asks for low-confidence fields in the same judge call", async () => {
    process.env.MODEL_API_KEY = "test-key";
    const seen: string[] = [];
    const fetchImpl = (async (_url: string, init: { body?: string }) => {
      seen.push(init.body ?? "");
      return responsesMessage('{"explanation": "ok", "flagged": false}');
    }) as unknown as typeof fetch;
    const [arm] = createVisionArms({ fetchImpl });
    await arm!.judge({ form: buildForm("form-v", 5), images: IMAGES });
    assert.equal(seen.length, 1);
    assert.match(seen[0] ?? "", /low_confidence/);
  });

  it("fails loudly without images or without a judgment", async () => {
    process.env.MODEL_API_KEY = "test-key";
    const fetchImpl = (async () =>
      responsesMessage('{"explanation": "ok", "flagged": false}')) as unknown as typeof fetch;
    const [arm] = createVisionArms({ fetchImpl });
    await assert.rejects(() => arm!.judge({ form: buildForm("form-v", 1) }), /no document images/);
    const prose = (async () => responsesMessage("just prose")) as unknown as typeof fetch;
    const [proseArm] = createVisionArms({ fetchImpl: prose });
    await assert.rejects(
      () => proseArm!.judge({ form: buildForm("form-v", 1), images: IMAGES }),
      /returned no judgment/,
    );
  });
});
