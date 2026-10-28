import type { VerdictCache } from "./cache.ts";
import { checkDigitChecks, fieldMatchChecks } from "./checks.ts";
import { checkCrossDoc, type CrossDocOptions } from "./crossdoc.ts";
import {
  isFreeTextField,
  StubGlimmerAdapter,
  type GlimmerAdapter,
  type GlimmerPassOutput,
} from "./glimmer.ts";
import { StubSparkAdapter, type SparkAdapter, type SparkEscalationOutput } from "./spark.ts";
import type {
  Crop,
  FieldCheck,
  FieldReading,
  ModelCall,
  SessionState,
  Verdict,
} from "./types.ts";

/**
 * Verdict state machine. Deterministic and dependency-free:
 * any check-digit failure blocks, any other failure mismatches,
 * otherwise the session is clean.
 */
export function reduceVerdict(checks: FieldCheck[]): Verdict {
  const failures = checks.filter((c) => !c.passed);
  let state: SessionState = "clean";
  if (failures.some((f) => f.kind === "check_digit")) {
    state = "blocked";
  } else if (failures.length > 0) {
    state = "mismatch";
  }
  return { state, failures };
}

export interface TieredPipelineInput {
  readings: FieldReading[];
  /** Flat typed values for the cross-document checks. */
  typedValues: Record<string, string>;
  crops?: Crop[];
  glimmer?: GlimmerAdapter;
  spark?: SparkAdapter;
  crossDocOptions?: CrossDocOptions;
  /** Reuse stored escalations for identical readings; skips repeat calls. */
  verdictCache?: VerdictCache;
  /** Per-call Spark `max_output_tokens` override for this escalation. */
  sparkMaxOutputTokens?: number;
  /**
   * Run validators and Glimmer only, skipping the Spark call while
   * still reporting escalationReasons. Lets callers decide whether
   * to escalate, and overlap the escalation with other work.
   */
  skipSpark?: boolean;
}

export interface TieredPipelineResult {
  checks: FieldCheck[];
  verdict: Verdict;
  glimmer: GlimmerPassOutput;
  /** Null when nothing escalated: Glimmer agreed and no conflict. */
  spark: SparkEscalationOutput | null;
  escalated: boolean;
  /** True when the Spark output came from the verdict cache, not a call. */
  sparkCached: boolean;
  escalationReasons: string[];
  modelCalls: ModelCall[];
}

/**
 * Whether any reading carries handwriting or free text (a non-empty
 * exception note or similar). Handwriting escalates to Spark for the
 * explanation/claim path but never fails the verdict by itself.
 */
export function hasHandwriting(readings: FieldReading[]): boolean {
  return readings.some(
    (reading) =>
      isFreeTextField(reading.fieldId) &&
      ((reading.typedValue ?? "") !== "" || (reading.paperValue ?? "") !== ""),
  );
}

function escalationQuestion(reasons: string[], crossDocFailures: FieldCheck[]): string {
  const parts: string[] = [];
  if (reasons.includes("glimmer_disagree")) {
    parts.push("the local pass disagrees with the typed values");
  }
  if (reasons.includes("cross_doc_conflict")) {
    parts.push(
      `cross-document conflict: ${crossDocFailures.map((f) => f.detail ?? f.fieldId).join("; ")}`,
    );
  }
  if (reasons.includes("handwriting")) {
    parts.push("a handwritten exception note needs reading");
  }
  return `Escalated because ${parts.join(", ")}. Explain the mismatch and propose fixes.`;
}

/**
 * Tiered verdict pipeline, end to end: deterministic validators first
 * (check digits, paper/typed match, cross-document), then the Glimmer
 * local pass, then Spark only on Glimmer disagreement, cross-doc
 * conflict, or handwriting. Check-digit failures block without a Spark
 * call: they already carry a deterministic fix.
 */
export async function runTieredPipeline(
  input: TieredPipelineInput,
): Promise<TieredPipelineResult> {
  const glimmer = input.glimmer ?? new StubGlimmerAdapter();
  const spark = input.spark ?? new StubSparkAdapter();
  const crops = input.crops ?? [];

  const checks: FieldCheck[] = [
    ...checkDigitChecks(input.readings),
    ...fieldMatchChecks(input.readings),
  ];
  const crossDocChecks = checkCrossDoc(input.typedValues, input.crossDocOptions);
  checks.push(...crossDocChecks);
  const crossDocFailures = crossDocChecks.filter((c) => !c.passed);

  const glimmerOut = await glimmer.pass({ crops, readings: input.readings });
  const modelCalls: ModelCall[] = [
    {
      model: "glimmer",
      adapter: glimmer.name,
      outcome: glimmerOut.outcome,
      latencyMs: glimmerOut.latencyMs,
      costUsd: glimmerOut.costUsd,
    },
  ];

  const escalationReasons: string[] = [];
  if (glimmerOut.outcome === "disagree") escalationReasons.push("glimmer_disagree");
  if (crossDocFailures.length > 0) escalationReasons.push("cross_doc_conflict");
  if (hasHandwriting(input.readings)) escalationReasons.push("handwriting");

  let sparkOut: SparkEscalationOutput | null = null;
  let sparkCached = false;
  if (escalationReasons.length > 0 && input.skipSpark !== true) {
    const hasImages = crops.length > 0;
    const cached = input.verdictCache?.lookup(glimmerOut.redacted, escalationReasons, hasImages);
    if (cached?.hit) {
      sparkOut = cached.spark;
      sparkCached = true;
    } else {
      sparkOut = await spark.escalate({
        readings: cached ? cached.send : glimmerOut.redacted,
        crops,
        question: escalationQuestion(escalationReasons, crossDocFailures),
        maxOutputTokens: input.sparkMaxOutputTokens,
      });
      input.verdictCache?.store(glimmerOut.redacted, escalationReasons, sparkOut, hasImages);
    }
    modelCalls.push({
      model: "spark",
      adapter: spark.name,
      outcome: sparkCached ? "escalation (cached)" : "escalation",
      latencyMs: sparkOut.latencyMs,
      costUsd: sparkOut.costUsd,
    });
  }

  return {
    checks,
    verdict: reduceVerdict(checks),
    glimmer: glimmerOut,
    spark: sparkOut,
    escalated: sparkOut !== null,
    sparkCached,
    escalationReasons,
    modelCalls,
  };
}
