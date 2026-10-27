import {
  checkCrossDoc,
  isFreeTextField,
  redactReadings,
  RealSparkAdapter,
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

/**
 * One-shot judging rubric for the real single-model arm. Readings carry
 * paper and typed values; the adapter appends the JSON reply contract.
 */
export const SINGLE_MODEL_JUDGE_QUESTION = [
  "Single-model judge: decide whether this warehouse form has errors.",
  "Flag when: (1) any paper value differs from its typed value, except [redacted] free-text notes;",
  "(2) any cross-document pair disagrees exactly: invoice.totalQty vs packing.totalQty,",
  "bol.weightKg vs awb.weightKg, pod.receivedCartons vs bol.cartons.",
  "Use kind field_match for (1), cross_doc for (2).",
  "Every injected error shows as a paper/typed diff or a cross-document gap, so no check-digit math is needed.",
  "Decide quickly and reply immediately with ONLY the JSON object.",
].join(" ");

export interface RealArmOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Live-model arms, built after `.env` loads so `available` reflects the
 * key. `single-model-real` judges each form from one Spark reply;
 * `tiered-real` runs the deterministic tiered pipeline with a real Spark
 * escalation (verdicts match the stub tiered arm; latency, tokens, and
 * explanations are live). Both are `stubbed: false` and stay out of
 * ALL_ARMS so default runs never touch the network.
 */
export function createRealArms(options: RealArmOptions = {}): EvalArm[] {
  const available = Boolean(process.env.MODEL_API_KEY ?? process.env.META_API_KEY);
  const singleModelReal: EvalArm = {
    name: "single-model-real",
    available,
    stubbed: false,
    async judge({ form }) {
      const started = performance.now();
      const spark = await new RealSparkAdapter({ fetchImpl: options.fetchImpl }).escalate({
        readings: redactReadings(readingsFromForm(form)),
        crops: [],
        question: SINGLE_MODEL_JUDGE_QUESTION,
      });
      if (!spark.judgment) {
        throw new Error(
          `single-model-real: ${form.form.formId} returned no judgment (explanation: ${spark.explanation.slice(0, 160)})`,
        );
      }
      return {
        flagged: spark.judgment.flagged,
        failures: spark.judgment.failures,
        latencyMs: performance.now() - started,
        costUsd: spark.costUsd,
      };
    },
  };
  const tieredReal: EvalArm = {
    name: "tiered-real",
    available,
    stubbed: false,
    async judge({ form }) {
      const started = performance.now();
      const tiered = await runTieredPipeline({
        readings: readingsFromForm(form),
        typedValues: form.typed,
        spark: new RealSparkAdapter({ fetchImpl: options.fetchImpl }),
      });
      return {
        flagged: tiered.verdict.state !== "clean",
        failures: tiered.verdict.failures,
        latencyMs: performance.now() - started,
        costUsd: tiered.modelCalls.reduce((sum, call) => sum + call.costUsd, 0),
      };
    },
  };
  return [singleModelReal, tieredReal];
}
