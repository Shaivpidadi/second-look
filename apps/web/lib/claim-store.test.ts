import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getClaimDrafts, storeClaimDraft } from "./claim-store.ts";

describe("claim store", () => {
  it("returns [] for sessions without drafts", () => {
    assert.deepEqual(getClaimDrafts(`none-${Date.now()}`), []);
  });

  it("stores drafts per session in order", () => {
    const sessionId = `s-${Date.now()}`;
    const first = {
      carrier: "A",
      bolRef: "BOL-1",
      awbRef: "AWB-1",
      exceptionNote: "1 carton damaged",
      damagedQty: 1,
      amount: "[AMOUNT TBD]",
      source: "template" as const,
      body: "first",
    };
    const second = { ...first, body: "second" };
    storeClaimDraft(sessionId, first);
    storeClaimDraft(sessionId, second);
    assert.deepEqual(getClaimDrafts(sessionId), [first, second]);
    assert.deepEqual(getClaimDrafts(`other-${Date.now()}`), []);
  });
});
