import { fail, pass, type CheckResult } from "./types.ts";

/**
 * Air waybill: 11 digits (3-digit airline prefix + 7-digit serial + check).
 * Check digit = 7-digit serial mod 7.
 */
export function normalizeAwb(input: string): string {
  return input.replace(/[\s-]/g, "");
}

/** Check digit for the first 10 digits (prefix + serial) of an AWB. */
export function computeAwbCheckDigit(firstTen: string): number {
  const serial = Number(firstTen.slice(3, 10));
  return serial % 7;
}

export function validateAwb(input: string): CheckResult {
  const normalized = normalizeAwb(input);
  if (!/^\d{11}$/.test(normalized)) {
    return fail(normalized, "awb_format");
  }
  const expected = computeAwbCheckDigit(normalized);
  if (Number(normalized[10]) !== expected) {
    return fail(normalized, "awb_check_digit");
  }
  return pass(normalized);
}
