import { NextResponse } from "next/server";
import { callBudgetLimit, getCallStats, resolveModelMode, sparkCostUsd } from "@second-look/pipeline";

/**
 * Demo-day preflight probe. Reports whether a model key is configured
 * (present or missing, never the value) and which adapter mode the
 * server runs; the Android Check-setup screen and `pnpm demo:preflight`
 * read this before anything streams. `modelCalls` and `callBudget` show
 * how much of the per-process Model API budget is spent, so a long demo
 * session never hits the cap by surprise; `spendUsd` prices this
 * process's tokens at Spark Standard rates (no cache discount, so an
 * upper bound). Meta exposes no balance endpoint; the dashboard is the
 * source of truth for remaining credits.
 */
export async function GET() {
  const keyPresent = Boolean(process.env.MODEL_API_KEY ?? process.env.META_API_KEY);
  const stats = getCallStats();
  let callBudget: number | null = null;
  try {
    callBudget = callBudgetLimit();
  } catch {
    callBudget = null;
  }
  return NextResponse.json({
    ok: true,
    mode: resolveModelMode(),
    keyPresent,
    modelCalls: stats.httpCalls,
    retriedCalls: stats.retriedCalls,
    inputTokens: stats.inputTokens,
    outputTokens: stats.outputTokens,
    spendUsd: Number(sparkCostUsd(stats.inputTokens, stats.outputTokens).toFixed(4)),
    callBudget,
  });
}
