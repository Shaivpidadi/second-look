import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateSubmission } from "./gate.ts";

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
