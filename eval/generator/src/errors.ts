import { int, type Rng } from "./prng.ts";
import type { SyntheticForm } from "./documents.ts";

export type ErrorKind =
  | "transposition"
  | "dropped_digit"
  | "swapped_fields"
  | "short_count";

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
    "pod.receivedCartons": String(form.pod.receivedCartons),
    "pod.exceptionNote": form.pod.exceptionNote ?? "",
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
 * Apply one error kind. Typo kinds change the typed values; short_count
 * changes the paper POD itself (a genuine receiving discrepancy).
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
  }
}

const KINDS: ErrorKind[] = [
  "transposition",
  "dropped_digit",
  "swapped_fields",
  "short_count",
];

/** Inject 1-2 seeded errors into a form; mutates form and typed. */
export function injectErrors(
  form: SyntheticForm,
  typed: TypedValues,
  rng: Rng,
): InjectedError[] {
  const count = 1 + Math.floor(rng() * 2);
  const kinds = [...KINDS];
  const errors: InjectedError[] = [];
  for (let i = 0; i < count; i++) {
    const at = Math.floor(rng() * kinds.length);
    errors.push(applyError(form, typed, kinds.splice(at, 1)[0]!, rng));
  }
  return errors;
}
