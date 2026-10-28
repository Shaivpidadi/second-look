"use client";

import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { Wordmark } from "../brand";
import { Badge } from "../ui/badge";
import { formatCost, formatLatency } from "../../lib/format";
import { actionLabel, fieldLabel } from "../../lib/fields";
import type { DemoStep, FixtureAudit, FixtureCard } from "./fixtures";

/* ---------------------------------- title --------------------------------- */

export function TitleCard({ onStart }: { onStart: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4 }}
      className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-void/95 text-center backdrop-blur-sm"
    >
      <Wordmark />
      <p className="mt-6 max-w-xl text-balance text-2xl font-medium leading-snug text-ink">
        In 2020 Citibank wired $900M to Revlon&apos;s lenders by mistake.
        Second Look checks the paperwork against the goods before you sign.
      </p>
      <p className="mt-3 font-mono text-sm text-ink-faint">4 moments · about 2 minutes · fixtures, no network</p>
      <button
        onClick={onStart}
        className="mt-8 inline-flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 text-sm font-medium text-white transition hover:bg-accent-strong"
      >
        Start the demo <ArrowRight className="h-4 w-4" />
      </button>
      <p className="mt-4 text-xs text-ink-faint">
        <KbdHint>→</KbdHint> to advance · <KbdHint>←</KbdHint> back · <KbdHint>R</KbdHint> reset
      </p>
    </motion.div>
  );
}

function KbdHint({ children }: { children: string }) {
  return <kbd className="rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[11px] text-ink-dim">{children}</kbd>;
}

/* ------------------------------ typed values ------------------------------ */

export function DemoFormPanel({ step }: { step: DemoStep }) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-sunken">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="text-xs font-medium text-ink-dim">Receiving form · typed values</span>
        <Badge tone={step.verdict === "clean" ? "pass" : step.verdict === "blocked" ? "block" : "warn"}>
          {step.verdict === "clean" ? "accepted" : step.verdict}
        </Badge>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 slim-scroll">
        {step.fields.map((f) => (
          <div key={f.id} data-field-id={f.id}>
            <div className="mb-1 flex items-baseline justify-between">
              <span className="text-xs text-ink-dim">{f.label}</span>
            </div>
            <div
              className={
                f.state === "bad"
                  ? "rounded-lg border border-block/60 bg-block/10 px-3 py-2 font-mono text-sm text-ink"
                  : "rounded-lg border border-line bg-panel px-3 py-2 font-mono text-sm text-ink"
              }
            >
              {f.typed}
            </div>
            <p className={f.state === "bad" ? "mt-1 font-mono text-xs text-block" : "mt-1 font-mono text-xs text-ink-faint"}>
              {f.state === "bad" ? `paper holds ${f.paper}` : `paper ${f.paper} · match`}
            </p>
          </div>
        ))}
        {step.fix && (
          <div className="rounded-lg border border-dashed border-line p-3 text-xs text-ink-dim">
            Fix available: <span className="font-mono text-ink">{step.fix.value}</span>. Apply it on the{" "}
            <span className="text-ink">/form</span> page.
          </div>
        )}
        {step.claim && (
          <div className="rounded-lg border border-dashed border-line p-3 text-xs text-ink-dim">
            Claim draft: <span className="font-mono text-ink">{step.claim.carrier}</span> ·{" "}
            <span className="font-mono text-ink">{step.claim.bolRef}</span> · qty {step.claim.damagedQty} · amount TBD.
          </div>
        )}
        <div
          className={
            step.verdict === "clean"
              ? "mt-auto rounded-lg border border-pass/40 bg-pass/10 p-3 text-xs text-ink-dim"
              : "mt-auto rounded-lg border border-block/40 bg-block/10 p-3 text-xs text-ink-dim"
          }
        >
          {step.verdict === "clean" ? (
            <>Submit gate: <span className="font-medium text-pass">OPEN</span>. Receipt accepted.</>
          ) : (
            <>Submit gate: <span className="font-medium text-block">BLOCKED</span>. Resolve the flagged field{step.verdict === "mismatch" ? "s" : ""} to submit.</>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------- side panel ------------------------------- */

export function DemoSidePanel({
  steps,
  index,
  onJump,
  cards,
  audit,
}: {
  steps: DemoStep[];
  index: number;
  onJump: (i: number) => void;
  cards: FixtureCard[];
  audit: FixtureAudit[];
}) {
  const totalMs = cards.reduce((s, c) => s + c.latencyMs, 0);
  const totalCost = cards.reduce((s, c) => s + c.costUsd, 0);
  const modelCalls = cards.filter((c) => c.model !== "validators" && c.model !== "template").length;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto slim-scroll">
      <div className="rounded-xl border border-line bg-sunken p-3">
        <p className="mb-2 px-1 text-xs font-medium text-ink-dim">Moments</p>
        <ol className="space-y-1">
          {steps.map((s, i) => (
            <li key={s.id}>
              <button
                onClick={() => onJump(i)}
                className={
                  i === index
                    ? "w-full rounded-lg bg-raised px-2.5 py-2 text-left text-sm text-ink ring-1 ring-inset ring-line"
                    : "w-full rounded-lg px-2.5 py-2 text-left text-sm text-ink-dim transition hover:bg-raised hover:text-ink"
                }
              >
                <span className="font-mono text-[10px] text-ink-faint">{s.kicker}</span>
                <span className="block truncate">{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Latency" value={formatLatency(totalMs)} />
        <Stat label="Model calls" value={String(modelCalls)} />
        <Stat label="Cost" value={formatCost(totalCost)} />
        <Stat label="Model" value={cards.some((c) => c.model.startsWith("spark")) ? "spark-1.3" : "local"} />
      </div>
      <div className="min-h-0 flex-1 rounded-xl border border-line bg-sunken p-3">
        <p className="mb-2 px-1 text-xs font-medium text-ink-dim">Audit trail</p>
        <ul className="space-y-1.5">
          {audit.length === 0 && <li className="px-1 text-xs text-ink-faint">Nothing yet. Advance a moment.</li>}
          {audit.map((a, i) => (
            <li
              key={`${a.moment}-${i}`}
              className="rounded-lg bg-panel px-2.5 py-2"
              data-field-id={a.field}
              data-action={a.action}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-[11px] text-ink">{actionLabel(a.action)}</span>
                <span className="font-mono text-[10px] text-ink-faint">{a.moment}</span>
              </div>
              <div className="mt-0.5 font-mono text-[10px] text-ink-faint">{fieldLabel(a.field)} · {a.verdict}</div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-sunken px-3 py-2.5">
      <p className="text-[11px] text-ink-faint">{label}</p>
      <p className="mt-0.5 font-mono text-sm tabular-nums text-ink">{value}</p>
    </div>
  );
}
