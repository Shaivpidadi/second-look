import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  analyzeFrames,
  createSamAdapter,
  CropCache,
  decodePngToGray,
  frameHash,
  runTieredPipeline,
  selectKeyframes,
  type CrossDocOptions,
  type Crop,
  type GlimmerAdapter,
  type SamAdapter,
  type SessionState,
  type SparkAdapter,
  type TieredPipelineResult,
  type VerdictCache,
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
  /** Max keyframes to run verdicts on; default 1 (single sharpest). */
  maxKeyframes?: number;
  /** Min dhash bits changed to cut a new keyframe; default 8. */
  keyframeThreshold?: number;
  /** Crop cache (frame-hash keyed); fresh per call unless shared. */
  cropCache?: CropCache;
  /** Verdict cache for repeat escalations; fresh per call unless shared. */
  verdictCache?: VerdictCache;
  /** Per-call Spark `max_output_tokens` cap for clip escalations. */
  sparkMaxOutputTokens?: number;
  /** Called per streamed keyframe verdict, before the run completes. */
  onKeyframe?: (verdict: KeyframeVerdict) => void;
  /** Run keyframes sharpest-first; default true. */
  sharpestFirst?: boolean;
}

/** Tighter Spark output cap for the clip path (escalation JSON is small). */
export const CLIP_SPARK_MAX_TOKENS = 768;

export interface ClipPathResult {
  frames: ClipFrameResult[];
  /** Worst verdict across frames: blocked > mismatch > clean. */
  verdict: SessionState;
  framesAgree: boolean;
  sampleLatencyMs: number;
  pipelineLatencyMs: number;
  totalLatencyMs: number;
  /** Frames sampled vs keyframes run. */
  framesScanned: number;
  keyframes: number;
  cropCacheHits: number;
  sparkCacheHits: number;
  /** Pipeline time to the first keyframe verdict (streaming metric). */
  firstVerdictLatencyMs: number;
}

/** One streamed partial verdict plus its cache provenance. */
export interface KeyframeVerdict {
  frame: ClipFrameResult;
  /** Ms since the pipeline started (sampling excluded). */
  elapsedMs: number;
  cropCached: boolean;
  sparkCached: boolean;
  /** `fast` = text-only verdict on the sharpest keyframe; `full` = refined. */
  phase: "fast" | "full";
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
 * Keyframe indices, sharpest first so the fast path verdicts on the best
 * frame; undecodable frames (test fakes) all run in scan order.
 */
function pickKeyframes(frames: SampledFrame[], options: ClipPathOptions): number[] {
  try {
    const analyses = analyzeFrames(frames.map((frame) => frame.png));
    const selected = selectKeyframes(analyses, {
      maxKeyframes: options.maxKeyframes,
      changeThreshold: options.keyframeThreshold,
    });
    if (options.sharpestFirst === false) return selected;
    const score = new Map(analyses.map((analysis) => [analysis.index, analysis.sharpness]));
    return [...selected].sort((a, b) => score.get(b)! - score.get(a)! || a - b);
  } catch {
    return frames.map((_, index) => index);
  }
}

/** Pixel-hash cache key, falling back to raw bytes when undecodable. */
function frameCacheKey(png: Uint8Array): string {
  try {
    return frameHash(decodePngToGray(png));
  } catch {
    return createHash("sha256").update(png).digest("hex");
  }
}

interface CropResult {
  crops: Crop[];
  cached: boolean;
  latencyMs: number;
  costUsd: number;
}

async function cropFrame(
  frame: SampledFrame,
  sam: SamAdapter,
  concept: string,
  boxes: ClipSidecar["groundTruth"]["boxes"],
  cropCache: CropCache,
  options: ClipPathOptions,
): Promise<CropResult> {
  const cached = cropCache.get(frameCacheKey(frame.png));
  if (cached) return { crops: cached, cached: true, latencyMs: 0, costUsd: 0 };
  const samOut = await sam.crop({
    image: frame.png,
    concept,
    frameWidth: options.frameWidth ?? 720,
    frameHeight: options.frameHeight ?? 1280,
    groundTruth: sam.name === "stub" ? boxes : undefined,
  });
  cropCache.set(frameCacheKey(frame.png), samOut.crops);
  return {
    crops: samOut.crops,
    cached: false,
    latencyMs: samOut.latencyMs,
    costUsd: samOut.costUsd,
  };
}

function withSamCall(
  tiered: TieredPipelineResult,
  sam: SamAdapter,
  crop: CropResult,
): TieredPipelineResult {
  tiered.modelCalls.push({
    model: "sam",
    adapter: sam.name,
    outcome: crop.cached ? "crop (cached)" : "crop",
    latencyMs: crop.latencyMs,
    costUsd: crop.costUsd,
  });
  return tiered;
}

/**
 * Stream keyframes through the live-glasses path. The sharpest keyframe
 * takes the fast path: validators plus the Glimmer local pass stream a
 * `fast` verdict in milliseconds while the crop runs concurrently,
 * then ONE image-grounded Spark escalation refines it as `full`. A
 * separate text-only escalation would double Spark cost and put two
 * API calls on the critical path for a verdict the deterministic
 * checks already fixed, so the fast verdict carries no Spark
 * explanation; the refinement does. Remaining keyframes (when callers
 * ask for more than one) run the full path sequentially so each
 * reuses the verdict cache the last one stored. Paper values come
 * from the clip's documented ground truth; typed values come from
 * the screen reader.
 */
export async function* runClipFramesStream(
  frames: SampledFrame[],
  paperValues: Record<string, string>,
  typedValues: Record<string, string>,
  boxes: ClipSidecar["groundTruth"]["boxes"],
  options: ClipPathOptions = {},
): AsyncGenerator<KeyframeVerdict> {
  const started = performance.now();
  const sam = options.sam ?? createSamAdapter("stub");
  const concept = options.concept ?? "shipping document";
  const cropCache = options.cropCache ?? new CropCache();
  const readings = Object.entries(paperValues).map(([fieldId, paperValue]) => ({
    fieldId,
    paperValue,
    typedValue: typedValues[fieldId] ?? null,
  }));
  const tieredOptions = {
    readings,
    typedValues,
    glimmer: options.glimmer,
    spark: options.spark,
    crossDocOptions: options.crossDocOptions,
    verdictCache: options.verdictCache,
    sparkMaxOutputTokens: options.sparkMaxOutputTokens ?? CLIP_SPARK_MAX_TOKENS,
  };
  const keyframes = pickKeyframes(frames, options);
  const emit = (partial: KeyframeVerdict): KeyframeVerdict => {
    options.onKeyframe?.(partial);
    return partial;
  };
  if (keyframes.length > 0) {
    const frame = frames[keyframes[0]!]!;
    // Crop first: the rendezvous contract is that Spark starts while a
    // crop is already in flight, never before it.
    const cropPromise = cropFrame(frame, sam, concept, boxes, cropCache, options);
    // Local-only preliminary: validators plus Glimmer decide whether
    // this frame needs Spark at all. Glimmer is local in every mode,
    // so re-running it inside the escalations below costs nothing.
    const prelim = await runTieredPipeline({ ...tieredOptions, crops: [], skipSpark: true });
    if (prelim.escalationReasons.length === 0) {
      const crop = await cropPromise;
      yield emit({
        frame: {
          timestampSec: frame.timestampSec,
          crops: [],
          tiered: { ...prelim, modelCalls: [...prelim.modelCalls] },
        },
        elapsedMs: performance.now() - started,
        cropCached: false,
        sparkCached: false,
        phase: "fast",
      });
      yield emit({
        frame: {
          timestampSec: frame.timestampSec,
          crops: crop.crops,
          tiered: withSamCall(prelim, sam, crop),
        },
        elapsedMs: performance.now() - started,
        cropCached: crop.cached,
        sparkCached: false,
        phase: "full",
      });
    } else {
      // One image-grounded escalation, started immediately on the
      // frame bytes: every adapter sends the whole frame as the crop
      // image (SAM boxes are audit provenance, attached below), so
      // the refinement never waits for SAM. The fast verdict is the
      // local preliminary, streamed in milliseconds.
      const frameCrop: Crop = {
        box: {
          x: 0,
          y: 0,
          width: options.frameWidth ?? 720,
          height: options.frameHeight ?? 1280,
        },
        image: frame.png,
      };
      const fullPromise = runTieredPipeline({
        ...tieredOptions,
        crops: [frameCrop],
      }).then(async (tiered) => ({ tiered, crop: await cropPromise }));
      yield emit({
        frame: {
          timestampSec: frame.timestampSec,
          crops: [],
          tiered: { ...prelim, modelCalls: [...prelim.modelCalls] },
        },
        elapsedMs: performance.now() - started,
        cropCached: false,
        sparkCached: false,
        phase: "fast",
      });
      const { crop, tiered: tieredFull } = await fullPromise;
      yield emit({
        frame: {
          timestampSec: frame.timestampSec,
          crops: crop.crops,
          tiered: withSamCall(tieredFull, sam, crop),
        },
        elapsedMs: performance.now() - started,
        cropCached: crop.cached,
        sparkCached: tieredFull.sparkCached,
        phase: "full",
      });
    }
  }
  for (const index of keyframes.slice(1)) {
    const frame = frames[index]!;
    const crop = await cropFrame(frame, sam, concept, boxes, cropCache, options);
    const tiered = await runTieredPipeline({ ...tieredOptions, crops: crop.crops });
    yield emit({
      frame: {
        timestampSec: frame.timestampSec,
        crops: crop.crops,
        tiered: withSamCall(tiered, sam, crop),
      },
      elapsedMs: performance.now() - started,
      cropCached: crop.cached,
      sparkCached: tiered.sparkCached,
      phase: "full",
    });
  }
}

/**
 * Run sampled keyframes through the live-glasses path and collect the
 * streamed partial verdicts into one summary.
 */
export async function runClipFrames(
  frames: SampledFrame[],
  paperValues: Record<string, string>,
  typedValues: Record<string, string>,
  boxes: ClipSidecar["groundTruth"]["boxes"],
  options: ClipPathOptions = {},
): Promise<Omit<ClipPathResult, "sampleLatencyMs" | "totalLatencyMs">> {
  const started = performance.now();
  const results: ClipFrameResult[] = [];
  let cropCacheHits = 0;
  let sparkCacheHits = 0;
  let firstVerdictLatencyMs = 0;
  let seenFirst = false;
  for await (const verdict of runClipFramesStream(frames, paperValues, typedValues, boxes, options)) {
    if (!seenFirst) {
      seenFirst = true;
      firstVerdictLatencyMs = verdict.elapsedMs;
    }
    if (verdict.phase !== "full") continue;
    if (verdict.cropCached) cropCacheHits += 1;
    if (verdict.sparkCached) sparkCacheHits += 1;
    results.push(verdict.frame);
  }
  const verdict = worstVerdict(results);
  return {
    frames: results,
    verdict,
    framesAgree: results.every((r) => r.tiered.verdict.state === verdict),
    pipelineLatencyMs: performance.now() - started,
    framesScanned: frames.length,
    keyframes: results.length,
    cropCacheHits,
    sparkCacheHits,
    firstVerdictLatencyMs,
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
