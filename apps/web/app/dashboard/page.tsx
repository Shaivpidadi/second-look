"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Ban,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  FileText,
  LayoutDashboard,
  ScrollText,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { Wordmark } from "../../components/brand";
import { Badge, type BadgeTone } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Separator } from "../../components/ui/separator";
import { Skeleton } from "../../components/ui/skeleton";
import { StatusDot } from "../../components/ui/status-dot";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "../../components/ui/table";
import { formatCost, formatCount, formatLatency, formatTime } from "../../lib/format";
import { actionLabel, fieldLabel } from "../../lib/fields";
import {
  groupRuns,
  selectRunStats,
  type CheckRun as LibCheckRun,
  type RunStats,
} from "../../lib/dashboard-stats";
import { buildDemoDataset } from "../../lib/demo-data";
import { cn } from "../../lib/cn";

/** Dashboard dataset id for the built-in demo data (see lib/demo-data). */
const DEMO_DATASET = "demo";

interface ModelCall {
  model: string;
  adapter: string;
  outcome: string;
  latencyMs: number;
  costUsd: number;
}

interface AuditEntry {
  ts: string;
  sessionId: string;
  fieldId: string;
  paperValue: string | null;
  typedValue: string | null;
  verdict: string;
  action: string;
  modelCalls?: ModelCall[];
}

interface ClaimDraft {
  carrier: string;
  bolRef: string;
  awbRef: string;
  exceptionNote: string;
  damagedQty: number | null;
  amount: string;
  source: string;
  body: string;
}

type View = "overview" | "checks" | "claims" | "audit" | "eval";

const NAV: Array<{ view: View; label: string; icon: typeof LayoutDashboard }> = [
  { view: "overview", label: "Overview", icon: LayoutDashboard },
  { view: "checks", label: "Checks", icon: ClipboardList },
  { view: "claims", label: "Claims", icon: FileText },
  { view: "audit", label: "Audit log", icon: ScrollText },
  { view: "eval", label: "Eval", icon: Activity },
];

const EVAL_ROWS = [
  { arm: "check-digit-only", split: "hard 40", precision: "100.0%", recall: "39.4%", latency: "0ms", cost: "$0" },
  { arm: "single-model-real", split: "hard 40", precision: "100.0%", recall: "100.0%", latency: "1849ms", cost: "$0.086" },
  { arm: "tiered-real", split: "hard 40", precision: "100.0%", recall: "100.0%", latency: "4438ms", cost: "$0.128" },
  { arm: "vision-real", split: "hard 40", precision: "100.0%", recall: "100.0%", latency: "2857ms", cost: "$0.61" },
  { arm: "tiered-real", split: "std 100", precision: "100.0%", recall: "98.8%", latency: "3118ms", cost: "†" },
];

function verdictTone(verdict: string): BadgeTone {
  if (verdict === "clean") return "pass";
  if (verdict === "mismatch") return "warn";
  if (verdict === "blocked") return "block";
  if (verdict === "needs-human") return "needs";
  return "neutral";
}

/** Adapter names for display. Local test doubles read as local. */
function adapterLabel(adapter: string): string {
  if (adapter === "stub") return "local";
  return adapter;
}

function docType(fieldId: string): string {
  const prefix = fieldId.split(".")[0] ?? "";
  const names: Record<string, string> = {
    awb: "AWB",
    bol: "BOL",
    label: "Label",
    pod: "POD",
    invoice: "Invoice",
    packing: "Packing",
  };
  return names[prefix] ?? "Other";
}

type CheckRun = LibCheckRun<AuditEntry>;

/** Reference values with units so bare counts read as quantities. */
function referenceLabel(fieldId: string | undefined, value: string | null | undefined): string {
  if (value === null || value === undefined) return fieldId ? fieldLabel(fieldId) : "n/a";
  if (fieldId === "bol.cartons" || fieldId === "pod.receivedCartons") return `${value} ctn`;
  if (fieldId === "invoice.totalQty" || fieldId === "packing.totalQty") return `${value} pcs`;
  if (fieldId === "bol.weightKg" || fieldId === "awb.weightKg") return `${value} kg`;
  return value;
}

function modelLabel(run: CheckRun): string {
  const spark = run.calls.find((call) => call.model === "spark");
  if (spark) return `Spark · ${adapterLabel(spark.adapter)}`;
  const glimmer = run.calls.find((call) => call.model === "glimmer");
  if (glimmer) return `Glimmer · ${adapterLabel(glimmer.adapter)}`;
  return "Validators";
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const area = document.createElement("textarea");
      area.value = text;
      document.body.appendChild(area);
      area.select();
      document.execCommand("copy");
      document.body.removeChild(area);
      return true;
    } catch {
      return false;
    }
  }
}

export default function Dashboard() {
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<string[]>([]);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [claims, setClaims] = useState<ClaimDraft[]>([]);
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>("overview");
  const [query, setQuery] = useState("");
  const [openCheck, setOpenCheck] = useState<string | null>(null);
  // Demo dataset, built once per mount so its timestamps stay fixed.
  const demoCache = useRef<{ entries: AuditEntry[]; claims: ClaimDraft[] } | null>(null);
  const demoData = (): { entries: AuditEntry[]; claims: ClaimDraft[] } => {
    if (!demoCache.current) demoCache.current = buildDemoDataset(Date.now());
    return demoCache.current;
  };

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/audit");
      const data = (await res.json()) as { sessions?: string[] };
      setSessions(data.sessions ?? []);
    } catch {
      setError("Could not reach the audit API.");
    }
  }, []);

  const loadEntries = useCallback(async (id: string) => {
    if (!id) {
      setEntries([]);
      return;
    }
    if (id === DEMO_DATASET) {
      setEntries(demoData().entries);
      setError(null);
      return;
    }
    try {
      const res = await fetch(`/api/audit?sessionId=${encodeURIComponent(id)}`);
      const data = (await res.json()) as { entries?: AuditEntry[] };
      setEntries(data.entries ?? []);
      setError(null);
    } catch {
      setError("Could not reach the audit API.");
    }
  }, []);

  const loadClaims = useCallback(async (id: string) => {
    if (!id) {
      setClaims([]);
      return;
    }
    if (id === DEMO_DATASET) {
      setClaims(demoData().claims);
      return;
    }
    try {
      const res = await fetch(`/api/claims?sessionId=${encodeURIComponent(id)}`);
      const data = (await res.json()) as { claims?: ClaimDraft[] };
      setClaims(data.claims ?? []);
    } catch {
      setError("Could not reach the claims API.");
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const preset = params.get("session") ?? "";
    const check = params.get("check") ?? "";
    setSessionId(preset || DEMO_DATASET);
    if (check) setOpenCheck(check);
    loadSessions().then(() => {
      setLoading(false);
    });
  }, [loadSessions]);

  useEffect(() => {
    loadEntries(sessionId);
    loadClaims(sessionId);
    if (!sessionId) return;
    const timer = setInterval(() => {
      loadEntries(sessionId);
      loadClaims(sessionId);
    }, 2000);
    return () => clearInterval(timer);
  }, [sessionId, loadEntries, loadClaims]);

  const runs = useMemo(() => groupRuns(entries), [entries]);
  const queryText = query.trim().toLowerCase();
  const visibleRuns = queryText
    ? runs.filter((run) =>
        [run.ts, run.verdict, modelLabel(run)]
          .concat(run.entries.map((entry) => `${entry.fieldId} ${entry.typedValue ?? ""} ${entry.action}`))
          .join(" ")
          .toLowerCase()
          .includes(queryText),
      )
    : runs;
  const visibleEntries = queryText
    ? entries.filter((entry) =>
        `${entry.ts} ${entry.fieldId} ${entry.typedValue ?? ""} ${entry.verdict} ${entry.action}`
          .toLowerCase()
          .includes(queryText),
      )
    : entries;

  const stats = useMemo(() => selectRunStats(runs), [runs]);
  const openRun = openCheck ? runs.find((run) => run.ts === openCheck) ?? null : null;

  function selectCheck(ts: string | null) {
    setOpenCheck(ts);
    const url = new URL(window.location.href);
    if (ts) url.searchParams.set("check", ts);
    else url.searchParams.delete("check");
    window.history.replaceState(null, "", url);
  }

  async function onCopy(index: number, body: string) {
    if (await copyText(body)) {
      setCopied(index);
      setTimeout(() => setCopied((cur) => (cur === index ? null : cur)), 2000);
    }
  }

  const kpis = [
    { label: "Checks run", value: formatCount(runs.length), icon: ClipboardList },
    { label: "Blocked", value: formatCount(stats.blocked), icon: Ban },
    { label: "Warned", value: formatCount(stats.warn), icon: TriangleAlert },
    { label: "p50 latency", value: formatLatency(stats.medianLatencyMs), icon: Activity },
    { label: "Model cost", value: formatCost(stats.totalCostUsd), icon: CheckCircle2 },
  ];

  return (
    <div className="flex min-h-screen bg-void text-ink">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-line bg-panel/60 md:flex">
        <div className="flex h-16 items-center px-5">
          <Link href="/" aria-label="Second Look home">
            <Wordmark />
          </Link>
        </div>
        <nav className="flex-1 space-y-1 px-3" aria-label="Dashboard">
          {NAV.map((item) => (
            <button
              key={item.view}
              type="button"
              onClick={() => setView(item.view)}
              aria-current={view === item.view ? "page" : undefined}
              className={cn(
                "flex w-full cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors duration-150 ease-out",
                view === item.view
                  ? "bg-white/[0.07] font-medium text-ink"
                  : "text-ink-dim hover:bg-white/[0.04] hover:text-ink",
              )}
            >
              <item.icon className="h-4 w-4" aria-hidden />
              {item.label}
              {item.view === "claims" && claims.length > 0 && (
                <span className="ml-auto rounded-full bg-white/10 px-1.5 font-mono text-[11px] tabular">
                  {claims.length}
                </span>
              )}
            </button>
          ))}
        </nav>
        <div className="p-3">
          <Button variant="secondary" size="sm" className="w-full" asChild>
            <Link href="/form">Open receiving form</Link>
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 shrink-0 items-center gap-4 border-b border-line bg-panel/60 px-6">
          <div className="relative w-full max-w-sm">
            <Search
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-faint"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search checks, fields, actions…"
              aria-label="Search checks"
              className="pl-9"
            />
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="w-64">
              <Select
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value)}
                aria-label="Dataset"
              >
                <option value={DEMO_DATASET}>Dataset: Demo</option>
                {sessions.map((id) => (
                  <option key={id} value={id} className="font-mono">
                    Session {id.slice(0, 8)}
                  </option>
                ))}
              </Select>
            </div>
            {sessionId === DEMO_DATASET && (
              <Badge tone="info" className="hidden sm:inline-flex">
                Demo data
              </Badge>
            )}
            <Badge tone="neutral" className="hidden font-mono sm:inline-flex">
              env: hackathon
            </Badge>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-6 py-8">
          <div className="mx-auto max-w-5xl">
            {error && (
              <Card className="mb-6 border-block/40">
                <CardContent className="text-sm text-block">{error}</CardContent>
              </Card>
            )}

            {loading ? (
              <div className="space-y-4" aria-label="Loading dashboard">
                <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                  {Array.from({ length: 5 }, (_, i) => (
                    <Skeleton key={i} className="h-24" />
                  ))}
                </div>
                <Skeleton className="h-64" />
              </div>
            ) : (
              <>
                {view === "overview" && (
                  <div className="space-y-6">
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
                      {kpis.map((kpi) => (
                        <Card key={kpi.label}>
                          <CardContent className="py-4">
                            <p className="flex items-center gap-1.5 text-[13px] whitespace-nowrap text-ink-dim">
                              <kpi.icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              {kpi.label}
                            </p>
                            <p className="mt-2 font-mono text-2xl leading-none font-semibold tracking-tight tabular">
                              {kpi.value}
                            </p>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Card>
                        <CardHeader>
                          <div className="flex items-baseline justify-between">
                            <CardTitle>Latency per check</CardTitle>
                            <span className="font-mono text-xs text-ink-faint tabular">
                              p50 {formatLatency(stats.medianLatencyMs)}
                            </span>
                          </div>
                        </CardHeader>
                        <CardContent>
                          <LatencyChart runs={runs} />
                        </CardContent>
                      </Card>
                      <Card>
                        <CardHeader>
                          <CardTitle>Verdict breakdown</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <VerdictBreakdown stats={stats} />
                        </CardContent>
                      </Card>
                    </div>
                    <Card>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle>Recent checks</CardTitle>
                          <Button size="sm" variant="ghost" onClick={() => setView("checks")}>
                            View all <ChevronRight className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      </CardHeader>
                      <CardContent className="!px-2 !pt-0">
                        <ChecksTable
                          runs={visibleRuns.slice(0, 8)}
                          empty="No checks yet. Submit the receiving form to create some."
                          onSelect={(ts) => selectCheck(ts)}
                        />
                      </CardContent>
                    </Card>
                  </div>
                )}

                {view === "checks" && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Checks</CardTitle>
                    </CardHeader>
                    <CardContent className="!px-2 !pt-0">
                      <ChecksTable
                        runs={visibleRuns}
                        empty={
                          queryText
                            ? `No checks match "${query}".`
                            : "No checks yet. Submit the receiving form to create some."
                        }
                        onSelect={(ts) => selectCheck(ts)}
                      />
                    </CardContent>
                  </Card>
                )}

                {view === "claims" && (
                  <div className="space-y-4">
                    {claims.length === 0 ? (
                      <EmptyState
                        icon={FileText}
                        title="No claim drafts"
                        body="Handwritten POD exceptions become damage-claim drafts here."
                      />
                    ) : (
                      claims.map((claim, index) => (
                        <article
                          key={`${claim.bolRef}-${claim.awbRef}-${index}`}
                          className="rounded-lg border border-line bg-panel"
                        >
                          <div className="flex flex-wrap items-center gap-2 border-b border-line px-5 py-3">
                            <Badge tone="needs">Claim draft</Badge>
                            <span className="font-mono text-xs text-ink-dim tabular">
                              {claim.carrier || "Unknown carrier"} · BOL {claim.bolRef || "n/a"} ·
                              AWB {claim.awbRef || "n/a"}
                            </span>
                            <Button
                              size="sm"
                              variant="secondary"
                              className="ml-auto"
                              onClick={() => onCopy(index, claim.body)}
                            >
                              {copied === index ? "Copied" : "Copy claim"}
                            </Button>
                          </div>
                          <div className="mx-auto max-w-2xl px-5 py-8">
                            <p className="text-lg font-semibold tracking-tight">
                              Damage claim: {claim.carrier || "Unknown carrier"}
                            </p>
                            <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                              <dt className="text-ink-faint">BOL reference</dt>
                              <dd className="font-mono tabular">{claim.bolRef || "n/a"}</dd>
                              <dt className="text-ink-faint">AWB reference</dt>
                              <dd className="font-mono tabular">{claim.awbRef || "n/a"}</dd>
                              <dt className="text-ink-faint">POD exception</dt>
                              <dd className="italic">“{claim.exceptionNote}”</dd>
                              <dt className="text-ink-faint">Damaged quantity</dt>
                              <dd className="font-mono tabular">
                                {claim.damagedQty === null ? "unspecified" : claim.damagedQty}
                              </dd>
                              <dt className="text-ink-faint">Claimed amount</dt>
                              <dd className="font-mono tabular">{claim.amount}</dd>
                              <dt className="text-ink-faint">Source</dt>
                              <dd className="font-mono tabular">{claim.source}</dd>
                            </dl>
                            <Separator className="my-5" />
                            <pre className="rounded-md border border-line bg-sunken p-4 font-mono text-[13px] leading-relaxed whitespace-pre-wrap">
                              {claim.body}
                            </pre>
                          </div>
                        </article>
                      ))
                    )}
                  </div>
                )}

                {view === "audit" && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Audit log</CardTitle>
                    </CardHeader>
                    <CardContent className="!px-2 !pt-0">
                      {visibleEntries.length === 0 ? (
                        <EmptyState
                          icon={ScrollText}
                          title="No audit entries"
                          body={
                            queryText
                              ? `Nothing matches "${query}".`
                              : "Submit the receiving form. Every decision lands here."
                          }
                        />
                      ) : (
                        <Table>
                          <TableHead>
                            <tr>
                              <TableHeaderCell>Time</TableHeaderCell>
                              <TableHeaderCell>Field</TableHeaderCell>
                              <TableHeaderCell>Typed value</TableHeaderCell>
                              <TableHeaderCell>Verdict</TableHeaderCell>
                              <TableHeaderCell>Action</TableHeaderCell>
                            </tr>
                          </TableHead>
                          <TableBody>
                            {visibleEntries.map((entry, i) => (
                              <TableRow key={`${entry.ts}-${i}`}>
                                <TableCell className="font-mono text-[13px] whitespace-nowrap tabular">
                                  {formatTime(entry.ts)}
                                </TableCell>
                                <TableCell
                                  className="text-[13px] text-ink-dim"
                                  title={entry.fieldId}
                                  data-field-id={entry.fieldId}
                                >
                                  {fieldLabel(entry.fieldId)}
                                </TableCell>
                                <TableCell className="max-w-48 truncate font-mono text-[13px] tabular">
                                  {entry.typedValue ?? "n/a"}
                                </TableCell>
                                <TableCell>
                                  <Badge tone={verdictTone(entry.verdict)}>
                                    {entry.verdict}
                                  </Badge>
                                </TableCell>
                                <TableCell
                                  className="font-mono text-[13px]"
                                  title={entry.action}
                                  data-action={entry.action}
                                >
                                  {actionLabel(entry.action)}
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      )}
                    </CardContent>
                  </Card>
                )}

                {view === "eval" && (
                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <CardTitle>Eval report</CardTitle>
                        <Badge tone="pass">Measured Oct 27 · 100 std + 40 hard</Badge>
                      </div>
                    </CardHeader>
                    <CardContent className="!px-2 !pt-0">
                      <Table>
                        <TableHead>
                          <tr>
                            <TableHeaderCell>Arm</TableHeaderCell>
                            <TableHeaderCell>Split</TableHeaderCell>
                            <TableHeaderCell>Precision</TableHeaderCell>
                            <TableHeaderCell>Recall</TableHeaderCell>
                            <TableHeaderCell>Latency</TableHeaderCell>
                            <TableHeaderCell>Cost</TableHeaderCell>
                          </tr>
                        </TableHead>
                        <TableBody>
                          {EVAL_ROWS.map((row) => (
                            <TableRow key={`${row.arm}-${row.split}`}>
                              <TableCell className="font-mono text-[13px]">
                                {row.arm}
                              </TableCell>
                              <TableCell className="text-ink-dim">{row.split}</TableCell>
                              <TableCell className="font-mono tabular">{row.precision}</TableCell>
                              <TableCell className="font-mono tabular">{row.recall}</TableCell>
                              <TableCell className="font-mono tabular">{row.latency}</TableCell>
                              <TableCell className="font-mono tabular">{row.cost}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </CardContent>
                    <p className="px-5 pb-4 text-xs text-ink-faint">
                      † ~$0.46 combined upper bound for both standard real arms
                      (batch-6 token totals; per-arm split unrecorded).
                    </p>
                  </Card>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {openRun && (
        <CheckDrawer
          run={openRun}
          onClose={() => selectCheck(null)}
        />
      )}
    </div>
  );
}

function ChecksTable({
  runs,
  empty,
  onSelect,
}: {
  runs: CheckRun[];
  empty: string;
  onSelect: (ts: string) => void;
}) {
  if (runs.length === 0) {
    return (
      <EmptyState icon={ClipboardList} title="No checks" body={empty} />
    );
  }
  return (
    <Table>
      <TableHead>
        <tr>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Doc</TableHeaderCell>
          <TableHeaderCell>Reference</TableHeaderCell>
          <TableHeaderCell>Model</TableHeaderCell>
          <TableHeaderCell>Latency</TableHeaderCell>
          <TableHeaderCell>Time</TableHeaderCell>
        </tr>
      </TableHead>
      <TableBody>
        {runs.map((run) => {
          const first = run.entries[0];
          return (
            <TableRow
              key={run.ts}
              onClick={() => onSelect(run.ts)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(run.ts);
                }
              }}
              tabIndex={0}
              className="cursor-pointer hover:bg-white/[0.03]"
            >
              <TableCell>
                <Badge tone={verdictTone(run.verdict)}>{run.verdict}</Badge>
              </TableCell>
              <TableCell className="text-ink-dim">
                {first ? docType(first.fieldId) : "n/a"}
              </TableCell>
              <TableCell className="max-w-44 truncate font-mono text-[13px] tabular">
                {referenceLabel(first?.fieldId, first?.typedValue)}
              </TableCell>
              <TableCell className="text-[13px] text-ink-dim">{modelLabel(run)}</TableCell>
              <TableCell className="font-mono text-[13px] tabular">
                {formatLatency(run.latencyMs)}
              </TableCell>
              <TableCell className="font-mono text-[13px] whitespace-nowrap tabular">
                {formatTime(run.ts)}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function CheckDrawer({ run, onClose }: { run: CheckRun; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Check detail">
      <button
        type="button"
        aria-label="Close check detail"
        onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/60"
      />
      <aside className="absolute top-0 right-0 flex h-full w-full max-w-md flex-col border-l border-line bg-panel">
        <div className="flex items-center gap-3 border-b border-line px-5 py-4">
          <Badge tone={verdictTone(run.verdict)}>{run.verdict}</Badge>
          <span className="font-mono text-xs text-ink-faint tabular">{formatTime(run.ts)}</span>
          <Button size="sm" variant="ghost" className="ml-auto !px-2" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        </div>
        <div className="slim-scroll flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section>
            <h3 className="text-[13px] font-semibold tracking-tight">Verdict reasoning</h3>
            {run.calls.length === 0 ? (
              <p className="mt-2 text-[13px] text-ink-dim">
                Decided by deterministic validators with no model call.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {run.calls.map((call, i) => (
                  <li
                    key={`${call.model}-${i}`}
                    className="flex items-center gap-2 rounded-md border border-line bg-sunken px-3 py-2 font-mono text-xs tabular"
                  >
                    <StatusDot
                      tone={call.model === "spark" ? "warn" : call.model === "sam" ? "needs" : "idle"}
                    />
                    <span className="text-ink">
                      {call.model} {call.outcome}
                    </span>
                    <span className="text-ink-faint">({adapterLabel(call.adapter)})</span>
                    <span className="ml-auto text-ink-faint">
                      {formatLatency(call.latencyMs)} · {formatCost(call.costUsd)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section>
            <h3 className="text-[13px] font-semibold tracking-tight">Extracted vs typed</h3>
            <div className="mt-2 overflow-hidden rounded-md border border-line">
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Field</TableHeaderCell>
                    <TableHeaderCell>Paper</TableHeaderCell>
                    <TableHeaderCell>Typed</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {run.entries.map((entry, i) => {
                    const differs =
                      entry.paperValue !== null &&
                      entry.typedValue !== null &&
                      entry.paperValue !== entry.typedValue;
                    return (
                      <TableRow key={`${entry.fieldId}-${i}`}>
                        <TableCell
                          className="text-xs text-ink-dim"
                          title={entry.fieldId}
                          data-field-id={entry.fieldId}
                        >
                          {fieldLabel(entry.fieldId)}
                        </TableCell>
                        <TableCell className="font-mono text-xs tabular">
                          {entry.paperValue ?? "n/a"}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "font-mono text-xs tabular",
                            differs && "text-warn",
                          )}
                        >
                          {entry.typedValue ?? "n/a"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </section>
          <section>
            <h3 className="text-[13px] font-semibold tracking-tight">Crops</h3>
            <p className="mt-2 rounded-md border border-dashed border-line bg-sunken p-3 text-[13px] text-ink-dim">
              {run.entries.some((entry) => entry.paperValue !== null)
                ? "Paper values were read from the glasses POV crops on the clip path."
                : "Frame crops are captured on the clip path, not on web submits. This run judged typed values only."}
            </p>
          </section>
          <section>
            <h3 className="text-[13px] font-semibold tracking-tight">Audit trail</h3>
            <ul className="mt-2 space-y-1.5">
              {run.entries.map((entry, i) => (
                <li
                  key={`${entry.ts}-${i}`}
                  className="flex items-center gap-2 font-mono text-xs tabular"
                >
                  <StatusDot
                    tone={
                      entry.verdict === "clean"
                        ? "pass"
                        : entry.verdict === "mismatch"
                          ? "warn"
                          : entry.verdict === "blocked"
                            ? "block"
                            : entry.verdict === "needs-human"
                              ? "needs"
                              : "idle"
                    }
                  />
                  <span className="text-ink-faint">{formatTime(entry.ts)}</span>
                  <span
                    className="truncate text-ink-dim"
                    title={`${entry.fieldId} → ${entry.action}`}
                    data-field-id={entry.fieldId}
                    data-action={entry.action}
                  >
                    {fieldLabel(entry.fieldId)} → {actionLabel(entry.action)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </aside>
    </div>
  );
}

const VERDICT_BAR: Record<string, string> = {
  clean: "bg-pass/70",
  mismatch: "bg-warn/70",
  blocked: "bg-block/70",
  "needs-human": "bg-needs/70",
};

function LatencyChart({ runs }: { runs: CheckRun[] }) {
  if (runs.length === 0) {
    return <p className="py-8 text-center text-[13px] text-ink-faint">No checks yet.</p>;
  }
  const ordered = [...runs].reverse();
  const max = Math.max(1, ...ordered.map((run) => run.latencyMs));
  return (
    <div
      className="flex h-24 items-end gap-[3px]"
      role="img"
      aria-label={`Latency bar chart over ${runs.length} checks`}
    >
      {ordered.map((run) => (
        <div
          key={run.ts}
          title={`${run.verdict} · ${formatLatency(run.latencyMs)}`}
          style={{ height: `${Math.max(6, (run.latencyMs / max) * 100)}%` }}
          className={cn("min-w-0 flex-1 rounded-sm", VERDICT_BAR[run.verdict] ?? "bg-white/15")}
        />
      ))}
    </div>
  );
}

function VerdictBreakdown({ stats }: { stats: RunStats }) {
  const rows = [
    { label: "Pass", bar: "bg-pass/70", count: stats.pass },
    { label: "Warn", bar: "bg-warn/70", count: stats.warn },
    { label: "Blocked", bar: "bg-block/70", count: stats.blocked },
    { label: "Needs human", bar: "bg-needs/70", count: stats.needsHuman },
  ];
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <ul className="space-y-3 py-1">
      {rows.map((row) => {
        const count = row.count;
        return (
          <li key={row.label} className="flex items-center gap-3">
            <span className="w-24 shrink-0 text-[13px] text-ink-dim">{row.label}</span>
            <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                style={{ width: `${(count / max) * 100}%` }}
                className={cn("h-full rounded-full", row.bar)}
              />
            </div>
            <span className="w-8 shrink-0 text-right font-mono text-[13px] tabular">
              {formatCount(count)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function EmptyState({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof FileText;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-md border border-line bg-raised">
        <Icon className="h-5 w-5 text-ink-faint" aria-hidden />
      </span>
      <p className="mt-4 text-sm font-semibold">{title}</p>
      <p className="mt-1 max-w-sm text-[13px] text-ink-dim">{body}</p>
    </div>
  );
}
