import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildForm } from "@second-look/generator";
import { checkDigitArm, tieredArm, type EvalArm } from "../arms.ts";
import { loadCorpus, runArm, runEval, selectableArms } from "../runner.ts";

const offlineArm: EvalArm = {
  name: "offline",
  available: false,
  stubbed: false,
  async judge() {
    throw new Error("offline arm: not implemented (needs MODEL_API_KEY)");
  },
};

describe("runner", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "second-look-corpus-"));
    for (const seed of [3, 1, 2]) {
      const formId = `form-${String(seed).padStart(4, "0")}`;
      await writeFile(
        join(dir, `${formId}.json`),
        JSON.stringify(buildForm(formId, seed)),
      );
    }
  });

  it("loads corpus forms sorted by name", async () => {
    const forms = await loadCorpus(dir);
    assert.deepEqual(
      forms.map((f) => f.form.formId),
      ["form-0001", "form-0002", "form-0003"],
    );
  });

  it("marks ground truth from injected errors", async () => {
    const [result] = await runEval(dir, [checkDigitArm]);
    assert.equal(result?.arm, "check-digit-only");
    assert.equal(result?.available, true);
    assert.equal(result?.stubbed, false);
    assert.equal(result?.forms.length, 3);
    for (const form of result?.forms ?? []) {
      const source = buildForm(
        form.formId,
        Number(form.formId.slice("form-".length)),
      );
      assert.equal(form.expected, source.errors.length > 0, form.formId);
    }
  });

  it("carries the stubbed flag from the arm", async () => {
    const [result] = await runEval(dir, [tieredArm]);
    assert.equal(result?.available, true);
    assert.equal(result?.stubbed, true);
    assert.equal(result?.forms.length, 3);
  });

  it("runs available arms and skips unavailable ones", async () => {
    const results = await runEval(dir, [tieredArm, offlineArm]);
    const [tiered, stub] = results;
    assert.equal(tiered?.available, true);
    assert.equal(tiered?.forms.length, 3);
    assert.equal(stub?.available, false);
    assert.deepEqual(stub?.forms, []);
  });

  it("runArm returns empty results for unavailable arms", async () => {
    const result = await runArm(offlineArm, await loadCorpus(dir));
    assert.equal(result.available, false);
    assert.deepEqual(result.forms, []);
  });

  it("limits pilot runs to the first N forms", async () => {
    const [result] = await runEval(dir, [checkDigitArm], { limit: 2 });
    assert.equal(result?.forms.length, 2);
    assert.deepEqual(
      result?.forms.map((f) => f.formId),
      ["form-0001", "form-0002"],
    );
    await assert.rejects(() => runEval(dir, [checkDigitArm], { limit: -1 }), /limit/);
  });

  it("selects real arms by name without changing the defaults", () => {
    const names = selectableArms().map((arm) => arm.name);
    assert.deepEqual(names.slice(0, 3), ["check-digit-only", "single-model", "tiered"]);
    assert.ok(names.includes("single-model-real"));
    assert.ok(names.includes("tiered-real"));
    assert.ok(names.includes("vision-real"));
  });

  it("loads images for arms that need them", async () => {
    await writeFile(join(dir, "form-0001-awb.png"), new Uint8Array([1, 2, 3]));
    await writeFile(join(dir, "form-0001-pod.png"), new Uint8Array([4]));
    const seen: Array<Record<string, Uint8Array> | undefined> = [];
    const imageArm: EvalArm = {
      name: "image-probe",
      available: true,
      stubbed: false,
      needsImages: true,
      async judge(input) {
        seen.push(input.images);
        return { flagged: false, failures: [], latencyMs: 0, costUsd: 0 };
      },
    };
    const [result] = await runEval(dir, [imageArm], { limit: 1 });
    assert.equal(result?.forms.length, 1);
    assert.deepEqual(Object.keys(seen[0] ?? {}).sort(), ["awb", "pod"]);
    assert.deepEqual([...(seen[0]?.awb ?? [])], [1, 2, 3]);
  });

  it("skips image loading for text arms", async () => {
    const seen: Array<Record<string, Uint8Array> | undefined> = [];
    const textArm: EvalArm = {
      name: "text-probe",
      available: true,
      stubbed: false,
      async judge(input) {
        seen.push(input.images);
        return { flagged: false, failures: [], latencyMs: 0, costUsd: 0 };
      },
    };
    await runEval(dir, [textArm], { limit: 1 });
    assert.deepEqual(seen, [undefined]);
  });
});
