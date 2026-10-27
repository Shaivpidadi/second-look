import type { Crop, FieldReading } from "./types.ts";
import { requireModelApiKey } from "./key.ts";

export interface SparkEscalationInput {
  /** Redacted readings from the Glimmer pass; never raw PII. */
  readings: FieldReading[];
  crops: Crop[];
  question: string;
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
}

function extractText(payload: unknown): string | null {
  if (typeof payload === "string") return payload;
  if (payload === null || typeof payload !== "object") return null;
  const data = payload as Record<string, unknown>;
  if (typeof data.output_text === "string") return data.output_text;
  const output = data.output;
  if (Array.isArray(output)) {
    for (const item of output) {
      if (item === null || typeof item !== "object") continue;
      const content = (item as Record<string, unknown>).content;
      if (Array.isArray(content)) {
        for (const part of content) {
          if (part === null || typeof part !== "object") continue;
          const text = (part as Record<string, unknown>).text;
          if (typeof text === "string") return text;
        }
      }
    }
  }
  const choices = data.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const message = (choices[0] as Record<string, unknown>)?.message as
      | Record<string, unknown>
      | undefined;
    const content = message?.content;
    if (typeof content === "string") return content;
  }
  return null;
}

/**
 * Real adapter: reads MODEL_API_KEY (alias META_API_KEY) from the
 * environment at call time and POSTs to the Responses API. The request and
 * response shapes are unverified until the PLAN spike runs; parsing stays
 * defensive across shapes.
 */
export class RealSparkAdapter implements SparkAdapter {
  readonly name = "real";
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: RealSparkOptions = {}) {
    this.baseUrl =
      options.baseUrl ?? process.env.MODEL_API_BASE_URL ?? "https://api.meta.ai/v1";
    this.model = options.model ?? "muse-spark-1.3";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async escalate(input: SparkEscalationInput): Promise<SparkEscalationOutput> {
    const started = performance.now();
    const key = requireModelApiKey();
    const prompt = [
      input.question,
      ...input.readings.map(
        (r) => `${r.fieldId}: paper=${r.paperValue ?? "?"} typed=${r.typedValue ?? "?"}`,
      ),
    ].join("\n");
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/responses`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${key}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          input: prompt,
          max_output_tokens: 512,
        }),
      });
    } catch (error) {
      throw new Error(
        `spark: Model API request failed (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    if (!response.ok) {
      throw new Error(
        `spark: Model API request failed with status ${response.status}`,
      );
    }
    const payload = (await response.json()) as unknown;
    return {
      explanation: extractText(payload) ?? "spark: empty response",
      proposedFixes: [],
      latencyMs: performance.now() - started,
      costUsd: 0,
    };
  }
}

export function createSparkAdapter(kind: "stub" | "real" = "stub"): SparkAdapter {
  return kind === "real" ? new RealSparkAdapter() : new StubSparkAdapter();
}
