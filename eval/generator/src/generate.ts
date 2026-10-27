import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generateForm, type SyntheticForm } from "./documents.ts";
import {
  ensureExceptionNote,
  injectErrors,
  injectHardErrors,
  paperValues,
  type InjectedError,
  type TypedValues,
} from "./errors.ts";
import { createRng } from "./prng.ts";
import { hardDegradeSpec, renderForm, type DegradeSpec } from "./render.ts";

export interface GeneratedForm {
  form: SyntheticForm;
  /** What the worker typed, including injected typos. */
  typed: TypedValues;
  errors: InjectedError[];
}

export function buildForm(formId: string, seed: number): GeneratedForm {
  const rng = createRng(seed);
  const form = generateForm(formId, seed, rng);
  const typed = paperValues(form);
  const errors = injectErrors(form, typed, rng);
  return { form, typed, errors };
}

/** Hard-split form: validator-blind and diff-free errors plus a note. */
export function buildHardForm(formId: string, seed: number): GeneratedForm {
  const rng = createRng(seed);
  const form = generateForm(formId, seed, rng);
  const typed = paperValues(form);
  const errors = injectHardErrors(form, typed, rng);
  ensureExceptionNote(form, typed, rng, errors.length > 0);
  return { form, typed, errors };
}

/** Degradation spec for a hard-split form's images. */
export function hardFormDegrade(seed: number): DegradeSpec {
  return hardDegradeSpec(seed);
}

function argValue(args: string[], name: string, fallback: string): string {
  const at = args.indexOf(name);
  return at >= 0 && at + 1 < args.length ? args[at + 1]! : fallback;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seed = Number(argValue(args, "--seed", "1"));
  const count = Number(argValue(args, "--count", "100"));
  const split = argValue(args, "--split", "standard");
  const out =
    args.includes("--out") && args[args.indexOf("--out") + 1]
      ? args[args.indexOf("--out") + 1]!
      : new URL(split === "hard" ? "../../corpus-hard" : "../../corpus", import.meta.url).pathname;
  if (!Number.isInteger(seed) || !Number.isInteger(count) || count < 1) {
    throw new Error("usage: generate --seed N --count N [--split standard|hard] [--out DIR]");
  }
  if (split !== "standard" && split !== "hard") {
    throw new Error(`usage: --split must be "standard" or "hard", got ${JSON.stringify(split)}`);
  }
  await mkdir(out, { recursive: true });
  for (let i = 0; i < count; i++) {
    const formId = `form-${String(i + 1).padStart(4, "0")}`;
    const generated =
      split === "hard" ? buildHardForm(formId, seed + i) : buildForm(formId, seed + i);
    const images =
      split === "hard"
        ? renderForm(generated.form, hardFormDegrade(seed + i))
        : renderForm(generated.form);
    await writeFile(`${out}/${formId}.json`, JSON.stringify(generated, null, 2));
    await writeFile(`${out}/${formId}-bol.png`, images.bol);
    await writeFile(`${out}/${formId}-awb.png`, images.awb);
    await writeFile(`${out}/${formId}-invoice.png`, images.invoice);
    await writeFile(`${out}/${formId}-packing.png`, images.packing);
    await writeFile(`${out}/${formId}-pod.png`, images.pod);
    await writeFile(`${out}/${formId}-label.png`, images.label);
  }
  console.log(`wrote ${count} forms to ${out}`);
}

const isMainEntry = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainEntry) {
  await main();
}
