"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  FileWarning,
  Inbox,
  OctagonX,
  Radio,
} from "lucide-react";
import { Wordmark } from "../../components/brand";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { FieldError, Input, Label } from "../../components/ui/input";
import { Separator } from "../../components/ui/separator";
import { Skeleton } from "../../components/ui/skeleton";
import { StatusDot, type StatusTone } from "../../components/ui/status-dot";
import { formatCost } from "../../lib/format";
import { fieldLabel, verdictLabel } from "../../lib/fields";
import { cn } from "../../lib/cn";
import { LiveVerdictTracker, type LiveVerdictMessage } from "../../lib/live-verdict";

interface Field {
  id: string;
  label: string;
  mono?: boolean;
}

interface Section {
  title: string;
  hint: string;
  fields: Field[];
}

const SECTIONS: Section[] = [
  {
    title: "Shipment",
    hint: "Air and ocean references for this receipt.",
    fields: [
      { id: "awb.awbNumber", label: "AWB number", mono: true },
      { id: "bol.bolNumber", label: "BOL number", mono: true },
      { id: "bol.carrier", label: "Carrier" },
    ],
  },
  {
    title: "Identifiers",
    hint: "Container and pallet marks, checked digit by digit.",
    fields: [
      { id: "bol.containerNumber", label: "Container number", mono: true },
      { id: "label.sscc", label: "SSCC (pallet label)", mono: true },
    ],
  },
  {
    title: "Counts",
    hint: "Shipped versus received cartons.",
    fields: [
      { id: "bol.cartons", label: "Shipped cartons", mono: true },
      { id: "pod.receivedCartons", label: "Received cartons", mono: true },
    ],
  },
  {
    title: "Exception",
    hint: "Handwritten POD notes become damage claims.",
    fields: [{ id: "pod.exceptionNote", label: "POD exception note" }],
  },
];

const ALL_FIELDS = SECTIONS.flatMap((section) => section.fields);

const PREFILL: Record<string, string> = {
  "awb.awbNumber": "02027342210",
  "bol.bolNumber": "BOL-00421307",
  "bol.carrier": "HARBOUR LINE GOODS",
  "bol.containerNumber": "CSQU3054383",
  "label.sscc": "106141410000001238",
  "bol.cartons": "120",
  "pod.receivedCartons": "120",
  "pod.exceptionNote": "",
};

interface Failure {
  fieldId: string;
  rule: string;
  message: string;
  fix?: string;
}

interface ModelCallInfo {
  model: string;
  adapter: string;
  outcome: string;
  latencyMs: number;
  costUsd: number;
}

interface ClaimInfo {
  carrier: string;
  bolRef: string;
  awbRef: string;
  damagedQty: number | null;
  source: string;
}

interface SubmitResult {
  decision: "ALLOW" | "BLOCK";
  verdict: { state: string };
  failures: Failure[];
  glimmer?: { outcome: string; adapter: string; latencyMs: number; costUsd: number };
  spark?: { explanation: string; adapter: string; latencyMs: number; costUsd: number } | null;
  escalated?: boolean;
  modelCalls?: ModelCallInfo[];
  claim?: ClaimInfo | null;
}

function stateTone(state: string | undefined): StatusTone {
  if (state === "clean") return "pass";
  if (state === "mismatch") return "warn";
  if (state === "blocked") return "block";
  return "idle";
}

function stateBadge(state: string | undefined): React.ReactNode {
  if (state === undefined) return <Badge tone="neutral">Idle</Badge>;
  const tone = state === "clean" ? "pass" : state === "mismatch" ? "warn" : "block";
  return <Badge tone={tone}>{verdictLabel(state)}</Badge>;
}

export default function ReceivingForm() {
  // Assigned client-side: a render-time UUID would hydrate differently.
  const [sessionId, setSessionId] = useState("");
  useEffect(() => {
    setSessionId(crypto.randomUUID());
  }, []);
  const [values, setValues] = useState<Record<string, string>>(PREFILL);
  const [streamed, setStreamed] = useState(0);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [live, setLive] = useState<LiveVerdictMessage | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    if (!sessionId) return;
    const tracker = new LiveVerdictTracker({ debounceMs: 150, onVerdict: setLive });
    const source = new EventSource(
      `/api/verdicts?sessionId=${encodeURIComponent(sessionId)}`,
    );
    source.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string) as Partial<LiveVerdictMessage>;
        if (typeof data.seq === "number") {
          tracker.handle(data as LiveVerdictMessage);
        }
      } catch {
        // Ignore malformed pushes; the next verdict replaces them.
      }
    };
    return () => {
      source.close();
      tracker.dispose();
    };
  }, [sessionId]);

  function streamEvent(fieldId: string, value: string) {
    clearTimeout(timers.current[fieldId]);
    timers.current[fieldId] = setTimeout(() => {
      fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          fieldId,
          value,
          ts: new Date().toISOString(),
        }),
      })
        .then((res) => {
          if (res.ok) setStreamed((n) => n + 1);
        })
        .catch(() => {});
    }, 250);
  }

  function onChange(fieldId: string, value: string) {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    setResult(null);
    streamEvent(fieldId, value);
  }

  function applyFix(fieldId: string, fix: string) {
    setValues((prev) => ({ ...prev, [fieldId]: fix }));
    setResult(null);
    streamEvent(fieldId, fix);
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId, values }),
      });
      const data = (await res.json()) as SubmitResult;
      setResult(data);
    } finally {
      setSubmitting(false);
    }
  }

  const liveFailures = live?.decision === "BLOCK" ? live.failures : [];
  const failedFields = new Map<string, Failure>();
  for (const failure of [...liveFailures, ...(result?.failures ?? [])]) {
    if (!failedFields.has(failure.fieldId)) failedFields.set(failure.fieldId, failure);
  }
  const blocked = live?.decision === "BLOCK";
  const submitCost = (result?.modelCalls ?? []).reduce((sum, call) => sum + call.costUsd, 0);

  return (
    <div className="min-h-screen bg-void text-ink">
      <header className="border-b border-line bg-panel/60">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
          <Link href="/" aria-label="Second Look home">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-3">
            <Badge tone="neutral" className="font-mono">
              session {sessionId ? sessionId.slice(0, 8) : "…"}
            </Badge>
            <Button size="sm" variant="secondary" asChild>
              <Link href={`/dashboard?session=${sessionId}`}>
                Dashboard <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="flex items-center gap-2 text-[13px] text-ink-dim">
              <Inbox className="h-4 w-4" aria-hidden /> Inbound · Dock 3
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.02em]">
              Warehouse receiving
            </h1>
            <p className="mt-2 max-w-xl text-[15px] text-ink-dim">
              Every keystroke streams to the screen reader; Second Look
              verdicts each field against the paper as you type.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[13px] text-ink-dim">
            <Radio className="h-4 w-4 text-pass" aria-hidden />
            <span className="font-mono tabular">
              {streamed} typed event{streamed === 1 ? "" : "s"} streamed
            </span>
          </div>
        </div>

        <div className="mt-8 grid items-start gap-6 lg:grid-cols-3">
          <form onSubmit={onSubmit} className="space-y-6 lg:col-span-2">
            {SECTIONS.map((section) => (
              <Card key={section.title}>
                <CardHeader>
                  <CardTitle>{section.title}</CardTitle>
                  <CardDescription>{section.hint}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {section.fields.map((field) => {
                    const failure = failedFields.get(field.id);
                    return (
                      <div key={field.id} data-field-id={field.id}>
                        <Label htmlFor={field.id}>{field.label}</Label>
                        <Input
                          id={field.id}
                          value={values[field.id] ?? ""}
                          onChange={(e) => onChange(field.id, e.target.value)}
                          autoComplete="off"
                          spellCheck={false}
                          invalid={failure !== undefined}
                          aria-invalid={failure !== undefined}
                          aria-describedby={failure ? `${field.id}-error` : undefined}
                          className={cn(field.mono && "font-mono tabular")}
                        />
                        {failure && (
                          <FieldError id={`${field.id}-error`}>{failure.message}</FieldError>
                        )}
                      </div>
                    );
                  })}
                </CardContent>
              </Card>
            ))}

            <div className="flex flex-wrap items-center gap-4">
              <Button type="submit" size="lg" disabled={submitting || blocked}>
                {submitting ? "Checking…" : "Submit receipt"}
              </Button>
              {blocked && !submitting && (
                <p className="flex items-center gap-2 text-sm text-block">
                  <OctagonX className="h-4 w-4" aria-hidden />
                  Resolve the live block to submit.
                </p>
              )}
            </div>
          </form>

          <aside className="space-y-4 lg:sticky lg:top-6">
            <Card aria-live="polite">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle>Live verdict</CardTitle>
                  <StatusDot tone={stateTone(live?.state)} pulse={live === null} />
                </div>
                <CardDescription>Verdicts stream in as you type.</CardDescription>
              </CardHeader>
              <CardContent>
                {live === null ? (
                  <div className="space-y-2">
                    <Skeleton className="h-6 w-24" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-2/3" />
                  </div>
                ) : (
                  <div key={live.seq} className="animate-rise space-y-3">
                    <div className="flex items-center gap-2">
                      {stateBadge(live.state)}
                      <span className="font-mono text-xs text-ink-faint tabular">
                        seq {live.seq}
                      </span>
                    </div>
                    {liveFailures.length === 0 ? (
                      <p className="flex items-center gap-2 text-sm text-ink-dim">
                        <CheckCircle2 className="h-4 w-4 text-pass" aria-hidden />
                        All typed fields agree with the paper.
                      </p>
                    ) : (
                      <ul className="space-y-3">
                        {liveFailures.map((failure) => (
                          <li
                            key={`${failure.fieldId}-${failure.rule}`}
                            className="rounded-md border border-line bg-sunken p-3"
                          >
                            <p
                              className="text-xs font-medium text-ink"
                              data-field-id={failure.fieldId}
                              data-rule={failure.rule}
                            >
                              {fieldLabel(failure.fieldId)}
                            </p>
                            <p className="mt-1 text-[13px] text-ink-dim">{failure.message}</p>
                            {failure.fix !== undefined && (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <code className="rounded border border-line bg-void px-1.5 py-0.5 font-mono text-xs tabular">
                                  {failure.fix}
                                </code>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => applyFix(failure.fieldId, failure.fix as string)}
                                >
                                  Apply fix
                                </Button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {result && (
              <Card aria-live="polite" className="animate-rise">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>
                      Submit {result.decision === "BLOCK" ? "blocked" : "accepted"}
                    </CardTitle>
                    {stateBadge(result.verdict.state)}
                  </div>
                  <CardDescription>
                    {result.glimmer
                      ? `Glimmer ${result.glimmer.outcome} (${result.glimmer.adapter}) · ${
                          result.escalated
                            ? `Spark escalation (${result.spark?.adapter ?? "?"})`
                            : "no Spark call"
                        } · ${formatCost(submitCost)}`
                      : "Validators only."}
                  </CardDescription>
                </CardHeader>
                {(result.failures.length > 0 || result.claim) && (
                  <CardContent className="space-y-3">
                    {result.claim && (
                      <p className="flex items-start gap-2 text-[13px] text-ink-dim">
                        <FileWarning className="mt-0.5 h-4 w-4 shrink-0 text-needs" aria-hidden />
                        <span>
                          Claim draft: {result.claim.damagedQty ?? "?"} damaged ·{" "}
                          {result.claim.carrier} ·{" "}
                          <Link
                            href={`/dashboard?session=${sessionId}`}
                            className="text-accent hover:underline"
                          >
                            view on dashboard
                          </Link>
                        </span>
                      </p>
                    )}
                    {result.failures.length > 0 && (
                      <ul className="space-y-3">
                        {result.failures.map((failure) => (
                          <li
                            key={`${failure.fieldId}-${failure.rule}`}
                            className="rounded-md border border-line bg-sunken p-3"
                          >
                            <p
                              className="text-xs font-medium text-ink"
                              data-field-id={failure.fieldId}
                              data-rule={failure.rule}
                            >
                              {fieldLabel(failure.fieldId)}
                            </p>
                            <p className="mt-1 text-[13px] text-ink-dim">{failure.message}</p>
                            {failure.fix !== undefined && (
                              <div className="mt-2 flex flex-wrap items-center gap-2">
                                <code className="rounded border border-line bg-void px-1.5 py-0.5 font-mono text-xs tabular">
                                  {failure.fix}
                                </code>
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => applyFix(failure.fieldId, failure.fix as string)}
                                >
                                  Apply fix
                                </Button>
                              </div>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                )}
              </Card>
            )}

            <Card>
              <CardContent className="text-[13px] leading-relaxed text-ink-dim">
                <p>
                  Session{" "}
                  <code className="font-mono text-xs tabular">
                    {sessionId ? sessionId.slice(0, 8) : "…"}
                  </code>{" "}
                  ·{" "}
                  <span className="font-mono text-xs tabular">
                    {streamed} event{streamed === 1 ? "" : "s"} · live
                  </span>
                </p>
                <Separator className="my-3" />
                <Link
                  href={`/dashboard?session=${sessionId}`}
                  className="inline-flex items-center gap-1.5 text-accent hover:underline"
                >
                  Watch this session on the dashboard
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </CardContent>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}
