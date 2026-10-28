/**
 * The dashboard's single source of truth for run numbers. Every KPI,
 * breakdown bar, chart annotation, and row count derives from
 * selectRunStats over the same run list, so the screen can never
 * disagree with itself. Covered by dashboard-stats.test.ts.
 */

export interface StatsModelCall {
  model: string;
  adapter: string;
  outcome: string;
  latencyMs: number;
  costUsd: number;
}

export interface StatsEntry {
  ts: string;
  verdict: string;
  modelCalls?: StatsModelCall[];
}

export interface CheckRun<TEntry extends StatsEntry = StatsEntry> {
  ts: string;
  verdict: string;
  entries: TEntry[];
  calls: StatsModelCall[];
  latencyMs: number;
  costUsd: number;
}

/** Group audit entries sharing a timestamp into one check run each. */
export function groupRuns<TEntry extends StatsEntry>(entries: TEntry[]): CheckRun<TEntry>[] {
  const byTs = new Map<string, TEntry[]>();
  for (const entry of entries) {
    const group = byTs.get(entry.ts) ?? [];
    group.push(entry);
    byTs.set(entry.ts, group);
  }
  const rank = (verdict: string): number =>
    verdict === "blocked" ? 3 : verdict === "needs-human" ? 2 : verdict === "mismatch" ? 1 : 0;
  return [...byTs.entries()]
    .map(([ts, group]) => {
      // Model calls are logged redundantly on every entry of a run,
      // so the first entry that carries them is the run's calls.
      const calls = group.find((entry) => entry.modelCalls)?.modelCalls ?? [];
      const verdict =
        group
          .map((entry) => entry.verdict)
          .sort((a, b) => rank(b) - rank(a))[0] ?? "clean";
      return {
        ts,
        verdict,
        entries: group,
        calls,
        latencyMs: calls.reduce((sum, call) => sum + call.latencyMs, 0),
        costUsd: calls.reduce((sum, call) => sum + call.costUsd, 0),
      };
    })
    .sort((a, b) => b.ts.localeCompare(a.ts));
}

export interface RunStats {
  total: number;
  pass: number;
  warn: number;
  blocked: number;
  needsHuman: number;
  medianLatencyMs: number;
  totalCostUsd: number;
}

/** Every aggregate the dashboard shows, from one pass over the runs. */
export function selectRunStats(
  runs: Array<{ verdict: string; latencyMs: number; costUsd: number }>,
): RunStats {
  let pass = 0;
  let warn = 0;
  let blocked = 0;
  let needsHuman = 0;
  let totalCostUsd = 0;
  const latencies: number[] = [];
  for (const run of runs) {
    if (run.verdict === "clean") pass += 1;
    else if (run.verdict === "mismatch") warn += 1;
    else if (run.verdict === "blocked") blocked += 1;
    else if (run.verdict === "needs-human") needsHuman += 1;
    totalCostUsd += run.costUsd;
    latencies.push(run.latencyMs);
  }
  latencies.sort((a, b) => a - b);
  const mid = Math.floor(latencies.length / 2);
  const medianLatencyMs =
    latencies.length === 0
      ? 0
      : latencies.length % 2 === 1
        ? (latencies[mid] as number)
        : ((latencies[mid - 1] as number) + (latencies[mid] as number)) / 2;
  return {
    total: runs.length,
    pass,
    warn,
    blocked,
    needsHuman,
    medianLatencyMs,
    totalCostUsd,
  };
}

export interface TierStats {
  /** Runs where Glimmer agreed and no Spark call was made ($0). */
  local: number;
  /** Runs with at least one Spark call. */
  escalated: number;
  /** Runs with no model calls at all (validators only, $0). */
  validatorsOnly: number;
  sparkCalls: number;
  sparkMedianLatencyMs: number;
  sparkTotalCostUsd: number;
}

/** The tiering proof: Glimmer-agree runs vs Spark-escalated runs. */
export function selectTierStats(runs: Array<{ calls: StatsModelCall[] }>): TierStats {
  let local = 0;
  let escalated = 0;
  let validatorsOnly = 0;
  let sparkCalls = 0;
  let sparkTotalCostUsd = 0;
  const sparkLatencies: number[] = [];
  for (const run of runs) {
    const sparks = run.calls.filter((call) => call.model === "spark");
    if (sparks.length > 0) {
      escalated += 1;
      sparkCalls += sparks.length;
      for (const spark of sparks) {
        sparkLatencies.push(spark.latencyMs);
        sparkTotalCostUsd += spark.costUsd;
      }
    } else if (run.calls.some((call) => call.model === "glimmer" && call.outcome === "agree")) {
      local += 1;
    } else if (run.calls.length === 0) {
      validatorsOnly += 1;
    }
  }
  sparkLatencies.sort((a, b) => a - b);
  const mid = Math.floor(sparkLatencies.length / 2);
  const sparkMedianLatencyMs =
    sparkLatencies.length === 0
      ? 0
      : sparkLatencies.length % 2 === 1
        ? (sparkLatencies[mid] as number)
        : ((sparkLatencies[mid - 1] as number) + (sparkLatencies[mid] as number)) / 2;
  return {
    local,
    escalated,
    validatorsOnly,
    sparkCalls,
    sparkMedianLatencyMs,
    sparkTotalCostUsd,
  };
}
