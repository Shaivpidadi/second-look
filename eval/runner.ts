import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GeneratedForm } from "@second-look/generator";
import { getCallStats, loadDotEnv } from "@second-look/pipeline";
import { ALL_ARMS, createRealArms, type EvalArm } from "./arms.ts";
import { formatReport, summarize } from "./report.ts";

export interface FormResult {
  formId: string;
  /** Ground truth: the generator injected errors into this form. */
  expected: boolean;
  flagged: boolean;
  latencyMs: number;
  costUsd: number;
}

export interface ArmResult {
  arm: string;
  available: boolean;
  stubbed: boolean;
  forms: FormResult[];
}

/** Load every `*.json` corpus form from a directory, sorted by name. */
export async function loadCorpus(dir: string): Promise<GeneratedForm[]> {
  const files = (await readdir(dir))
    .filter((name) => name.endsWith(".json"))
    .sort();
  return Promise.all(
    files.map(async (name) =>
      JSON.parse(await readFile(join(dir, name), "utf8")) as GeneratedForm,
    ),
  );
}

/** Run one arm over every form; unavailable arms come back empty. */
export async function runArm(
  arm: EvalArm,
  forms: GeneratedForm[],
): Promise<ArmResult> {
  if (!arm.available) {
    return { arm: arm.name, available: false, stubbed: arm.stubbed, forms: [] };
  }
  const results: FormResult[] = [];
  for (const form of forms) {
    const verdict = await arm.judge({ form });
    results.push({
      formId: form.form.formId,
      expected: form.errors.length > 0,
      flagged: verdict.flagged,
      latencyMs: verdict.latencyMs,
      costUsd: verdict.costUsd,
    });
  }
  return { arm: arm.name, available: true, stubbed: arm.stubbed, forms: results };
}

export interface RunEvalOptions {
  /** Run over only the first N corpus forms (pilot runs). */
  limit?: number;
}

/** Run every arm over the corpus directory. */
export async function runEval(
  corpusDir: string,
  arms: EvalArm[] = ALL_ARMS,
  options: RunEvalOptions = {},
): Promise<ArmResult[]> {
  const loaded = await loadCorpus(corpusDir);
  const limit = options.limit;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 0)) {
    throw new Error(`runEval: limit must be a non-negative integer, got ${limit}`);
  }
  const forms = limit === undefined ? loaded : loaded.slice(0, limit);
  const results: ArmResult[] = [];
  for (const arm of arms) {
    results.push(await runArm(arm, forms));
  }
  return results;
}

function argValue(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : undefined;
}

/** All selectable arms: defaults plus live-model arms (built after .env). */
export function selectableArms(): EvalArm[] {
  return [...ALL_ARMS, ...createRealArms()];
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  loadDotEnv();
  const corpus =
    argValue(args, "--corpus") ?? new URL("./corpus", import.meta.url).pathname;
  const out = argValue(args, "--out");
  const registry = selectableArms();
  const only = argValue(args, "--arms")?.split(",");
  const arms = only ? registry.filter((arm) => only.includes(arm.name)) : ALL_ARMS;
  if (only && arms.length !== only.length) {
    throw new Error(
      `unknown arm in --arms ${only.join(",")} (known: ${registry.map((a) => a.name).join(", ")})`,
    );
  }
  const limitRaw = argValue(args, "--limit");
  const limit = limitRaw === undefined ? undefined : Number(limitRaw);
  const results = await runEval(corpus, arms, { limit });
  if (out) {
    await writeFile(out, JSON.stringify(results, null, 2));
  }
  console.log(formatReport(results.map(summarize)));
  const stats = getCallStats();
  if (stats.httpCalls > 0) {
    console.log(
      `real model calls: ${stats.httpCalls} (retries ${stats.retriedCalls}, ` +
        `tokens in/out ${stats.inputTokens}/${stats.outputTokens})`,
    );
  }
}

const isMainEntry = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainEntry) {
  await main();
}
