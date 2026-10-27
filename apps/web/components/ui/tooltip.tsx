import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export interface TooltipProps extends HTMLAttributes<HTMLSpanElement> {
  tip: string;
  side?: "top" | "bottom";
}

export function Tooltip({ tip, side = "top", className, children, ...props }: TooltipProps) {
  return (
    <span className={cn("group/tooltip relative inline-flex", className)} {...props}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 rounded-md border border-line bg-raised px-2 py-1 text-xs whitespace-nowrap text-ink opacity-0 shadow-lg transition-opacity duration-150 ease-out group-hover/tooltip:opacity-100",
          side === "top" ? "bottom-full mb-2" : "top-full mt-2",
        )}
      >
        {tip}
      </span>
    </span>
  );
}
