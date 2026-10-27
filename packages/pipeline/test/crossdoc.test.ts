import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkCrossDoc } from "../src/crossdoc.ts";

const CLEAN: Record<string, string> = {
  "invoice.totalQty": "120",
  "packing.totalQty": "120",
  "bol.weightKg": "2400",
  "awb.weightKg": "2400",
  "bol.cartons": "120",
  "pod.receivedCartons": "120",
};

describe("checkCrossDoc", () => {
  it("passes all three checks on consistent values", () => {
    const checks = checkCrossDoc({ ...CLEAN });
    assert.equal(checks.length, 3);
    assert.ok(checks.every((c) => c.passed));
    assert.ok(checks.every((c) => c.kind === "cross_doc"));
  });

  it("flags an invoice-vs-packing quantity gap", () => {
    const checks = checkCrossDoc({ ...CLEAN, "invoice.totalQty": "118" });
    const failed = checks.filter((c) => !c.passed);
    assert.equal(failed.length, 1);
    assert.equal(failed[0]?.fieldId, "invoice.totalQty");
    assert.match(failed[0]?.detail ?? "", /118.*120/);
  });

  it("flags a BOL-vs-AWB weight gap", () => {
    const checks = checkCrossDoc({ ...CLEAN, "awb.weightKg": "2600" });
    const failed = checks.filter((c) => !c.passed);
    assert.equal(failed.length, 1);
    assert.equal(failed[0]?.fieldId, "awb.weightKg");
  });

  it("accepts weights within tolerance", () => {
    const checks = checkCrossDoc(
      { ...CLEAN, "awb.weightKg": "2405" },
      { weightToleranceKg: 10 },
    );
    assert.ok(checks.every((c) => c.passed));
    const strict = checkCrossDoc({ ...CLEAN, "awb.weightKg": "2405" });
    assert.equal(strict.filter((c) => !c.passed).length, 1);
  });

  it("flags received-vs-shipped count mismatch", () => {
    const checks = checkCrossDoc({ ...CLEAN, "pod.receivedCartons": "117" });
    const failed = checks.filter((c) => !c.passed);
    assert.equal(failed.length, 1);
    assert.equal(failed[0]?.fieldId, "pod.receivedCartons");
  });

  it("fails checks with missing values", () => {
    const checks = checkCrossDoc({});
    assert.equal(checks.length, 3);
    assert.ok(checks.every((c) => !c.passed));
  });

  it("fails checks with non-numeric values", () => {
    const checks = checkCrossDoc({ ...CLEAN, "packing.totalQty": "many" });
    const failed = checks.filter((c) => !c.passed);
    assert.equal(failed.length, 1);
    assert.equal(failed[0]?.fieldId, "invoice.totalQty");
  });

  it("rejects negative counts", () => {
    const checks = checkCrossDoc({ ...CLEAN, "pod.receivedCartons": "-1" });
    assert.equal(checks.filter((c) => !c.passed).length, 1);
  });

  it("omits missing-input checks when skipMissingInputs is set", () => {
    const checks = checkCrossDoc(
      { "bol.cartons": "120", "pod.receivedCartons": "120" },
      { skipMissingInputs: true },
    );
    assert.equal(checks.length, 1);
    assert.equal(checks[0]?.fieldId, "pod.receivedCartons");
    assert.ok(checks[0]?.passed);
  });

  it("still fails present-but-conflicting inputs with skipMissingInputs", () => {
    const checks = checkCrossDoc(
      { "bol.cartons": "120", "pod.receivedCartons": "118" },
      { skipMissingInputs: true },
    );
    assert.equal(checks.length, 1);
    assert.equal(checks[0]?.passed, false);
  });
});
