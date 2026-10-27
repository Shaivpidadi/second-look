import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildForm, renderForm } from "@second-look/generator";
import { validateAwb } from "@second-look/validators";
import { runClipFrames, sampleFrames } from "../clips/ingest.ts";
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
