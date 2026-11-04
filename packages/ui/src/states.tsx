import type { ReactNode } from "react";
import { cn } from "./cn";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-[var(--radius-input)] bg-line/70", className)} />;
}

/** Helpful empty state with one clear action (CLAUDE.md H5). */
export function EmptyState({ icon, title, description, action, className }: { icon?: ReactNode; title: string; description?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-line px-4 py-8 text-center", className)}>
      {icon ? <div className="mb-3 flex size-12 items-center justify-center rounded-full bg-primary-soft text-primary [&_svg]:size-6">{icon}</div> : null}
      <p className="font-medium text-ink">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-ink-2">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

/** Inline error message for a form or section. */
export function Alert({ tone = "danger", children }: { tone?: "danger" | "success" | "warning" | "info"; children: ReactNode }) {
  const styles = { danger: "bg-danger-soft text-danger", success: "bg-success-soft text-success", warning: "bg-warning-soft text-warning", info: "bg-primary-soft text-primary" }[tone];
  return (
    <p role={tone === "danger" ? "alert" : "status"} className={cn("rounded-[var(--radius-input)] px-3 py-2 text-sm", styles)}>
      {children}
    </p>
  );
}
