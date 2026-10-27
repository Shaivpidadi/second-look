import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLAIM_AMOUNT_PLACEHOLDER,
  draftClaim,
  draftClaimTemplate,
  mentionsDamage,
  parseDamagedQty,
  type SparkAdapter,
  type SparkEscalationInput,
  type SparkEscalationOutput,
} from "../src/index.ts";

const INPUT = {
  carrier: "HARBOUR LINE",
  bolRef: "BOL-123",
  awbRef: "02027342210",
  exceptionNote: "2 cartons damaged",
};

describe("parseDamagedQty", () => {
  it("reads counts before and after the damage word", () => {
    assert.equal(parseDamagedQty("2 cartons damaged"), 2);
    assert.equal(parseDamagedQty("1 box damaged"), 1);
    assert.equal(parseDamagedQty("DAMAGED: 3 units"), 3);
    assert.equal(parseDamagedQty("5 damaged"), 5);
  });

  it("returns null when no count is stated", () => {
    assert.equal(parseDamagedQty("cartons damaged"), null);
    assert.equal(parseDamagedQty("all good"), null);
    assert.equal(parseDamagedQty(""), null);
  });
});

describe("mentionsDamage", () => {
  it("matches damage mentions case-insensitively", () => {
    assert.equal(mentionsDamage("2 cartons damaged"), true);
    assert.equal(mentionsDamage("DAMAGED corner"), true);
    assert.equal(mentionsDamage("received short"), false);
    assert.equal(mentionsDamage(""), false);
  });
});

describe("draftClaimTemplate", () => {
  it("fills refs, qty, and the amount placeholder", () => {
    const draft = draftClaimTemplate(INPUT);
    assert.equal(draft.carrier, "HARBOUR LINE");
    assert.equal(draft.bolRef, "BOL-123");
    assert.equal(draft.awbRef, "02027342210");
    assert.equal(draft.damagedQty, 2);
    assert.equal(draft.amount, CLAIM_AMOUNT_PLACEHOLDER);
    assert.equal(draft.source, "template");
    assert.match(draft.body, /HARBOUR LINE/);
    assert.match(draft.body, /BOL-123/);
    assert.match(draft.body, /02027342210/);
    assert.match(draft.body, /2 cartons/);
    assert.match(draft.body, /\[AMOUNT TBD\]/);
  });

  it("notes an unspecified quantity without a count", () => {
    const draft = draftClaimTemplate({ ...INPUT, exceptionNote: "corner crushed, damaged" });
    assert.equal(draft.damagedQty, null);
    assert.match(draft.body, /unspecified/);
  });
});

describe("draftClaim", () => {
  it("uses the template with no Spark adapter and no key", async () => {
    const draft = await draftClaim(INPUT);
    assert.equal(draft.source, "template");
    assert.equal(draft.damagedQty, 2);
  });

  it("drafts the body through the Spark hook when given", async () => {
    const spark: SparkAdapter = {
      name: "canned",
      async escalate(_input: SparkEscalationInput): Promise<SparkEscalationOutput> {
        return {
          explanation: "Canned claim body.",
          proposedFixes: [],
          latencyMs: 1,
          costUsd: 0,
        };
      },
    };
    const draft = await draftClaim(INPUT, { spark });
    assert.equal(draft.source, "spark");
    assert.equal(draft.body, "Canned claim body.");
    assert.equal(draft.damagedQty, 2);
    assert.equal(draft.amount, CLAIM_AMOUNT_PLACEHOLDER);
  });
});
