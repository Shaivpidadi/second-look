import { reduceVerdict } from "@second-look/pipeline";
import type { FieldCheck, Verdict } from "@second-look/pipeline";
import {
  computeAwbCheckDigit,
  computeContainerCheckDigit,
  computeGs1CheckDigit,
  normalizeAwb,
  normalizeContainer,
  normalizeSscc,
  validateAwb,
  validateContainer,
  validateSscc,
} from "@second-look/validators";

export type Decision = "ALLOW" | "BLOCK";

export interface GateFailure {
  fieldId: string;
  rule: string;
  message: string;
  /** Proposed corrected value, when the failure has a deterministic fix. */
  fix?: string;
}

export interface GateResult {
  decision: Decision;
  verdict: Verdict;
  failures: GateFailure[];
}

const MESSAGES: Record<string, string> = {
  awb_format: "AWB must be 11 digits (prefix + serial + check).",
  awb_check_digit: "AWB check digit wrong: serial mod 7 mismatch.",
  container_format: "Container must be 4 letters + 7 digits.",
  container_check_digit: "Container check digit wrong (ISO 6346).",
  sscc_format: "SSCC must be 18 digits.",
  sscc_check_digit: "SSCC check digit wrong (GS1 mod-10).",
};

function fixAwb(raw: string): string | undefined {
  const normalized = normalizeAwb(raw);
  if (!/^\d{11}$/.test(normalized)) return undefined;
  const firstTen = normalized.slice(0, 10);
  return `${firstTen}${computeAwbCheckDigit(firstTen)}`;
}

function fixContainer(raw: string): string | undefined {
  const normalized = normalizeContainer(raw);
  if (!/^[A-Z]{4}\d{7}$/.test(normalized)) return undefined;
  const firstTen = normalized.slice(0, 10);
  return `${firstTen}${computeContainerCheckDigit(firstTen)}`;
}

function fixSscc(raw: string): string | undefined {
  const normalized = normalizeSscc(raw);
  if (!/^\d{18}$/.test(normalized)) return undefined;
  const firstSeventeen = normalized.slice(0, 17);
  return `${firstSeventeen}${computeGs1CheckDigit(firstSeventeen)}`;
}

/**
 * Submit gate. Runs deterministic validators before any model call and
 * blocks on any failure: bad check digits or a short/over receiving count.
 * Each check-digit failure carries a proposed fix (corrected check digit);
 * a count mismatch proposes the shipped quantity.
 */
export function evaluateSubmission(
  values: Record<string, string>,
): GateResult {
  const checks: FieldCheck[] = [];
  const failures: GateFailure[] = [];

  const checkDigit = (
    fieldId: string,
    raw: string,
    result: { valid: boolean; error?: string },
    fix?: string,
  ) => {
    checks.push({ fieldId, kind: "check_digit", passed: result.valid });
    if (!result.valid) {
      const rule = result.error ?? "unknown";
      const failure: GateFailure = {
        fieldId,
        rule,
        message: MESSAGES[rule] ?? rule,
      };
      if (fix !== undefined) failure.fix = fix;
      failures.push(failure);
    }
  };

  const awbRaw = values["awb.awbNumber"] ?? "";
  checkDigit("awb.awbNumber", awbRaw, validateAwb(awbRaw), fixAwb(awbRaw));
  const containerRaw = values["bol.containerNumber"] ?? "";
  checkDigit(
    "bol.containerNumber",
    containerRaw,
    validateContainer(containerRaw),
    fixContainer(containerRaw),
  );
  const ssccRaw = values["label.sscc"] ?? "";
  checkDigit("label.sscc", ssccRaw, validateSscc(ssccRaw), fixSscc(ssccRaw));

  const shipped = Number(values["bol.cartons"]);
  const received = Number(values["pod.receivedCartons"]);
  const countsOk =
    values["bol.cartons"] !== undefined &&
    values["pod.receivedCartons"] !== undefined &&
    Number.isInteger(shipped) &&
    Number.isInteger(received) &&
    shipped >= 0 &&
    received >= 0 &&
    received === shipped;
  checks.push({ fieldId: "pod.receivedCartons", kind: "cross_doc", passed: countsOk });
  if (!countsOk) {
    const failure: GateFailure = {
      fieldId: "pod.receivedCartons",
      rule: "count_mismatch",
      message: `Received ${values["pod.receivedCartons"] ?? "?"} vs shipped ${values["bol.cartons"] ?? "?"} cartons.`,
    };
    if (
      values["bol.cartons"] !== undefined &&
      Number.isInteger(shipped) &&
      shipped >= 0
    ) {
      failure.fix = String(shipped);
    }
    failures.push(failure);
  }

  const verdict = reduceVerdict(checks);
  return {
    decision: failures.length > 0 ? "BLOCK" : "ALLOW",
    verdict,
    failures,
  };
}
