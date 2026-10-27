import {
  cloneElement,
  forwardRef,
  isValidElement,
  type ButtonHTMLAttributes,
  type ReactElement,
} from "react";
import { cn } from "../../lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Render classes onto the single child (e.g. a next/link) instead. */
  asChild?: boolean;
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    "bg-accent text-white hover:bg-[#2f74e8] active:bg-[#2a68d4] disabled:bg-white/10 disabled:text-ink-faint",
  secondary:
    "bg-white/[0.06] text-ink border border-line hover:bg-white/10 hover:border-line-strong disabled:text-ink-faint disabled:bg-transparent",
  ghost: "text-ink-dim hover:text-ink hover:bg-white/[0.06] disabled:text-ink-faint",
  danger:
    "bg-block/15 text-block border border-block/30 hover:bg-block/25 disabled:text-ink-faint disabled:bg-transparent disabled:border-line",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5",
  md: "h-10 px-4 text-sm gap-2",
  lg: "h-12 px-6 text-[15px] gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className, type = "button", asChild = false, ...props },
  ref,
) {
  const classes = cn(
    "inline-flex cursor-pointer items-center justify-center rounded-md font-medium whitespace-nowrap transition-colors duration-150 ease-out disabled:cursor-not-allowed",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
  if (asChild && isValidElement(props.children)) {
    const { children, ...rest } = props;
    return cloneElement(children as ReactElement<{ className?: string }>, {
      className: cn(classes, (children as ReactElement<{ className?: string }>).props.className),
      ...rest,
    });
  }
  return (
    <button ref={ref} type={type} className={classes} {...props} />
  );
});
