import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildForm } from "@second-look/generator";
import { checkDigitArm, crossDocArm, singleModelArm } from "../arms.ts";
import { loadCorpus, runArm, runEval } from "../runner.ts";

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
    assert.equal(result?.forms.length, 3);
    for (const form of result?.forms ?? []) {
      const source = buildForm(
        form.formId,
        Number(form.formId.slice("form-".length)),
      );
      assert.equal(form.expected, source.errors.length > 0, form.formId);
    }
  });

  it("runs available arms and skips stubbed ones", async () => {
    const results = await runEval(dir, [crossDocArm, singleModelArm]);
    const [cross, stub] = results;
    assert.equal(cross?.available, true);
    assert.equal(cross?.forms.length, 3);
    assert.equal(stub?.available, false);
    assert.deepEqual(stub?.forms, []);
  });

  it("runArm returns empty results for stubbed arms", async () => {
    const result = await runArm(singleModelArm, await loadCorpus(dir));
    assert.equal(result.available, false);
    assert.deepEqual(result.forms, []);
  });
});
