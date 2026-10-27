import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeAwbCheckDigit, validateAwb } from "../src/awb.ts";

describe("validateAwb", () => {
  it("accepts known-good numbers", () => {
    assert.equal(validateAwb("02027342210").valid, true);
    assert.equal(validateAwb("00112345675").valid, true);
  });

  it("accepts dashes and spaces", () => {
    const result = validateAwb("020-2734 2210");
    assert.equal(result.valid, true);
    assert.equal(result.normalized, "02027342210");
  });

  it("rejects a swapped digit", () => {
    // Transposition in the serial changes serial mod 7.
    assert.equal(validateAwb("02027342201").valid, false);
  });

  it("rejects a wrong check digit", () => {
    assert.equal(validateAwb("02027342211").valid, false);
    assert.equal(validateAwb("02027342211").error, "awb_check_digit");
  });

  it("rejects a dropped digit", () => {
    assert.equal(validateAwb("0202734221").error, "awb_format");
  });

  it("rejects non-numeric input", () => {
    assert.equal(validateAwb("0202734221X").error, "awb_format");
  });

  it("computes check digits", () => {
    assert.equal(computeAwbCheckDigit("0202734221"), 0);
    assert.equal(computeAwbCheckDigit("0011234567"), 5);
  });
});
