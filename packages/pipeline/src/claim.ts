import type { ClaimDraft } from "./types.ts";

export interface ClaimDraftInput {
  carrier: string;
  bolRef: string;
  awbRef: string;
  exceptionNote: string;
}

/** Draft a damage claim from a handwritten POD exception. */
export async function draftClaim(_input: ClaimDraftInput): Promise<ClaimDraft> {
  throw new Error("claim.draftClaim: not implemented (needs MODEL_API_KEY)");
}
