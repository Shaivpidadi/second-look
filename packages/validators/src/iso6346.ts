import { fail, pass, type CheckResult } from "./types.ts";

/**
 * ISO 6346 container number: 4 letters (owner + category) + 6 serial digits
 * + 1 check digit. Letter values skip multiples of 11; each value is weighted
 * by 2^position over the first 10 characters; sum mod 11 (10 maps to 0).
 */
const LETTER_VALUES: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
  K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
  U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

export function normalizeContainer(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

/** Check digit for the first 10 characters of a container number. */
export function computeContainerCheckDigit(firstTen: string): number {
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = firstTen[i]!;
    const value = ch >= "0" && ch <= "9" ? Number(ch) : LETTER_VALUES[ch]!;
    sum += value * 2 ** i;
  }
  const remainder = sum % 11;
  return remainder === 10 ? 0 : remainder;
}

export function validateContainer(input: string): CheckResult {
  const normalized = normalizeContainer(input);
  if (!/^[A-Z]{4}\d{7}$/.test(normalized)) {
    return fail(normalized, "container_format");
  }
  const expected = computeContainerCheckDigit(normalized);
  if (Number(normalized[10]) !== expected) {
    return fail(normalized, "container_check_digit");
  }
  return pass(normalized);
}
