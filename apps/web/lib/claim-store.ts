import type { ClaimDraft } from "@second-look/pipeline";

import { processMap } from "./process-store.ts";

const draftsBySession = processMap<string, ClaimDraft[]>("claim-drafts");

/** Store a claim draft for a session (in-memory, like the event store). */
export function storeClaimDraft(sessionId: string, draft: ClaimDraft): void {
  const drafts = draftsBySession.get(sessionId) ?? [];
  drafts.push(draft);
  draftsBySession.set(sessionId, drafts);
}

/** Claim drafts for a session, oldest first; [] when it has none. */
export function getClaimDrafts(sessionId: string): ClaimDraft[] {
  return [...(draftsBySession.get(sessionId) ?? [])];
}
