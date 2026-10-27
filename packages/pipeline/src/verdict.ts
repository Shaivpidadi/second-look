import type { FieldCheck, SessionState, Verdict } from "./types.ts";

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
