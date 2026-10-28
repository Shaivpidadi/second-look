import test from "node:test";
import assert from "node:assert/strict";
import {
  createPipelineAdapters,
  createSamAdapter,
  encodeGrayToJpeg,
  type PipelineAdapters,
  type SamAdapter,
  type SamCropInput,
  type SamCropOutput,
  type SparkAdapter,
  type SparkEscalationInput,
  type SparkEscalationOutput,
} from "@second-look/pipeline";
import {
  __resetFramePath,
  FRAME_CROSSDOC_FIELD_ID,
  FRAME_FIELD_ID,
  FRAME_JUDGE_LONG_SIDE,
  FRAME_MODEL_CALLS_PER_CHECK,
  frameStateFor,
  handleFramePost,
  isNearDuplicate,
  MAX_DOC_FIELDS,
  MAX_FRAME_MODEL_CALLS_PER_MIN,
  MAX_SESSION_DOCS,
  parseFrameDataUrl,
  pruneFrameSessions,
  REJUDGE_AFTER_MS,
  runFrameCheck,
  SESSION_IDLE_MS,
  storeFrameDocument,
  tryReserveFrameCalls,
  type FrameCheckResult,
  type FrameDedupeKey,
  type SessionFrameState,
} from "./frame-path.ts";
import {
  __resetLiveVerdictBus,
  subscribeLiveVerdicts,
  type PublishedVerdict,
} from "./verdict-bus.ts";

function jpegDataUrl(gray: Uint8Array, width: number, height: number): string {
  const base64 = Buffer.from(encodeGrayToJpeg(gray, width, height)).toString("base64");
  return `data:image/jpeg;base64,${base64}`;
}

/**
 * 32x32 frame: deterministic noise (even i) or flat mid-gray (odd i).
 * The two patterns sit ~32 dhash bits apart, so alternating them
 * always cuts a new keyframe.
 */
function stripeFrame(i: number): { gray: Uint8Array; width: number; height: number } {
  const width = 32;
  const height = 32;
  const gray = new Uint8Array(width * height).fill(128);
  if (i % 2 === 0) {
    let seed = 42;
    for (let p = 0; p < gray.length; p++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      gray[p] = (seed >> 16) & 0xff;
    }
  }
  return { gray, width, height };
}

function stubAdapters(): PipelineAdapters {
  return createPipelineAdapters("stub");
}

function freshState(): SessionFrameState {
  return {
    lastKey: null,
    lastJudgeMs: 0,
    callTimestamps: [],
    documents: new Map(),
    lastSeenMs: 0,
    lastCrossDocKey: null,
  };
}

function dedupeKey(dhash: bigint, ink: number[]): FrameDedupeKey {
  return { dhash, ink };
}

function judgingSpark(output: Partial<SparkEscalationOutput>): SparkAdapter {
  return {
    name: "fake-judge",
    async escalate(_input: SparkEscalationInput): Promise<SparkEscalationOutput> {
      return {
        explanation: "fake",
        proposedFixes: [],
        latencyMs: 1,
        costUsd: 0,
        ...output,
      };
    },
  };
}

function judgingSparkSequence(outputs: Array<Partial<SparkEscalationOutput>>): SparkAdapter {
  let at = 0;
  return {
    name: "fake-sequence",
    async escalate(_input: SparkEscalationInput): Promise<SparkEscalationOutput> {
      const partial = outputs[Math.min(at, outputs.length - 1)]!;
      at++;
      return {
        explanation: "fake",
        proposedFixes: [],
        latencyMs: 1,
        costUsd: 0,
        ...partial,
      };
    },
  };
}

async function postFrame(
  sessionId: string,
  index: number,
  spark: SparkAdapter,
  nowMs?: number,
): Promise<FrameCheckResult | null> {
  const frame = stripeFrame(index);
  const posted = handleFramePost({
    sessionId,
    value: jpegDataUrl(frame.gray, frame.width, frame.height),
    typedValues: {},
    adapters: { ...stubAdapters(), spark },
    nowMs,
  });
  assert.equal(posted.outcome, "accepted");
  if (posted.outcome !== "accepted") throw new Error("unreachable");
  return posted.done;
}

/** 64x64 mid-gray frame with a dark band across the top or bottom. */
function bandFrame(top: boolean): { gray: Uint8Array; width: number; height: number } {
  const width = 64;
  const height = 64;
  const gray = new Uint8Array(width * height).fill(200);
  const y0 = top ? 0 : 56;
  for (let y = y0; y < y0 + 8; y++) {
    for (let x = 0; x < width; x++) gray[y * width + x] = 20;
  }
  return { gray, width, height };
}

test("frame: parses valid JPEG and PNG data URLs", () => {
  const frame = stripeFrame(0);
  const jpeg = parseFrameDataUrl(jpegDataUrl(frame.gray, frame.width, frame.height));
  assert.ok("frame" in jpeg);
  assert.equal(jpeg.frame.mime, "image/jpeg");
  assert.ok(jpeg.frame.bytes.length > 0);
  const png = parseFrameDataUrl("data:image/png;base64,aGVsbG8=");
  assert.ok("frame" in png);
  assert.equal(png.frame.mime, "image/png");
});

test("frame: rejects bad mime, bad base64, and oversized frames", () => {
  assert.deepEqual(parseFrameDataUrl("data:image/gif;base64,aGVsbG8="), { error: "bad_frame_mime" });
  assert.deepEqual(parseFrameDataUrl("aGVsbG8="), { error: "bad_frame_mime" });
  assert.deepEqual(parseFrameDataUrl("data:image/jpeg;base64,"), { error: "bad_frame_mime" });
  assert.deepEqual(parseFrameDataUrl("data:image/jpeg;base64,***"), { error: "bad_frame_base64" });
  assert.deepEqual(parseFrameDataUrl("data:image/jpeg;base64,abcde"), { error: "bad_frame_base64" });
  const huge = `data:image/jpeg;base64,${"A".repeat(3_000_000)}`;
  assert.deepEqual(parseFrameDataUrl(huge), { error: "frame_too_large" });
});

test("frame: near-duplicate detection honors both thresholds", () => {
  assert.equal(isNearDuplicate(null, dedupeKey(0n, [0])), false);
  assert.equal(isNearDuplicate(dedupeKey(0b1010n, [0]), dedupeKey(0b1010n, [0])), true);
  assert.equal(isNearDuplicate(dedupeKey(0n, [0]), dedupeKey((1n << 8n) - 1n, [0])), false);
  assert.equal(isNearDuplicate(dedupeKey(0n, [0]), dedupeKey((1n << 7n) - 1n, [0])), true);
  assert.equal(isNearDuplicate(dedupeKey(0n, [0]), dedupeKey(0n, [0.54])), true);
  assert.equal(isNearDuplicate(dedupeKey(0n, [0]), dedupeKey(0n, [0.55])), false);
  assert.equal(isNearDuplicate(dedupeKey(0n, [0]), dedupeKey(0b111n, [9]), 4), false);
  assert.equal(isNearDuplicate(dedupeKey(0n, [0]), dedupeKey(0n, [0]), 8, 0.1), true);
});

test("frame: throttle reserves up to the per-minute cap, then refuses", () => {
  const state = freshState();
  for (let i = 0; i < 5; i++) {
    assert.equal(tryReserveFrameCalls(state, FRAME_MODEL_CALLS_PER_CHECK, 0), true);
  }
  assert.equal(state.callTimestamps.length, MAX_FRAME_MODEL_CALLS_PER_MIN);
  assert.equal(tryReserveFrameCalls(state, FRAME_MODEL_CALLS_PER_CHECK, 0), false);
  assert.equal(tryReserveFrameCalls(state, FRAME_MODEL_CALLS_PER_CHECK, 59_999), false);
  assert.equal(tryReserveFrameCalls(state, FRAME_MODEL_CALLS_PER_CHECK, 60_000), true);
});

test("frame: stub check judges clean with no network", async () => {
  const frame = stripeFrame(1);
  const result = await runFrameCheck({
    image: encodeGrayToJpeg(frame.gray, frame.width, frame.height),
    frameWidth: frame.width,
    frameHeight: frame.height,
    typedValues: { "awb.awbNumber": "02027342210" },
    adapters: stubAdapters(),
  });
  assert.equal(result.state, "clean");
  assert.equal(result.decision, "ALLOW");
  assert.deepEqual(result.failures, []);
  assert.equal(result.boxes, 1);
});

test("frame: judgment failures map to blocked/mismatch with fixes", async () => {
  const sam: SamAdapter = createSamAdapter("stub");
  const blocked = await runFrameCheck({
    image: new Uint8Array([0xff, 0xd8]),
    frameWidth: 32,
    frameHeight: 32,
    typedValues: {},
    adapters: {
      sam,
      glimmer: stubAdapters().glimmer,
      spark: judgingSpark({
        judgment: {
          flagged: true,
          failures: [{ fieldId: "awb.awbNumber", kind: "check_digit", passed: false }],
        },
        proposedFixes: [{ fieldId: "awb.awbNumber", paperValue: "02027342210", typedValue: "x" }],
      }),
    },
  });
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.decision, "BLOCK");
  assert.equal(blocked.failures[0]?.fix, "02027342210");
  const mismatch = await runFrameCheck({
    image: new Uint8Array([0xff, 0xd8]),
    frameWidth: 32,
    frameHeight: 32,
    typedValues: {},
    adapters: {
      sam,
      glimmer: stubAdapters().glimmer,
      spark: judgingSpark({
        judgment: {
          flagged: true,
          failures: [
            { fieldId: "invoice.totalQty", kind: "cross_doc", passed: false, detail: "gap" },
          ],
        },
      }),
    },
  });
  assert.equal(mismatch.state, "mismatch");
  assert.equal(mismatch.decision, "ALLOW");
  assert.equal(mismatch.failures[0]?.message, "gap");
});

test("frame: unreadable fields abstain to needs-human", async () => {
  const result = await runFrameCheck({
    image: new Uint8Array([0xff, 0xd8]),
    frameWidth: 32,
    frameHeight: 32,
    typedValues: {},
    adapters: {
      sam: createSamAdapter("stub"),
      glimmer: stubAdapters().glimmer,
      spark: judgingSpark({
        judgment: { flagged: false, failures: [] },
        unreadable: ["awb.awbNumber"],
        lowConfidence: ["bol.containerNumber"],
      }),
    },
  });
  assert.equal(result.state, "needs-human");
  assert.equal(result.decision, "ALLOW");
  assert.deepEqual(
    result.failures.map((f) => f.rule),
    ["unreadable", "low_confidence"],
  );
});

test("frame: post accepts, then drops the duplicate, publishing once", async () => {
  __resetFramePath();
  __resetLiveVerdictBus();
  const sessionId = "frame-dedupe";
  const seen: PublishedVerdict[] = [];
  subscribeLiveVerdicts(sessionId, (verdict) => seen.push(verdict));
  const frame = stripeFrame(2);
  const value = jpegDataUrl(frame.gray, frame.width, frame.height);
  const first = handleFramePost({
    sessionId,
    value,
    typedValues: {},
    adapters: stubAdapters(),
  });
  assert.equal(first.outcome, "accepted");
  if (first.outcome !== "accepted") throw new Error("unreachable");
  const judged = await first.done;
  assert.equal(judged?.state, "clean");
  const second = handleFramePost({
    sessionId,
    value,
    typedValues: {},
    adapters: stubAdapters(),
  });
  assert.equal(second.outcome, "duplicate");
  assert.equal(seen.length, 1);
  assert.equal(seen[0]?.fieldId, FRAME_FIELD_ID);
  assert.equal(seen[0]?.state, "clean");
});

test("frame: corrupt images and bad values never reach the judge", () => {
  __resetFramePath();
  __resetLiveVerdictBus();
  const adapters = stubAdapters();
  const corrupt = Buffer.from([0xff, 0xd8, 0x00, 0x01]).toString("base64");
  assert.deepEqual(
    handleFramePost({ sessionId: "frame-bad", value: `data:image/jpeg;base64,${corrupt}`, typedValues: {}, adapters }),
    { outcome: "undecodable" },
  );
  const rejected = handleFramePost({
    sessionId: "frame-bad",
    value: "not-a-data-url",
    typedValues: {},
    adapters,
  });
  assert.deepEqual(rejected, { outcome: "rejected", error: "bad_frame_mime" });
});

test("frame: a second document triggers a cross-doc conflict verdict", async () => {
  __resetFramePath();
  __resetLiveVerdictBus();
  const sessionId = "frame-crossdoc";
  const seen: PublishedVerdict[] = [];
  subscribeLiveVerdicts(sessionId, (verdict) => seen.push(verdict));
  const spark = judgingSparkSequence([
    {
      judgment: { flagged: false, failures: [] },
      document: "bol",
      paperReadings: { "bol.weightKg": "1000" },
    },
    {
      judgment: { flagged: false, failures: [] },
      document: "awb",
      paperReadings: { "awb.weightKg": "2000" },
    },
  ]);
  await postFrame(sessionId, 0, spark);
  await postFrame(sessionId, 1, spark);
  const cross = seen.filter((v) => v.fieldId === FRAME_CROSSDOC_FIELD_ID);
  assert.equal(cross.length, 1);
  assert.equal(cross[0]?.state, "mismatch");
  assert.equal(cross[0]?.decision, "ALLOW");
  assert.equal(cross[0]?.failures[0]?.fieldId, "awb.weightKg");
  assert.equal(
    cross[0]?.failures[0]?.message,
    "BOL weight 1000kg vs AWB weight 2000kg (tolerance 0kg)",
  );
});

test("frame: consistent pair stays quiet, conflict then resolution publish", async () => {
  __resetFramePath();
  __resetLiveVerdictBus();
  const sessionId = "frame-crossdoc-quiet";
  const seen: PublishedVerdict[] = [];
  subscribeLiveVerdicts(sessionId, (verdict) => seen.push(verdict));
  const spark = judgingSparkSequence([
    { judgment: { flagged: false, failures: [] }, document: "bol", paperReadings: { "bol.weightKg": "1000" } },
    { judgment: { flagged: false, failures: [] }, document: "awb", paperReadings: { "awb.weightKg": "1000" } },
    { judgment: { flagged: false, failures: [] }, document: "awb", paperReadings: { "awb.weightKg": "2000" } },
    { judgment: { flagged: false, failures: [] }, document: "awb", paperReadings: { "awb.weightKg": "1000" } },
  ]);
  await postFrame(sessionId, 0, spark);
  await postFrame(sessionId, 1, spark);
  assert.deepEqual(
    seen.filter((v) => v.fieldId === FRAME_CROSSDOC_FIELD_ID),
    [],
  );
  await postFrame(sessionId, 2, spark);
  await postFrame(sessionId, 3, spark);
  assert.deepEqual(
    seen.filter((v) => v.fieldId === FRAME_CROSSDOC_FIELD_ID).map((v) => v.state),
    ["mismatch", "clean"],
  );
});

test("frame: bare reading names gain the doc-type prefix", () => {
  const state = freshState();
  assert.equal(
    storeFrameDocument(state, "BOL", { weightKg: "1000" }, "h1", 0),
    true,
  );
  assert.deepEqual(state.documents.get("bol")?.fields, { "bol.weightKg": "1000" });
  assert.equal(storeFrameDocument(state, "awb", { "awb.weightKg": "2000" }, "h2", 0), true);
  assert.equal(state.documents.size, 2);
});

test("frame: document memory caps entries, fields, and rejects junk", () => {
  const state = freshState();
  for (let i = 0; i < MAX_SESSION_DOCS + 2; i++) {
    assert.equal(storeFrameDocument(state, `doc-${i}`, { [`f${i}`]: "v" }, `h${i}`, i), true);
  }
  assert.equal(state.documents.size, MAX_SESSION_DOCS);
  assert.equal(state.documents.has("doc-0"), false);
  assert.equal(state.documents.has(`doc-${MAX_SESSION_DOCS + 1}`), true);
  const many: Record<string, string> = {};
  for (let i = 0; i < MAX_DOC_FIELDS + 10; i++) many[`k${i}`] = "v";
  assert.equal(storeFrameDocument(state, "big", many, "h", 0), true);
  assert.equal(Object.keys(state.documents.get("big")?.fields ?? {}).length, MAX_DOC_FIELDS);
  assert.equal(storeFrameDocument(state, "BOL!!!", { a: "b" }, "h", 0), false);
  assert.equal(storeFrameDocument(state, undefined, { a: "b" }, "h", 0), false);
  assert.equal(storeFrameDocument(state, "bol", undefined, "h", 0), false);
  assert.equal(storeFrameDocument(state, "bol", {}, "h", 0), false);
});

test("frame: idle sessions lose their document memory", async () => {
  __resetFramePath();
  __resetLiveVerdictBus();
  const sessionId = "frame-expiry";
  const seen: PublishedVerdict[] = [];
  subscribeLiveVerdicts(sessionId, (verdict) => seen.push(verdict));
  const spark = judgingSparkSequence([
    { judgment: { flagged: false, failures: [] }, document: "bol", paperReadings: { "bol.weightKg": "1000" } },
    { judgment: { flagged: false, failures: [] }, document: "awb", paperReadings: { "awb.weightKg": "2000" } },
  ]);
  await postFrame(sessionId, 0, spark, 0);
  await postFrame(sessionId, 1, spark, SESSION_IDLE_MS + 1);
  assert.deepEqual(
    seen.filter((v) => v.fieldId === FRAME_CROSSDOC_FIELD_ID),
    [],
  );
  assert.equal(pruneFrameSessions(SESSION_IDLE_MS * 3), 1);
  assert.equal(pruneFrameSessions(SESSION_IDLE_MS * 3), 0);
});

test("frame: dhash-near but ink-far frames still judge", async () => {
  __resetFramePath();
  __resetLiveVerdictBus();
  const sessionId = "frame-ink";
  const adapters = stubAdapters();
  const top = bandFrame(true);
  const first = handleFramePost({
    sessionId,
    value: jpegDataUrl(top.gray, top.width, top.height),
    typedValues: {},
    adapters,
  });
  assert.equal(first.outcome, "accepted");
  if (first.outcome === "accepted") await first.done;
  const bottom = bandFrame(false);
  const second = handleFramePost({
    sessionId,
    value: jpegDataUrl(bottom.gray, bottom.width, bottom.height),
    typedValues: {},
    adapters,
  });
  assert.equal(second.outcome, "accepted");
  if (second.outcome === "accepted") await second.done;
  const repeat = handleFramePost({
    sessionId,
    value: jpegDataUrl(bottom.gray, bottom.width, bottom.height),
    typedValues: {},
    adapters,
  });
  assert.equal(repeat.outcome, "duplicate");
});

test("frame: stale near-duplicates re-judge after the window", async () => {
  __resetFramePath();
  __resetLiveVerdictBus();
  const sessionId = "frame-rejudge";
  const spark = judgingSpark({ judgment: { flagged: false, failures: [] } });
  await postFrame(sessionId, 0, spark, 0);
  const frame = stripeFrame(0);
  const stale = handleFramePost({
    sessionId,
    value: jpegDataUrl(frame.gray, frame.width, frame.height),
    typedValues: {},
    adapters: { ...stubAdapters(), spark },
    nowMs: REJUDGE_AFTER_MS + 1,
  });
  assert.equal(stale.outcome, "accepted");
  if (stale.outcome === "accepted") await stale.done;
  const fresh = handleFramePost({
    sessionId,
    value: jpegDataUrl(frame.gray, frame.width, frame.height),
    typedValues: {},
    adapters: { ...stubAdapters(), spark },
    nowMs: REJUDGE_AFTER_MS + 2,
  });
  assert.equal(fresh.outcome, "duplicate");
});

test("frame: the model sees a downscaled image on big frames", async () => {
  __resetFramePath();
  __resetLiveVerdictBus();
  const captured: { image?: Uint8Array; width?: number; height?: number } = {};
  const spark: SparkAdapter = {
    name: "fake-capture",
    async escalate(input: SparkEscalationInput): Promise<SparkEscalationOutput> {
      captured.image = input.crops[0]?.image;
      captured.width = input.crops[0]?.box.width;
      captured.height = input.crops[0]?.box.height;
      return {
        explanation: "fake",
        proposedFixes: [],
        latencyMs: 1,
        costUsd: 0,
        judgment: { flagged: false, failures: [] },
      };
    },
  };
  const gray = new Uint8Array(1000 * 1600).fill(200);
  const posted = handleFramePost({
    sessionId: "frame-downscale",
    value: jpegDataUrl(gray, 1000, 1600),
    typedValues: {},
    adapters: { ...stubAdapters(), spark },
  });
  assert.equal(posted.outcome, "accepted");
  if (posted.outcome === "accepted") await posted.done;
  assert.ok(captured.image && captured.image.length > 2);
  assert.equal(captured.image?.[0], 0xff);
  assert.equal(captured.image?.[1], 0xd8);
  assert.ok(Math.max(captured.width ?? 0, captured.height ?? 0) <= FRAME_JUDGE_LONG_SIDE);
});

test("frame: re-shown documents skip the localizer and reserve one call", async () => {
  __resetFramePath();
  __resetLiveVerdictBus();
  const sessionId = "frame-hashskip";
  const throwingSam: SamAdapter = {
    name: "fake-throw",
    async crop(_input: SamCropInput): Promise<SamCropOutput> {
      throw new Error("sam boom");
    },
  };
  const spark = judgingSparkSequence([
    { judgment: { flagged: false, failures: [] }, document: "d0", paperReadings: { "d0.a": "1" } },
    { judgment: { flagged: false, failures: [] }, document: "d1", paperReadings: { "d1.a": "1" } },
    { judgment: { flagged: false, failures: [] }, document: "d0", paperReadings: { "d0.a": "1" } },
  ]);
  await postFrame(sessionId, 0, spark);
  await postFrame(sessionId, 1, spark);
  const frame = stripeFrame(0);
  const third = handleFramePost({
    sessionId,
    value: jpegDataUrl(frame.gray, frame.width, frame.height),
    typedValues: {},
    adapters: { sam: throwingSam, glimmer: stubAdapters().glimmer, spark },
  });
  assert.equal(third.outcome, "accepted");
  if (third.outcome !== "accepted") throw new Error("unreachable");
  const result = await third.done;
  assert.equal(result?.boxesSkipped, true);
  assert.equal(frameStateFor(sessionId).callTimestamps.length, 5);
});

test("frame: boxes failure still publishes the judge verdict", async () => {
  const throwingSam: SamAdapter = {
    name: "fake-throw",
    async crop(_input: SamCropInput): Promise<SamCropOutput> {
      throw new Error("sam boom");
    },
  };
  const boxErrors: unknown[] = [];
  const result = await runFrameCheck({
    image: new Uint8Array([0xff, 0xd8]),
    frameWidth: 32,
    frameHeight: 32,
    typedValues: {},
    adapters: { ...stubAdapters(), sam: throwingSam },
    onBoxesError: (error) => boxErrors.push(error),
  });
  assert.equal(result.state, "clean");
  assert.equal(result.boxes, 0);
  assert.equal(boxErrors.length, 1);
});

test("frame: judge failure resolves null and reports", async () => {
  __resetFramePath();
  __resetLiveVerdictBus();
  const failingSpark: SparkAdapter = {
    name: "fake-fail",
    async escalate(_input: SparkEscalationInput): Promise<SparkEscalationOutput> {
      throw new Error("judge boom");
    },
  };
  const errors: Array<[string, unknown]> = [];
  const frame = stripeFrame(4);
  const posted = handleFramePost({
    sessionId: "frame-judgefail",
    value: jpegDataUrl(frame.gray, frame.width, frame.height),
    typedValues: {},
    adapters: { ...stubAdapters(), spark: failingSpark },
    onError: (message, error) => errors.push([message, error]),
  });
  assert.equal(posted.outcome, "accepted");
  if (posted.outcome !== "accepted") throw new Error("unreachable");
  assert.equal(await posted.done, null);
  assert.equal(errors.length, 1);
  assert.ok(errors[0]?.[0].startsWith("frame check failed"));
});

test("frame: over-budget frames publish a visible throttled verdict", async () => {
  __resetFramePath();
  __resetLiveVerdictBus();
  const sessionId = "frame-throttle";
  const seen: PublishedVerdict[] = [];
  subscribeLiveVerdicts(sessionId, (verdict) => seen.push(verdict));
  const adapters = stubAdapters();
  const pending: Array<Promise<unknown>> = [];
  for (let i = 0; i < 5; i++) {
    const frame = stripeFrame(i);
    const posted = handleFramePost({
      sessionId,
      value: jpegDataUrl(frame.gray, frame.width, frame.height),
      typedValues: {},
      adapters,
      nowMs: 0,
    });
    assert.equal(posted.outcome, "accepted");
    if (posted.outcome === "accepted") pending.push(posted.done);
  }
  const frame = stripeFrame(5);
  const throttled = handleFramePost({
    sessionId,
    value: jpegDataUrl(frame.gray, frame.width, frame.height),
    typedValues: {},
    adapters,
    nowMs: 0,
  });
  assert.equal(throttled.outcome, "throttled");
  await Promise.all(pending);
  const states = seen.map((verdict) => verdict.state);
  assert.ok(states.includes("throttled"), `expected a throttled verdict, saw ${states}`);
  assert.equal(seen.filter((v) => v.state === "throttled")[0]?.decision, "ALLOW");
});
