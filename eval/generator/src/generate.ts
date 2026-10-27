import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { generateForm, type SyntheticForm } from "./documents.ts";
import {
  injectErrors,
  paperValues,
  type InjectedError,
  type TypedValues,
} from "./errors.ts";
import { createRng } from "./prng.ts";
import { renderForm } from "./render.ts";

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

function argValue(args: string[], name: string, fallback: string): string {
  const at = args.indexOf(name);
  return at >= 0 && at + 1 < args.length ? args[at + 1]! : fallback;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const seed = Number(argValue(args, "--seed", "1"));
  const count = Number(argValue(args, "--count", "5"));
  const out =
    args.includes("--out") && args[args.indexOf("--out") + 1]
      ? args[args.indexOf("--out") + 1]!
      : new URL("../../corpus", import.meta.url).pathname;
  if (!Number.isInteger(seed) || !Number.isInteger(count) || count < 1) {
    throw new Error("usage: generate --seed N --count N [--out DIR]");
  }
  await mkdir(out, { recursive: true });
  for (let i = 0; i < count; i++) {
    const formId = `form-${String(i + 1).padStart(4, "0")}`;
    const generated = buildForm(formId, seed + i);
    const images = renderForm(generated.form);
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
