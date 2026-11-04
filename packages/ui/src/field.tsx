import type { ComponentProps, ReactNode } from "react";
import { cn } from "./cn";

const CONTROL =
  "w-full rounded-[var(--radius-input)] border border-line bg-card px-3 text-base text-ink outline-none transition placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/20 disabled:bg-page disabled:text-ink-2 aria-[invalid=true]:border-danger";

interface LabelProps {
  label: string;
  hint?: ReactNode;
  /** Inline error under the field (CLAUDE.md H5). */
  error?: string;
}

function Wrap({ label, hint, error, className, children }: LabelProps & { className?: string; children: ReactNode }) {
  return (
    <label className={cn("block", className)}>
      {label ? <span className="mb-1 block text-sm font-medium text-ink">{label}</span> : null}
      {children}
      {error ? <span className="mt-1 block text-xs text-danger">{error}</span> : hint ? <span className="mt-1 block text-xs text-ink-2">{hint}</span> : null}
    </label>
  );
}

export function Field({ label, hint, error, className, ...props }: ComponentProps<"input"> & LabelProps) {
  return (
    <Wrap label={label} hint={hint} error={error} className={className}>
      <input aria-invalid={error ? true : undefined} {...props} className={cn(CONTROL, "h-11")} />
    </Wrap>
  );
}

/** Native select: best on low-end Android, styled to match the other controls. */
export function Select({ label, hint, error, className, children, ...props }: ComponentProps<"select"> & LabelProps) {
  return (
    <Wrap label={label} hint={hint} error={error} className={className}>
      <select aria-invalid={error ? true : undefined} {...props} className={cn(CONTROL, "h-11 pr-8")}>
        {children}
      </select>
    </Wrap>
  );
}

export function Textarea({ label, hint, error, className, ...props }: ComponentProps<"textarea"> & LabelProps) {
  return (
    <Wrap label={label} hint={hint} error={error} className={className}>
      <textarea aria-invalid={error ? true : undefined} {...props} className={cn(CONTROL, "min-h-24 py-2")} />
    </Wrap>
  );
}

export function Check({ label, className, ...props }: ComponentProps<"input"> & { label: string }) {
  return (
    <label className={cn("flex min-h-11 items-center gap-2 text-sm text-ink", className)}>
      <input type="checkbox" {...props} className="size-5 rounded accent-[var(--color-primary)]" />
      {label}
    </label>
  );
}
