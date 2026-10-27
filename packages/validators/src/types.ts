export interface CheckResult {
  valid: boolean;
  /** Input with separators removed and uppercased where applicable. */
  normalized: string;
  /** Machine-readable reason; present only when valid is false. */
  error?: string;
}

export function fail(normalized: string, error: string): CheckResult {
  return { valid: false, normalized, error };
}

export function pass(normalized: string): CheckResult {
  return { valid: true, normalized };
}
