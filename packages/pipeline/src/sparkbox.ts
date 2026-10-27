import type { BoundingBox, Crop } from "./types.ts";
import { postJson, recordUsage, type RetryOptions } from "./http.ts";
import { requireModelApiKey } from "./key.ts";
import { sparkCostUsd } from "./pricing.ts";
import { assertSingleConcept, type SamAdapter, type SamCropInput, type SamCropOutput } from "./sam.ts";

export interface SparkBoxOptions {
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  maxOutputTokens?: number;
  retry?: RetryOptions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractText(payload: unknown): string | null {
  if (typeof payload === "string") return payload;
  if (!isRecord(payload)) return null;
  if (typeof payload.output_text === "string") return payload.output_text;
  const output = payload.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (!isRecord(item) || !Array.isArray(item.content)) continue;
      for (const part of item.content) {
        if (!isRecord(part)) continue;
        if (
          (part.type === "output_text" || part.type === "text") &&
          typeof part.text === "string"
        ) {
          return part.text;
        }
      }
    }
  }
  return null;
}

function extractUsage(payload: unknown): {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
} {
  const zero = { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 };
  if (!isRecord(payload) || !isRecord(payload.usage)) return zero;
  const usage = payload.usage;
  const details = usage.input_tokens_details;
  return {
    inputTokens: typeof usage.input_tokens === "number" ? usage.input_tokens : 0,
    outputTokens: typeof usage.output_tokens === "number" ? usage.output_tokens : 0,
    cachedInputTokens:
      isRecord(details) && typeof details.cached_tokens === "number" ? details.cached_tokens : 0,
  };
}

/**
 * Boxes from a JSON array of 0-1000 relative coordinates, e.g.
 * `[{"x_min":0,"y_min":0,"x_max":1000,"y_max":1000}]`. Tolerates fences
 * and prose around the array; clamps to range and drops degenerate or
 * malformed entries.
 */
export function parseNormalizedBoxes(
  text: string | null,
  frameWidth: number,
  frameHeight: number,
): BoundingBox[] {
  if (text === null) return [];
  const clean = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "");
  const start = clean.indexOf("[");
  const end = clean.lastIndexOf("]");
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(clean.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const clamp = (n: number): number => Math.max(0, Math.min(1000, n));
  const boxes: BoundingBox[] = [];
  for (const entry of parsed) {
    if (!isRecord(entry)) continue;
    const { x_min, y_min, x_max, y_max } = entry;
    if (
      typeof x_min !== "number" ||
      typeof y_min !== "number" ||
      typeof x_max !== "number" ||
      typeof y_max !== "number"
    ) {
      continue;
    }
    const x0 = clamp(x_min);
    const y0 = clamp(y_min);
    const x1 = clamp(x_max);
    const y1 = clamp(y_max);
    if (x1 <= x0 || y1 <= y0) continue;
    boxes.push({
      x: Math.round((x0 / 1000) * frameWidth),
      y: Math.round((y0 / 1000) * frameHeight),
      width: Math.round(((x1 - x0) / 1000) * frameWidth),
      height: Math.round(((y1 - y0) / 1000) * frameHeight),
    });
  }
  return boxes;
}

function cropDataUrl(image: Uint8Array): string {
  const binary = Buffer.from(image).toString("base64");
  const jpeg = image.length > 2 && image[0] === 0xff && image[1] === 0xd8;
  return `data:image/${jpeg ? "jpeg" : "png"};base64,${binary}`;
}

/**
 * SAM-interface adapter backed by Muse Spark: asks `muse-spark-1.3` for
 * 0-1000 JSON boxes over the frame image. Fallback while `sam-3.1`
 * returns empty output for document concepts (see STATUS.md); selected
 * in real mode behind the same `SamAdapter` interface so the crop path
 * runs on live boxes. One noun-phrase concept per request, same rule.
 */
export class SparkBoxAdapter implements SamAdapter {
  readonly name = "spark-box";
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxOutputTokens: number;
  private readonly retry?: RetryOptions;

  constructor(options: SparkBoxOptions = {}) {
    this.baseUrl =
      options.baseUrl ?? process.env.MODEL_API_BASE_URL ?? "https://api.meta.ai/v1";
    this.model = options.model ?? "muse-spark-1.3";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxOutputTokens = options.maxOutputTokens ?? 384;
    this.retry = options.retry;
  }

  async crop(input: SamCropInput): Promise<SamCropOutput> {
    const started = performance.now();
    const concept = assertSingleConcept(input.concept);
    const key = requireModelApiKey();
    const frameWidth = input.frameWidth ?? 720;
    const frameHeight = input.frameHeight ?? 1280;
    const payload = await postJson({
      fetchImpl: this.fetchImpl,
      url: `${this.baseUrl}/responses`,
      key,
      body: {
        model: this.model,
        input: [
          {
            type: "message",
            role: "user",
            content: [
              {
                type: "input_text",
                text:
                  `Locate every "${concept}" in this image. ` +
                  `Reply with ONLY a JSON array of boxes in 0-1000 relative coordinates: ` +
                  `[{"x_min":0,"y_min":0,"x_max":1000,"y_max":1000}]. No other text.`,
              },
              { type: "input_image", image_url: cropDataUrl(input.image) },
            ],
          },
        ],
        max_output_tokens: this.maxOutputTokens,
        reasoning: { effort: "minimal" },
        temperature: 0,
      },
      what: "spark-box",
      retry: this.retry,
    });
    const usage = extractUsage(payload);
    recordUsage(usage.inputTokens, usage.outputTokens);
    const boxes = parseNormalizedBoxes(extractText(payload), frameWidth, frameHeight);
    const crops: Crop[] = boxes.map((box) => ({ box, image: input.image }));
    return {
      crops,
      latencyMs: performance.now() - started,
      costUsd: sparkCostUsd(usage.inputTokens, usage.outputTokens, usage.cachedInputTokens),
    };
  }
}
