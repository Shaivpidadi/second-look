import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildForm, renderForm } from "@second-look/generator";
import { validateAwb } from "@second-look/validators";
import {
  analyzeFrames,
  decodePngToGray,
  sharpness,
  VerdictCache,
} from "@second-look/pipeline";
import type {
  SamAdapter,
  SamCropOutput,
  SparkAdapter,
  SparkEscalationOutput,
} from "@second-look/pipeline";
import {
  runClipFrames,
  runClipFramesStream,
  sampleFrames,
} from "../clips/ingest.ts";
import { nominalBoxes } from "../clips/render.ts";
import { ffmpegPath } from "../clips/render.ts";

const execFileAsync = promisify(execFile);

async function ffmpegAvailable(): Promise<boolean> {
  try {
    await execFileAsync(ffmpegPath(), ["-version"]);
    return true;
  } catch {
    return false;
  }
}

const FAKE_PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function frames(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    timestampSec: index / 2,
    png: FAKE_PNG,
  }));
}

function swapAt(value: string, at: number): string {
  return value.slice(0, at) + value[at + 1]! + value[at]! + value.slice(at + 2);
}

/** First adjacent-digit swap that breaks the AWB check digit. */
function swappedAwb(value: string): string {
  for (let at = 0; at < value.length - 1; at++) {
    const candidate = swapAt(value, at);
    if (candidate !== value && !validateAwb(candidate).valid) return candidate;
  }
  throw new Error("no check-digit-breaking swap found");
}

describe("runClipFrames", () => {
  it("runs every frame through crop then the tiered pipeline", async () => {
    const { typed } = buildForm("clip-test", 42);
    const paper = { ...typed };
    const result = await runClipFrames(frames(3), paper, typed, nominalBoxes());
    assert.equal(result.frames.length, 3);
    for (const frame of result.frames) {
      assert.equal(frame.crops.length, nominalBoxes().length);
    }
    assert.equal(result.verdict, "clean");
    assert.equal(result.framesAgree, true);
    assert.ok(result.pipelineLatencyMs >= 0);
  });

  it("blocks on a swapped AWB digit with the paper value as fix", async () => {
    const { form } = buildForm("clip-test", 42);
    const paper: Record<string, string> = {
      "awb.awbNumber": form.awb.awbNumber,
      "bol.containerNumber": form.bol.containerNumber,
      "label.sscc": form.label.sscc,
      "invoice.totalQty": String(form.invoice.totalQty),
      "packing.totalQty": String(form.packing.totalQty),
      "bol.weightKg": String(form.bol.weightKg),
      "awb.weightKg": String(form.awb.weightKg),
      "bol.cartons": String(form.bol.cartons),
      "pod.receivedCartons": String(form.pod.receivedCartons),
    };
    const typed = { ...paper, "awb.awbNumber": swappedAwb(paper["awb.awbNumber"]!) };
    const result = await runClipFrames(frames(2), paper, typed, nominalBoxes());
    assert.equal(result.verdict, "blocked");
    assert.ok(
      result.frames[0]!.tiered.verdict.failures.some(
        (f) => f.fieldId === "awb.awbNumber" && f.kind === "check_digit",
      ),
    );
    const fixes = result.frames[0]!.tiered.spark?.proposedFixes ?? [];
    assert.ok(fixes.some((f) => f.fieldId === "awb.awbNumber" && f.paperValue === paper["awb.awbNumber"]));
  });

  it("threads caller-supplied adapters through every frame", async () => {
    let escalations = 0;
    const spark: SparkAdapter = {
      name: "recording",
      async escalate(): Promise<SparkEscalationOutput> {
        escalations += 1;
        return { explanation: "rec", proposedFixes: [], latencyMs: 1, costUsd: 0 };
      },
    };
    const { form } = buildForm("clip-test", 42);
    form.invoice.totalQty = form.packing.totalQty - 2;
    const paper: Record<string, string> = {
      "invoice.totalQty": String(form.invoice.totalQty),
      "packing.totalQty": String(form.packing.totalQty),
    };
    const result = await runClipFrames(frames(2), paper, { ...paper }, nominalBoxes(), {
      spark,
    });
    // Keyframe 1 runs text + refined escalations; keyframe 2 one more.
    assert.equal(escalations, 3);
    assert.equal(result.frames[0]!.tiered.modelCalls[1]?.adapter, "recording");
  });

  it("streams fast then full verdicts with cache flags", async () => {
    const { typed } = buildForm("clip-test", 42);
    const partials = [];
    for await (const partial of runClipFramesStream(
      frames(3),
      { ...typed },
      typed,
      nominalBoxes(),
    )) {
      partials.push(partial);
    }
    // Fake bytes are undecodable, so every frame runs as a keyframe.
    assert.deepEqual(
      partials.map((p) => p.phase),
      ["fast", "full", "full", "full"],
    );
    assert.ok(partials[0]!.elapsedMs >= 0);
    assert.deepEqual(partials[0]!.frame.crops, []);
    assert.equal(partials[0]!.cropCached, false);
    assert.equal(partials[1]!.cropCached, false);
    assert.equal(partials[2]!.cropCached, true);
    assert.ok(
      partials.every((p) => p.frame.tiered.verdict.state === "clean"),
    );
  });

  it("caches crops by frame hash and reports scan stats", async () => {
    let crops = 0;
    const sam: SamAdapter = {
      name: "counting",
      async crop(input): Promise<SamCropOutput> {
        crops += 1;
        return {
          crops: (input.groundTruth ?? []).map((box) => ({ box, image: input.image })),
          latencyMs: 1,
          costUsd: 0,
        };
      },
    };
    const { typed } = buildForm("clip-test", 42);
    const seen: number[] = [];
    const result = await runClipFrames(frames(3), { ...typed }, typed, nominalBoxes(), {
      sam,
      onKeyframe: () => {
        seen.push(1);
      },
    });
    assert.equal(crops, 1);
    assert.equal(seen.length, 4);
    assert.equal(result.framesScanned, 3);
    assert.equal(result.keyframes, 3);
    assert.equal(result.cropCacheHits, 2);
    assert.ok(result.firstVerdictLatencyMs >= 0);
    assert.equal(result.frames[1]!.tiered.modelCalls.at(-1)?.outcome, "crop (cached)");
  });

  it("reuses verdict-cache escalations across frames", async () => {
    let escalations = 0;
    const spark: SparkAdapter = {
      name: "counting",
      async escalate(input): Promise<SparkEscalationOutput> {
        escalations += 1;
        return {
          explanation: "gap",
          proposedFixes: [],
          latencyMs: 2,
          costUsd: 0.001,
        };
      },
    };
    const { form } = buildForm("clip-test", 42);
    form.invoice.totalQty = form.packing.totalQty - 2;
    const paper: Record<string, string> = {
      "invoice.totalQty": String(form.invoice.totalQty),
      "packing.totalQty": String(form.packing.totalQty),
    };
    const result = await runClipFrames(frames(2), paper, { ...paper }, nominalBoxes(), {
      spark,
      verdictCache: new VerdictCache(),
    });
    // Fast text + refined image escalations, then a cache hit on frame 2.
    assert.equal(escalations, 2);
    assert.equal(result.sparkCacheHits, 1);
    assert.equal(result.frames[1]!.tiered.sparkCached, true);
  });

  it("overlaps the crop with the fast text verdict", async () => {
    // Rendezvous: each side waits for the other to start, so a sequential
    // path would deadlock and trip the timeout instead of passing.
    let sparkStarted = false;
    let samStarted = false;
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const spark: SparkAdapter = {
      name: "rendezvous",
      async escalate(): Promise<SparkEscalationOutput> {
        sparkStarted = true;
        for (let i = 0; i < 1000 && !samStarted; i++) await tick();
        if (!samStarted) throw new Error("spark ran without an overlapping crop");
        return { explanation: "ok", proposedFixes: [], latencyMs: 1, costUsd: 0 };
      },
    };
    const sam: SamAdapter = {
      name: "rendezvous",
      async crop(_input): Promise<SamCropOutput> {
        samStarted = true;
        for (let i = 0; i < 1000 && !sparkStarted; i++) await tick();
        if (!sparkStarted) throw new Error("crop ran without an overlapping escalation");
        return { crops: [], latencyMs: 1, costUsd: 0 };
      },
    };
    const { form } = buildForm("clip-test", 42);
    form.invoice.totalQty = form.packing.totalQty - 2;
    const paper: Record<string, string> = {
      "invoice.totalQty": String(form.invoice.totalQty),
      "packing.totalQty": String(form.packing.totalQty),
    };
    const phases: string[] = [];
    for await (const partial of runClipFramesStream(
      frames(1),
      paper,
      { ...paper },
      nominalBoxes(),
      { spark, sam },
    )) {
      phases.push(partial.phase);
    }
    assert.deepEqual(phases, ["fast", "full"]);
  });

  it("runs keyframes sharpest-first on decodable frames", async () => {
    const a = renderForm(buildForm("sharp-a", 11).form).awb;
    const b = renderForm(buildForm("sharp-b", 12).form).awb;
    const sharpA = sharpness(decodePngToGray(a));
    const sharpB = sharpness(decodePngToGray(b));
    assert.notEqual(sharpA, sharpB);
    const expectedFirst = sharpA > sharpB ? 0 : 1;
    const sampled = [
      { index: 0, timestampSec: 0, png: a },
      { index: 1, timestampSec: 0.5, png: b },
    ];
    const analyses = analyzeFrames(sampled.map((f) => f.png));
    assert.equal(analyses.length, 2);
    const { typed } = buildForm("clip-test", 42);
    const stamps: number[] = [];
    await runClipFrames(sampled, { ...typed }, typed, nominalBoxes(), {
      maxKeyframes: 2,
      keyframeThreshold: 0,
      onKeyframe: (partial) => {
        if (partial.phase === "full") stamps.push(partial.frame.timestampSec);
      },
    });
    assert.deepEqual(stamps, [expectedFirst === 0 ? 0 : 0.5, expectedFirst === 0 ? 0.5 : 0]);
  });

  it("formats demo beats as timestamped lines", async () => {
    const { formatBeat, DEMO_SCENARIOS } = await import("../clips/demo.ts");
    assert.equal(formatBeat({ at: "00:03", line: "verdict: BLOCKED" }), "[00:03] verdict: BLOCKED");
    assert.deepEqual(
      DEMO_SCENARIOS.map((s) => [s.clip, s.expect]),
      [
        ["clip-awb.mp4", "blocked"],
        ["clip-pod.mp4", "mismatch"],
      ],
    );
  });

  it("flags a paper invoice/packing quantity gap as mismatch", async () => {
    const { form } = buildForm("clip-test", 42);
    form.invoice.totalQty = form.packing.totalQty - 2;
    const paper: Record<string, string> = {
      "awb.awbNumber": form.awb.awbNumber,
      "bol.containerNumber": form.bol.containerNumber,
      "label.sscc": form.label.sscc,
      "invoice.totalQty": String(form.invoice.totalQty),
      "packing.totalQty": String(form.packing.totalQty),
      "bol.weightKg": String(form.bol.weightKg),
      "awb.weightKg": String(form.awb.weightKg),
      "bol.cartons": String(form.bol.cartons),
      "pod.receivedCartons": String(form.pod.receivedCartons),
    };
    const result = await runClipFrames(frames(2), paper, { ...paper }, nominalBoxes());
    assert.equal(result.verdict, "mismatch");
    assert.ok(
      result.frames[0]!.tiered.verdict.failures.some(
        (f) => f.fieldId === "invoice.totalQty" && f.kind === "cross_doc",
      ),
    );
    assert.equal(result.frames[0]!.tiered.escalated, true);
  });
});

describe("sampleFrames", () => {
  it("rejects fps outside the 2 to 7 glasses rate", async () => {
    await assert.rejects(() => sampleFrames("nope.mp4", { fps: 1 }), /2 to 7/);
    await assert.rejects(() => sampleFrames("nope.mp4", { fps: 8 }), /2 to 7/);
  });

  it("samples a rendered clip at the requested fps", async (t) => {
    if (!(await ffmpegAvailable())) {
      t.skip("ffmpeg not available");
      return;
    }
    const work = await mkdtemp(join(tmpdir(), "sl-sample-"));
    const images = renderForm(buildForm("sample-test", 7).form);
    const src = join(work, "src.png");
    await writeFile(src, images.awb);
    const clip = join(work, "clip.mp4");
    await execFileAsync(ffmpegPath(), [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-loop",
      "1",
      "-framerate",
      "30",
      "-t",
      "2",
      "-i",
      src,
      "-vf",
      "scale=720:1280",
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      clip,
    ]);
    const sampled = await sampleFrames(clip, { fps: 2 });
    assert.equal(sampled.length, 4);
    for (const [i, frame] of sampled.entries()) {
      assert.equal(frame.index, i);
      assert.equal(frame.timestampSec, i / 2);
      assert.deepEqual(frame.png.slice(0, 4), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
    }
  });
});
