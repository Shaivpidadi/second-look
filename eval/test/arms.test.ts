import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildForm } from "@second-look/generator";
import {
  ALL_ARMS,
  checkDigitArm,
  singleModelArm,
  tieredArm,
  type EvalArm,
} from "../arms.ts";

describe("check-digit-only arm", () => {
  it("is available, free, and fast", async () => {
    const verdict = await checkDigitArm.judge({
      form: buildForm("form-0001", 1),
    });
    assert.equal(checkDigitArm.available, true);
    assert.equal(checkDigitArm.stubbed, false);
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

describe("stubbed model arms", () => {
  const arms: EvalArm[] = [singleModelArm, tieredArm];

  it("are available behind stubs", () => {
    for (const arm of arms) {
      assert.equal(arm.available, true);
      assert.equal(arm.stubbed, true);
    }
  });

  it("never flag clean forms", async () => {
    let clean = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const form = buildForm(`form-${seed}`, seed);
      if (form.errors.length > 0) continue;
      clean++;
      for (const arm of arms) {
        const verdict = await arm.judge({ form });
        assert.equal(verdict.flagged, false, `${arm.name} seed ${seed} flagged`);
      }
    }
    assert.ok(clean > 0, "expected some clean forms");
  });

  it("flag every error kind at least once", async () => {
    // No-op injections (e.g. swapping identical digits) leave no signal,
    // so per-kind coverage is asserted instead of perfect recall.
    const flagged = new Map<string, Set<string>>(
      arms.map((arm) => [arm.name, new Set<string>()]),
    );
    for (let seed = 1; seed <= 150; seed++) {
      const form = buildForm(`form-${seed}`, seed);
      if (form.errors.length === 0) continue;
      for (const arm of arms) {
        const verdict = await arm.judge({ form });
        if (verdict.flagged) {
          for (const error of form.errors) flagged.get(arm.name)?.add(error.kind);
        }
      }
    }
    const kinds = [
      "dropped_digit",
      "qty_gap",
      "short_count",
      "sscc_transposition",
      "swapped_fields",
      "transposition",
      "weight_gap",
    ];
    for (const arm of arms) {
      assert.deepEqual([...(flagged.get(arm.name) ?? [])].sort(), kinds, arm.name);
    }
  });

  it("always flag genuine paper discrepancies", async () => {
    const paperKinds = new Set(["short_count", "qty_gap", "weight_gap"]);
    for (let seed = 1; seed <= 80; seed++) {
      const form = buildForm(`form-${seed}`, seed);
      if (!form.errors.some((e) => paperKinds.has(e.kind))) continue;
      for (const arm of arms) {
        const verdict = await arm.judge({ form });
        assert.equal(verdict.flagged, true, `${arm.name} seed ${seed} missed`);
      }
    }
  });

  it("charges one Spark call per form on single-model, fewer on tiered", async () => {
    let single = 0;
    let tiered = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const form = buildForm(`form-${seed}`, seed);
      single += (await singleModelArm.judge({ form })).costUsd;
      tiered += (await tieredArm.judge({ form })).costUsd;
    }
    assert.ok(single > 0);
    assert.ok(tiered > 0);
    assert.ok(tiered <= single, `tiered $${tiered} > single $${single}`);
  });

  it("costs the tiered arm nothing on clean forms without handwriting", async () => {
    let plain = 0;
    let noted = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const form = buildForm(`form-${seed}`, seed);
      if (form.errors.length > 0) continue;
      const verdict = await tieredArm.judge({ form });
      assert.equal(verdict.flagged, false);
      if (form.typed["pod.exceptionNote"]) {
        noted++;
        assert.ok(verdict.costUsd > 0, `seed ${seed} should escalate`);
      } else {
        plain++;
        assert.equal(verdict.costUsd, 0, `seed ${seed} should cost $0`);
      }
    }
    assert.ok(plain > 0, "expected clean forms without notes");
    assert.ok(noted > 0, "expected clean forms with notes");
  });

  it("registers three uniquely named arms", () => {
    assert.deepEqual(
      ALL_ARMS.map((arm) => arm.name),
      ["check-digit-only", "single-model", "tiered"],
    );
  });
});
