import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeGs1CheckDigit, validateSscc } from "../src/gs1.ts";

describe("validateSscc", () => {
  it("accepts a known-good SSCC", () => {
    assert.equal(validateSscc("106141410000001238").valid, true);
  });

  it("accepts separators", () => {
    const result = validateSscc("1 0614141 0000001238");
    assert.equal(result.valid, true);
    assert.equal(result.normalized, "106141410000001238");
  });

  it("rejects a transposition", () => {
    assert.equal(validateSscc("106141410000001328").valid, false);
  });

  it("rejects a wrong check digit", () => {
    const result = validateSscc("106141410000001239");
    assert.equal(result.valid, false);
    assert.equal(result.error, "sscc_check_digit");
  });

  it("rejects a dropped digit", () => {
    assert.equal(validateSscc("10614141000000123").error, "sscc_format");
  });

  it("computes GS1 mod-10 check digits", () => {
    assert.equal(computeGs1CheckDigit("10614141000000123"), 8);
    // Textbook GTIN-13 example exercises the same algorithm.
    assert.equal(computeGs1CheckDigit("400638133393"), 1);
  });

  it("round-trips generated numbers", () => {
    const first = "10614141000000987";
    const full = first + computeGs1CheckDigit(first);
    assert.equal(validateSscc(full).valid, true);
  });
});
