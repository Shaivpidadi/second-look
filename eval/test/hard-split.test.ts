import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildHardForm } from "@second-look/generator";
import { checkDigitArm, singleModelArm, tieredArm } from "../arms.ts";

describe("hard split", () => {
  it("separates validator-only arms from diff-aware arms", async () => {
    let errors = 0;
    let checkFlags = 0;
    let tieredFlags = 0;
    let singleFlags = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const form = buildHardForm(`hard-${seed}`, 9000 + seed);
      if (form.errors.length === 0) continue;
      errors++;
      if ((await checkDigitArm.judge({ form })).flagged) checkFlags++;
      if ((await tieredArm.judge({ form })).flagged) tieredFlags++;
      if ((await singleModelArm.judge({ form })).flagged) singleFlags++;
    }
    assert.ok(errors > 0);
    assert.ok(checkFlags < errors, "check-digit-only should miss validator-blind errors");
    assert.ok(tieredFlags > checkFlags, `tiered ${tieredFlags} <= check-digit ${checkFlags}`);
    assert.equal(singleFlags, tieredFlags);
  });

  it("never flags clean hard forms despite the notes", async () => {
    let clean = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const form = buildHardForm(`hard-${seed}`, 9000 + seed);
      if (form.errors.length > 0) continue;
      clean++;
      assert.ok((form.typed["pod.exceptionNote"] ?? "") !== "", `seed ${seed} has no note`);
      for (const arm of [checkDigitArm, singleModelArm, tieredArm]) {
        assert.equal((await arm.judge({ form })).flagged, false, `${arm.name} seed ${seed}`);
      }
    }
    assert.ok(clean > 0, "expected clean hard forms");
  });
});
