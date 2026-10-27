"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, RotateCcw, Radio, Play } from "lucide-react";
import { Wordmark } from "../../components/brand";
import { Badge } from "../../components/ui/badge";
import { DEMO_STEPS, type FixtureAudit, type FixtureCard } from "../../components/demo/fixtures";
import { PovPanel } from "../../components/demo/pov-panel";
import { DemoFormPanel, DemoSidePanel, TitleCard } from "../../components/demo/panels";
import { cn } from "../../lib/cn";

interface LiveSubmit {
  ok: boolean;
  verdict: string;
  failures: Array<{ code?: string; field: string; message: string }>;
  warnings: string[];
  glimmer: { label: string; confidence: number; elapsedMs: number } | null;
  spark: { label: string; reasoning: string; proposedFix: unknown; escalateNote: string | null; elapsedMs: number } | null;
  modelCalls: number;
  claim: { carrier: string; bolRef: string; damagedQty: number } | null;
}

function LiveCard({ card, i }: { card: FixtureCard; i: number }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      layout
      initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: reduce ? 0 : i * 0.05 }}
      className={cn(
        "w-72 shrink-0 rounded-xl border bg-sunken p-3",
        card.tone === "block" && "border-block/50",
        card.tone === "warn" && "border-warn/50",
        card.tone === "pass" && "border-pass/40",
        card.tone === "info" && "border-line",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wide text-ink-faint">{card.from}</span>
        <Badge tone={card.tone === "info" ? "info" : card.tone}>{card.tone}</Badge>
      </div>
      <p className="mt-1.5 text-sm font-medium text-ink">{card.title}</p>
      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-ink-dim">{card.body}</p>
      <p className="mt-2 font-mono text-[10px] tabular-nums text-ink-faint">
        {card.model} · {card.latencyMs >= 1000 ? `${(card.latencyMs / 1000).toFixed(1)}s` : `${Math.round(card.latencyMs)}ms`} · ${card.costUsd === 0 ? "$0" : `$${card.costUsd.toFixed(4)}`}
      </p>
    </motion.div>
  );
}

function DemoInner() {
  const params = useSearchParams();
  const record = params.get("record") === "1";
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [live, setLive] = useState(false);
  const [cards, setCards] = useState<FixtureCard[]>([]);
  const [audit, setAudit] = useState<FixtureAudit[]>([]);
  const [liveNote, setLiveNote] = useState<string | null>(null);
  const timers = useRef<number[]>([]);

  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const streamCards = useCallback((all: FixtureCard[], stepAudit: FixtureAudit[], staggerMs: number) => {
    clearTimers();
    setCards([]);
    setAudit((prev) => prev); // keep
    all.forEach((c, i) => {
      timers.current.push(
        window.setTimeout(() => setCards((prev) => [...prev, c]), 350 + i * staggerMs),
      );
    });
    timers.current.push(window.setTimeout(() => setAudit((prev) => [...prev, ...stepAudit]), 350 + all.length * staggerMs));
  }, []);

  const step = DEMO_STEPS[index];

  const runLive = useCallback(async (i: number) => {
    clearTimers();
    setCards([]);
    setLiveNote("calling /api/submit …");
    const s = DEMO_STEPS[i];
    try {
      // Build a typed form: ok fields from typed values, bad fields keep the typo.
      const typed: Record<string, Record<string, unknown>> = {};
      for (const f of s.fields) {
        const [doc, field] = f.id.split(".");
        typed[doc] ??= {};
        const n = Number(f.typed);
        typed[doc][field] = f.typed === "" ? "" : Number.isNaN(n) || /[^0-9.\-]/.test(f.typed) ? f.typed : n;
      }
      const res = await fetch("/api/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ typed, expected: {}, sessionId: "demo" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const r = (await res.json()) as LiveSubmit;
      const liveCards: FixtureCard[] = [];
      for (const f of r.failures) {
        liveCards.push({
          from: "validators", title: f.code ?? "Blocked", body: `${f.field}: ${f.message}`,
          tone: "block", model: "validators", latencyMs: 0.5, costUsd: 0,
        });
      }
      if (r.glimmer) {
        liveCards.push({
          from: "glimmer", title: `Local pass: ${r.glimmer.label}`,
          body: `confidence ${(r.glimmer.confidence * 100).toFixed(0)}%`,
          tone: r.glimmer.label === "match" ? "pass" : "warn",
          model: "glimmer", latencyMs: r.glimmer.elapsedMs, costUsd: 0,
        });
      }
      if (r.spark) {
        liveCards.push({
          from: "spark", title: `Spark: ${r.spark.label}`,
          body: r.spark.escalateNote ?? r.spark.reasoning.slice(0, 120),
          tone: r.spark.label === "block" ? "block" : r.spark.label === "flag" ? "warn" : "pass",
          model: "muse-spark", latencyMs: r.spark.elapsedMs, costUsd: 0,
        });
      }
      if (r.claim) {
        liveCards.push({
          from: "claim", title: "Claim drafted",
          body: `${r.claim.carrier} · ${r.claim.bolRef} · qty ${r.claim.damagedQty}`,
          tone: "info", model: "template", latencyMs: 3, costUsd: 0,
        });
      }
      if (r.ok) {
        liveCards.push({
          from: "submit", title: "Accepted", body: r.warnings.join(" ") || "Receipt accepted.",
          tone: "pass", model: "gate", latencyMs: 1, costUsd: 0,
        });
      }
      setLiveNote(null);
      streamCards(liveCards, [], 500);
    } catch (e) {
      setLiveNote(e instanceof Error ? `live call failed: ${e.message}` : "live call failed");
    }
  }, [streamCards]);

  const playStep = useCallback((i: number, useLive: boolean) => {
    const clamped = Math.max(0, Math.min(DEMO_STEPS.length - 1, i));
    setIndex(clamped);
    if (useLive) {
      void runLive(clamped);
    } else {
      const s = DEMO_STEPS[clamped];
      streamCards(s.cards, s.audit, 600);
    }
  }, [runLive, streamCards]);

  const start = useCallback(() => {
    setStarted(true);
    setAudit([]);
    playStep(0, live);
  }, [live, playStep]);

  const reset = useCallback(() => {
    clearTimers();
    setStarted(false);
    setIndex(0);
    setCards([]);
    setAudit([]);
    setLiveNote(null);
  }, []);

  const next = useCallback(() => {
    if (!started) return start();
    if (index < DEMO_STEPS.length - 1) playStep(index + 1, live);
  }, [started, start, index, live, playStep]);

  const back = useCallback(() => {
    if (index > 0) playStep(index - 1, live);
  }, [index, live, playStep]);

  // keyboard stepping
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") next();
      else if (e.key === "ArrowLeft") back();
      else if (e.key === "r" || e.key === "R") reset();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, back, reset]);

  // 10s title card auto-advance
  useEffect(() => {
    if (started) return;
    const t = window.setTimeout(() => start(), 10_000);
    return () => window.clearTimeout(t);
  }, [started, start]);

  useEffect(() => () => clearTimers(), []);

  return (
    <div className={cn("relative flex h-screen flex-col overflow-hidden bg-void text-ink", record && "demo-record")}>
      {!started && <TitleCard onStart={start} />}

      {/* top chrome (hidden in record mode) */}
      {!record && (
        <header className="flex items-center justify-between border-b border-line px-5 py-2.5">
          <Wordmark />
          <div className="flex items-center gap-3">
            <Badge tone={live ? "block" : "info"}>{live ? "LIVE · /api/submit" : "FIXTURE · replay"}</Badge>
            <button
              onClick={() => { const v = !live; setLive(v); if (started) playStep(index, v); }}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-1.5 text-xs text-ink-dim transition hover:text-ink"
            >
              {live ? <Play className="h-3.5 w-3.5" /> : <Radio className="h-3.5 w-3.5" />}
              {live ? "Use fixtures" : "Go live"}
            </button>
            <span className="hidden font-mono text-[11px] text-ink-faint lg:inline">→ next · ← back · R reset · ?record=1 hides this bar</span>
          </div>
        </header>
      )}

      {/* main grid */}
      <div className="grid min-h-0 flex-1 grid-cols-12 gap-3 p-3">
        <div className="col-span-5 min-h-0">
          <PovPanel doc={step.doc} live={live} />
        </div>
        <div className="col-span-4 min-h-0">
          <DemoFormPanel step={step} />
        </div>
        <div className="col-span-3 min-h-0">
          <DemoSidePanel
            steps={DEMO_STEPS}
            index={index}
            onJump={(i) => playStep(i, live)}
            cards={cards}
            audit={audit}
          />
        </div>
      </div>

      {/* streaming verdict strip */}
      <div className="border-t border-line px-3 pb-3 pt-2">
        <div className="mb-2 flex items-center justify-between px-1">
          <p className="text-xs font-medium text-ink-dim">
            {step.kicker} — {step.title}
            <span className="ml-2 font-normal text-ink-faint">{step.hint}</span>
          </p>
          {!record && (
            <div className="flex items-center gap-1.5">
              <button onClick={back} disabled={index === 0} className="rounded-lg border border-line bg-panel p-1.5 text-ink-dim transition hover:text-ink disabled:opacity-40" aria-label="Back">
                <ArrowLeft className="h-4 w-4" />
              </button>
              <button onClick={next} disabled={index === DEMO_STEPS.length - 1 && started} className="rounded-lg border border-line bg-panel p-1.5 text-ink-dim transition hover:text-ink disabled:opacity-40" aria-label="Next">
                <ArrowRight className="h-4 w-4" />
              </button>
              <button onClick={reset} className="rounded-lg border border-line bg-panel p-1.5 text-ink-dim transition hover:text-ink" aria-label="Reset">
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
        <div className="flex h-44 gap-3 overflow-x-auto pb-1 slim-scroll">
          <AnimatePresence>
            {cards.map((c, i) => (
              <LiveCard key={`${index}-${i}`} card={c} i={i} />
            ))}
          </AnimatePresence>
          {liveNote && <p className="self-center text-sm text-ink-faint">{liveNote}</p>}
          {cards.length === 0 && !liveNote && started && (
            <p className="self-center text-sm text-ink-faint">Streaming verdicts …</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DemoPage() {
  return (
    <Suspense fallback={<div className="flex h-screen items-center justify-center bg-void text-sm text-ink-faint">Loading demo …</div>}>
      <DemoInner />
    </Suspense>
  );
}
