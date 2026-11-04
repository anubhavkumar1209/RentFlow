import type { ReactNode } from "react";
import { cn } from "./cn";

export type Tone = "success" | "warning" | "danger" | "neutral" | "info";

const TONES: Record<Tone, string> = {
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
  neutral: "bg-page text-ink-2 ring-1 ring-inset ring-line",
  info: "bg-primary-soft text-primary",
};

/** Status → colour, the same everywhere (CLAUDE.md H4). */
const STATUS_TONE: Record<string, Tone> = {
  paid: "success",
  resolved: "success",
  active: "success",
  delivered: "success",
  occupied: "success",
  matched: "success",
  confirmed: "success",
  partially_paid: "warning",
  due_soon: "warning",
  waiting: "warning",
  notice: "warning",
  confirming: "warning",
  unmatched: "warning",
  setting_up: "warning",
  overdue: "danger",
  failed: "danger",
  disputed: "danger",
  emergency: "danger",
  no_money: "danger",
  draft: "neutral",
  vacant: "neutral",
  paused: "neutral",
  closed: "neutral",
  ignored: "neutral",
  blocked: "neutral",
  unavailable: "neutral",
  issued: "info",
  assigned: "info",
  in_progress: "info",
  reserved: "info",
  approved: "info",
  sent: "info",
};

export function statusTone(status: string): Tone {
  return STATUS_TONE[status] ?? "neutral";
}

export function Chip({ tone = "neutral", icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-[var(--radius-input)] px-2 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5", TONES[tone], className)}>
      {icon}
      {children}
    </span>
  );
}
