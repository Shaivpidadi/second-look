import type { SparkAdapter } from "./spark.ts";
import type { ClaimDraft } from "./types.ts";

export interface ClaimDraftInput {
  carrier: string;
  bolRef: string;
  awbRef: string;
  exceptionNote: string;
}

export interface DraftClaimOptions {
  /**
   * Spark adapter hook for a model-drafted body. Null/omitted today, so
   * the deterministic template serves the draft with no API key.
   */
  spark?: SparkAdapter | null;
}

export const CLAIM_AMOUNT_PLACEHOLDER = "[AMOUNT TBD]";

const QTY_UNITS = "cartons?|box(?:es)?|units?|pieces?|pkgs?|packages?|pallets?|ctns?";

/** Whether a POD exception note mentions damage. */
export function mentionsDamage(note: string): boolean {
  return /damag/i.test(note);
}

/**
 * Parse the damaged quantity from an exception note like "2 cartons
 * damaged" or "damaged: 3 units". Null when no count is stated.
 */
export function parseDamagedQty(note: string): number | null {
  const before = note.match(
    new RegExp(`(\\d+)\\s*(?:${QTY_UNITS})?\\s*damag`, "i"),
  );
  if (before?.[1]) return Number(before[1]);
  const after = note.match(
    new RegExp(`damag\\w*\\D{0,24}(\\d+)\\s*(?:${QTY_UNITS})?`, "i"),
  );
  if (after?.[1]) return Number(after[1]);
  return null;
}

/** Deterministic template draft; needs no model or API key. */
export function draftClaimTemplate(input: ClaimDraftInput): ClaimDraft {
  const damagedQty = parseDamagedQty(input.exceptionNote);
  const qtyLine =
    damagedQty === null
      ? "Damaged quantity: unspecified (see POD exception)"
      : `Damaged quantity: ${damagedQty} carton${damagedQty === 1 ? "" : "s"}`;
  const body = [
    `Damage claim — ${input.carrier || "Unknown carrier"}`,
    `BOL ${input.bolRef || "n/a"} / AWB ${input.awbRef || "n/a"}`,
    `POD exception: "${input.exceptionNote}"`,
    qtyLine,
    `Claimed amount: ${CLAIM_AMOUNT_PLACEHOLDER}`,
    "",
    "Adjuster: confirm the count against the POD photos, price the goods,",
    "and replace the amount placeholder before filing.",
  ].join("\n");
  return {
    carrier: input.carrier,
    bolRef: input.bolRef,
    awbRef: input.awbRef,
    exceptionNote: input.exceptionNote,
    damagedQty,
    amount: CLAIM_AMOUNT_PLACEHOLDER,
    source: "template",
    body,
  };
}

/**
 * Draft a damage claim from a POD exception note. Template path today;
 * pass a Spark adapter to draft the body with the model instead (the
 * structured fields still come from the template parse).
 */
export async function draftClaim(
  input: ClaimDraftInput,
  options: DraftClaimOptions = {},
): Promise<ClaimDraft> {
  const template = draftClaimTemplate(input);
  if (!options.spark) return template;
  const qty =
    template.damagedQty === null ? "unspecified" : String(template.damagedQty);
  const refined = await options.spark.escalate({
    readings: [
      { fieldId: "claim.carrier", paperValue: null, typedValue: input.carrier },
      { fieldId: "claim.bolRef", paperValue: null, typedValue: input.bolRef },
      { fieldId: "claim.awbRef", paperValue: null, typedValue: input.awbRef },
      { fieldId: "claim.damagedQty", paperValue: null, typedValue: qty },
    ],
    crops: [],
    question:
      `Draft a carrier damage claim for ${input.carrier || "the carrier"}, ` +
      `BOL ${input.bolRef || "n/a"}, AWB ${input.awbRef || "n/a"}: ${qty} ` +
      `damaged per the POD exception "${input.exceptionNote}". ` +
      `Leave the claimed amount as ${CLAIM_AMOUNT_PLACEHOLDER}.`,
  });
  return { ...template, source: "spark", body: refined.explanation };
}
