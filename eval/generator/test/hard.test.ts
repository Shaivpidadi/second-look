import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateAwb,
  validateContainer,
  validateSscc,
} from "@second-look/validators";
import { generateForm } from "../src/documents.ts";
import {
  applyError,
  ensureExceptionNote,
  injectHardErrors,
  paperValues,
} from "../src/errors.ts";
import { buildHardForm } from "../src/generate.ts";
import { createRng } from "../src/prng.ts";
import {
  applyDegrade,
  blurPixels,
  glarePixels,
  hardDegradeSpec,
  renderForm,
  skewPixels,
} from "../src/render.ts";

function validateField(fieldId: string, value: string): boolean {
  if (fieldId === "awb.awbNumber") return validateAwb(value).valid;
  if (fieldId === "bol.containerNumber") return validateContainer(value).valid;
  return validateSscc(value).valid;
}

describe("near_miss errors", () => {
  it("swap digits while usually preserving check-digit validity", () => {
    let preserved = 0;
    let seen = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const rng = createRng(seed);
      const form = generateForm(`near-${seed}`, seed, rng);
      const typed = paperValues(form);
      const error = applyError(form, typed, "near_miss", rng);
      seen++;
      assert.notEqual(error.typedValue, error.paperValue);
      assert.equal(typed[error.fieldId], error.typedValue);
      if (validateField(error.fieldId, error.typedValue)) preserved++;
    }
    assert.equal(seen, 120);
    assert.ok(preserved > seen * 0.8, `only ${preserved}/${seen} preserved validity`);
  });
});

describe("cross_doc_only errors", () => {
  it("leave paper and typed identical on the mutated field", () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rng = createRng(seed);
      const form = generateForm(`xdoc-${seed}`, seed, rng);
      const typed = paperValues(form);
      const error = applyError(form, typed, "cross_doc_only", rng);
      const paper = paperValues(form);
      assert.equal(
        paper[error.fieldId],
        typed[error.fieldId],
        `seed ${seed} ${error.fieldId} differs`,
      );
      assert.notEqual(error.typedValue, error.paperValue);
    }
  });
});

describe("injectHardErrors", () => {
  it("mixes hard kinds with some clean forms", () => {
    const kinds = new Set<string>();
    let clean = 0;
    let total = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const rng = createRng(10_000 + seed);
      const form = generateForm(`hard-${seed}`, seed, rng);
      const typed = paperValues(form);
      const errors = injectHardErrors(form, typed, rng);
      total++;
      if (errors.length === 0) clean++;
      for (const error of errors) kinds.add(error.kind);
    }
    assert.ok(kinds.has("near_miss"), "missing near_miss");
    assert.ok(kinds.has("cross_doc_only"), "missing cross_doc_only");
    assert.ok(clean > 0 && clean < total, `clean=${clean}/${total}`);
  });
});

describe("ensureExceptionNote", () => {
  it("adds damage notes to error forms and benign notes to clean ones", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = createRng(seed);
      const form = generateForm(`note-${seed}`, seed, rng);
      form.pod.exceptionNote = null;
      const typed = paperValues(form);
      ensureExceptionNote(form, typed, rng, true);
      assert.match(typed["pod.exceptionNote"]!, /DAMAGED/);
      const clean = generateForm(`note-clean-${seed}`, seed, rng);
      clean.pod.exceptionNote = null;
      const cleanTyped = paperValues(clean);
      ensureExceptionNote(clean, cleanTyped, rng, false);
      assert.ok(cleanTyped["pod.exceptionNote"] !== "");
      assert.doesNotMatch(cleanTyped["pod.exceptionNote"]!, /DAMAGED/);
    }
  });
});

describe("buildHardForm", () => {
  it("always carries a note and mostly hard errors", () => {
    let hardKinds = 0;
    let errorForms = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const form = buildHardForm(`form-${seed}`, 50_000 + seed);
      assert.ok((form.typed["pod.exceptionNote"] ?? "") !== "", `seed ${seed} has no note`);
      if (form.errors.length > 0) {
        errorForms++;
        if (form.errors.some((e) => e.kind === "near_miss" || e.kind === "cross_doc_only")) {
          hardKinds++;
        }
      }
    }
    assert.ok(errorForms > 0);
    assert.ok(hardKinds > errorForms * 0.5, `${hardKinds}/${errorForms} hard`);
  });
});

describe("degradations", () => {
  function canvas(width: number, height: number, fill: number): Uint8Array {
    return new Uint8Array(width * height * 3).fill(fill);
  }

  it("blurs sharp dots into their neighbors", () => {
    const pixels = canvas(9, 9, 255);
    pixels[(4 * 9 + 4) * 3] = 0;
    pixels[(4 * 9 + 4) * 3 + 1] = 0;
    pixels[(4 * 9 + 4) * 3 + 2] = 0;
    const out = blurPixels(pixels, 9, 9);
    assert.ok(out[(4 * 9 + 4) * 3]! > 0, "center stays black");
    assert.ok(out[(4 * 9 + 5) * 3]! < 255, "neighbor untouched");
    assert.equal(out[0], 255);
  });

  it("lifts the top-right corner more than the bottom-left", () => {
    const out = glarePixels(canvas(100, 100, 100), 100, 100);
    const near = out[(10 * 100 + 85) * 3]!;
    const far = out[(90 * 100 + 10) * 3]!;
    assert.ok(near > far, `near=${near} far=${far}`);
    assert.ok(near > 100);
  });

  it("shears rows horizontally with y", () => {
    const pixels = canvas(20, 20, 255);
    for (let y = 0; y < 20; y++) {
      pixels[(y * 20 + 10) * 3] = 0;
      pixels[(y * 20 + 10) * 3 + 1] = 0;
      pixels[(y * 20 + 10) * 3 + 2] = 0;
    }
    const out = skewPixels(pixels, 20, 20);
    const topRow = [...out.subarray(0, 60)].filter((v, i) => i % 3 === 0 && v === 0).length;
    const bottomRow = [...out.subarray(19 * 60, 20 * 60)].filter((v, i) => i % 3 === 0 && v === 0).length;
    assert.equal(topRow, 1);
    assert.equal(bottomRow, 1);
    const topAt = out.findIndex((v, i) => i % 3 === 0 && v === 0);
    const bottomStripe = out.subarray(19 * 60, 20 * 60);
    const bottomAt = bottomStripe.findIndex((v, i) => i % 3 === 0 && v === 0);
    assert.notEqual(topAt, bottomAt);
  });

  it("hardDegradeSpec rotates 1-2 deterministic ops", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 12; seed++) {
      const spec = hardDegradeSpec(seed);
      assert.deepEqual(spec, hardDegradeSpec(seed));
      const count = [spec.blur, spec.glare, spec.skew].filter(Boolean).length;
      assert.ok(count === 1 || count === 2, `seed ${seed}: ${count} ops`);
      seen.add(JSON.stringify(spec));
    }
    assert.ok(seen.size > 2, "specs do not vary");
  });

  it("degraded renders differ from clean renders", () => {
    const form = buildHardForm("degrade-1", 7).form;
    const clean = renderForm(form);
    const dirty = renderForm(form, { blur: true, glare: true, skew: true });
    assert.notDeepEqual([...dirty.awb.slice(0, 200)], [...clean.awb.slice(0, 200)]);
    assert.deepEqual(
      [...renderForm(form, { blur: true }).awb.slice(0, 200)],
      [...renderForm(form, { blur: true }).awb.slice(0, 200)],
    );
  });

  it("applyDegrade composes the selected ops", () => {
    const pixels = canvas(9, 9, 255);
    assert.deepEqual([...applyDegrade(pixels, 9, 9, {})], [...pixels]);
    const half = canvas(20, 20, 255);
    for (let y = 0; y < 20; y++) {
      half[(y * 20 + 2) * 3] = 0;
      half[(y * 20 + 2) * 3 + 1] = 0;
      half[(y * 20 + 2) * 3 + 2] = 0;
    }
    assert.notDeepEqual([...applyDegrade(half, 20, 20, { skew: true })], [...half]);
  });
});
