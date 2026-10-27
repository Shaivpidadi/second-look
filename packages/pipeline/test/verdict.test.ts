import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { reduceVerdict } from "../src/verdict.ts";
import type { FieldCheck } from "../src/types.ts";

function check(fieldId: string, passed: boolean, kind: FieldCheck["kind"] = "field_match"): FieldCheck {
  return { fieldId, kind, passed };
}

describe("reduceVerdict", () => {
  it("is clean when all checks pass", () => {
    const verdict = reduceVerdict([check("awb", true), check("qty", true)]);
    assert.equal(verdict.state, "clean");
    assert.deepEqual(verdict.failures, []);
  });

  it("blocks on any check-digit failure", () => {
    const verdict = reduceVerdict([
      check("awb", false, "check_digit"),
      check("qty", true),
    ]);
    assert.equal(verdict.state, "blocked");
    assert.equal(verdict.failures.length, 1);
  });

  it("mismatches on non-check-digit failures", () => {
    const verdict = reduceVerdict([check("qty", false, "cross_doc")]);
    assert.equal(verdict.state, "mismatch");
  });

  it("prefers blocked over mismatch", () => {
    const verdict = reduceVerdict([
      check("qty", false, "cross_doc"),
      check("sscc", false, "check_digit"),
    ]);
    assert.equal(verdict.state, "blocked");
  });
});
