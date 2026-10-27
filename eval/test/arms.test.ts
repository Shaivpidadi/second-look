import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildForm } from "@second-look/generator";
import {
  ALL_ARMS,
  checkDigitArm,
  crossDocArm,
  singleModelArm,
  tieredArm,
} from "../arms.ts";

describe("check-digit-only arm", () => {
  it("is available, free, and fast", async () => {
    const verdict = await checkDigitArm.judge({
      form: buildForm("form-0001", 1),
    });
    assert.equal(checkDigitArm.available, true);
    assert.equal(typeof verdict.flagged, "boolean");
    assert.equal(verdict.costUsd, 0);
    assert.ok(verdict.latencyMs >= 0);
  });

  it("never flags clean forms", async () => {
    let clean = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const form = buildForm(`form-${seed}`, seed);
      if (form.errors.length > 0) continue;
      clean++;
      const verdict = await checkDigitArm.judge({ form });
      assert.equal(verdict.flagged, false, `seed ${seed} flagged`);
    }
    assert.ok(clean > 0, "expected some clean forms");
  });

  it("always flags dropped container digits", async () => {
    let seen = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const form = buildForm(`form-${seed}`, seed);
      if (!form.errors.some((e) => e.kind === "dropped_digit")) continue;
      seen++;
      const verdict = await checkDigitArm.judge({ form });
      assert.equal(verdict.flagged, true, `seed ${seed} missed`);
      assert.ok(
        verdict.failures.some((f) => f.fieldId === "bol.containerNumber"),
      );
    }
    assert.ok(seen > 0, "expected dropped_digit forms");
  });
});

describe("check-digit+cross-doc arm", () => {
  it("never flags clean forms", async () => {
    let clean = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const form = buildForm(`form-${seed}`, seed);
      if (form.errors.length > 0) continue;
      clean++;
      const verdict = await crossDocArm.judge({ form });
      assert.equal(verdict.flagged, false, `seed ${seed} flagged`);
    }
    assert.ok(clean > 0, "expected some clean forms");
  });

  it("always flags paper discrepancies", async () => {
    const paperKinds = new Set(["short_count", "qty_gap", "weight_gap"]);
    const seen = new Set<string>();
    for (let seed = 1; seed <= 80; seed++) {
      const form = buildForm(`form-${seed}`, seed);
      const kinds = form.errors.map((e) => e.kind).filter((k) => paperKinds.has(k));
      if (kinds.length === 0) continue;
      for (const kind of kinds) seen.add(kind);
      const verdict = await crossDocArm.judge({ form });
      assert.equal(verdict.flagged, true, `seed ${seed} missed`);
    }
    assert.deepEqual([...seen].sort(), ["qty_gap", "short_count", "weight_gap"]);
  });
});

describe("model arms", () => {
  it("stay stubbed behind the arm interface", async () => {
    for (const arm of [singleModelArm, tieredArm]) {
      assert.equal(arm.available, false);
      await assert.rejects(() => arm.judge({ form: buildForm("f", 1) }));
    }
  });

  it("registers four uniquely named arms", () => {
    assert.deepEqual(
      ALL_ARMS.map((arm) => arm.name),
      ["check-digit-only", "check-digit+cross-doc", "single-model", "tiered"],
    );
  });
});
