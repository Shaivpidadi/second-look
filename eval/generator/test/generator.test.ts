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
  injectErrors,
  isPaperError,
  paperValues,
} from "../src/errors.ts";
import { buildForm } from "../src/generate.ts";
import { createRng } from "../src/prng.ts";
import {
  PAGE_HEIGHT,
  PAGE_WIDTH,
  podPage,
  renderForm,
  renderPage,
} from "../src/render.ts";

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

function readU32(bytes: Uint8Array, at: number): number {
  return (
    bytes[at]! * 2 ** 24 + bytes[at + 1]! * 2 ** 16 + bytes[at + 2]! * 2 ** 8 + bytes[at + 3]!
  );
}

describe("generator", () => {
  it("is deterministic for a fixed seed", () => {
    const first = buildForm("form-0001", 7);
    const second = buildForm("form-0001", 7);
    assert.deepEqual(first, second);
    const rng = createRng(7);
    const form = generateForm("form-0001", 7, rng);
    assert.deepEqual(renderForm(form).bol, renderForm(form).bol);
  });

  it("varies across seeds", () => {
    const first = buildForm("form-0001", 7);
    const second = buildForm("form-0001", 8);
    assert.notDeepEqual(first.form.awb, second.form.awb);
  });

  it("emits ground truth with valid check digits", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { form } = buildForm(`form-${seed}`, seed);
      assert.equal(
        validateAwb(form.awb.awbNumber).valid,
        true,
        `seed ${seed} awb ${form.awb.awbNumber}`,
      );
      assert.equal(
        validateContainer(form.bol.containerNumber).valid,
        true,
        `seed ${seed} container ${form.bol.containerNumber}`,
      );
      assert.equal(
        validateSscc(form.label.sscc).valid,
        true,
        `seed ${seed} sscc ${form.label.sscc}`,
      );
    }
  });

  it("generates cross-document-consistent ground truth", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rng = createRng(seed);
      const form = generateForm(`form-${seed}`, seed, rng);
      assert.equal(form.invoice.totalQty, form.bol.cartons);
      assert.equal(form.packing.totalQty, form.bol.cartons);
      assert.equal(form.pod.receivedCartons, form.bol.cartons);
      assert.equal(form.label.cartons, form.bol.cartons);
      assert.equal(form.awb.weightKg, form.bol.weightKg);
      assert.equal(form.invoice.bolRef, form.bol.bolNumber);
      assert.equal(form.packing.bolRef, form.bol.bolNumber);
      assert.equal(form.pod.bolRef, form.bol.bolNumber);
    }
  });

  it("renders valid PNGs at the expected size", () => {
    const { form } = buildForm("form-0001", 3);
    const images = renderForm(form);
    assert.equal(Object.keys(images).length, 6);
    for (const bytes of Object.values(images)) {
      assert.deepEqual([...bytes.slice(0, 8)], PNG_SIGNATURE);
      assert.equal(readU32(bytes, 16), PAGE_WIDTH);
      assert.equal(readU32(bytes, 20), PAGE_HEIGHT);
    }
  });

  it("renders the POD exception note handwritten-style", () => {
    const rng = createRng(9);
    const form = generateForm("form-0001", 9, rng);
    form.pod.exceptionNote = "2 CARTONS DAMAGED";
    const hand = renderPage(podPage(form, form.pod), createRng(1));
    const plain = renderPage({ ...podPage(form, form.pod), handRow: undefined });
    assert.notDeepEqual(hand, plain);
    const again = renderPage(podPage(form, form.pod), createRng(1));
    assert.deepEqual(hand, again);
  });

  it("injects 0-2 distinct errors per form", () => {
    let clean = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { errors } = buildForm(`form-${seed}`, seed);
      assert.ok(errors.length >= 0 && errors.length <= 2);
      assert.equal(new Set(errors.map((e) => e.kind)).size, errors.length);
      if (errors.length === 0) clean++;
    }
    assert.ok(clean > 0, "expected some clean forms");
    assert.ok(clean < 40, "expected some error forms");
  });

  it("covers every error kind across seeds", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 150; seed++) {
      for (const e of buildForm(`form-${seed}`, seed).errors) {
        seen.add(e.kind);
      }
    }
    assert.deepEqual(
      [...seen].sort(),
      [
        "dropped_digit",
        "qty_gap",
        "short_count",
        "sscc_transposition",
        "swapped_fields",
        "transposition",
        "weight_gap",
      ],
    );
  });

  it("sometimes emits a damage exception note", () => {
    let noted = 0;
    for (let seed = 1; seed <= 30; seed++) {
      if (buildForm(`form-${seed}`, seed).form.pod.exceptionNote) noted++;
    }
    assert.ok(noted > 0 && noted < 30, `noted=${noted}`);
  });
});

describe("applyError", () => {
  function fresh(seed: number) {
    const rng = createRng(seed);
    const form = generateForm("form-0001", seed, rng);
    return { form, typed: paperValues(form), rng };
  }

  it("transposition preserves length and usually breaks the check digit", () => {
    // Prefix swaps never affect the serial mod-7 check, and serial swaps
    // survive it 1/7 of the time, so only aggregate behavior is asserted.
    let changed = 0;
    let broke = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { form, typed, rng } = fresh(seed);
      const error = applyError(form, typed, "transposition", rng);
      assert.equal(error.typedValue.length, error.paperValue.length);
      assert.equal(typed["awb.awbNumber"], error.typedValue);
      if (error.typedValue !== error.paperValue) {
        changed++;
        if (!validateAwb(error.typedValue).valid) broke++;
      }
    }
    assert.ok(changed > 0);
    assert.ok(broke > 0);
  });

  it("dropped_digit shortens the container number", () => {
    const { form, typed, rng } = fresh(11);
    const error = applyError(form, typed, "dropped_digit", rng);
    assert.equal(error.typedValue.length, error.paperValue.length - 1);
    assert.equal(validateContainer(error.typedValue).valid, false);
  });

  it("swapped_fields exchanges origin and destination", () => {
    const { form, typed, rng } = fresh(11);
    const error = applyError(form, typed, "swapped_fields", rng);
    assert.equal(typed["awb.origin"], form.awb.destination);
    assert.equal(typed["awb.destination"], form.awb.origin);
    assert.notEqual(error.typedValue, error.paperValue);
  });

  it("short_count lowers the paper received count", () => {
    const { form, typed, rng } = fresh(11);
    const before = form.bol.cartons;
    const error = applyError(form, typed, "short_count", rng);
    assert.ok(form.pod.receivedCartons < before);
    assert.equal(typed["pod.receivedCartons"], String(form.pod.receivedCartons));
    assert.equal(error.paperValue, String(before));
    assert.equal(isPaperError(error.kind), true);
  });

  it("qty_gap lowers the paper invoice quantity", () => {
    const { form, typed, rng } = fresh(11);
    const error = applyError(form, typed, "qty_gap", rng);
    assert.ok(form.invoice.totalQty < form.packing.totalQty);
    assert.equal(typed["invoice.totalQty"], String(form.invoice.totalQty));
    assert.equal(error.fieldId, "invoice.totalQty");
    assert.equal(isPaperError(error.kind), true);
  });

  it("weight_gap raises the paper AWB weight", () => {
    const { form, typed, rng } = fresh(11);
    const error = applyError(form, typed, "weight_gap", rng);
    assert.ok(form.awb.weightKg > form.bol.weightKg);
    assert.equal(typed["awb.weightKg"], String(form.awb.weightKg));
    assert.equal(error.fieldId, "awb.weightKg");
    assert.equal(isPaperError(error.kind), true);
  });

  it("sscc_transposition preserves length and usually breaks the check digit", () => {
    let changed = 0;
    let broke = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { form, typed, rng } = fresh(seed);
      const error = applyError(form, typed, "sscc_transposition", rng);
      assert.equal(error.typedValue.length, error.paperValue.length);
      assert.equal(typed["label.sscc"], error.typedValue);
      if (error.typedValue !== error.paperValue) {
        changed++;
        if (!validateSscc(error.typedValue).valid) broke++;
      }
    }
    assert.ok(changed > 0);
    assert.ok(broke > 0);
    assert.equal(isPaperError("sscc_transposition"), false);
    assert.equal(isPaperError("transposition"), false);
  });

  it("injectErrors mutates only the injected fields", () => {
    const { form, typed, rng } = fresh(5);
    const clean = paperValues(form);
    injectErrors(form, typed, rng);
    // Typo kinds leave the paper form untouched except short_count's POD.
    assert.equal(form.bol.cartons, Number(clean["bol.cartons"]));
    assert.equal(form.awb.awbNumber, clean["awb.awbNumber"]);
  });
});
