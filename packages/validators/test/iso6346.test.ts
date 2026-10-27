import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeContainerCheckDigit, validateContainer } from "../src/iso6346.ts";

describe("validateContainer", () => {
  it("accepts the textbook example", () => {
    assert.equal(validateContainer("CSQU3054383").valid, true);
  });

  it("accepts lowercase and separators", () => {
    const result = validateContainer("csqu-3054383");
    assert.equal(result.valid, true);
    assert.equal(result.normalized, "CSQU3054383");
  });

  it("rejects a transposition", () => {
    assert.equal(validateContainer("CSQU3504383").valid, false);
  });

  it("rejects a wrong check digit", () => {
    const result = validateContainer("CSQU3054384");
    assert.equal(result.valid, false);
    assert.equal(result.error, "container_check_digit");
  });

  it("rejects a dropped digit", () => {
    assert.equal(validateContainer("CSQU305438").error, "container_format");
  });

  it("rejects a bad owner code", () => {
    assert.equal(validateContainer("CSQ13054383").error, "container_format");
  });

  it("computes check digits", () => {
    assert.equal(computeContainerCheckDigit("CSQU305438"), 3);
  });

  it("round-trips generated numbers", () => {
    const firstTen = "TCLU482031";
    const full = firstTen + computeContainerCheckDigit(firstTen);
    assert.equal(validateContainer(full).valid, true);
  });
});
