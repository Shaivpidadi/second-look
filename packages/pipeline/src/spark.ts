import type { Crop, FieldCheck, FieldReading } from "./types.ts";
import { postJson, recordUsage, type RetryOptions } from "./http.ts";
import { requireModelApiKey } from "./key.ts";

export interface SparkEscalationInput {
  /** Redacted readings from the Glimmer pass; never raw PII. */
  readings: FieldReading[];
  crops: Crop[];
  question: string;
}

export interface SparkUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Structured pass/fail judgment parsed from the model's JSON reply. */
export interface SparkJudgment {
  flagged: boolean;
  failures: FieldCheck[];
}

export interface SparkEscalationOutput {
  explanation: string;
  /**
   * Proposed fixes. Each entry carries the field id, the current typed
   * value, and the proposed corrected value in `paperValue`.
   */
  proposedFixes: FieldReading[];
  latencyMs: number;
  costUsd: number;
  /** Token usage from the Responses payload; absent on stubs. */
  usage?: SparkUsage;
  /** Structured judgment; absent when the reply carried no JSON verdict. */
  judgment?: SparkJudgment;
}

/** Spark adapter interface: cloud escalation for disagreements only. */
export interface SparkAdapter {
  readonly name: string;
  escalate(input: SparkEscalationInput): Promise<SparkEscalationOutput>;
}

/**
 * Placeholder per-call cost estimate for the stub until PLAN spike 4
 * measures real Spark vision $/form. Deterministic so eval can compare
 * arms; the real adapter reports measured cost once pricing is verified.
 */
export const ESTIMATED_SPARK_CALL_COST_USD = 0.005;

/**
 * Deterministic stub: explains the paper/typed diffs in the redacted
 * payload and proposes the paper value as the fix for each. When there are
 * no diffs (pure cross-doc or handwriting escalation) it explains that and
 * proposes nothing.
 */
export class StubSparkAdapter implements SparkAdapter {
  readonly name = "stub";

  async escalate(input: SparkEscalationInput): Promise<SparkEscalationOutput> {
    const started = performance.now();
    const mismatched = input.readings.filter(
      (r) =>
        r.paperValue !== null && r.typedValue !== null && r.paperValue !== r.typedValue,
    );
    const explanation =
      mismatched.length > 0
        ? `Spark stub: paper/typed differ on ${mismatched.map((r) => `${r.fieldId} (paper ${r.paperValue}, typed ${r.typedValue})`).join("; ")}. ${input.question}`
        : `Spark stub: no paper/typed diffs in the redacted payload. ${input.question}`;
    return {
      explanation,
      proposedFixes: mismatched.map((r) => ({ ...r })),
      latencyMs: performance.now() - started,
      costUsd: ESTIMATED_SPARK_CALL_COST_USD,
    };
  }
}

export interface RealSparkOptions {
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
  /**
   * Responses cap name `max_output_tokens`; default 1024. Reasoning alone
   * burns ~200 tokens even on low effort, so smaller caps return
   * `incomplete` with no message item.
   */
  maxOutputTokens?: number;
  /** Reasoning effort; default "low" (the API default "high" burns the cap). */
  reasoningEffort?: string;
  /** Sampling temperature; default 0 for deterministic verdicts. */
  temperature?: number;
  /** Max crop images attached as `input_image` blocks; default 1. */
  maxImages?: number;
  retry?: RetryOptions;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * First assistant text across the verified Responses envelope
 * (`output[].content[]` parts of type `output_text`) plus the legacy
 * `output_text` / chat-completions shapes.
 */
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
  const choices = payload.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const message = (choices[0] as Record<string, unknown>)?.message as
      | Record<string, unknown>
      | undefined;
    if (message && typeof message.content === "string") return message.content;
  }
  return null;
}

function extractUsage(payload: unknown): SparkUsage {
  if (isRecord(payload) && isRecord(payload.usage)) {
    const input = payload.usage.input_tokens;
    const output = payload.usage.output_tokens;
    return {
      inputTokens: typeof input === "number" ? input : 0,
      outputTokens: typeof output === "number" ? output : 0,
    };
  }
  return { inputTokens: 0, outputTokens: 0 };
}

/** Largest `{...}` span in the text, tolerating fences and prose. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const clean = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "");
  const start = clean.indexOf("{");
  const end = clean.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const value: unknown = JSON.parse(clean.slice(start, end + 1));
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

const FAILURE_KINDS = new Set(["field_match", "check_digit", "cross_doc"]);

function parseJudgment(json: Record<string, unknown>): SparkJudgment | undefined {
  const hasFlagged = typeof json.flagged === "boolean";
  const rawFailures = Array.isArray(json.failures) ? json.failures : null;
  if (!hasFlagged && rawFailures === null) return undefined;
  const failures: FieldCheck[] = [];
  for (const entry of rawFailures ?? []) {
    if (!isRecord(entry) || typeof entry.fieldId !== "string") continue;
    failures.push({
      fieldId: entry.fieldId,
      kind:
        typeof entry.kind === "string" && FAILURE_KINDS.has(entry.kind)
          ? (entry.kind as FieldCheck["kind"])
          : "field_match",
      passed: false,
      detail: typeof entry.detail === "string" ? entry.detail : undefined,
    });
  }
  return {
    flagged: hasFlagged ? (json.flagged as boolean) : failures.length > 0,
    failures,
  };
}

function parseFixes(
  json: Record<string, unknown>,
  readings: FieldReading[],
): FieldReading[] {
  if (!Array.isArray(json.fixes)) return [];
  const typedByField = new Map(readings.map((r) => [r.fieldId, r.typedValue]));
  const fixes: FieldReading[] = [];
  for (const entry of json.fixes) {
    if (
      !isRecord(entry) ||
      typeof entry.fieldId !== "string" ||
      typeof entry.correctedValue !== "string"
    ) {
      continue;
    }
    fixes.push({
      fieldId: entry.fieldId,
      paperValue: entry.correctedValue,
      typedValue: typedByField.get(entry.fieldId) ?? null,
    });
  }
  return fixes;
}

function cropDataUrl(image: Uint8Array): string {
  const binary = Buffer.from(image).toString("base64");
  const jpeg = image.length > 2 && image[0] === 0xff && image[1] === 0xd8;
  return `data:image/${jpeg ? "jpeg" : "png"};base64,${binary}`;
}

/**
 * Real adapter: reads MODEL_API_KEY (alias META_API_KEY) from the
 * environment at call time and POSTs to the Responses API. Request and
 * response shapes verified against `muse-spark-1.3` (see STATUS.md):
 * message-style `input` with `input_text`/`input_image` blocks, cap
 * `max_output_tokens`, low reasoning effort, and `output[].content[]`
 * `output_text` replies with a `usage` block. Pricing is unverified, so
 * `costUsd` stays 0 and token usage is reported instead.
 */
export class RealSparkAdapter implements SparkAdapter {
  readonly name = "real";
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxOutputTokens: number;
  private readonly reasoningEffort: string;
  private readonly temperature: number;
  private readonly maxImages: number;
  private readonly retry?: RetryOptions;

  constructor(options: RealSparkOptions = {}) {
    this.baseUrl =
      options.baseUrl ?? process.env.MODEL_API_BASE_URL ?? "https://api.meta.ai/v1";
    this.model = options.model ?? "muse-spark-1.3";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.maxOutputTokens = options.maxOutputTokens ?? 1024;
    this.reasoningEffort = options.reasoningEffort ?? "low";
    this.temperature = options.temperature ?? 0;
    this.maxImages = options.maxImages ?? 1;
    this.retry = options.retry;
  }

  async escalate(input: SparkEscalationInput): Promise<SparkEscalationOutput> {
    const started = performance.now();
    const key = requireModelApiKey();
    const readingLines =
      input.readings.length === 0
        ? ["(no readings)"]
        : input.readings.map(
            (r) => `- ${r.fieldId}: paper=${r.paperValue ?? "?"} typed=${r.typedValue ?? "?"}`,
          );
    const prompt = [
      input.question,
      "Readings (paper vs typed):",
      ...readingLines,
      'Reply with ONLY a JSON object, no other text: {"explanation": "...", "flagged": true|false, "failures": [{"fieldId": "...", "kind": "field_match|check_digit|cross_doc", "detail": "..."}], "fixes": [{"fieldId": "...", "correctedValue": "..."}]}.',
      "Set flagged=true when any reading differs paper-vs-typed, any check digit is invalid, or any cross-document values conflict. For each differing field, set correctedValue to the PAPER value.",
    ].join("\n");
    const content: Array<Record<string, unknown>> = [{ type: "input_text", text: prompt }];
    for (const crop of input.crops.slice(0, Math.max(0, this.maxImages))) {
      content.push({ type: "input_image", image_url: cropDataUrl(crop.image) });
    }
    const payload = await postJson({
      fetchImpl: this.fetchImpl,
      url: `${this.baseUrl}/responses`,
      key,
      body: {
        model: this.model,
        input: [{ role: "user", content }],
        max_output_tokens: this.maxOutputTokens,
        reasoning: { effort: this.reasoningEffort },
        temperature: this.temperature,
      },
      what: "spark",
      retry: this.retry,
    });
    const usage = extractUsage(payload);
    recordUsage(usage.inputTokens, usage.outputTokens);
    const text = extractText(payload);
    const json = text === null ? null : parseJsonObject(text);
    const output: SparkEscalationOutput = {
      explanation: "",
      proposedFixes: [],
      latencyMs: performance.now() - started,
      costUsd: 0,
      usage,
    };
    if (json === null) {
      output.explanation = text ?? "spark: empty response";
      return output;
    }
    output.explanation =
      typeof json.explanation === "string" && json.explanation !== ""
        ? json.explanation
        : (text ?? "spark: empty response");
    output.proposedFixes = parseFixes(json, input.readings);
    const judgment = parseJudgment(json);
    if (judgment) output.judgment = judgment;
    return output;
  }
}

export function createSparkAdapter(kind: "stub" | "real" = "stub"): SparkAdapter {
  return kind === "real" ? new RealSparkAdapter() : new StubSparkAdapter();
}
