import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <span className="relative inline-flex w-full items-center">
      <select
        ref={ref}
        className={cn(
          "h-10 w-full cursor-pointer appearance-none rounded-md border border-line bg-sunken pr-9 pl-3 text-sm text-ink transition-colors duration-150 ease-out",
          "hover:border-line-strong focus:border-accent focus:ring-2 focus:ring-accent/30 focus:outline-none",
          "disabled:cursor-not-allowed disabled:opacity-50 [&>option]:bg-raised",
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute right-3 h-4 w-4 text-ink-faint"
      />
    </span>
  );
});
