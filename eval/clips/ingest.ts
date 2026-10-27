import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createSamAdapter,
  runTieredPipeline,
  type CrossDocOptions,
  type Crop,
  type GlimmerAdapter,
  type SamAdapter,
  type SessionState,
  type SparkAdapter,
  type TieredPipelineResult,
} from "@second-look/pipeline";
import { ffmpegPath, type ClipSidecar } from "./render.ts";

const execFileAsync = promisify(execFile);

export const MIN_SAMPLE_FPS = 2;
export const MAX_SAMPLE_FPS = 7;

export interface SampledFrame {
  index: number;
  timestampSec: number;
  png: Uint8Array;
}

export interface SampleOptions {
  ffmpeg?: string;
  /** Frames per second to sample; the glasses stream 2-7 fps. */
  fps?: number;
}

function assertSampleFps(fps: number): void {
  if (!Number.isInteger(fps) || fps < MIN_SAMPLE_FPS || fps > MAX_SAMPLE_FPS) {
    throw new Error(
      `clip ingest: fps must be ${MIN_SAMPLE_FPS} to ${MAX_SAMPLE_FPS} (glasses rate), got ${fps}`,
    );
  }
}

async function checkFfmpeg(ffmpeg: string): Promise<void> {
  try {
    await execFileAsync(ffmpeg, ["-version"]);
  } catch {
    throw new Error(
      `clip ingest: ffmpeg not found at ${ffmpeg} (override with FFMPEG_BIN)`,
    );
  }
}

/**
 * Sample frames from a POV clip at the glasses rate (2-7 fps) via ffmpeg.
 * Returns PNG bytes per frame with approximate timestamps; frames decode
 * lazily downstream (the stub adapters pass bytes through untouched).
 */
export async function sampleFrames(
  clipPath: string,
  options: SampleOptions = {},
): Promise<SampledFrame[]> {
  const fps = options.fps ?? MIN_SAMPLE_FPS;
  assertSampleFps(fps);
  const ffmpeg = options.ffmpeg ?? ffmpegPath();
  await checkFfmpeg(ffmpeg);
  const work = await mkdtemp(join(tmpdir(), "sl-ingest-"));
  try {
    await execFileAsync(ffmpeg, [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      clipPath,
      "-vf",
      `fps=${fps}`,
      join(work, "frame-%04d.png"),
    ]);
  } catch (error) {
    const stderr = (error as { stderr?: string })?.stderr ?? String(error);
    throw new Error(`clip ingest: sampling ${clipPath} failed: ${stderr}`);
  }
  const files = (await readdir(work)).filter((n) => n.endsWith(".png")).sort();
  const frames: SampledFrame[] = [];
  for (let i = 0; i < files.length; i++) {
    const png = new Uint8Array(await readFile(join(work, files[i]!)));
    frames.push({ index: i, timestampSec: i / fps, png });
  }
  return frames;
}

/** Read the sidecar the renderer wrote next to a clip. */
export async function readSidecar(clipPath: string): Promise<ClipSidecar> {
  const sidecarPath = clipPath.replace(/\.[^.]+$/, ".json");
  return JSON.parse(await readFile(sidecarPath, "utf8")) as ClipSidecar;
}

export interface ClipFrameResult {
  timestampSec: number;
  crops: Crop[];
  tiered: TieredPipelineResult;
}

export interface ClipPathOptions {
  sam?: SamAdapter;
  glimmer?: GlimmerAdapter;
  spark?: SparkAdapter;
  concept?: string;
  frameWidth?: number;
  frameHeight?: number;
  crossDocOptions?: CrossDocOptions;
}

export interface ClipPathResult {
  frames: ClipFrameResult[];
  /** Worst verdict across frames: blocked > mismatch > clean. */
  verdict: SessionState;
  framesAgree: boolean;
  sampleLatencyMs: number;
  pipelineLatencyMs: number;
  totalLatencyMs: number;
}

const SEVERITY: Record<SessionState, number> = { clean: 0, mismatch: 1, blocked: 2 };

function worstVerdict(frames: ClipFrameResult[]): SessionState {
  let worst: SessionState = "clean";
  for (const frame of frames) {
    if (SEVERITY[frame.tiered.verdict.state] > SEVERITY[worst]) {
      worst = frame.tiered.verdict.state;
    }
  }
  return worst;
}

/**
 * Run sampled frames through the live-glasses path: SAM crop per frame,
 * then validators first, the Glimmer local pass, and Spark only on
 * disagreement, cross-doc conflict, or handwriting. Paper values come from
 * the clip's documented ground truth (standing in for Glimmer reads until
 * the vision adapters land); typed values come from the screen reader.
 */
export async function runClipFrames(
  frames: SampledFrame[],
  paperValues: Record<string, string>,
  typedValues: Record<string, string>,
  boxes: ClipSidecar["groundTruth"]["boxes"],
  options: ClipPathOptions = {},
): Promise<Omit<ClipPathResult, "sampleLatencyMs" | "totalLatencyMs"> & { pipelineLatencyMs: number }> {
  const started = performance.now();
  const sam = options.sam ?? createSamAdapter("stub");
  const concept = options.concept ?? "shipping document";
  const readings = Object.entries(paperValues).map(([fieldId, paperValue]) => ({
    fieldId,
    paperValue,
    typedValue: typedValues[fieldId] ?? null,
  }));
  const results: ClipFrameResult[] = [];
  for (const frame of frames) {
    const samOut = await sam.crop({
      image: frame.png,
      concept,
      frameWidth: options.frameWidth ?? 720,
      frameHeight: options.frameHeight ?? 1280,
      groundTruth: sam.name === "stub" ? boxes : undefined,
    });
    const tiered = await runTieredPipeline({
      readings,
      typedValues,
      crops: samOut.crops,
      glimmer: options.glimmer,
      spark: options.spark,
      crossDocOptions: options.crossDocOptions,
    });
    results.push({ timestampSec: frame.timestampSec, crops: samOut.crops, tiered });
  }
  const verdict = worstVerdict(results);
  return {
    frames: results,
    verdict,
    framesAgree: results.every((r) => r.tiered.verdict.state === verdict),
    pipelineLatencyMs: performance.now() - started,
  };
}

export interface ClipPathRunOptions extends ClipPathOptions, SampleOptions {}

/**
 * Sample a clip at 2-7 fps and run every frame through the tiered path.
 * The sidecar selects the SAM concept: "delivery receipt" for POD clips,
 * "shipping document" otherwise.
 */
export async function runClipPath(
  clipPath: string,
  typedValues: Record<string, string>,
  options: ClipPathRunOptions = {},
): Promise<ClipPathResult> {
  const totalStarted = performance.now();
  const sidecar = await readSidecar(clipPath);
  const sampleStarted = performance.now();
  const frames = await sampleFrames(clipPath, options);
  const sampleLatencyMs = performance.now() - sampleStarted;
  const concept =
    options.concept ?? (sidecar.docType === "pod" ? "delivery receipt" : "shipping document");
  const run = await runClipFrames(
    frames,
    sidecar.groundTruth.paperValues,
    typedValues,
    sidecar.groundTruth.boxes,
    {
      ...options,
      concept,
      frameWidth: sidecar.width,
      frameHeight: sidecar.height,
    },
  );
  return { ...run, sampleLatencyMs, totalLatencyMs: performance.now() - totalStarted };
}
