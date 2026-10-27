import {
  draftClaim,
  mentionsDamage,
  reduceVerdict,
  runTieredPipeline,
} from "@second-look/pipeline";
import type {
  ClaimDraft,
  FieldCheck,
  FieldReading,
  ModelCall,
  Verdict,
} from "@second-look/pipeline";
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

type DigitValidator = (raw: string) => { valid: boolean; error?: string };

const DIGIT_FIELDS: Array<{
  id: string;
  validate: DigitValidator;
  fix: (raw: string) => string | undefined;
}> = [
  { id: "awb.awbNumber", validate: validateAwb, fix: fixAwb },
  { id: "bol.containerNumber", validate: validateContainer, fix: fixContainer },
  { id: "label.sscc", validate: validateSscc, fix: fixSscc },
];

/** Validate one check-digit field; null when it passes. */
function digitFailure(fieldId: string, raw: string): GateFailure | null {
  const spec = DIGIT_FIELDS.find((d) => d.id === fieldId);
  if (!spec) return null;
  const result = spec.validate(raw);
  if (result.valid) return null;
  const rule = result.error ?? "unknown";
  const failure: GateFailure = {
    fieldId,
    rule,
    message: MESSAGES[rule] ?? rule,
  };
  const fix = spec.fix(raw);
  if (fix !== undefined) failure.fix = fix;
  return failure;
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

  for (const spec of DIGIT_FIELDS) {
    const raw = values[spec.id] ?? "";
    const failure = digitFailure(spec.id, raw);
    checks.push({ fieldId: spec.id, kind: "check_digit", passed: failure === null });
    if (failure) failures.push(failure);
  }

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

/**
 * Live verdict over partially typed values. Unlike the submit gate, fields
 * that are still empty produce no checks at all, so typing never blocks on
 * values that were simply never entered. Only judged fields can fail.
 */
export function evaluatePartialSubmission(
  values: Record<string, string>,
): GateResult {
  const checks: FieldCheck[] = [];
  const failures: GateFailure[] = [];

  for (const spec of DIGIT_FIELDS) {
    const raw = values[spec.id];
    if (raw === undefined || raw === "") continue;
    const failure = digitFailure(spec.id, raw);
    checks.push({ fieldId: spec.id, kind: "check_digit", passed: failure === null });
    if (failure) failures.push(failure);
  }

  const shippedRaw = values["bol.cartons"];
  const receivedRaw = values["pod.receivedCartons"];
  if (shippedRaw !== undefined && shippedRaw !== "" && receivedRaw !== undefined && receivedRaw !== "") {
    const shipped = Number(shippedRaw);
    const received = Number(receivedRaw);
    const countsOk =
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
        message: `Received ${receivedRaw} vs shipped ${shippedRaw} cartons.`,
      };
      if (Number.isInteger(shipped) && shipped >= 0) {
        failure.fix = String(shipped);
      }
      failures.push(failure);
    }
  }

  const verdict = reduceVerdict(checks);
  return {
    decision: failures.length > 0 ? "BLOCK" : "ALLOW",
    verdict,
    failures,
  };
}

export interface TieredGateResult extends GateResult {
  glimmer: {
    outcome: "agree" | "disagree";
    reason?: string;
    adapter: string;
    latencyMs: number;
    costUsd: number;
  };
  spark: {
    explanation: string;
    adapter: string;
    latencyMs: number;
    costUsd: number;
  } | null;
  escalated: boolean;
  escalationReasons: string[];
  modelCalls: ModelCall[];
  /** Template claim draft when the POD note mentions damage, else null. */
  claim: ClaimDraft | null;
}

/** Fields the tiered pipeline judges; paper values are unknown on the form. */
const TIERED_FIELDS = [
  "awb.awbNumber",
  "bol.containerNumber",
  "label.sscc",
  "bol.cartons",
  "pod.receivedCartons",
  "pod.exceptionNote",
];

function readingsFromValues(values: Record<string, string>): FieldReading[] {
  return TIERED_FIELDS.map((fieldId) => ({
    fieldId,
    paperValue: null,
    typedValue: values[fieldId] ?? null,
  }));
}

/**
 * Submit gate with the tiered pipeline end to end: the deterministic sync
 * gate decides ALLOW/BLOCK with fix proposals, then the tiered run adds
 * the Glimmer pass, conditional Spark escalation, per-call latency/cost,
 * and a claim draft when the POD note mentions damage.
 */
export async function evaluateTieredSubmission(
  values: Record<string, string>,
): Promise<TieredGateResult> {
  const sync = evaluateSubmission(values);
  const tiered = await runTieredPipeline({
    readings: readingsFromValues(values),
    typedValues: values,
    crossDocOptions: { skipMissingInputs: true },
  });
  const note = values["pod.exceptionNote"] ?? "";
  const claim = mentionsDamage(note)
    ? await draftClaim({
        carrier: values["bol.carrier"] ?? "",
        bolRef: values["bol.bolNumber"] ?? "",
        awbRef: values["awb.awbNumber"] ?? "",
        exceptionNote: note,
      })
    : null;
  return {
    ...sync,
    glimmer: {
      outcome: tiered.glimmer.outcome,
      reason: tiered.glimmer.reason,
      adapter: tiered.modelCalls[0]?.adapter ?? "stub",
      latencyMs: tiered.glimmer.latencyMs,
      costUsd: tiered.glimmer.costUsd,
    },
    spark: tiered.spark
      ? {
          explanation: tiered.spark.explanation,
          adapter: tiered.modelCalls[1]?.adapter ?? "stub",
          latencyMs: tiered.spark.latencyMs,
          costUsd: tiered.spark.costUsd,
        }
      : null,
    escalated: tiered.escalated,
    escalationReasons: tiered.escalationReasons,
    modelCalls: tiered.modelCalls,
    claim,
  };
}
