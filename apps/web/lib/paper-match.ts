/**
 * Paper-vs-typed comparison over session paper memory. The glasses read
 * paper values into session memory; whichever comes second, the paper
 * or the typing, gets compared here, so a mismatch is caught in both
 * directions with the paper value as the fix. Deterministic, no model.
 */
import { validateAwb, validateContainer, validateSscc } from "@second-look/validators";

export interface PaperMismatch {
  fieldId: string;
  rule: "paper_mismatch";
  message: string;
  /** The paper value: what the worker should have typed. */
  fix: string;
}

/** Typed form fields that have a printed source on paper. */
export const PAPER_MATCH_FIELDS = [
  "awb.awbNumber",
  "bol.bolNumber",
  "bol.carrier",
  "bol.containerNumber",
  "label.sscc",
  "bol.cartons",
  "pod.receivedCartons",
] as const;

const DIGITS_ONLY = new Set(["awb.awbNumber", "label.sscc"]);
const COUNTS = new Set(["bol.cartons", "pod.receivedCartons"]);

/**
 * Canonical form for comparing one field: case, spacing, and
 * punctuation never count as a mismatch ("020-2734 2210" equals
 * "02027342210", "(00) 1061..." equals "1061...", "120 CTNS" equals
 * "120"). Returns null when nothing comparable is left.
 */
export function canonicalFieldValue(fieldId: string, raw: string): string | null {
  const value = raw.trim().toUpperCase();
  if (value === "") return null;
  if (COUNTS.has(fieldId)) {
    const match = /\d[\d,]*/.exec(value);
    return match ? String(Number(match[0].replace(/,/g, ""))) : null;
  }
  if (DIGITS_ONLY.has(fieldId)) {
    let digits = value.replace(/\D/g, "");
    // GS1 application identifier (00) printed in front of the SSCC.
    if (fieldId === "label.sscc" && digits.length === 20 && digits.startsWith("00")) {
      digits = digits.slice(2);
    }
    return digits === "" ? null : digits;
  }
  const alnum = value.replace(/[^A-Z0-9]/g, "");
  return alnum === "" ? null : alnum;
}

function display(fieldId: string, paper: string): string {
  if (COUNTS.has(fieldId)) return canonicalFieldValue(fieldId, paper) ?? paper.trim();
  if (DIGITS_ONLY.has(fieldId)) return canonicalFieldValue(fieldId, paper) ?? paper.trim();
  return paper.trim();
}

export type PaperVsTyped = "match" | "mismatch" | "cut-off" | "misread" | "unknown";

/** Check-digit validators for paper reads: printed numbers always pass theirs. */
const PAPER_VALIDATORS: Record<string, (raw: string) => { valid: boolean }> = {
  "awb.awbNumber": validateAwb,
  "bol.containerNumber": validateContainer,
  "label.sscc": validateSscc,
};

/**
 * Compare one field's paper reading with its typed value.
 * "cut-off": a shorter digit-only paper read that the typed value starts
 * or ends with, i.e. the page edge clipped the number. "misread": the
 * paper read fails its own check digit, so the camera read it wrong (a
 * printed AWB, container, or SSCC number is valid by construction).
 * Neither is a typing error; both abstain instead of blocking.
 */
export function classifyPaperVsTyped(fieldId: string, paperRaw: string, typedRaw: string): PaperVsTyped {
  const p = canonicalFieldValue(fieldId, paperRaw);
  const t = canonicalFieldValue(fieldId, typedRaw);
  if (p === null || t === null) return "unknown";
  if (p === t) return "match";
  if (DIGITS_ONLY.has(fieldId) && p.length < t.length && (t.endsWith(p) || t.startsWith(p))) return "cut-off";
  const validate = PAPER_VALIDATORS[fieldId];
  if (validate !== undefined && !validate(p).valid) return "misread";
  return "mismatch";
}

/** True for form fields that have a printed source on paper. */
export function isPaperMatchField(fieldId: string): boolean {
  return (PAPER_MATCH_FIELDS as readonly string[]).includes(fieldId);
}

/**
 * Typed fields that contradict the paper. Fields not yet typed, or not
 * yet seen on paper, produce nothing: only two known values can disagree.
 */
export function comparePaperToTyped(
  paper: Record<string, string>,
  typed: Record<string, string>,
): PaperMismatch[] {
  const out: PaperMismatch[] = [];
  for (const fieldId of PAPER_MATCH_FIELDS) {
    const paperRaw = paper[fieldId];
    const typedRaw = typed[fieldId];
    if (paperRaw === undefined || typedRaw === undefined) continue;
    if (classifyPaperVsTyped(fieldId, paperRaw, typedRaw) !== "mismatch") continue;
    const fix = display(fieldId, paperRaw);
    out.push({
      fieldId,
      rule: "paper_mismatch",
      message: `Typed ${typedRaw.trim()}, paper says ${fix}.`,
      fix,
    });
  }
  return out;
}

const DOC_NAMES: Record<string, string> = {
  bol: "bill of lading",
  awb: "air waybill",
  label: "pallet label",
  pod: "delivery receipt",
};

/**
 * A typed field whose source document was seen but whose value was
 * never read (cut off, glare, blur) cannot be verified. Silence would
 * read as "matches the paper", so it abstains to needs-human instead.
 */
export function unverifiedField(
  fieldId: string,
  typedRaw: string,
  paper: Record<string, string>,
  seenDocTypes: ReadonlySet<string>,
  label: string,
): { fieldId: string; rule: "unreadable"; message: string } | null {
  if (!isPaperMatchField(fieldId) || typedRaw.trim() === "") return null;
  const docType = fieldId.split(".")[0] ?? "";
  if (!seenDocTypes.has(docType)) return null;
  const paperRaw = paper[fieldId];
  if (paperRaw !== undefined) {
    const verdict = classifyPaperVsTyped(fieldId, paperRaw, typedRaw);
    if (verdict !== "cut-off" && verdict !== "misread") return null;
  }
  return {
    fieldId,
    rule: "unreadable",
    message: `${label} was not readable on the ${DOC_NAMES[docType] ?? docType}; look at it again.`,
  };
}
