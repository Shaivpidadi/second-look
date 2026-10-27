import { int, type Rng } from "./prng.ts";
import type { SyntheticForm } from "./documents.ts";

export type ErrorKind =
  | "transposition"
  | "dropped_digit"
  | "swapped_fields"
  | "short_count"
  | "qty_gap"
  | "weight_gap"
  | "sscc_transposition";

export interface InjectedError {
  kind: ErrorKind;
  /** Flat field id, e.g. "awb.awbNumber". */
  fieldId: string;
  paperValue: string;
  typedValue: string;
}

/** Flat field-id map mirroring the mock warehouse form. */
export type TypedValues = Record<string, string>;

export function paperValues(form: SyntheticForm): TypedValues {
  return {
    "bol.bolNumber": form.bol.bolNumber,
    "bol.containerNumber": form.bol.containerNumber,
    "bol.cartons": String(form.bol.cartons),
    "bol.weightKg": String(form.bol.weightKg),
    "awb.awbNumber": form.awb.awbNumber,
    "awb.origin": form.awb.origin,
    "awb.destination": form.awb.destination,
    "awb.pieces": String(form.awb.pieces),
    "awb.weightKg": String(form.awb.weightKg),
    "invoice.invoiceNumber": form.invoice.invoiceNumber,
    "invoice.totalQty": String(form.invoice.totalQty),
    "packing.packingNumber": form.packing.packingNumber,
    "packing.totalQty": String(form.packing.totalQty),
    "pod.receivedCartons": String(form.pod.receivedCartons),
    "pod.exceptionNote": form.pod.exceptionNote ?? "",
    "label.sscc": form.label.sscc,
  };
}

function swapAdjacent(value: string, rng: Rng): string {
  const at = int(rng, 0, value.length - 2);
  return (
    value.slice(0, at) + value[at + 1]! + value[at]! + value.slice(at + 2)
  );
}

function dropChar(value: string, rng: Rng): string {
  const at = int(rng, 0, value.length - 1);
  return value.slice(0, at) + value.slice(at + 1);
}

/**
 * Apply one error kind. Typo kinds change the typed values only; short_count,
 * qty_gap, and weight_gap change the paper docs themselves (genuine
 * cross-document discrepancies the worker typed faithfully).
 */
export function applyError(
  form: SyntheticForm,
  typed: TypedValues,
  kind: ErrorKind,
  rng: Rng,
): InjectedError {
  switch (kind) {
    case "transposition": {
      const paper = form.awb.awbNumber;
      const value = swapAdjacent(paper, rng);
      typed["awb.awbNumber"] = value;
      return { kind, fieldId: "awb.awbNumber", paperValue: paper, typedValue: value };
    }
    case "dropped_digit": {
      const paper = form.bol.containerNumber;
      const value = dropChar(paper, rng);
      typed["bol.containerNumber"] = value;
      return { kind, fieldId: "bol.containerNumber", paperValue: paper, typedValue: value };
    }
    case "swapped_fields": {
      const paper = `${form.awb.origin}/${form.awb.destination}`;
      typed["awb.origin"] = form.awb.destination;
      typed["awb.destination"] = form.awb.origin;
      const value = `${form.awb.destination}/${form.awb.origin}`;
      return { kind, fieldId: "awb.origin", paperValue: paper, typedValue: value };
    }
    case "short_count": {
      const paper = String(form.bol.cartons);
      form.pod.receivedCartons = form.bol.cartons - int(rng, 1, 4);
      const value = String(form.pod.receivedCartons);
      typed["pod.receivedCartons"] = value;
      return { kind, fieldId: "pod.receivedCartons", paperValue: paper, typedValue: value };
    }
    case "qty_gap": {
      const paper = String(form.invoice.totalQty);
      form.invoice.totalQty = form.packing.totalQty - int(rng, 1, 4);
      const value = String(form.invoice.totalQty);
      typed["invoice.totalQty"] = value;
      return { kind, fieldId: "invoice.totalQty", paperValue: paper, typedValue: value };
    }
    case "weight_gap": {
      const paper = String(form.awb.weightKg);
      form.awb.weightKg = form.bol.weightKg + int(rng, 50, 400);
      const value = String(form.awb.weightKg);
      typed["awb.weightKg"] = value;
      return { kind, fieldId: "awb.weightKg", paperValue: paper, typedValue: value };
    }
    case "sscc_transposition": {
      const paper = form.label.sscc;
      const value = swapAdjacent(paper, rng);
      typed["label.sscc"] = value;
      return { kind, fieldId: "label.sscc", paperValue: paper, typedValue: value };
    }
  }
}

const KINDS: ErrorKind[] = [
  "transposition",
  "dropped_digit",
  "swapped_fields",
  "short_count",
  "qty_gap",
  "weight_gap",
  "sscc_transposition",
];

/** Whether any injected error is a genuine paper discrepancy (not a typo). */
export function isPaperError(kind: ErrorKind): boolean {
  return kind === "short_count" || kind === "qty_gap" || kind === "weight_gap";
}

/**
 * Inject 0-2 seeded errors into a form; mutates form and typed.
 * About a quarter of forms stay clean so eval can measure precision.
 */
export function injectErrors(
  form: SyntheticForm,
  typed: TypedValues,
  rng: Rng,
): InjectedError[] {
  if (rng() < 0.25) return [];
  const count = 1 + Math.floor(rng() * 2);
  const kinds = [...KINDS];
  const errors: InjectedError[] = [];
  for (let i = 0; i < count; i++) {
    const at = Math.floor(rng() * kinds.length);
    errors.push(applyError(form, typed, kinds.splice(at, 1)[0]!, rng));
  }
  return errors;
}
