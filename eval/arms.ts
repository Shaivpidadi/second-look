import { checkCrossDoc } from "@second-look/pipeline";
import type { FieldCheck } from "@second-look/pipeline";
import {
  validateAwb,
  validateContainer,
  validateSscc,
} from "@second-look/validators";
import type { GeneratedForm } from "@second-look/generator";

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
 * Model arms stay behind this interface with `available: false` until
 * their keys/weights exist; the runner skips unavailable arms.
 */
export interface EvalArm {
  name: string;
  available: boolean;
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

export const checkDigitArm: EvalArm = {
  name: "check-digit-only",
  available: true,
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

export const crossDocArm: EvalArm = {
  name: "check-digit+cross-doc",
  available: true,
  async judge({ form }) {
    const started = performance.now();
    const failures = [
      ...checkDigitFailures(form.typed),
      ...checkCrossDoc(form.typed).filter((c) => !c.passed),
    ];
    return {
      flagged: failures.length > 0,
      failures,
      latencyMs: performance.now() - started,
      costUsd: 0,
    };
  },
};

/** Single-model baseline: one Spark pass over the form. Needs MODEL_API_KEY. */
export const singleModelArm: EvalArm = {
  name: "single-model",
  available: false,
  async judge() {
    throw new Error("single-model arm: not implemented (needs MODEL_API_KEY)");
  },
};

/** Tiered Glimmer-to-Spark pipeline. Needs local weights + MODEL_API_KEY. */
export const tieredArm: EvalArm = {
  name: "tiered",
  available: false,
  async judge() {
    throw new Error("tiered arm: not implemented (needs weights + MODEL_API_KEY)");
  },
};

export const ALL_ARMS: EvalArm[] = [
  checkDigitArm,
  crossDocArm,
  singleModelArm,
  tieredArm,
];
