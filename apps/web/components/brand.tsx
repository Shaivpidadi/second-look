import { cn } from "../lib/cn";

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden>
        <rect x="0.5" y="0.5" width="25" height="25" rx="7" className="fill-raised stroke-line" />
        <rect x="6" y="8.5" width="10" height="12" rx="1.5" className="fill-white/25" />
        <rect x="10" y="5.5" width="10" height="12" rx="1.5" className="fill-accent" />
      </svg>
      <span className="text-[15px] font-semibold tracking-tight text-ink">Second Look</span>
    </span>
  );
}
