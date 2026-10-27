import type { FieldCheck } from "./types.ts";

export interface CrossDocOptions {
  /** Absolute kg tolerance for the BOL-vs-AWB weight comparison. */
  weightToleranceKg?: number;
  /**
   * Omit checks whose inputs are absent instead of failing them. For live
   * and partial form values where not every document is typed yet; eval
   * runs with the default so missing inputs still fail.
   */
  skipMissingInputs?: boolean;
}

function parseCount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function qtyCheck(values: Record<string, string>): FieldCheck {
  const fieldId = "invoice.totalQty";
  const invoice = parseCount(values["invoice.totalQty"]);
  const packing = parseCount(values["packing.totalQty"]);
  if (invoice === null || packing === null) {
    return {
      fieldId,
      kind: "cross_doc",
      passed: false,
      detail: `invoice qty ${values["invoice.totalQty"] ?? "?"} vs packing qty ${values["packing.totalQty"] ?? "?"}: missing or invalid`,
    };
  }
  return {
    fieldId,
    kind: "cross_doc",
    passed: invoice === packing,
    detail: `invoice qty ${invoice} vs packing qty ${packing}`,
  };
}

function weightCheck(
  values: Record<string, string>,
  toleranceKg: number,
): FieldCheck {
  const fieldId = "awb.weightKg";
  const bol = parseCount(values["bol.weightKg"]);
  const awb = parseCount(values["awb.weightKg"]);
  if (bol === null || awb === null) {
    return {
      fieldId,
      kind: "cross_doc",
      passed: false,
      detail: `BOL weight ${values["bol.weightKg"] ?? "?"} vs AWB weight ${values["awb.weightKg"] ?? "?"}: missing or invalid`,
    };
  }
  return {
    fieldId,
    kind: "cross_doc",
    passed: Math.abs(bol - awb) <= toleranceKg,
    detail: `BOL weight ${bol}kg vs AWB weight ${awb}kg (tolerance ${toleranceKg}kg)`,
  };
}

function receivedCheck(values: Record<string, string>): FieldCheck {
  const fieldId = "pod.receivedCartons";
  const shipped = parseCount(values["bol.cartons"]);
  const received = parseCount(values["pod.receivedCartons"]);
  if (shipped === null || received === null) {
    return {
      fieldId,
      kind: "cross_doc",
      passed: false,
      detail: `received ${values["pod.receivedCartons"] ?? "?"} vs shipped ${values["bol.cartons"] ?? "?"}: missing or invalid`,
    };
  }
  return {
    fieldId,
    kind: "cross_doc",
    passed: received === shipped,
    detail: `received ${received} vs shipped ${shipped}`,
  };
}

const CROSS_DOC_INPUTS: Record<string, string[]> = {
  "invoice.totalQty": ["invoice.totalQty", "packing.totalQty"],
  "awb.weightKg": ["bol.weightKg", "awb.weightKg"],
  "pod.receivedCartons": ["bol.cartons", "pod.receivedCartons"],
};

/**
 * Cross-document checks over flat typed values (see generator
 * paperValues): invoice qty vs packing list, BOL weight vs AWB weight,
 * POD received vs shipped count. Missing or non-numeric inputs fail the
 * check they belong to, unless skipMissingInputs omits checks whose
 * inputs are absent. Deterministic; needs no model or API key.
 */
export function checkCrossDoc(
  values: Record<string, string>,
  options: CrossDocOptions = {},
): FieldCheck[] {
  const tolerance = options.weightToleranceKg ?? 0;
  const checks = [qtyCheck(values), weightCheck(values, tolerance), receivedCheck(values)];
  if (!options.skipMissingInputs) return checks;
  return checks.filter((check) =>
    (CROSS_DOC_INPUTS[check.fieldId] ?? []).every((input) => {
      const value = values[input];
      return value !== undefined && value !== "";
    }),
  );
}
