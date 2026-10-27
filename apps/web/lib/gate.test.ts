import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateSubmission, evaluateTieredSubmission } from "./gate.ts";

const VALID = {
  "awb.awbNumber": "02027342210",
  "bol.containerNumber": "CSQU3054383",
  "label.sscc": "106141410000001238",
  "bol.cartons": "120",
  "pod.receivedCartons": "120",
  "pod.exceptionNote": "",
};

describe("evaluateSubmission", () => {
  it("allows a fully valid submission", () => {
    const result = evaluateSubmission({ ...VALID });
    assert.equal(result.decision, "ALLOW");
    assert.equal(result.verdict.state, "clean");
    assert.deepEqual(result.failures, []);
  });

  it("blocks on a wrong AWB digit", () => {
    const result = evaluateSubmission({
      ...VALID,
      "awb.awbNumber": "02027342211",
    });
    assert.equal(result.decision, "BLOCK");
    assert.equal(result.verdict.state, "blocked");
    assert.equal(result.failures[0]?.fieldId, "awb.awbNumber");
    assert.equal(result.failures[0]?.rule, "awb_check_digit");
    assert.equal(result.failures[0]?.fix, "02027342210");
  });

  it("blocks on a bad container check digit", () => {
    const result = evaluateSubmission({
      ...VALID,
      "bol.containerNumber": "CSQU3054384",
    });
    assert.equal(result.decision, "BLOCK");
    assert.equal(result.failures[0]?.rule, "container_check_digit");
    assert.equal(result.failures[0]?.fix, "CSQU3054383");
  });

  it("blocks on a bad SSCC check digit", () => {
    const result = evaluateSubmission({
      ...VALID,
      "label.sscc": "106141410000001239",
    });
    assert.equal(result.decision, "BLOCK");
    assert.equal(result.failures[0]?.rule, "sscc_check_digit");
    assert.equal(result.failures[0]?.fix, "106141410000001238");
  });

  it("blocks on a short receiving count", () => {
    const result = evaluateSubmission({
      ...VALID,
      "pod.receivedCartons": "118",
    });
    assert.equal(result.decision, "BLOCK");
    assert.equal(result.verdict.state, "mismatch");
    assert.equal(result.failures[0]?.rule, "count_mismatch");
    assert.equal(result.failures[0]?.fix, "120");
  });

  it("blocks on missing values", () => {
    const result = evaluateSubmission({});
    assert.equal(result.decision, "BLOCK");
    assert.ok(result.failures.length >= 3);
  });

  it("omits fixes for malformed values", () => {
    const result = evaluateSubmission({ ...VALID, "awb.awbNumber": "abc" });
    assert.equal(result.decision, "BLOCK");
    assert.equal(result.failures[0]?.rule, "awb_format");
    assert.equal(result.failures[0]?.fix, undefined);
  });
});

describe("evaluateTieredSubmission", () => {
  const TIERED_VALID = {
    ...VALID,
    "bol.bolNumber": "BOL-00421307",
    "bol.carrier": "HARBOUR LINE GOODS",
  };

  it("agrees with no Spark call and no claim on a clean form", async () => {
    const result = await evaluateTieredSubmission({ ...TIERED_VALID });
    assert.equal(result.decision, "ALLOW");
    assert.equal(result.glimmer.outcome, "agree");
    assert.equal(result.escalated, false);
    assert.equal(result.spark, null);
    assert.equal(result.claim, null);
    assert.equal(result.modelCalls.length, 1);
    assert.equal(result.modelCalls[0]?.model, "glimmer");
    assert.equal(result.modelCalls[0]?.costUsd, 0);
  });

  it("blocks a bad check digit with no Spark call", async () => {
    const result = await evaluateTieredSubmission({
      ...TIERED_VALID,
      "awb.awbNumber": "02027342211",
    });
    assert.equal(result.decision, "BLOCK");
    assert.equal(result.verdict.state, "blocked");
    assert.equal(result.escalated, false);
    assert.equal(result.spark, null);
    assert.equal(result.failures[0]?.fix, "02027342210");
  });

  it("escalates to Spark on a short receiving count", async () => {
    const result = await evaluateTieredSubmission({
      ...TIERED_VALID,
      "pod.receivedCartons": "118",
    });
    assert.equal(result.decision, "BLOCK");
    assert.equal(result.escalated, true);
    assert.ok(result.escalationReasons.includes("cross_doc_conflict"));
    assert.ok(result.spark);
    assert.equal(result.modelCalls.length, 2);
    assert.ok((result.modelCalls[1]?.costUsd ?? 0) > 0);
  });

  it("drafts a claim when the POD note mentions damage", async () => {
    const result = await evaluateTieredSubmission({
      ...TIERED_VALID,
      "pod.exceptionNote": "2 cartons damaged",
    });
    assert.equal(result.decision, "ALLOW");
    assert.equal(result.escalated, true);
    assert.ok(result.escalationReasons.includes("handwriting"));
    assert.equal(result.claim?.damagedQty, 2);
    assert.equal(result.claim?.carrier, "HARBOUR LINE GOODS");
    assert.equal(result.claim?.bolRef, "BOL-00421307");
    assert.equal(result.claim?.awbRef, "02027342210");
    assert.equal(result.claim?.source, "template");
  });

  it("drafts no claim when the note mentions no damage", async () => {
    const result = await evaluateTieredSubmission({
      ...TIERED_VALID,
      "pod.exceptionNote": "seal intact",
    });
    assert.equal(result.claim, null);
  });
});
