import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertSingleConcept,
  createSamAdapter,
  defaultDocumentBox,
  extractBoxes,
  RealSamAdapter,
  StubSamAdapter,
} from "../src/index.ts";

const FRAME = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);

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

describe("assertSingleConcept", () => {
  it("accepts one noun phrase", () => {
    assert.equal(assertSingleConcept("shipping document"), "shipping document");
    assert.equal(assertSingleConcept("  address label "), "address label");
  });

  it("rejects empty, multi-concept, and sentence inputs", () => {
    for (const bad of ["", "   ", "shipping document, address label", "find the doc."]) {
      assert.throws(() => assertSingleConcept(bad), /one noun phrase/);
    }
  });
});

describe("StubSamAdapter", () => {
  const stub = new StubSamAdapter();

  it("returns one crop per ground-truth box, deterministically", async () => {
    const input = {
      image: FRAME,
      concept: "shipping document",
      frameWidth: 720,
      frameHeight: 1280,
      groundTruth: [
        { x: 10, y: 20, width: 700, height: 1200 },
        { x: 40, y: 80, width: 300, height: 60 },
      ],
    };
    const first = await stub.crop(input);
    const second = await stub.crop(input);
    assert.deepEqual(first.crops, second.crops);
    assert.equal(first.crops.length, 2);
    assert.deepEqual(first.crops[0]?.box, { x: 10, y: 20, width: 700, height: 1200 });
    assert.deepEqual(first.crops[1]?.box, { x: 40, y: 80, width: 300, height: 60 });
    assert.equal(first.crops[0]?.image, FRAME);
    assert.equal(first.costUsd, 0);
    assert.ok(first.latencyMs >= 0);
  });

  it("falls back to a centered document box without ground truth", async () => {
    const out = await stub.crop({
      image: FRAME,
      concept: "shipping document",
      frameWidth: 720,
      frameHeight: 1280,
    });
    assert.equal(out.crops.length, 1);
    assert.deepEqual(out.crops[0]?.box, defaultDocumentBox(720, 1280));
  });

  it("rejects multi-concept requests like the real API would", async () => {
    await assert.rejects(
      () => stub.crop({ image: FRAME, concept: "doc, label" }),
      /one noun phrase/,
    );
  });
});

describe("defaultDocumentBox", () => {
  it("insets a 4% margin inside the frame", () => {
    assert.deepEqual(defaultDocumentBox(1000, 1400), {
      x: 40,
      y: 56,
      width: 920,
      height: 1288,
    });
  });
});

describe("extractBoxes", () => {
  it("reads pixel boxes across shapes", () => {
    const payload = {
      boxes: [
        { x: 10, y: 20, width: 100, height: 200 },
        { x_min: 5, y_min: 6, x_max: 55, y_max: 106 },
        [1, 2, 30, 40],
      ],
    };
    assert.deepEqual(extractBoxes(payload, 720, 1280), [
      { x: 10, y: 20, width: 100, height: 200 },
      { x: 5, y: 6, width: 50, height: 100 },
      { x: 1, y: 2, width: 30, height: 40 },
    ]);
  });

  it("scales 0-1 fractions to frame pixels", () => {
    const payload = { output: [{ content: [{ text: '{"boxes":[{"x":0.1,"y":0.2,"width":0.5,"height":0.25}]}' }] }] };
    assert.deepEqual(extractBoxes(payload, 1000, 2000), [
      { x: 100, y: 400, width: 500, height: 500 },
    ]);
  });

  it("returns no boxes for unrecognized payloads", () => {
    assert.deepEqual(extractBoxes({ output_text: "no boxes here" }, 720, 1280), []);
    assert.deepEqual(extractBoxes(null, 720, 1280), []);
  });
});

describe("RealSamAdapter", () => {
  it("fails cleanly naming the key env vars when no key exists", async () => {
    await withCleanKeys(async () => {
      await assert.rejects(
        () => new RealSamAdapter().crop({ image: FRAME, concept: "shipping document" }),
        /MODEL_API_KEY/,
      );
    });
  });

  it("reads the key at call time, then attempts the call", async () => {
    const model = process.env.MODEL_API_KEY;
    try {
      process.env.MODEL_API_KEY = "test-key";
      const adapter = new RealSamAdapter({ baseUrl: "http://127.0.0.1:1" });
      await assert.rejects(
        () => adapter.crop({ image: FRAME, concept: "shipping document" }),
        /Model API request failed/,
      );
    } finally {
      if (model !== undefined) process.env.MODEL_API_KEY = model;
      else delete process.env.MODEL_API_KEY;
    }
  });

  it("posts one concept plus the frame and parses boxes", async () => {
    const seen: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: string, init: { body?: string }) => {
      seen.push({ url, body: JSON.parse(init.body ?? "{}") as Record<string, unknown> });
      return new Response(JSON.stringify({ boxes: [{ x: 1, y: 2, width: 10, height: 20 }] }), {
        status: 200,
      });
    }) as unknown as typeof fetch;
    const model = process.env.MODEL_API_KEY;
    try {
      process.env.MODEL_API_KEY = "test-key";
      const out = await new RealSamAdapter({ baseUrl: "https://sam.test/v1", fetchImpl }).crop({
        image: FRAME,
        concept: "shipping document",
      });
      assert.equal(seen.length, 1);
      assert.equal(seen[0]?.url, "https://sam.test/v1/responses");
      assert.equal(seen[0]?.body.model, "sam-3.1");
      assert.match(JSON.stringify(seen[0]?.body), /shipping document/);
      assert.deepEqual(
        out.crops.map((c) => c.box),
        [{ x: 1, y: 2, width: 10, height: 20 }],
      );
      assert.ok(out.latencyMs >= 0);
    } finally {
      if (model !== undefined) process.env.MODEL_API_KEY = model;
      else delete process.env.MODEL_API_KEY;
    }
  });

  it("surfaces non-2xx statuses as clean errors", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    const model = process.env.MODEL_API_KEY;
    try {
      process.env.MODEL_API_KEY = "test-key";
      await assert.rejects(
        () =>
          new RealSamAdapter({ fetchImpl }).crop({ image: FRAME, concept: "shipping document" }),
        /status 404/,
      );
    } finally {
      if (model !== undefined) process.env.MODEL_API_KEY = model;
      else delete process.env.MODEL_API_KEY;
    }
  });
});

describe("createSamAdapter", () => {
  it("defaults to the stub and builds the real adapter on request", () => {
    assert.equal(createSamAdapter().name, "stub");
    assert.equal(createSamAdapter("stub").name, "stub");
    assert.equal(createSamAdapter("real").name, "real");
  });
});
