import { fail, pass, type CheckResult } from "./types.ts";

/**
 * SSCC: 18 digits with a GS1 mod-10 check digit. Weights 3,1,3,1... applied
 * from the rightmost digit before the check digit.
 */
export function normalizeSscc(input: string): string {
  return input.replace(/[\s-]/g, "");
}

/** GS1 mod-10 check digit for digits given without their check digit. */
export function computeGs1CheckDigit(digits: string): number {
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10;
}

export function validateSscc(input: string): CheckResult {
  const normalized = normalizeSscc(input);
  if (!/^\d{18}$/.test(normalized)) {
    return fail(normalized, "sscc_format");
  }
  const expected = computeGs1CheckDigit(normalized.slice(0, 17));
  if (Number(normalized[17]) !== expected) {
    return fail(normalized, "sscc_check_digit");
  }
  return pass(normalized);
}
