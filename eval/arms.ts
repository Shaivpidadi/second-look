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
  /** Document images by doc type; loaded when the arm needs images. */
  images?: Record<string, Uint8Array>;
}

export interface ArmVerdict {
  flagged: boolean;
  failures: FieldCheck[];
  latencyMs: number;
  costUsd: number;
  /** True when the arm abstained (needs-human) instead of judging. */
  abstained?: boolean;
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
  /** When true, the runner loads the form's document images for judge(). */
  needsImages?: boolean;
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

/** Document image order for the vision arm (matches the prompt). */
export const VISION_DOCS = ["bol", "awb", "invoice", "packing", "pod", "label"] as const;

/**
 * Vision judging rubric. The model reads paper values from the images
 * (no paper text is sent) and compares against the typed lines. Fields
 * it cannot read go under "unreadable" instead of being guessed, so the
 * arm abstains on degraded fields rather than silently passing them.
 * This baseline sees full images with no redaction.
 */
export const VISION_JUDGE_QUESTION = [
  "Vision judge: read every field's PAPER value from the attached document images,",
  "in order: bill of lading, air waybill, commercial invoice, packing list,",
  "proof of delivery, pallet SSCC label. The readings below carry only TYPED values.",
  "Flag when: (1) a readable paper value differs from its typed value, except notes;",
  "(2) any cross-document pair disagrees exactly: invoice.totalQty vs packing.totalQty,",
  "bol.weightKg vs awb.weightKg, pod.receivedCartons vs bol.cartons.",
  "Use kind field_match for (1), cross_doc for (2).",
  'List fields you cannot read (blur, glare, skew) under "unreadable" instead of guessing.',
  'Also list fields you read but are unsure about under "low_confidence".',
  "Every injected error shows as a paper/typed diff or a cross-document gap, so no check-digit math is needed.",
  "Decide quickly and reply immediately with ONLY the JSON object.",
].join(" ");

export interface VisionArmOptions {
  fetchImpl?: typeof fetch;
  maxOutputTokens?: number;
}

/**
 * Live vision arm: one Spark call per form over all six document images
 * plus typed values. Abstains (needs-human) when the model reports
 * unreadable or low-confidence fields; available only with a key,
 * never in ALL_ARMS.
 */
export function createVisionArms(options: VisionArmOptions = {}): EvalArm[] {
  const available = Boolean(process.env.MODEL_API_KEY ?? process.env.META_API_KEY);
  const visionReal: EvalArm = {
    name: "vision-real",
    available,
    stubbed: false,
    needsImages: true,
    async judge({ form, images }) {
      const crops = VISION_DOCS.flatMap((doc) => {
        const image = images?.[doc];
        return image
          ? [{ box: { x: 0, y: 0, width: 1000, height: 1400 }, image }]
          : [];
      });
      if (crops.length === 0) {
        throw new Error(
          `vision-real: ${form.form.formId} has no document images (expected <formId>-{${VISION_DOCS.join(",")}}.png next to the corpus JSON)`,
        );
      }
      const started = performance.now();
      const spark = await new RealSparkAdapter({
        fetchImpl: options.fetchImpl,
        maxOutputTokens: options.maxOutputTokens ?? 1536,
        maxImages: VISION_DOCS.length,
      }).escalate({
        readings: Object.entries(form.typed).map(([fieldId, typedValue]) => ({
          fieldId,
          paperValue: null,
          typedValue,
        })),
        crops,
        question: VISION_JUDGE_QUESTION,
      });
      if (!spark.judgment) {
        throw new Error(
          `vision-real: ${form.form.formId} returned no judgment (explanation: ${spark.explanation.slice(0, 160)})`,
        );
      }
      return {
        flagged: spark.judgment.flagged,
        failures: spark.judgment.failures,
        latencyMs: performance.now() - started,
        costUsd: spark.costUsd,
        abstained:
          (spark.unreadable?.length ?? 0) + (spark.lowConfidence?.length ?? 0) > 0,
      };
    },
  };
  return [visionReal];
}
