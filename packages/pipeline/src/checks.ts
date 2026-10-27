import {
  validateAwb,
  validateContainer,
  validateSscc,
} from "@second-look/validators";
import { isFreeTextField } from "./glimmer.ts";
import type { FieldCheck, FieldReading } from "./types.ts";

type CheckDigitValidator = (raw: string) => { valid: boolean; error?: string };

const CHECK_DIGIT_FIELDS: Record<string, CheckDigitValidator> = {
  "awb.awbNumber": validateAwb,
  "bol.containerNumber": validateContainer,
  "label.sscc": validateSscc,
};

/**
 * Deterministic check-digit checks over typed values. Only fields with a
 * known validator and a non-empty typed value produce checks; unknown or
 * empty fields are skipped (nothing typed yet, nothing to judge).
 */
export function checkDigitChecks(readings: FieldReading[]): FieldCheck[] {
  const checks: FieldCheck[] = [];
  for (const reading of readings) {
    const validate = CHECK_DIGIT_FIELDS[reading.fieldId];
    if (!validate) continue;
    if (reading.typedValue === null || reading.typedValue === "") continue;
    const result = validate(reading.typedValue);
    checks.push({
      fieldId: reading.fieldId,
      kind: "check_digit",
      passed: result.valid,
      detail: result.error,
    });
  }
  return checks;
}

/**
 * Deterministic paper-vs-typed match checks. Only readings with both values
 * present are judged; free-text fields (handwriting, names) are skipped
 * because they feed the claim path, not the mismatch verdict.
 */
export function fieldMatchChecks(readings: FieldReading[]): FieldCheck[] {
  const checks: FieldCheck[] = [];
  for (const reading of readings) {
    if (isFreeTextField(reading.fieldId)) continue;
    if (reading.paperValue === null || reading.typedValue === null) continue;
    checks.push({
      fieldId: reading.fieldId,
      kind: "field_match",
      passed: reading.paperValue === reading.typedValue,
      detail: `paper ${reading.paperValue} vs typed ${reading.typedValue}`,
    });
  }
  return checks;
}
