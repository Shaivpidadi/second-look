import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAwb } from "@second-look/validators";
import {
  appendAudit,
  checkCrossDoc,
  checkDigitChecks,
  createPipelineAdapters,
  draftClaim,
  exportAuditCsv,
  exportAuditMarkdown,
  fieldMatchChecks,
  getCallStats,
  loadDotEnv,
  mentionsDamage,
  readSessionAudit,
  reduceVerdict,
  resolveModelMode,
  StubSamAdapter,
  type AuditEntry,
  type ModelMode,
  type PipelineAdapters,
  type SessionState,
} from "@second-look/pipeline";
import { readSidecar, runClipPath, sampleFrames } from "./ingest.ts";
import { PLACEHOLDER_NOTE } from "./render.ts";

export const E2E_SESSION = "clip-e2e";
export const LATENCY_TARGET_MS = 5000;
export const E2E_FPS = 2;

export interface CheckOutcome {
  name: string;
  pass: boolean;
  detail: string;
  latencyMs: number;
  withinTarget: boolean;
}

function swapAt(value: string, at: number): string {
  return value.slice(0, at) + value[at + 1]! + value[at]! + value.slice(at + 2);
}

/** First adjacent-digit swap that breaks the AWB check digit. */
function swappedAwb(value: string): string {
  for (let at = 0; at < value.length - 1; at++) {
    const candidate = swapAt(value, at);
    if (candidate !== value && !validateAwb(candidate).valid) return candidate;
  }
  throw new Error("e2e: no check-digit-breaking AWB swap found");
}

/** Last-digit bump; always breaks the mod-7 check digit. */
function bumpedAwb(value: string): string {
  const last = Number(value[value.length - 1]!);
  return `${value.slice(0, -1)}${(last + 1) % 10}`;
}

function auditEntry(
  fieldId: string,
  paperValue: string | null,
  typedValue: string | null,
  verdict: SessionState,
  action: string,
  modelCalls?: AuditEntry["modelCalls"],
): AuditEntry {
  return {
    ts: new Date().toISOString(),
    sessionId: E2E_SESSION,
    fieldId,
    paperValue,
    typedValue,
    verdict,
    action,
    modelCalls,
  };
}

export interface E2EOptions {
  adapters?: PipelineAdapters;
}

async function checkSwappedAwb(
  clipsDir: string,
  options: E2EOptions,
): Promise<{ outcome: CheckOutcome; entry: AuditEntry }> {
  const clip = join(clipsDir, "clip-awb.mp4");
  const sidecar = await readSidecar(clip);
  const paper = sidecar.groundTruth.paperValues;
  const typedAwb = swappedAwb(paper["awb.awbNumber"]!);
  const typed = { ...paper, "awb.awbNumber": typedAwb };
  const run = await runClipPath(clip, typed, { fps: E2E_FPS, ...options.adapters });
  const failures = run.frames[0]!.tiered.verdict.failures;
  const fixes = run.frames[0]!.tiered.spark?.proposedFixes ?? [];
  const fix = fixes.find((f) => f.fieldId === "awb.awbNumber");
  const pass =
    run.verdict === "blocked" &&
    failures.some((f) => f.fieldId === "awb.awbNumber" && f.kind === "check_digit") &&
    fix?.paperValue === paper["awb.awbNumber"];
  return {
    outcome: {
      name: "swapped AWB digit -> block + fix",
      pass,
      detail: pass
        ? `blocked, fix proposes paper ${fix?.paperValue}`
        : `verdict=${run.verdict} fix=${fix?.paperValue ?? "none"}`,
      latencyMs: run.totalLatencyMs,
      withinTarget: run.totalLatencyMs < LATENCY_TARGET_MS,
    },
    entry: auditEntry(
      "awb.awbNumber",
      paper["awb.awbNumber"]!,
      typedAwb,
      run.verdict,
      "block+fix",
      run.frames[0]!.tiered.modelCalls,
    ),
  };
}

async function checkModelsOff(
  clipsDir: string,
  _options?: E2EOptions,
): Promise<{ outcome: CheckOutcome; entry: AuditEntry }> {
  // Models off: frames still sample and SAM still localizes (stub boxes),
  // but no Glimmer pass and no Spark call run. Validators decide alone.
  const started = performance.now();
  const clip = join(clipsDir, "clip-awb.mp4");
  const sidecar = await readSidecar(clip);
  const paper = sidecar.groundTruth.paperValues;
  const typedAwb = bumpedAwb(paper["awb.awbNumber"]!);
  const typed: Record<string, string> = { ...paper, "awb.awbNumber": typedAwb };
  const frames = await sampleFrames(clip, { fps: E2E_FPS });
  const sam = new StubSamAdapter();
  for (const frame of frames) {
    await sam.crop({
      image: frame.png,
      concept: "shipping document",
      frameWidth: sidecar.width,
      frameHeight: sidecar.height,
      groundTruth: sidecar.groundTruth.boxes,
    });
  }
  const readings = Object.entries(paper).map(([fieldId, paperValue]) => ({
    fieldId,
    paperValue,
    typedValue: typed[fieldId] ?? null,
  }));
  const verdict = reduceVerdict([
    ...checkDigitChecks(readings),
    ...fieldMatchChecks(readings),
    ...checkCrossDoc(typed),
  ]);
  const latencyMs = performance.now() - started;
  const pass =
    verdict.state === "blocked" &&
    verdict.failures.some((f) => f.fieldId === "awb.awbNumber" && f.kind === "check_digit");
  return {
    outcome: {
      name: "bad check digit, models off -> still blocks",
      pass,
      detail: pass
        ? `blocked on validators alone (${frames.length} frames, 0 model calls)`
        : `verdict=${verdict.state}`,
      latencyMs,
      withinTarget: latencyMs < LATENCY_TARGET_MS,
    },
    entry: auditEntry("awb.awbNumber", paper["awb.awbNumber"]!, typedAwb, verdict.state, "block (models off)"),
  };
}

async function checkQtyGap(
  clipsDir: string,
  options: E2EOptions,
): Promise<{ outcome: CheckOutcome; entry: AuditEntry }> {
  const clip = join(clipsDir, "clip-pod.mp4");
  const sidecar = await readSidecar(clip);
  const paper = sidecar.groundTruth.paperValues;
  const run = await runClipPath(clip, { ...paper }, { fps: E2E_FPS, ...options.adapters });
  const failures = run.frames[0]!.tiered.verdict.failures;
  const pass =
    run.verdict === "mismatch" &&
    failures.some((f) => f.fieldId === "invoice.totalQty" && f.kind === "cross_doc") &&
    run.frames[0]!.tiered.escalated;
  return {
    outcome: {
      name: "invoice vs packing qty gap -> flag",
      pass,
      detail: pass
        ? `flagged: invoice ${paper["invoice.totalQty"]} vs packing ${paper["packing.totalQty"]}, escalated to Spark`
        : `verdict=${run.verdict}`,
      latencyMs: run.totalLatencyMs,
      withinTarget: run.totalLatencyMs < LATENCY_TARGET_MS,
    },
    entry: auditEntry(
      "invoice.totalQty",
      paper["invoice.totalQty"]!,
      paper["invoice.totalQty"]!,
      run.verdict,
      "flag cross-doc gap",
      run.frames[0]!.tiered.modelCalls,
    ),
  };
}

async function checkClaimDraft(
  clipsDir: string,
  options: E2EOptions,
): Promise<{ outcome: CheckOutcome; entry: AuditEntry }> {
  const started = performance.now();
  const clip = join(clipsDir, "clip-pod.mp4");
  const sidecar = await readSidecar(clip);
  const paper = sidecar.groundTruth.paperValues;
  const run = await runClipPath(clip, { ...paper }, { fps: E2E_FPS, ...options.adapters });
  const note = paper["pod.exceptionNote"]!;
  const draft = mentionsDamage(note)
    ? await draftClaim({
        carrier: paper["bol.carrier"] ?? "",
        bolRef: paper["bol.bolNumber"] ?? "",
        awbRef: paper["awb.awbNumber"] ?? "",
        exceptionNote: note,
      })
    : null;
  const latencyMs = performance.now() - started;
  const pass =
    draft !== null &&
    draft.damagedQty === 2 &&
    draft.body.includes(paper["bol.bolNumber"]!) &&
    draft.body.includes("[AMOUNT TBD]");
  return {
    outcome: {
      name: '"2 cartons damaged" on POD -> claim draft',
      pass,
      detail: pass
        ? `drafted ${draft.source} claim, damagedQty=2`
        : `draft=${draft === null ? "none" : `qty=${draft.damagedQty}`}`,
      latencyMs,
      withinTarget: latencyMs < LATENCY_TARGET_MS,
    },
    entry: auditEntry("pod.exceptionNote", note, note, run.verdict, "claim-draft", run.frames[0]!.tiered.modelCalls),
  };
}

export async function runE2E(clipsDir: string, options: E2EOptions = {}): Promise<CheckOutcome[]> {
  for (const name of ["clip-awb.mp4", "clip-pod.mp4"]) {
    try {
      await readSidecar(join(clipsDir, name));
    } catch {
      throw new Error(
        `e2e: ${name} sidecar missing in ${clipsDir}; run "pnpm --filter @second-look/eval clips:render" first`,
      );
    }
  }
  // Fresh audit trail per run; appendAudit is append-only otherwise.
  await rm(join(clipsDir, `audit-${E2E_SESSION}.jsonl`), { force: true });
  const checks = [checkSwappedAwb, checkModelsOff, checkQtyGap, checkClaimDraft];
  const outcomes: CheckOutcome[] = [];
  for (const check of checks) {
    const { outcome, entry } = await check(clipsDir, options);
    await appendAudit(entry, { dir: clipsDir });
    outcomes.push(outcome);
  }
  const entries = await readSessionAudit(E2E_SESSION, { dir: clipsDir });
  await writeFile(join(clipsDir, `audit-${E2E_SESSION}.md`), exportAuditMarkdown(entries));
  await writeFile(join(clipsDir, `audit-${E2E_SESSION}.csv`), exportAuditCsv(entries));
  return outcomes;
}

function argValue(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 && at + 1 < args.length ? args[at + 1] : undefined;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  loadDotEnv();
  const clipsDir =
    argValue(args, "--clips") ?? new URL("../../clips", import.meta.url).pathname;
  const flag = argValue(args, "--models");
  if (flag !== undefined && flag !== "stub" && flag !== "real") {
    throw new Error(`e2e: --models must be "stub" or "real", got ${JSON.stringify(flag)}`);
  }
  const mode: ModelMode = flag ?? resolveModelMode();
  const adapters = createPipelineAdapters(mode);
  console.log(`${PLACEHOLDER_NOTE}\n`);
  console.log(
    `models: ${mode} (sam ${adapters.sam.name}, glimmer ${adapters.glimmer.name}, spark ${adapters.spark.name})\n`,
  );
  const outcomes = await runE2E(clipsDir, { adapters });
  let failed = 0;
  for (const outcome of outcomes) {
    const status = outcome.pass ? "PASS" : "FAIL";
    const target = outcome.withinTarget
      ? `<${LATENCY_TARGET_MS}ms`
      : `OVER ${LATENCY_TARGET_MS}ms`;
    if (!outcome.pass || !outcome.withinTarget) failed++;
    console.log(
      `[${status}] ${outcome.name}\n      ${outcome.detail} | e2e ${outcome.latencyMs.toFixed(0)}ms (${target})`,
    );
  }
  console.log(`\naudit: audit-${E2E_SESSION}.jsonl/.md/.csv in ${clipsDir}`);
  const stats = getCallStats();
  if (stats.httpCalls > 0) {
    console.log(
      `real model calls: ${stats.httpCalls} (retries ${stats.retriedCalls}, ` +
        `tokens in/out ${stats.inputTokens}/${stats.outputTokens})`,
    );
  }
  if (failed > 0) {
    console.error(`${failed} check(s) failed`);
    process.exit(1);
  }
  console.log("all 4 checks passed within the latency target");
}

const isMainEntry = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainEntry) {
  await main();
}
