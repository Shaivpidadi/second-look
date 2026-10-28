import { forwardRef, type InputHTMLAttributes, type LabelHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { invalid = false, className, ...props },
  ref,
) {
  return (
    <input
      ref={ref}
      className={cn(
        "h-10 w-full rounded-md border bg-sunken px-3 text-sm text-ink transition-colors duration-150 ease-out",
        "placeholder:text-ink-faint focus:outline-none",
        "disabled:cursor-not-allowed disabled:opacity-50",
        invalid
          ? "border-block/60 focus:border-block/70 focus:ring-2 focus:ring-block/25"
          : "border-line hover:border-line-strong focus:border-accent focus:ring-2 focus:ring-accent/30",
        className,
      )}
      {...props}
    />
  );
});

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn("mb-1.5 block text-[13px] font-medium text-ink-dim", className)}
      {...props}
    />
  );
}

export function FieldHint({ className, ...props }: LabelHTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1.5 text-xs text-ink-faint", className)} {...props} />;
}

export function FieldError({ className, ...props }: LabelHTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1.5 text-xs text-block", className)} {...props} />;
}
