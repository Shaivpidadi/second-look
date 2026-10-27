import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export type BadgeTone = "neutral" | "info" | "pass" | "warn" | "block" | "needs";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-white/[0.06] text-ink-dim border-white/10",
  info: "bg-accent/15 text-[#7fb0ff] border-accent/30",
  pass: "bg-pass/12 text-pass border-pass/25",
  warn: "bg-warn/12 text-warn border-warn/25",
  block: "bg-block/12 text-block border-block/25",
  needs: "bg-needs/12 text-needs border-needs/25",
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone;
}

export function Badge({ tone = "neutral", className, ...props }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs leading-4 font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
      {...props}
    />
  );
}
