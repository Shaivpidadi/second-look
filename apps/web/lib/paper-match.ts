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
  "bol.consignee",
  "bol.containerNumber",
  "label.sscc",
  "bol.cartons",
  "pod.receivedCartons",
] as const;

const DIGITS_ONLY = new Set(["awb.awbNumber", "label.sscc"]);
const COUNTS = new Set(["bol.cartons", "pod.receivedCartons"]);
/** Party names: compared as company names, not as codes. */
const PARTIES = new Set(["bol.carrier", "bol.consignee"]);

/**
 * Paper readings that can verify a typed field, best first. The form
 * has one consignee; the BOL prints it, and so does the air waybill.
 */
const PAPER_SOURCES: Record<string, readonly string[]> = {
  "bol.consignee": ["bol.consignee", "awb.consignee"],
};

function paperSources(fieldId: string): readonly string[] {
  return PAPER_SOURCES[fieldId] ?? [fieldId];
}

/** The paper reading that verifies a typed field, if any was read. */
export function paperValueFor(fieldId: string, paper: Record<string, string>): string | undefined {
  for (const source of paperSources(fieldId)) {
    const value = paper[source];
    if (value !== undefined && value.trim() !== "") return value;
  }
  return undefined;
}

/** Legal-form suffixes that never tell two parties apart. */
const LEGAL_SUFFIXES = new Set([
  "INC", "INCORPORATED", "LLC", "LLP", "LP", "LTD", "LIMITED", "CO", "COMPANY",
  "CORP", "CORPORATION", "PLC", "GMBH", "AG", "SA", "SAS", "BV", "NV", "PTY", "PVT", "SRL",
]);

/** Common abbreviations on paperwork, expanded so "DIST." equals "DISTRIBUTION". */
const ABBREVIATIONS: Record<string, string> = {
  DIST: "DISTRIBUTION",
  DISTR: "DISTRIBUTION",
  INTL: "INTERNATIONAL",
  MFG: "MANUFACTURING",
  SVCS: "SERVICES",
  SVC: "SERVICE",
  LOG: "LOGISTICS",
  WHSE: "WAREHOUSE",
  BROS: "BROTHERS",
};

/**
 * Canonical company name: case, punctuation, spacing, "&" vs "AND",
 * a leading "THE", trailing legal suffixes (Inc, LLC, Co, Ltd...) and a
 * few standard abbreviations never tell two parties apart. Returns null
 * when nothing is left.
 */
export function canonicalPartyName(raw: string): string | null {
  const upper = raw.toUpperCase().replace(/&/g, " AND ");
  // "L.L.C." and "S.A." collapse to one token before splitting.
  const joined = upper.replace(/\b([A-Z])\.(?=[A-Z]\.)/g, "$1").replace(/\b([A-Z])\.(?=\s|$)/g, "$1");
  let words = joined
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w !== "");
  words = words.map((w) => ABBREVIATIONS[w] ?? w);
  if (words.length > 1 && words[0] === "THE") words = words.slice(1);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1]!)) words = words.slice(0, -1);
  const out = words.join(" ");
  return out === "" ? null : out;
}

/**
 * Canonical form for comparing one field: case, spacing, and
 * punctuation never count as a mismatch ("020-2734 2210" equals
 * "02027342210", "(00) 1061..." equals "1061...", "120 CTNS" equals
 * "120", "Blue River Distribution, Inc." equals "BLUE RIVER
 * DISTRIBUTION"). Returns null when nothing comparable is left.
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
  if (PARTIES.has(fieldId)) {
    const name = canonicalPartyName(value);
    return name === null ? null : name.replace(/ /g, "");
  }
  const alnum = value.replace(/[^A-Z0-9]/g, "");
  return alnum === "" ? null : alnum;
}

function display(fieldId: string, paper: string): string {
  if (COUNTS.has(fieldId)) return canonicalFieldValue(fieldId, paper) ?? paper.trim();
  if (DIGITS_ONLY.has(fieldId)) return canonicalFieldValue(fieldId, paper) ?? paper.trim();
  return paper.trim().replace(/\s+/g, " ");
}

export type PaperVsTyped = "match" | "mismatch" | "cut-off" | "misread" | "unknown";

/** Check-digit validators for paper reads: printed numbers always pass theirs. */
const PAPER_VALIDATORS: Record<string, (raw: string) => { valid: boolean }> = {
  "awb.awbNumber": validateAwb,
  "bol.containerNumber": validateContainer,
  "label.sscc": validateSscc,
};

/** Letters a camera confuses with digits on printed reference numbers. */
const CONFUSABLE: Record<string, string> = { O: "0", Q: "0", D: "0", I: "1", L: "1", S: "5", B: "8", Z: "2", G: "6" };

function foldConfusables(value: string): string {
  return value.replace(/[OQDILSBZG]/g, (ch) => CONFUSABLE[ch] ?? ch);
}

/** Levenshtein distance, capped: returns cap + 1 once it is exceeded. */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      row.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
    prev = row;
  }
  return prev[b.length]!;
}

/**
 * Compare one field's paper reading with its typed value.
 * "cut-off": a shorter digit-only paper read that the typed value starts
 * or ends with, i.e. the page edge clipped the number. "misread": the
 * paper read fails its own check digit, so the camera read it wrong (a
 * printed AWB, container, or SSCC number is valid by construction), or
 * a party name differs by one character, or a reference number differs
 * only by look-alike characters (BOI vs BOL, O vs 0), which is a camera
 * or typing slip, not a different value. Neither is a wrong value; both
 * abstain to a human instead of blocking.
 */
export function classifyPaperVsTyped(fieldId: string, paperRaw: string, typedRaw: string): PaperVsTyped {
  const p = canonicalFieldValue(fieldId, paperRaw);
  const t = canonicalFieldValue(fieldId, typedRaw);
  if (p === null || t === null) return "unknown";
  if (p === t) return "match";
  if (DIGITS_ONLY.has(fieldId) && p.length < t.length && (t.endsWith(p) || t.startsWith(p))) return "cut-off";
  const validate = PAPER_VALIDATORS[fieldId];
  if (validate !== undefined && !validate(p).valid) return "misread";
  if (PARTIES.has(fieldId) && Math.min(p.length, t.length) >= 8 && editDistance(p, t, 1) <= 1) return "misread";
  if (!PARTIES.has(fieldId) && !COUNTS.has(fieldId) && foldConfusables(p) === foldConfusables(t)) return "misread";
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
    const paperRaw = paperValueFor(fieldId, paper);
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
  const seenSources = paperSources(fieldId)
    .map((source) => source.split(".")[0] ?? "")
    .filter((docType) => seenDocTypes.has(docType));
  if (seenSources.length === 0) return null;
  const paperRaw = paperValueFor(fieldId, paper);
  if (paperRaw !== undefined) {
    const verdict = classifyPaperVsTyped(fieldId, paperRaw, typedRaw);
    if (verdict !== "cut-off" && verdict !== "misread") return null;
  }
  const docType = seenSources[0]!;
  return {
    fieldId,
    rule: "unreadable",
    message: `${label} was not readable on the ${DOC_NAMES[docType] ?? docType}; look at it again.`,
  };
}

/** Paper-vs-paper consignee pairs: the BOL is the reference. */
const CONSIGNEE_READINGS = ["bol.consignee", "awb.consignee"] as const;

export interface PaperConflict {
  fieldId: string;
  rule: "cross_doc";
  message: string;
}

/**
 * Consignee printed on two documents of one shipment must name the same
 * party. Formatting (case, punctuation, Inc/LLC) is not a conflict, and
 * a one-character difference is a misread, not a conflict.
 */
export function consigneeConflict(paper: Record<string, string>): PaperConflict | null {
  const [refId, otherId] = CONSIGNEE_READINGS;
  const ref = paper[refId];
  const other = paper[otherId];
  if (ref === undefined || other === undefined) return null;
  if (classifyPaperVsTyped("bol.consignee", ref, other) !== "mismatch") return null;
  return {
    fieldId: otherId,
    rule: "cross_doc",
    message: `Consignee differs: bill of lading says ${display("bol.consignee", ref)}, air waybill says ${display("bol.consignee", other)}.`,
  };
}

/** Paper reading for the receiver signature on a delivery receipt. */
export const SIGNATURE_FIELD = "pod.receiverSigned";

/** "yes", "no", or null when the reading says neither. */
export function normalizeSigned(raw: string): "yes" | "no" | null {
  const value = raw.trim().toLowerCase();
  if (["yes", "y", "true", "signed", "present"].includes(value)) return "yes";
  if (["no", "n", "false", "unsigned", "blank", "missing", "none", "empty"].includes(value)) return "no";
  return null;
}

export interface SignatureFailure {
  fieldId: typeof SIGNATURE_FIELD;
  rule: "missing_signature" | "unreadable";
  message: string;
}

/**
 * Receiver signature on the delivery receipt. Only the delivery receipt
 * carries this check. A blank signature line blocks; a receipt that was
 * seen but whose signature could not be told (covered, cut off, blurred)
 * goes to a human. Returns null when no delivery receipt was seen or
 * the receipt is signed.
 */
export function signatureFailure(
  paper: Record<string, string>,
  seenDocTypes: ReadonlySet<string>,
): SignatureFailure | null {
  const raw = paper[SIGNATURE_FIELD];
  const signed = raw === undefined ? null : normalizeSigned(raw);
  if (signed === "no") {
    return {
      fieldId: SIGNATURE_FIELD,
      rule: "missing_signature",
      message: "Delivery receipt is not signed by the receiver. Get it signed before accepting.",
    };
  }
  if (signed === "yes" || !seenDocTypes.has("pod")) return null;
  return {
    fieldId: SIGNATURE_FIELD,
    rule: "unreadable",
    message: "Could not tell whether the delivery receipt is signed; check the signature line.",
  };
}
