import test from "node:test";
import assert from "node:assert/strict";
import {
  createPipelineAdapters,
  createSamAdapter,
  encodeGrayToJpeg,
  type PipelineAdapters,
  type SamAdapter,
  type SparkAdapter,
  type SparkEscalationInput,
  type SparkEscalationOutput,
} from "@second-look/pipeline";
import {
  __resetFramePath,
  FRAME_FIELD_ID,
  FRAME_MODEL_CALLS_PER_CHECK,
  handleFramePost,
  isNearDuplicate,
  MAX_FRAME_MODEL_CALLS_PER_MIN,
  parseFrameDataUrl,
  runFrameCheck,
  tryReserveFrameCalls,
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
  return { lastDhash: null, callTimestamps: [] };
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

test("frame: near-duplicate detection honors the threshold", () => {
  assert.equal(isNearDuplicate(null, 0n), false);
  assert.equal(isNearDuplicate(0b1010n, 0b1010n), true);
  assert.equal(isNearDuplicate(0n, (1n << 8n) - 1n), false); // 8 bits differ: a keyframe
  assert.equal(isNearDuplicate(0n, (1n << 7n) - 1n), true); // 7 bits differ: dropped
  assert.equal(isNearDuplicate(0n, 0b111n, 4), true);
  assert.equal(isNearDuplicate(0n, 0b1111n, 4), false);
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
