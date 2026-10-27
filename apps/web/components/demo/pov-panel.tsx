"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ScanLine } from "lucide-react";
import { cn } from "../../lib/cn";

/** Stylised document + animated crop boxes for the demo POV panel. */

interface Crop {
  id: string;
  label: string;
  value: string;
  state: "ok" | "bad" | "warn";
  style: React.CSSProperties;
}

const DOCS: Record<string, { title: string; lines: Array<{ label: string; value: string; hot?: boolean }>; crops: Crop[] }> = {
  awb: {
    title: "AIR WAYBILL · 879-1541 9121",
    lines: [
      { label: "Shipper", value: "Revlon Consumer Products" },
      { label: "Consignee", value: "Harbour Line Goods Ltd" },
      { label: "Flight", value: "HL-2207 / 14 OCT" },
      { label: "AWB no.", value: "879-1541 9121", hot: true },
      { label: "Pieces", value: "120 CTN" },
    ],
    crops: [
      { id: "awb", label: "crop · awb.awbNumber", value: "87915419121", state: "bad", style: { top: "52%", left: "30%", width: "52%", height: "13%" } },
    ],
  },
  invoice: {
    title: "COMMERCIAL INVOICE · INV-90412",
    lines: [
      { label: "Seller", value: "Revlon Consumer Products" },
      { label: "Buyer", value: "Harbour Line Goods Ltd" },
      { label: "Line 1", value: "Lipstick · 200 pcs" },
      { label: "Line 2", value: "Foundation · 165 pcs" },
      { label: "Total qty", value: "363", hot: true },
    ],
    crops: [
      { id: "inv", label: "crop · invoice.totalQty", value: "363", state: "warn", style: { top: "66%", left: "52%", width: "26%", height: "12%" } },
      { id: "pack", label: "crop · packing.totalQty", value: "365", state: "warn", style: { top: "80%", left: "52%", width: "26%", height: "12%" } },
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
      { id: "note", label: "crop · pod.exceptionNote", value: "handwriting", state: "warn", style: { top: "58%", left: "24%", width: "58%", height: "16%" } },
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
      { id: "all", label: "crop · full page", value: "match", state: "ok", style: { top: "12%", left: "10%", width: "80%", height: "76%" } },
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

export function PovPanel({ doc, live }: { doc: keyof typeof DOCS; live: boolean }) {
  const reduce = useReducedMotion();
  const tick = useClock(true);
  const d = DOCS[doc];
  const mm = String(Math.floor(tick / 120)).padStart(2, "0");
  const ss = String(Math.floor(tick / 2) % 60).padStart(2, "0");
  const ff = String(tick % 2).padStart(2, "0");

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-sunken">
      {/* header strip */}
      <div className="flex items-center justify-between border-b border-line px-4 py-2">
        <span className="flex items-center gap-2 text-xs font-medium text-ink-dim">
          <span className={cn("inline-block h-2 w-2 rounded-full", live ? "animate-pulse bg-block" : "bg-amber-400")} />
          {live ? "LIVE POV · glasses 2fps" : "FIXTURE POV · replay"}
        </span>
        <span className="font-mono text-xs tabular-nums text-ink-faint">REC {mm}:{ss}:{ff}</span>
      </div>
      {/* document + crops */}
      <div className="relative m-4 min-h-0 flex-1 overflow-hidden rounded-lg border border-line bg-panel">
        <div className="border-b border-line px-4 py-2 font-mono text-[11px] tracking-wide text-ink-dim">{d.title}</div>
        <div className="space-y-2.5 px-4 py-4">
          {d.lines.map((l) => (
            <div key={l.label} className="flex items-baseline gap-3 text-sm">
              <span className="w-28 shrink-0 text-xs text-ink-faint">{l.label}</span>
              <span className={cn("font-mono text-[13px]", l.hot ? "text-ink" : "text-ink-dim")}>{l.value}</span>
            </div>
          ))}
        </div>
        <AnimatePresence mode="popLayout">
          {d.crops.map((c, i) => (
            <motion.div
              key={doc + c.id}
              initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 1.06 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, delay: reduce ? 0 : 0.25 + i * 0.2 }}
              style={c.style}
              className={cn(
                "absolute rounded-md border-2",
                c.state === "bad" && "border-block/90 bg-block/10",
                c.state === "warn" && "border-warn/90 bg-warn/10",
                c.state === "ok" && "border-pass/80 bg-pass/10",
              )}
            >
              <span
                className={cn(
                  "absolute -top-6 left-0 flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px]",
                  c.state === "bad" && "bg-block text-white",
                  c.state === "warn" && "bg-warn text-black",
                  c.state === "ok" && "bg-pass text-black",
                )}
              >
                <ScanLine className="h-3 w-3" />{c.label} · {c.value}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
