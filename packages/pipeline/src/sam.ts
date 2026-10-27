import type { BoundingBox, Crop } from "./types.ts";
import { postJson, recordUsage, type RetryOptions } from "./http.ts";
import { requireModelApiKey } from "./key.ts";

export interface SamCropInput {
  /** Still frame bytes (JPEG/PNG) or one short-clip sample. */
  image: Uint8Array;
  /** One noun-phrase concept per request, e.g. "shipping document". */
  concept: string;
  /** Frame size in pixels; the stub needs it for the default box. */
  frameWidth?: number;
  frameHeight?: number;
  /**
   * Generator-known document/field boxes for the deterministic stub path.
   * Real glasses frames have no ground truth, so this stays undefined there
   * and the stub falls back to a centered document box.
   */
  groundTruth?: BoundingBox[];
}

export interface SamCropOutput {
  crops: Crop[];
  latencyMs: number;
  costUsd: number;
}

/** SAM adapter interface: locate concepts in a frame, return crops. */
export interface SamAdapter {
  readonly name: string;
  crop(input: SamCropInput): Promise<SamCropOutput>;
}

/**
 * Enforce the one-noun-phrase-per-request rule: a short single-line phrase
 * with no sentence or list punctuation. Both adapters call this so the stub
 * rejects the same inputs the `sam-3.1` API would.
 */
export function assertSingleConcept(concept: string): string {
  const trimmed = concept.trim();
  if (trimmed.length === 0) {
    throw new Error("sam: concept must be one noun phrase, got an empty string");
  }
  if (/[\n\r.,;:!?]/.test(trimmed) || trimmed.split(/\s+/).length > 6) {
    throw new Error(
      `sam: concept must be one noun phrase per request, got ${JSON.stringify(concept)}`,
    );
  }
  return trimmed;
}

/**
 * Deterministic stub: returns one crop per generator ground-truth box, or a
 * single centered document box when no ground truth is attached. Crop bytes
 * pass the frame through untouched; the stub locates boxes but never
 * resamples pixels. Costs $0.
 */
export class StubSamAdapter implements SamAdapter {
  readonly name = "stub";

  async crop(input: SamCropInput): Promise<SamCropOutput> {
    const started = performance.now();
    assertSingleConcept(input.concept);
    const boxes =
      input.groundTruth ?? [
        defaultDocumentBox(input.frameWidth, input.frameHeight),
      ];
    return {
      crops: boxes.map((box) => ({ box: { ...box }, image: input.image })),
      latencyMs: performance.now() - started,
      costUsd: 0,
    };
  }
}

/** Centered document box with a 4% margin; falls back to 720x1280. */
export function defaultDocumentBox(width = 720, height = 1280): BoundingBox {
  const marginX = Math.round(width * 0.04);
  const marginY = Math.round(height * 0.04);
  return {
    x: marginX,
    y: marginY,
    width: width - 2 * marginX,
    height: height - 2 * marginY,
  };
}

export interface RealSamOptions {
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  retry?: RetryOptions;
}

function dataUrl(image: Uint8Array): string {
  const binary = Buffer.from(image).toString("base64");
  const jpeg = image.length > 2 && image[0] === 0xff && image[1] === 0xd8;
  return `data:image/${jpeg ? "jpeg" : "png"};base64,${binary}`;
}

type RawBox =
  | { x: number; y: number; width: number; height: number }
  | { x_min: number; y_min: number; x_max: number; y_max: number }
  | [number, number, number, number];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function toBox(value: unknown): BoundingBox | null {
  if (Array.isArray(value) && value.length === 4) {
    const [x, y, width, height] = value;
    if ([x, y, width, height].every((n) => typeof n === "number")) {
      return { x, y, width, height };
    }
    return null;
  }
  if (!isRecord(value)) return null;
  const { x, y, width, height, x_min, y_min, x_max, y_max } = value as Record<
    string,
    unknown
  >;
  if (
    typeof x === "number" &&
    typeof y === "number" &&
    typeof width === "number" &&
    typeof height === "number"
  ) {
    return { x, y, width, height };
  }
  if (
    typeof x_min === "number" &&
    typeof y_min === "number" &&
    typeof x_max === "number" &&
    typeof y_max === "number"
  ) {
    return { x: x_min, y: y_min, width: x_max - x_min, height: y_max - y_min };
  }
  return null;
}

function collectBoxes(value: unknown, into: BoundingBox[]): void {
  if (value === null || value === undefined) return;
  const direct = toBox(value);
  if (direct) {
    into.push(direct);
    return;
  }
  if (typeof value === "string") {
    try {
      collectBoxes(JSON.parse(value) as unknown, into);
    } catch {
      // Not JSON text; nothing to collect.
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectBoxes(item, into);
    return;
  }
  if (isRecord(value)) {
    for (const key of ["boxes", "bboxes", "detections", "results", "output", "data"]) {
      if (key in value) collectBoxes(value[key], into);
    }
    if (
      "content" in value ||
      "text" in value ||
      "output_text" in value
    ) {
      collectBoxes(value.content ?? value.text ?? value.output_text, into);
    }
  }
}

/**
 * Pull boxes out of a Responses API payload across the shapes the SAM
 * endpoint might use; coordinates stay in the payload's own units and are
 * scaled to pixels only when they read as 0-1 fractions.
 */
export function extractBoxes(
  payload: unknown,
  frameWidth: number,
  frameHeight: number,
): BoundingBox[] {
  const raw: BoundingBox[] = [];
  collectBoxes(payload, raw);
  return raw.map((box) => {
    const max = Math.max(box.x, box.y, box.width, box.height);
    if (max <= 1) {
      return {
        x: Math.round(box.x * frameWidth),
        y: Math.round(box.y * frameHeight),
        width: Math.round(box.width * frameWidth),
        height: Math.round(box.height * frameHeight),
      };
    }
    return {
      x: Math.round(box.x),
      y: Math.round(box.y),
      width: Math.round(box.width),
      height: Math.round(box.height),
    };
  });
}

function extractSamUsage(payload: unknown): { inputTokens: number; outputTokens: number } {
  if (
    payload !== null &&
    typeof payload === "object" &&
    !Array.isArray(payload) &&
    "usage" in payload
  ) {
    const usage = (payload as Record<string, unknown>).usage;
    if (usage !== null && typeof usage === "object" && !Array.isArray(usage)) {
      const record = usage as Record<string, unknown>;
      return {
        inputTokens: typeof record.input_tokens === "number" ? record.input_tokens : 0,
        outputTokens: typeof record.output_tokens === "number" ? record.output_tokens : 0,
      };
    }
  }
  return { inputTokens: 0, outputTokens: 0 };
}

/**
 * Real adapter: reads MODEL_API_KEY (alias META_API_KEY) from the
 * environment at call time and POSTs one concept plus one frame to the
 * Responses API `sam-3.1` model. Verified: the request returns HTTP 200
 * with `images_processed: 1`, but the message holds empty text and no
 * boxes, masks, or annotations, so no box shape is confirmed yet (see
 * STATUS.md); parsing stays defensive and yields zero crops until one is.
 * Crop bytes pass the frame through until a pixel-crop step exists.
 */
export class RealSamAdapter implements SamAdapter {
  readonly name = "real";
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly retry?: RetryOptions;

  constructor(options: RealSamOptions = {}) {
    this.baseUrl =
      options.baseUrl ?? process.env.MODEL_API_BASE_URL ?? "https://api.meta.ai/v1";
    this.model = options.model ?? "sam-3.1";
    this.fetchImpl = options.fetchImpl ?? fetch;
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
            role: "user",
            content: [
              {
                type: "input_text",
                text: `Locate every instance of this concept and return bounding boxes as JSON: ${concept}`,
              },
              { type: "input_image", image_url: dataUrl(input.image) },
            ],
          },
        ],
        max_output_tokens: 1024,
      },
      what: "sam",
      retry: this.retry,
    });
    const usage = extractSamUsage(payload);
    recordUsage(usage.inputTokens, usage.outputTokens);
    const boxes = extractBoxes(payload, frameWidth, frameHeight);
    return {
      crops: boxes.map((box) => ({ box, image: input.image })),
      latencyMs: performance.now() - started,
      // Pricing is unverified; report $0 until measured.
      costUsd: 0,
    };
  }
}

export function createSamAdapter(kind: "stub" | "real" = "stub"): SamAdapter {
  return kind === "real" ? new RealSamAdapter() : new StubSamAdapter();
}
