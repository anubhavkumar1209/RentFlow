import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-white hover:bg-primary-hover",
  secondary: "border border-line bg-card text-ink hover:bg-page",
  ghost: "text-ink-2 hover:bg-page hover:text-ink",
  danger: "bg-danger text-white hover:brightness-95",
};

// Tap targets: md/lg are ≥ 44px (CLAUDE.md H5).
const SIZES: Record<ButtonSize, string> = {
  sm: "h-9 px-3 text-sm gap-1.5",
  md: "h-11 px-4 text-sm gap-2",
  lg: "h-12 px-5 text-base gap-2",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", className?: string): string {
  return cn(
    "inline-flex shrink-0 items-center justify-center rounded-[var(--radius-input)] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 [&_svg]:size-4",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  icon,
  children,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode }) {
  return (
    <button className={buttonClass(variant, size, className)} {...props}>
      {icon}
      {children}
    </button>
  );
}
