"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ScanLine } from "lucide-react";
import { cn } from "../../lib/cn";

/**
 * Stylised document + animated crop boxes for the demo POV panel.
 * Each crop anchors to a document line, so the box always lands on
 * the value it reads regardless of panel size.
 */

interface Crop {
  id: string;
  /** Index into the doc's lines. */
  line: number;
  label: string;
  value: string;
  state: "ok" | "bad" | "warn";
}

interface DocLine {
  label: string;
  value: string;
  hot?: boolean;
}

const DOCS: Record<string, { title: string; lines: DocLine[]; crops: Crop[] }> = {
  awb: {
    title: "AIR WAYBILL · 879-1541 9121",
    lines: [
      { label: "Shipper", value: "Meridian Foods Ltd" },
      { label: "Consignee", value: "Harbour Line Goods Ltd" },
      { label: "Flight", value: "HL-2207 / 14 OCT" },
      { label: "AWB no.", value: "879-1541 9121", hot: true },
      { label: "Pieces", value: "120 CTN" },
    ],
    crops: [
      { id: "awb", line: 3, label: "crop · AWB number", value: "87915419121", state: "bad" },
    ],
  },
  invoice: {
    title: "INVOICE + PACKING LIST · INV-90412",
    lines: [
      { label: "Seller", value: "Meridian Foods Ltd" },
      { label: "Invoice qty", value: "363", hot: true },
      { label: "Packing qty", value: "365", hot: true },
      { label: "Line 1", value: "Lipstick · 200 pcs" },
      { label: "Line 2", value: "Foundation · 165 pcs" },
    ],
    crops: [
      { id: "inv", line: 1, label: "crop · invoice qty", value: "363", state: "warn" },
      { id: "pack", line: 2, label: "crop · packing qty", value: "365", state: "warn" },
    ],
  },
  pod: {
    title: "PROOF OF DELIVERY · POD-11822",
    lines: [
      { label: "Delivered to", value: "Dock 7, Bay 3" },
      { label: "Received", value: "118 CTN" },
      { label: "Signed", value: "R. Alvarez" },
      { label: "Note", value: "“2 cartons damaged”", hot: true },
    ],
    crops: [
      { id: "note", line: 3, label: "crop · exception note", value: "handwriting", state: "warn" },
    ],
  },
  clean: {
    title: "RECEIVING PACK · all documents",
    lines: [
      { label: "AWB", value: "879-1541 9121" },
      { label: "Container", value: "CSQU3054383" },
      { label: "SSCC", value: "106141410000001238" },
      { label: "Received", value: "120 CTN · no exceptions", hot: true },
    ],
    crops: [
      { id: "all", line: 3, label: "crop · received count", value: "match", state: "ok" },
    ],
  },
};

function useClock(running: boolean) {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setT((v) => v + 1), 500);
    return () => clearInterval(id);
  }, [running]);
  return t;
}

function stamp(tick: number): string {
  const mm = String(Math.floor(tick / 120)).padStart(2, "0");
  const ss = String(Math.floor(tick / 2) % 60).padStart(2, "0");
  const ff = String(tick % 2).padStart(2, "0");
  return `${mm}:${ss}:${ff}`;
}

const CROP_TONE = {
  bad: "border-block/90 bg-block/10",
  warn: "border-warn/90 bg-warn/10",
  ok: "border-pass/80 bg-pass/10",
} as const;

const CHIP_TONE = {
  bad: "bg-block text-white",
  warn: "bg-warn text-black",
  ok: "bg-pass text-black",
} as const;

export function PovPanel({ doc, live }: { doc: keyof typeof DOCS; live: boolean }) {
  const reduce = useReducedMotion();
  const tick = useClock(true);
  const d = DOCS[doc];

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-sunken">
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="flex items-center gap-2 text-xs font-medium text-ink-dim">
          <span className={cn("inline-block h-2 w-2 rounded-full", live ? "animate-pulse bg-block" : "bg-amber-400")} />
          {live ? "LIVE POV · glasses 2fps" : "FIXTURE POV · replay"}
        </span>
        <span className="font-mono text-xs tabular-nums text-ink-faint">REC {stamp(tick)}</span>
      </div>

      {/* document with line-anchored crops */}
      <div className="relative mx-4 mt-4 overflow-hidden rounded-lg border border-line bg-panel">
        <div className="border-b border-line px-4 py-2 font-mono text-[11px] tracking-wide text-ink-dim">{d.title}</div>
        <div className="space-y-5 px-4 py-5">
          {d.lines.map((l, li) => (
            <div key={l.label} className="relative flex items-baseline gap-3 text-sm">
              <span className="w-28 shrink-0 text-xs text-ink-faint">{l.label}</span>
              <span className={cn("font-mono text-[13px]", l.hot ? "text-ink" : "text-ink-dim")}>{l.value}</span>
              <AnimatePresence>
                {d.crops.filter((c) => c.line === li).map((c) => (
                  <motion.div
                    key={doc + c.id}
                    initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.04 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.25, delay: reduce ? 0 : 0.3 }}
                    className={cn("pointer-events-none absolute -inset-x-2 -inset-y-1 rounded-md border-2", CROP_TONE[c.state])}
                  >
                    <span className={cn("absolute -top-3 right-2 flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px]", CHIP_TONE[c.state])}>
                      <ScanLine className="h-3 w-3" />{c.label} · {c.value}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          ))}
        </div>
      </div>

      {/* frame strip */}
      <div className="mx-4 mt-3">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-ink-faint">Recent frames</p>
        <div className="grid grid-cols-5 gap-2">
          {[4, 3, 2, 1, 0].map((ago) => {
            const f = Math.max(0, tick - ago);
            return (
              <div
                key={ago}
                className={cn(
                  "rounded-md border bg-panel p-2",
                  ago === 0 ? "border-line-strong" : "border-line opacity-60",
                )}
              >
                <div className="space-y-1">
                  <div className="h-1.5 w-3/4 rounded-sm bg-white/15" />
                  <div className="h-1.5 w-full rounded-sm bg-white/10" />
                  <div className="h-1.5 w-1/2 rounded-sm bg-white/10" />
                </div>
                <p className="mt-2 font-mono text-[10px] tabular-nums text-ink-faint">
                  f-{f} · {stamp(f)}
                </p>
              </div>
            );
          })}
        </div>
      </div>

      {/* detection log */}
      <div className="mx-4 mb-4 mt-3 min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-panel p-3">
        <p className="mb-2 font-mono text-[10px] uppercase tracking-wide text-ink-faint">Detection log</p>
        <ul className="space-y-1.5 font-mono text-[11px] tabular-nums">
          <li className="flex justify-between gap-2"><span className="text-ink-dim">page localized · conf 0.98</span><span className="text-ink-faint">{stamp(Math.max(0, tick - 4))}</span></li>
          <li className="flex justify-between gap-2"><span className="text-ink-dim">deskew + crop {d.crops.length} region{d.crops.length === 1 ? "" : "s"}</span><span className="text-ink-faint">{stamp(Math.max(0, tick - 2))}</span></li>
          <li className="flex justify-between gap-2"><span className="text-ink-dim">readings redacted for cloud</span><span className="text-ink-faint">{stamp(Math.max(0, tick - 1))}</span></li>
          <li className="flex justify-between gap-2"><span className="text-pass">verdict streamed to form</span><span className="text-ink-faint">{stamp(tick)}</span></li>
        </ul>
      </div>
    </div>
  );
}
