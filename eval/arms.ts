import {
  checkCrossDoc,
  isFreeTextField,
  redactReadings,
  runTieredPipeline,
  StubSparkAdapter,
} from "@second-look/pipeline";
import type { FieldCheck, FieldReading } from "@second-look/pipeline";
import {
  validateAwb,
  validateContainer,
  validateSscc,
} from "@second-look/validators";
import { paperValues, type GeneratedForm } from "@second-look/generator";

export interface ArmInput {
  form: GeneratedForm;
}

export interface ArmVerdict {
  flagged: boolean;
  failures: FieldCheck[];
  latencyMs: number;
  costUsd: number;
}

/**
 * One eval arm: judges each corpus form against its typed values.
 * `stubbed` marks arms whose model calls run through deterministic
 * stubs instead of live models; the report labels them as such.
 * Unavailable arms (missing keys/weights) are skipped by the runner.
 */
export interface EvalArm {
  name: string;
  available: boolean;
  stubbed: boolean;
  judge(input: ArmInput): Promise<ArmVerdict>;
}

function checkDigitFailures(typed: Record<string, string>): FieldCheck[] {
  const failures: FieldCheck[] = [];
  const checks: Array<[string, { valid: boolean; error?: string }]> = [
    ["awb.awbNumber", validateAwb(typed["awb.awbNumber"] ?? "")],
    ["bol.containerNumber", validateContainer(typed["bol.containerNumber"] ?? "")],
    ["label.sscc", validateSscc(typed["label.sscc"] ?? "")],
  ];
  for (const [fieldId, result] of checks) {
    if (!result.valid) {
      failures.push({
        fieldId,
        kind: "check_digit",
        passed: false,
        detail: result.error,
      });
    }
  }
  return failures;
}

/** Paper-vs-typed readings for a corpus form (fixtures carry both). */
function readingsFromForm(form: GeneratedForm): FieldReading[] {
  const paper = paperValues(form.form);
  return Object.entries(paper).map(([fieldId, paperValue]) => ({
    fieldId,
    paperValue,
    typedValue: form.typed[fieldId] ?? null,
  }));
}

/**
 * Deterministic failure detection over fixtures: check digits, paper-vs-
 * typed match (free text excluded), and cross-document consistency. The
 * stubbed model arms judge from this; the real arms will judge from live
 * model output over the same inputs.
 */
function detectFailures(form: GeneratedForm): FieldCheck[] {
  const paper = paperValues(form.form);
  const failures: FieldCheck[] = [...checkDigitFailures(form.typed)];
  for (const [fieldId, paperValue] of Object.entries(paper)) {
    if (isFreeTextField(fieldId)) continue;
    const typedValue = form.typed[fieldId];
    if (typedValue === undefined || typedValue === paperValue) continue;
    failures.push({
      fieldId,
      kind: "field_match",
      passed: false,
      detail: `paper ${paperValue} vs typed ${typedValue}`,
    });
  }
  failures.push(...checkCrossDoc(form.typed).filter((c) => !c.passed));
  return failures;
}

export const checkDigitArm: EvalArm = {
  name: "check-digit-only",
  available: true,
  stubbed: false,
  async judge({ form }) {
    const started = performance.now();
    const failures = checkDigitFailures(form.typed);
    return {
      flagged: failures.length > 0,
      failures,
      latencyMs: performance.now() - started,
      costUsd: 0,
    };
  },
};

/**
 * Single-model baseline (stubbed): one Spark pass over every form.
 * Judges from fixture diffs; costs one estimated Spark call per form.
 */
export const singleModelArm: EvalArm = {
  name: "single-model",
  available: true,
  stubbed: true,
  async judge({ form }) {
    const started = performance.now();
    const failures = detectFailures(form);
    const spark = await new StubSparkAdapter().escalate({
      readings: redactReadings(readingsFromForm(form)),
      crops: [],
      question: "Single-model baseline: judge this form in one pass.",
    });
    return {
      flagged: failures.length > 0,
      failures,
      latencyMs: performance.now() - started,
      costUsd: spark.costUsd,
    };
  },
};

/**
 * Tiered Glimmer-to-Spark pipeline (stubbed): validators first, then the
 * stub Glimmer pass, then the stub Spark escalation only on disagreement,
 * cross-doc conflict, or handwriting.
 */
export const tieredArm: EvalArm = {
  name: "tiered",
  available: true,
  stubbed: true,
  async judge({ form }) {
    const started = performance.now();
    const tiered = await runTieredPipeline({
      readings: readingsFromForm(form),
      typedValues: form.typed,
    });
    return {
      flagged: tiered.verdict.state !== "clean",
      failures: tiered.verdict.failures,
      latencyMs: performance.now() - started,
      costUsd: tiered.modelCalls.reduce((sum, call) => sum + call.costUsd, 0),
    };
  },
};

export const ALL_ARMS: EvalArm[] = [checkDigitArm, singleModelArm, tieredArm];
