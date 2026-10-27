import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export type StatusTone = "pass" | "warn" | "block" | "needs" | "idle";

const TONES: Record<StatusTone, string> = {
  pass: "bg-pass",
  warn: "bg-warn",
  block: "bg-block",
  needs: "bg-needs",
  idle: "bg-ink-faint",
};

export interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  pulse?: boolean;
}

export function StatusDot({ tone = "idle", pulse = false, className, ...props }: StatusDotProps) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        TONES[tone],
        pulse && "animate-pulse",
        className,
      )}
      {...props}
    />
  );
}
