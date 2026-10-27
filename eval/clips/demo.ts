/**
 * One-command narrated replay of the synthetic POV clips through the
 * pipeline, for the screen-recorded backup demo. Stub mode is offline
 * and deterministic; --models real reruns the same beats live.
 *
 *   pnpm --filter @second-look/eval clips:demo [-- --models real --pace 0]
 */
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { validateAwb } from "@second-look/validators";
import {
  createPipelineAdapters,
  draftClaim,
  getCallStats,
  loadDotEnv,
  mentionsDamage,
  resolveModelMode,
  type ModelMode,
  type PipelineAdapters,
  type SessionState,
} from "@second-look/pipeline";
import {
  readSidecar,
  runClipPath,
  type ClipPathResult,
} from "./ingest.ts";

export interface DemoBeat {
  /** Timestamp label, e.g. "00:03". */
  at: string;
  line: string;
}

export function formatBeat(beat: DemoBeat): string {
  return `[${beat.at}] ${beat.line}`;
}

export interface DemoScenario {
  label: string;
  clip: string;
  mutateTyped: (paper: Record<string, string>) => Record<string, string>;
  expect: SessionState;
  narrate: (run: ClipPathResult, paper: Record<string, string>) => Promise<string[]>;
}

function swapAt(value: string, at: number): string {
  return value.slice(0, at) + value[at + 1]! + value[at]! + value.slice(at + 2);
}

function swappedAwb(value: string): string {
  for (let at = 0; at < value.length - 1; at++) {
    const candidate = swapAt(value, at);
    if (candidate !== value && !validateAwb(candidate).valid) return candidate;
  }
  throw new Error("demo: no check-digit-breaking swap found");
}

function stamp(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  return `${String(Math.floor(totalSec / 60)).padStart(2, "0")}:${String(totalSec % 60).padStart(2, "0")}`;
}

export const DEMO_SCENARIOS: DemoScenario[] = [
  {
    label: "swapped AWB digit",
    clip: "clip-awb.mp4",
    mutateTyped: (paper) => ({ ...paper, "awb.awbNumber": swappedAwb(paper["awb.awbNumber"]!) }),
    expect: "blocked",
    narrate: async (run, paper) => {
      const fix = (run.frames[0]?.tiered.spark?.proposedFixes ?? []).find(
        (f) => f.fieldId === "awb.awbNumber",
      );
      return [
        `verdict: BLOCKED (AWB check digit invalid, ${(run.totalLatencyMs / 1000).toFixed(1)}s end to end)`,
        fix
          ? `fix proposed: typed -> paper ${fix.paperValue} (paper holds ${paper["awb.awbNumber"]})`
          : "fix proposed: none this run (live-model text varies; verdict is deterministic)",
      ];
    },
  },
  {
    label: "qty gap plus damage note",
    clip: "clip-pod.mp4",
    mutateTyped: (paper) => ({ ...paper }),
    expect: "mismatch",
    narrate: async (run, paper) => {
      const note = paper["pod.exceptionNote"] ?? "";
      const draft = mentionsDamage(note)
        ? await draftClaim({
            carrier: paper["bol.carrier"] ?? "",
            bolRef: paper["bol.bolNumber"] ?? "",
            awbRef: paper["awb.awbNumber"] ?? "",
            exceptionNote: note,
          })
        : null;
      return [
        `verdict: FLAG (invoice ${paper["invoice.totalQty"]} vs packing ${paper["packing.totalQty"]}, ${(run.totalLatencyMs / 1000).toFixed(1)}s end to end)`,
        draft
          ? `claim drafted: ${draft.carrier ? `${draft.carrier} ` : ""}${draft.bolRef}, damagedQty=${draft.damagedQty}`
          : "claim drafted: none",
      ];
    },
  },
];

export interface DemoOptions {
  clipsDir: string;
  adapters?: PipelineAdapters;
  /** Delay between printed beats for recordability; 0 disables. */
  paceMs?: number;
  out?: (line: string) => void;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Replay every scenario, printing narrated beats. Pass = each scenario's
 * final verdict matches; model-worded text (fixes, explanations) is
 * reported as observed, never gated, because live wording varies.
 */
export async function runDemo(options: DemoOptions): Promise<boolean> {
  const out = options.out ?? console.log;
  const paceMs = options.paceMs ?? 600;
  const say = async (at: number, line: string): Promise<void> => {
    out(formatBeat({ at: stamp(at), line }));
    if (paceMs > 0) await sleep(paceMs);
  };
  const started = performance.now();
  await say(0, "SECOND LOOK — backup demo replay (synthetic POV clips, not recorded footage)");
  let pass = true;
  for (const scenario of DEMO_SCENARIOS) {
    const clip = join(options.clipsDir, scenario.clip);
    const sidecar = await readSidecar(clip).catch(() => {
      throw new Error(
        `demo: ${scenario.clip} sidecar missing; run "pnpm --filter @second-look/eval clips:render" first`,
      );
    });
    const paper = sidecar.groundTruth.paperValues;
    await say(performance.now() - started, `--- scenario: ${scenario.label} (${scenario.clip}) ---`);
    const run = await runClipPath(clip, scenario.mutateTyped(paper), {
      fps: 2,
      ...options.adapters,
      onKeyframe: (verdict) => {
        out(
          formatBeat({
            at: stamp(performance.now() - started),
            line:
              `partial:${verdict.phase} t=${verdict.frame.timestampSec.toFixed(1)}s ` +
              `verdict=${verdict.frame.tiered.verdict.state} ` +
              `spark=${verdict.frame.tiered.spark ? (verdict.sparkCached ? "cached" : "live") : "none"}`,
          }),
        );
      },
    });
    const ok = run.verdict === scenario.expect;
    if (!ok) pass = false;
    await say(
      performance.now() - started,
      `keyframes: ${run.keyframes}/${run.framesScanned} scanned, first verdict ${run.firstVerdictLatencyMs.toFixed(0)}ms`,
    );
    for (const line of await scenario.narrate(run, paper)) {
      await say(performance.now() - started, line);
    }
    if (!ok) {
      await say(performance.now() - started, `MISMATCH: expected ${scenario.expect}, got ${run.verdict}`);
    }
  }
  await say(performance.now() - started, "replay complete (see docs/DEMO.md for the 3-minute script)");
  return pass;
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
    throw new Error(`demo: --models must be "stub" or "real", got ${JSON.stringify(flag)}`);
  }
  const mode: ModelMode = flag ?? resolveModelMode();
  const paceRaw = argValue(args, "--pace");
  const paceMs = paceRaw === undefined ? undefined : Number(paceRaw);
  if (paceMs !== undefined && (!Number.isFinite(paceMs) || paceMs < 0)) {
    throw new Error(`demo: --pace must be ms >= 0, got ${JSON.stringify(paceRaw)}`);
  }
  console.log(`models: ${mode}\n`);
  const pass = await runDemo({
    clipsDir,
    adapters: createPipelineAdapters(mode),
    paceMs,
  });
  const stats = getCallStats();
  if (stats.httpCalls > 0) {
    console.log(
      `real model calls: ${stats.httpCalls} (retries ${stats.retriedCalls}, ` +
        `tokens in/out ${stats.inputTokens}/${stats.outputTokens})`,
    );
  }
  if (!pass) {
    console.log("demo: verdict mismatch");
    process.exitCode = 1;
  }
}

const isMainEntry = process.argv[1] === fileURLToPath(import.meta.url);
if (isMainEntry) {
  await main();
}
